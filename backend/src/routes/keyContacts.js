// Key Contacts API routes
//
// SOURCE SAFETY RULES (enforced here):
//   • ?leadId present            → returns ALL sources (Apify + Apollo + LinkedIn etc.)
//                                   Lead Review / Approval Gate context — show everything.
//   • Default (no ?source param) → returns ONLY Apify contacts (source_type != 'apollo')
//   • ?source=apify             → same as default — Apify only
//   • ?source=apollo            → Apollo contacts only (no email/phone filter required)
//   • ?source=all               → everything (used by /contacts/all unified page)
//   • NULL source_type          → treated as 'apify' (safe default)
//
// DASHBOARD RULE:
//   When called with jobId only (no leadId) — e.g. from Apify or Apollo dashboards —
//   strict source separation is maintained so each dashboard only sees its own data.
//
// GET    /api/key-contacts?leadId=&jobId=&status=&source=
// GET    /api/key-contacts/stats/:jobId
// POST   /api/key-contacts/:id/approve
// POST   /api/key-contacts/:id/reject
// POST   /api/key-contacts/:id/push-hubspot
// POST   /api/key-contacts/bulk-approve
// POST   /api/key-contacts/bulk-push-hubspot
// POST   /api/key-contacts/enrich/:leadId   — manual re-trigger

const router   = require('express').Router();
const { supabase }               = require('../db/supabase');
const { enqueue }                = require('../services/cloudtasks');
const { createEnrichedContact }  = require('../services/hubspot');

