// Worker: /worker/clean
// Cleans, scores all leads then saves contacts and notifies approver.
//
// Reads from scrape_jobs DB columns (set by previous workers to bypass Cloud Tasks 1MB limit):
//   raw_data             — raw Apify company data
//   contacts_data        — legacy Apify contacts (kept for backward compatibility)
//   apollo_contacts_data — Apollo contacts pre-fetched BEFORE this clean pass
//                          (only set when apolloEnabled, from apollo-batch pre_clean mode)
// All three columns are cleared after processing to free up DB space.

const { supabase }          = require('../db/supabase');
const { cleanAndScore }     = require('../services/cleaner');
const { sendApprovalReady } = require('../services/notify');
const { enqueue }           = require('../services/cloudtasks');

async function handleClean(req, res) {
  const { jobId, config } = req.body;

  try {
    // ── Read rawData + contactsByCompany from DB (not from payload) ────────────
    const { data: jobRow, error: jobErr } = await supabase
      .from('scrape_jobs')
      .select('raw_data, contacts_data, apollo_contacts_data')
      .eq('id', jobId)
      .single();

    if (jobErr || !jobRow) throw new Error(`Could not load job data for ${jobId}: ${jobErr?.message}`);

    const rawData            = jobRow.raw_data             || [];
    const contactsByCompany  = jobRow.contacts_data        || {}; // legacy Apify contacts
    const apolloContactsMap  = jobRow.apollo_contacts_data || {}; // Apollo pre-fetched contacts

    console.log(`[clean] Processing ${rawData.length} records for job ${jobId}`);

    // Run full clean + score pipeline
    const processed = await cleanAndScore(rawData, config);
    const goodLeads = processed.filter(l => !l.is_duplicate);
    const dupeCount = processed.length - goodLeads.length;

    // Insert all good leads and get back IDs
    let insertedLeads = [];
    if (goodLeads.length > 0) {
      const toInsert = goodLeads.map(l => ({
        job_id:            jobId,
        company_name:      l.company_name    || null,
        industry:          l.industry        || null,
        address:           l.address         || null,
        city:              l.city            || null,
        phone:             l.phone_formatted || l.phone || null,
        website:           l.website         || null,
        rating:            l.rating          || null,
        reviews_count:     l.reviews_count   || 0,
        lead_score:        l.lead_score      || 0,
        lead_status:       l.lead_status     || 'Low',
        approval_status:   'pending',
        pushed_to_hubspot: false,
        google_maps_url:   l.google_maps_url || null,
        enrichment_status: 'pending_enrichment', // corrected after contact filter runs below
        enriched_at:       new Date().toISOString(),
        // Unified-app columns (sql/unified_schema.sql) — map view + Thai territory filters
        latitude:          l.latitude        ?? null,
        longitude:         l.longitude       ?? null,
        email:             l.email           || null,
        province:          config?.province    || null,
        district:          config?.district    || null,
        sub_district:      config?.subDistrict || null,
      }));

      for (let i = 0; i < toInsert.length; i += 100) {
        let batch = toInsert.slice(i, i + 100);
        let { data, error } = await supabase
          .from('leads')
          .insert(batch)
          .select('id, company_name');
        // Older DB without the unified columns → retry with the original columns only
        if (error && (error.code === 'PGRST204' || /column/i.test(error.message))) {
          console.warn('[clean] Unified lead columns missing — run sql/unified_schema.sql. Retrying without them.');
          batch = batch.map(({ latitude, longitude, email, province, district, sub_district, ...rest }) => rest);
          ({ data, error } = await supabase.from('leads').insert(batch).select('id, company_name'));
        }
        if (error) throw error;
        insertedLeads.push(...(data || []));
      }
    }

    // Save pre-collected contacts linked to real lead IDs
    const allContacts = [];
    const GENERIC_NAMES = new Set(['business contact','contact','info','admin','unknown','n/a','na','user','owner','manager']);

    for (const lead of insertedLeads) {
      // Merge Apify contacts (legacy) + Apollo pre-fetched contacts
      const apifyContacts  = contactsByCompany[lead.company_name] || [];
      const apolloContacts = apolloContactsMap[lead.company_name] || [];
      const contacts       = [...apifyContacts, ...apolloContacts];
      for (const c of contacts) {
        const rawName = (c.person_name || '').trim();

        // Skip contacts with no name OR a generic placeholder — these are just
        // business phone/email entries, not real people.
        if (!rawName || GENERIC_NAMES.has(rawName.toLowerCase())) continue;

        // ALL contacts must have at least email, phone, or LinkedIn URL.
        // A name with no contact detail is not actionable for any outreach channel.
        // (LinkedIn URL alone is useful — sales team can reach out via DM.)
        if (!c.public_email && !c.public_phone && !c.linkedin_url) continue;

        // Skip contacts that look like email usernames (no spaces, mixed case + digits)
        // e.g. "Thexaesthetic88" extracted from thexaesthetic88@gmail.com
        const looksLikeEmailName = /^[A-Z][a-z]+[0-9]+$/.test(rawName) || // e.g. Thexaesthetic88
                                   (rawName.split(/\s+/).length === 1 && rawName.length > 20);
        if (looksLikeEmailName) continue;

        const parts = rawName.split(/\s+/);
        allContacts.push({
          lead_id:           lead.id,
          company_name:      lead.company_name,
          person_name:       rawName,
          first_name:        parts[0]                 || '',
          last_name:         parts.slice(1).join(' ') || '',
          job_title:         c.job_title     || '',
          department:        getDepartment(c.job_title),
          seniority:         getSeniority(c.job_title),
          linkedin_url:      c.linkedin_url  || '',
          source_url:        c.source_url    || '',
          source_type:       c.source_type   || 'apify',
          public_email:      c.public_email  || '',
          public_phone:      c.public_phone  || '',
          confidence_score:  scoreContact(c),
          confidence_reason: c.source_type   || '',
          status:            'pending',
        });
      }
    }

    if (allContacts.length > 0) {
      for (let i = 0; i < allContacts.length; i += 100) {
        const { error } = await supabase.from('key_contacts').insert(allContacts.slice(i, i + 100));
        if (error) console.error('[clean] Contact insert error:', error.message);
      }
      console.log(`[clean] Saved ${allContacts.length} contact(s) across ${insertedLeads.length} lead(s)`);
    }

    // ── Fix enrichment_status based on contacts actually saved (post-filter) ───
    // We set 'pending_enrichment' on insert. Now update each lead to the correct
    // status: 'enriched' if it got real contacts, 'no_contacts_found' otherwise.
    if (insertedLeads.length > 0) {
      const leadsWithContacts = new Set(allContacts.map(c => c.lead_id));
      const enrichedIds       = insertedLeads.filter(l => leadsWithContacts.has(l.id)).map(l => l.id);
      const notEnrichedIds    = insertedLeads.filter(l => !leadsWithContacts.has(l.id)).map(l => l.id);
      if (enrichedIds.length)
        await supabase.from('leads').update({ enrichment_status: 'enriched' }).in('id', enrichedIds);
      if (notEnrichedIds.length)
        await supabase.from('leads').update({ enrichment_status: 'no_contacts_found' }).in('id', notEnrichedIds);
      console.log(`[clean] enrichment_status — enriched:${enrichedIds.length} no_contacts:${notEnrichedIds.length}`);
    }

    // Count by status
    const hot  = goodLeads.filter(l => l.lead_status === 'Hot').length;
    const warm = goodLeads.filter(l => l.lead_status === 'Warm').length;
    const low  = goodLeads.filter(l => l.lead_status === 'Low').length;

    // Update job to done + clear temporary large data columns
    await supabase.from('scrape_jobs').update({
      status:           'done',
      verified_records: goodLeads.length,
      hot_count:        hot,
      warm_count:       warm,
      low_count:        low,
      raw_data:              null,  // free up DB space
      contacts_data:         null,  // free up DB space
      apollo_contacts_data:  null,  // free up DB space
    }).eq('id', jobId);

    console.log(`[clean] Job ${jobId} done — Hot:${hot} Warm:${warm} Low:${low} Dupes:${dupeCount} Contacts:${allContacts.length}`);

    const { data: job } = await supabase.from('scrape_jobs').select('created_by').eq('id', jobId).single();

    if (hot + warm > 0) {
      await sendApprovalReady({ jobId, hot, warm, createdBy: job?.created_by });
      console.log(`[clean] Approval email sent for job ${jobId}`);
    }

    // ── Auto-approve leads if autoApprove is enabled ──────────────────────────
    // Skips the human approval step: marks all inserted leads as approved and
    // immediately queues them for HubSpot push.
    if (config?.autoApprove && insertedLeads.length > 0) {
      try {
        const leadIds = insertedLeads.map(l => l.id);
        await supabase.from('leads').update({
          approval_status: 'approved',
          approved_by:     'auto',
          approved_at:     new Date().toISOString(),
        }).in('id', leadIds);
        await enqueue('hubspot-queue', '/worker/hubspot', { leadIds, jobId });
        console.log(`[clean] Auto-approved ${leadIds.length} lead(s) and queued HubSpot push`);
      } catch (err) {
        console.error('[clean] Auto-approve leads failed:', err.message);
      }
    }

    // Apollo enrichment now runs BEFORE clean (pre_clean mode in apollo-batch).
    // No post-clean Apollo trigger needed here — contacts are already saved above.

    res.status(200).json({ status: 'ok', hot, warm, low });

  } catch (err) {
    console.error(`[clean] Job ${jobId} failed:`, err.message);
    await supabase.from('scrape_jobs').update({ status: 'error', last_error: err.message }).eq('id', jobId);
    res.status(200).json({ status: 'error', message: err.message });
  }
}

