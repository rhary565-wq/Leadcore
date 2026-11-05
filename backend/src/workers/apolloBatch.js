// Worker: /worker/apollo-batch
// Called by Cloud Tasks after the clean step, only when job.config.apolloEnabled = true.
// Runs the full Apollo enrichment pipeline for all Hot + Warm leads in the job:
//
//   1. enrichCompanyWithApollo  — search Apollo for company by domain/name
//      → stores headcount, revenue, revenue_range, dbd_url, apollo_company_id
//   2. searchContactsForLead   — same people-search approach as working /api/apollo/enrich route:
//      → mixed_people/api_search with company name + Thailand location + seniority
//      → skips social/platform domains (fb, instagram, etc.) — falls back to name search
//      → stores to key_contacts with source_type='apollo'
//
// ── SAME APPROACH AS /api/apollo/enrich/:leadId ───────────────────────────────
// The contacts step now uses the SAME working path as the Apollo search page:
//
//   apollo-batch worker          │  /api/apollo/enrich route
//   ─────────────────────────────┼────────────────────────────────────────────
//   apolloPeopleSearch service   │  same logic (buildSearchUrl, normalizeContact)
//   Synchronous — returns rows   │  Async webhook delivery
//   Saves with lead_id set       │  Saves with apollo_run_id set (lead_id=null)
//   Triggered by clean step      │  Triggered by user on Apollo Search page
//
// Duplication protection:
//   - Company enrichment: skip if lead.apollo_company_enriched_at is already set
//   - Contacts: skip if apollo contacts already exist for this lead (count > 0)
// ─────────────────────────────────────────────────────────────────────────────

const { supabase }              = require('../db/supabase');
const { enqueue }               = require('../services/cloudtasks');
const { enrichCompanyWithApollo, saveApolloContactsForLead } = require('../services/apolloCompany');
const { searchContactsForLead } = require('../services/apolloPeopleSearch');
const { findFallbackContacts }  = require('../services/contactFinder');

// Places that are clearly not businesses — same list as cleaner.js JUNK_CATEGORIES.
// Checked in pre_clean so junk entries don't waste Apollo quota or enter fallback search.
const JUNK_CATEGORIES = new Set([
  'parking lot', 'parking garage', 'parking facility', 'car park', 'parkade',
  'parking', 'paid parking lot',
  'atm', 'cash machine', 'bank machine',
  'food court', 'food stall', 'canteen', 'cafeteria',
  'restroom', 'public restroom', 'public toilet', 'toilet',
  'vending machine', 'phone booth', 'elevator', 'escalator',
]);