// ── GET all contacts (filterable, source-safe) ────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { leadId, jobId, status, source } = req.query;

    let query = supabase
      .from('key_contacts')
      .select('*')
      .order('created_at', { ascending: false });

    // ── Source filtering — STRICT SEPARATION ──────────────────────────────────
    // EXCEPTION: when fetching by leadId (per-lead review context) always return
    // ALL sources so the Lead Review / Approval Gate shows every contact found
    // for that company — Apify, Apollo, LinkedIn, website, Google — in one table.
    // Dashboard pages use jobId without leadId and keep strict source separation.
    const effectiveSource = leadId ? 'all' : source;

    if (effectiveSource === 'all') {
      // Lead review context or unified /contacts/all page: no source filter.
    } else if (effectiveSource === 'apollo') {
      // Apollo dashboard: show only Apollo contacts (with or without email/phone).
      query = query.eq('source_type', 'apollo');
    } else {
      // Default (no param) OR source=apify → Apify-sourced contacts only.
      // Excludes Apollo. Treats NULL source_type as 'apify' (safe default).
      // PostgreSQL: neq excludes NULLs, so .or() is required to include nulls.
      query = query.or('source_type.neq.apollo,source_type.is.null');
    }

    if (leadId) query = query.eq('lead_id', leadId);
    if (status) query = query.eq('status', status);

    // Filter by job — join through leads table
    if (jobId) {
      const { data: leads } = await supabase
        .from('leads').select('id').eq('job_id', jobId);
      const ids = (leads || []).map(l => l.id);
      if (ids.length === 0) return res.json([]);
      query = query.in('lead_id', ids);
    }

    const { data, error } = await query;
    if (error) throw error;

    const contacts = data || [];

    // ── Enrich contacts with job context (for batch grouping in UI) ────────────
    // Get unique lead_ids, then look up job_id + job config for each
    const uniqueLeadIds = [...new Set(contacts.map(c => c.lead_id).filter(Boolean))];

    let leadJobMap = {}; // lead_id -> { job_id, job_config, job_created_at }
    if (uniqueLeadIds.length) {
      const { data: leads } = await supabase
        .from('leads')
        .select('id, job_id')
        .in('id', uniqueLeadIds);

      const uniqueJobIds = [...new Set((leads || []).map(l => l.job_id).filter(Boolean))];
      let jobMap = {};
      if (uniqueJobIds.length) {
        const { data: jobs } = await supabase
          .from('scrape_jobs')
          .select('id, config, created_at')
          .in('id', uniqueJobIds);
        (jobs || []).forEach(j => { jobMap[j.id] = j; });
      }

      (leads || []).forEach(l => {
        leadJobMap[l.id] = {
          job_id:         l.job_id || null,
          job_config:     l.job_id && jobMap[l.job_id] ? jobMap[l.job_id].config     : null,
          job_created_at: l.job_id && jobMap[l.job_id] ? jobMap[l.job_id].created_at : null,
        };
      });
    }

    // Attach job context to each contact
    const enriched = contacts.map(c => ({
      ...c,
      job_id:         (leadJobMap[c.lead_id] || {}).job_id         || null,
      job_config:     (leadJobMap[c.lead_id] || {}).job_config     || null,
      job_created_at: (leadJobMap[c.lead_id] || {}).job_created_at || null,
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET summary counts for a job ─────────────────────────────────────────────
router.get('/stats/:jobId', async (req, res) => {
  try {
    const { data: leads } = await supabase
      .from('leads').select('id').eq('job_id', req.params.jobId);
    const ids = (leads || []).map(l => l.id);
    if (ids.length === 0) return res.json({ total: 0, pending: 0, approved: 0, rejected: 0, pushed: 0 });

    const { data, error } = await supabase
      .from('key_contacts')
      .select('status')
      .in('lead_id', ids)
      .or('source_type.neq.apollo,source_type.is.null'); // Apify only for job stats

    if (error) throw error;

    const stats = { total: data.length, pending: 0, approved: 0, rejected: 0, pushed: 0 };
    data.forEach(c => { if (stats[c.status] !== undefined) stats[c.status]++; });
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Approve a single contact ──────────────────────────────────────────────────
router.post('/:id/approve', async (req, res) => {
  try {
    const { reviewerNotes } = req.body;
    const { error } = await supabase.from('key_contacts').update({
      status:         'approved',
      reviewer_notes: reviewerNotes || '',
    }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Contact approved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Reject a single contact ───────────────────────────────────────────────────
router.post('/:id/reject', async (req, res) => {
  try {
    const { reviewerNotes } = req.body;
    const { error } = await supabase.from('key_contacts').update({
      status:         'rejected',
      reviewer_notes: reviewerNotes || '',
    }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Contact rejected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Push a single approved contact to HubSpot ────────────────────────────────
router.post('/:id/push-hubspot', async (req, res) => {
  try {
    const { data: contact, error: fetchErr } = await supabase
      .from('key_contacts')
      .select('*, leads(website, address, industry, lead_score, lead_status, rating, reviews_count, google_maps_url)')
      .eq('id', req.params.id)
      .single();

    if (fetchErr) throw fetchErr;

    const lead = contact.leads || {};
    const hubspotId = await createEnrichedContact({
      first_name:      contact.first_name,
      last_name:       contact.last_name,
      job_title:       contact.job_title,
      linkedin_url:    contact.linkedin_url,
      public_email:    contact.public_email,
      public_phone:    contact.public_phone,
      company_name:    contact.company_name,
      website:         lead.website         || '',
      address:         lead.address         || '',
      industry:        lead.industry        || '',
      lead_score:      lead.lead_score      || 0,
      lead_status:     lead.lead_status     || 'Warm',
      rating:          lead.rating,
      reviews_count:   lead.reviews_count,
      google_maps_url: lead.google_maps_url,
    });

    await supabase.from('key_contacts').update({
      hubspot_contact_id: hubspotId,
      pushed_to_hubspot:  true,
      status:             'pushed',
    }).eq('id', req.params.id);

    res.json({ message: 'Pushed to HubSpot', hubspotId });
  } catch (err) {
    console.error('[hubspot:push] Failed:', err.message, err.response?.data || '');
    res.status(500).json({ error: err.message, details: err.response?.data });
  }
});

// ── Bulk approve ──────────────────────────────────────────────────────────────
router.post('/bulk-approve', async (req, res) => {
  try {
    const contactIds = req.body.contactIds || req.body.ids; // apolloApi.ts sent `ids`
    if (!contactIds?.length) return res.status(400).json({ error: 'No contactIds' });

    const { error } = await supabase.from('key_contacts').update({
      status: 'approved',
    }).in('id', contactIds);

    if (error) throw error;
    res.json({ message: `${contactIds.length} contacts approved` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Bulk push to HubSpot (via Cloud Tasks queue) ──────────────────────────────
router.post('/bulk-push-hubspot', async (req, res) => {
  try {
    const contactIds = req.body.contactIds || req.body.ids; // apolloApi.ts sent `ids`
    const jobId = req.body.jobId;
    if (!contactIds?.length) return res.status(400).json({ error: 'No contactIds' });

    await enqueue('hubspot-queue', '/worker/hubspot-contacts', { contactIds, jobId });
    res.json({ message: `${contactIds.length} contacts queued for HubSpot` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Manual re-trigger enrichment for one lead ─────────────────────────────────
router.post('/enrich/:leadId', async (req, res) => {
  try {
    const { jobId } = req.body;

    await supabase.from('leads').update({
      enrichment_status: 'queued',
    }).eq('id', req.params.leadId);

    await enqueue('enrich-queue', '/worker/enrich', {
      leadIds: [req.params.leadId],
      jobId:   jobId || 'manual',
    });

    res.json({ message: 'Enrichment queued' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
