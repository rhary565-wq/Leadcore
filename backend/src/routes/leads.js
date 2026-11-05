const router    = require('express').Router();
const { supabase } = require('../db/supabase');
const { enqueue }  = require('../services/cloudtasks');
const { enrichCompanyWithApollo, saveApolloContactsForLead } = require('../services/apolloCompany');

// GET /api/leads?jobId=xxx&status=Hot&approval=pending
router.get('/', async (req, res) => {
  try {
    const { jobId, status, approval, page = 1, limit = 50 } = req.query;

    let query = supabase
      .from('leads')
      .select('*')
      .order('lead_score', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (jobId)    query = query.eq('job_id', jobId);
    if (status)   query = query.eq('lead_status', status);
    if (approval) query = query.eq('approval_status', approval);

    const { data, error } = await query;
    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leads/:id — Single lead detail
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('leads').select('*').eq('id', req.params.id).single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leads/approve — Approve one or many leads -> triggers HubSpot push
router.post('/approve', async (req, res) => {
  try {
    const { leadIds, approvedBy, jobId } = req.body;

    if (!leadIds?.length) {
      return res.status(400).json({ error: 'No lead IDs provided' });
    }

    // Mark as approved
    const { error: updateError } = await supabase.from('leads').update({
      approval_status: 'approved',
      approved_by:     approvedBy || 'unknown',
      approved_at:     new Date().toISOString()
    }).in('id', leadIds);

    if (updateError) {
      console.error('[approve] Supabase update failed:', updateError.message);
      throw updateError;
    }

    console.log(`[approve] Marked ${leadIds.length} lead(s) as approved`);

    // Queue HubSpot push — automation resumes here
    try {
      await enqueue('hubspot-queue', '/worker/hubspot', { leadIds, jobId });
      console.log(`[approve] HubSpot task queued for ${leadIds.length} lead(s)`);
    } catch (enqueueErr) {
      console.error('[approve] Failed to queue HubSpot task:', enqueueErr.message);
    }

    res.json({
      message: `${leadIds.length} lead(s) approved and queued for HubSpot.`,
      count:   leadIds.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leads/reject — Reject leads with a reason
router.post('/reject', async (req, res) => {
  try {
    const { leadIds, reason, rejectedBy } = req.body;

    await supabase.from('leads').update({
      approval_status:  'rejected',
      rejection_reason: reason || 'No reason given',
      approved_by:      rejectedBy || 'unknown',
      approved_at:      new Date().toISOString()
    }).in('id', leadIds);

    res.json({
      message: `${leadIds.length} lead(s) rejected.`,
      count:   leadIds.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/leads/:id/notes — Save reviewer notes on a lead
router.patch('/:id/notes', async (req, res) => {
  try {
    const { notes } = req.body;
    await supabase.from('leads')
      .update({ reviewer_notes: notes })
      .eq('id', req.params.id);
    res.json({ message: 'Notes saved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/leads/:id/enrich-apollo
// Trigger Apollo company enrichment for one Apify lead.
// Searches Apollo by domain/name, saves headcount + revenue + DBD URL,
// then retrieves and saves associated business contacts.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/enrich-apollo', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: lead, error: fetchErr } = await supabase
      .from('leads').select('*').eq('id', id).single();
    if (fetchErr || !lead) return res.status(404).json({ error: 'Lead not found' });

    // Run Apollo company enrichment (domain -> name fallback, always generates DBD URL)
    const result = await enrichCompanyWithApollo(lead);

    // If matched, fetch and save associated contacts
    let contactCount = 0;
    if (result.found && result.apolloOrgId) {
      contactCount = await saveApolloContactsForLead(id, lead.company_name, result.apolloOrgId);
    }

    res.json({
      success:      true,
      found:        result.found,
      apolloOrgId:  result.apolloOrgId  || null,
      headcount:    result.headcount     || null,
      revenue:      result.revenue       || null,
      revenueRange: result.revenueRange  || null,
      dbdUrl:       result.dbdUrl,
      contactCount,
      message:      result.found
        ? `Apollo matched "${lead.company_name}" — ${contactCount} contacts saved`
        : `No Apollo match for "${lead.company_name}" — DBD link generated`,
    });
  } catch (err) {
    console.error('[leads:enrich-apollo] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/leads/:id/apollo-contacts
// Return Apollo-sourced contacts already saved for this lead.
// Returns ALL Apollo contacts regardless of email/phone — source badge on frontend.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id/apollo-contacts', async (req, res) => {
  try {
    const { id } = req.params;

    // Get the lead to find its apollo_company_id
    const { data: lead, error: leadErr } = await supabase
      .from('leads').select('apollo_company_id').eq('id', id).single();
    if (leadErr || !lead) return res.status(404).json({ error: 'Lead not found' });

    // Return ALL Apollo contacts for this lead — no email/phone filter.
    // The frontend displays source badges so users can see what's available.
    let query = supabase
      .from('key_contacts')
      .select('*')
      .eq('lead_id', id)
      .eq('source_type', 'apollo')
      .order('confidence_score', { ascending: false });

    if (lead.apollo_company_id) {
      query = query.eq('apollo_company_id', lead.apollo_company_id);
    }

    const { data, error } = await query;
    if (error) throw error;

    const contacts = data || [];
    res.json({ success: true, count: contacts.length, contacts });
  } catch (err) {
    console.error('[leads:apollo-contacts] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