function getDepartment(title) {
  const t = (title || '').toLowerCase();
  if (t.includes('sales') || t.includes('commercial'))  return 'Sales';
  if (t.includes('marketing'))                           return 'Marketing';
  if (t.includes('logistics') || t.includes('freight')) return 'Logistics';
  if (t.includes('operations'))                          return 'Operations';
  if (t.includes('finance') || t.includes('cfo'))       return 'Finance';
  return 'General Management';
}

function getSeniority(title) {
  const t = (title || '').toLowerCase();
  if (['ceo','owner','founder','managing director','md','president'].some(k => t.includes(k))) return 'Executive';
  if (['director','head of','vp ','chief'].some(k => t.includes(k)))                          return 'Director';
  if (t.includes('manager'))                                                                    return 'Manager';
  return 'Other';
}

function scoreContact(c) {
  let score = 30;
  if (c.public_email)                            score += 25;
  if (c.public_phone)                            score += 10;
  if (c.linkedin_url)                            score += 15;
  if (c.source_type === 'facebook')              score += 10;
  if (c.source_type === 'about_page')            score += 10;
  if (c.source_type === 'google')                score +=  8;
  if (c.source_type === 'website')               score +=  5;
  const t = (c.job_title || '').toLowerCase();
  if (['ceo','owner','founder','md','managing director'].some(k => t.includes(k))) score += 20;
  else if (['director','head of'].some(k => t.includes(k)))                        score += 12;
  else if (t.includes('manager'))                                                   score +=  6;
  return Math.min(100, score);
}

module.exports = { handleClean };