// ── Pre-clean mode ─────────────────────────────────────────────────────────────
// Called by scrape.js BEFORE clean.js when apolloEnabled.
// Reads raw Apify data, searches Apollo contacts for every company,
// stores them in scrape_jobs.apollo_contacts_data keyed by company name,
// then enqueues clean.js so contacts are already there during scoring.
async function handleApolloPreClean(jobId, jobConfig) {
  console.log(`[apollo-batch] Pre-clean: fetching contacts before scoring for job ${jobId}`);

  const { data: jobRow, error: jobErr } = await supabase
    .from('scrape_jobs')
    .select('raw_data')
    .eq('id', jobId)
    .single();

  if (jobErr || !jobRow) throw new Error(`Pre-clean: could not load raw_data for ${jobId}`);

  const rawData     = jobRow.raw_data || [];
  const maxContacts = jobConfig.maxContacts ?? 500;

  const apolloContactsData = {};   // { companyName: [contactRow, ...] }
  const needsFallback      = [];   // companies where Apollo found 0 contacts
  let totalContacts = 0;

  for (const company of rawData) {
    if (totalContacts >= maxContacts) {
      console.log(`[apollo-batch] Pre-clean: contact budget reached (${maxContacts})`);
      break;
    }

    // Extract company identifiers from raw Apify data
    const companyName = company.title || company.name || company.company_name || '';
    const website     = company.website || company.domain || '';
    const city        = company.city    || '';

    if (!companyName) continue;

    // Skip junk Google Maps categories — parking lots, ATMs, etc. are never valid leads
    // and should never reach Apollo search or the fallback (LinkedIn/Facebook/Website).
    const industry = (company.categoryName || company.category || company.industry || '').toLowerCase().trim();
    if (JUNK_CATEGORIES.has(industry)) {
      console.log(`[apollo-batch] Pre-clean: skipping junk category "${companyName}" (${company.categoryName || industry})`);
      continue;
    }

    try {
      const remaining = maxContacts - totalContacts;
      const fakeLead  = { id: null, company_name: companyName, website, city };
      const contacts  = await searchContactsForLead(fakeLead, remaining);

      if (contacts.length > 0) {
        // Strip lead_id (doesn't exist yet) — clean.js will set it after creating leads
        apolloContactsData[companyName] = contacts.map(({ lead_id, ...rest }) => rest);
        totalContacts += contacts.length;
        console.log(`[apollo-batch] Pre-clean: "${companyName}" — ${contacts.length} contacts`);
      } else {
        // Apollo found nothing — queue for fallback (LinkedIn / Facebook / Website)
        needsFallback.push(company);
        console.log(`[apollo-batch] Pre-clean: "${companyName}" — 0 contacts from Apollo, added to fallback`);
      }

      await new Promise(r => setTimeout(r, 1200)); // Apollo rate limit

    } catch (err) {
      console.error(`[apollo-batch] Pre-clean error for "${companyName}": ${err.message}`);
      // Also add errored companies to fallback
      needsFallback.push(company);
    }
  }

  console.log(`[apollo-batch] Pre-clean Apollo done: ${totalContacts} contacts, ${needsFallback.length} companies need fallback`);

  // ── Fallback: LinkedIn / Facebook / Website / Apollo-Apify ──────────────────
  // Only runs when Apollo API found 0 contacts. Keeps contact budget in mind.
  // Wrapped in a 6-minute timeout: LinkedIn actor can take up to 540s; without a
  // hard cap the pre_clean worker may hang and never hand off to clean.js.
  const FALLBACK_TIMEOUT_MS = 6 * 60 * 1000;

  if (needsFallback.length > 0 && totalContacts < maxContacts) {
    console.log(`[apollo-batch] Pre-clean: starting fallback contact search for ${needsFallback.length} companies`);
    try {
      // Signal the pipeline UI that fallback is running
      await supabase.from('scrape_jobs').update({ status: 'contact_fallback' }).eq('id', jobId);

      // Race the fallback against a timeout — if Apify actors take too long the
      // pipeline still moves forward (clean.js runs with whatever Apollo found).
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Fallback timeout after ${FALLBACK_TIMEOUT_MS / 60000} minutes`)), FALLBACK_TIMEOUT_MS)
      );
      const fallbackResults = await Promise.race([
        findFallbackContacts(needsFallback),
        timeoutPromise,
      ]);

      for (const [companyName, contacts] of Object.entries(fallbackResults)) {
        if (!contacts.length) continue;
        // Respect remaining budget
        const remaining = maxContacts - totalContacts;
        if (remaining <= 0) break;
        const trimmed = contacts.slice(0, remaining);
        apolloContactsData[companyName] = (apolloContactsData[companyName] || []).concat(trimmed);
        totalContacts += trimmed.length;
        console.log(`[apollo-batch] Fallback: "${companyName}" — ${trimmed.length} contact(s) via LinkedIn/Facebook/Web/Apollo`);
      }
    } catch (err) {
      console.warn(`[apollo-batch] Pre-clean: fallback search failed or timed out: ${err.message}`);
      // Non-fatal — continue to clean with whatever Apollo found
    }
  }

  console.log(`[apollo-batch] Pre-clean done: ${totalContacts} total contacts across ${Object.keys(apolloContactsData).length} companies`);

  // Save contacts map and hand off to clean.js
  await supabase.from('scrape_jobs').update({
    apollo_contacts_data: apolloContactsData,
    status: 'cleaning',
  }).eq('id', jobId);

  await enqueue('clean-queue', '/worker/clean', { jobId, config: jobConfig });
  console.log(`[apollo-batch] Pre-clean: handed off to clean worker for job ${jobId}`);
}

async function handleApolloBatch(req, res) {
  const { jobId, config: jobConfig = {}, mode = 'post_clean' } = req.body;

  // Respond immediately — Apollo can take a few minutes
  res.status(200).json({ status: 'ok', message: 'Apollo batch started' });

  // ── Route by mode ─────────────────────────────────────────────────────────
  // pre_clean: runs before clean.js (new default for scrape pipeline)
  // post_clean: runs after clean.js (used by manual /api/apollo/enrich/:leadId only)
  if (mode === 'pre_clean') {
    try {
      await handleApolloPreClean(jobId, jobConfig);
    } catch (err) {
      console.error(`[apollo-batch] Pre-clean failed for job ${jobId}:`, err.message);
      // Still hand off to clean so the job doesn't get stuck
      await supabase.from('scrape_jobs').update({ status: 'cleaning' }).eq('id', jobId);
      await enqueue('clean-queue', '/worker/clean', { jobId, config: jobConfig });
    }
    return;
  }

  // ── Config flags (post_clean mode) ───────────────────────────────────────
  const maxContacts  = jobConfig.maxContacts  ?? 500;   // cap total contacts for this job
  const autoApprove  = jobConfig.autoApprove  ?? false; // skip manual review + push to HubSpot

  try {
    console.log(`[apollo-batch] Starting for job ${jobId} (maxContacts=${maxContacts}, autoApprove=${autoApprove})`);

    await supabase.from('scrape_jobs')
      .update({ status: 'apollo_enriching' })
      .eq('id', jobId);

    // Get Hot + Warm leads for this job
    const { data: leads, error } = await supabase
      .from('leads')
      .select('*')
      .eq('job_id', jobId)
      .in('lead_status', ['Hot', 'Warm'])
      .order('lead_score', { ascending: false });

    if (error) throw error;
    console.log(`[apollo-batch] Processing ${leads.length} Hot/Warm lead(s)`);

    let totalCompanies = 0;
    let totalContacts  = 0;

    for (const lead of leads) {
      // ── Respect maxContacts budget ─────────────────────────────────────────
      if (totalContacts >= maxContacts) {
        console.log(`[apollo-batch] Max contacts reached (${maxContacts}), skipping remaining leads`);
        break;
      }

      try {
        // ── Step 1: Company enrichment (headcount, revenue, DBD URL) ──────────
        // apolloCompany.js cleanDomain has SOCIAL_DOMAINS guard — Facebook/Instagram
        // URLs return null → falls back to name search → no wrong Meta org match.
        let apolloOrgId = lead.apollo_company_id || null;

        if (!lead.apollo_company_enriched_at) {
          const result = await enrichCompanyWithApollo(lead);
          if (result.found) {
            apolloOrgId = result.apolloOrgId;
            totalCompanies++;
            console.log(`[apollo-batch] "${lead.company_name}" — company enriched (orgId=${apolloOrgId})`);
          } else {
            console.log(`[apollo-batch] "${lead.company_name}" — no Apollo org match, DBD URL saved`);
          }
        } else {
          console.log(`[apollo-batch] "${lead.company_name}" — company already enriched, skipping`);
        }

        // ── Step 2: Contacts ──────────────────────────────────────────────────
        // Skip if apollo contacts already exist for this lead
        const { count: existingCount } = await supabase
          .from('key_contacts')
          .select('id', { count: 'exact', head: true })
          .eq('lead_id', lead.id)
          .eq('source_type', 'apollo');

        if (existingCount > 0) {
          console.log(`[apollo-batch] "${lead.company_name}" — contacts already exist (${existingCount}), skipping`);
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }

        const remainingBudget = maxContacts - totalContacts;

        if (apolloOrgId) {
          // ── Path A: org known → org-filtered search (returns stored emails) ──
          const saved = await saveApolloContactsForLead(lead.id, lead.company_name, apolloOrgId, remainingBudget);
          totalContacts += saved;
          console.log(`[apollo-batch] "${lead.company_name}" — ${saved} org-filtered contact(s) saved`);
        } else {
          // ── Path B: no org match → name + Thailand location people search ────
          // (same approach as /api/apollo/enrich route)
          // Returns contacts with name/title/LinkedIn even when email is not yet in Apollo's DB.
          const contacts = await searchContactsForLead(lead, remainingBudget);
          if (contacts.length > 0) {
            const { error: insertErr } = await supabase.from('key_contacts').insert(contacts);
            if (insertErr) {
              console.error(`[apollo-batch] "${lead.company_name}" — contact insert error: ${insertErr.message}`);
            } else {
              totalContacts += contacts.length;
              console.log(`[apollo-batch] "${lead.company_name}" — ${contacts.length} name-search contact(s) saved`);
            }
          } else {
            console.log(`[apollo-batch] "${lead.company_name}" — not found in Apollo`);
          }
        }

        // Respect Apollo rate limits — 1.5 s between leads
        await new Promise(r => setTimeout(r, 1500));

      } catch (err) {
        console.error(`[apollo-batch] Error for "${lead.company_name}": ${err.message}`);
        // Continue to next lead — don't fail entire batch
      }
    }

    // ── Auto-approve contacts + push to HubSpot ───────────────────────────────
    // When autoApprove is on, skip manual review — approve every pending contact
    // for this job and queue them all for HubSpot push immediately.
    if (autoApprove && totalContacts > 0) {
      try {
        // Collect all pending contacts across all leads for this job
        const leadIds = leads.map(l => l.id);
        const { data: pendingContacts } = await supabase
          .from('key_contacts')
          .select('id')
          .in('lead_id', leadIds)
          .eq('status', 'pending');

        if (pendingContacts?.length) {
          const contactIds = pendingContacts.map(c => c.id);

          // Bulk-approve
          await supabase.from('key_contacts').update({
            status:     'approved',
            updated_at: new Date().toISOString(),
          }).in('id', contactIds);

          // Queue HubSpot contacts push
          await enqueue('hubspot-queue', '/worker/hubspot-contacts', { contactIds, jobId });

          console.log(`[apollo-batch] Auto-approved ${contactIds.length} contact(s) and queued HubSpot push`);
        }
      } catch (err) {
        console.error('[apollo-batch] Auto-approve contacts failed:', err.message);
      }
    }

    await supabase.from('scrape_jobs')
      .update({ status: 'done' })
      .eq('id', jobId);

    console.log(`[apollo-batch] Job ${jobId} done — ${totalCompanies} companies + ${totalContacts} contacts enriched`);

  } catch (err) {
    console.error(`[apollo-batch] Job ${jobId} failed:`, err.message);
    await supabase.from('scrape_jobs')
      .update({ status: 'done' })
      .eq('id', jobId);
  }
}

module.exports = { handleApolloBatch };
