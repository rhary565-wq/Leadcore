const router    = require('express').Router();
const { v4: uuid } = require('uuid');
const { supabase } = require('../db/supabase');
const { enqueue }  = require('../services/cloudtasks');


// POST /api/jobs — Start a new lead generation run
router.post('/', async (req, res) => {
  try {
    const { config, createdBy } = req.body;

    // Validate required fields
    if (!config?.queries?.length) {
      return res.status(400).json({ error: 'At least one search query is required' });
    }

    const jobId = uuid();

    // Save job to DB
    const { error: insertErr } = await supabase.from('scrape_jobs').insert({
      id:         jobId,
      config:     { ...config, createdBy: req.user?.email || createdBy, ownerId: req.user?.id },
      status:     'queued',
      created_by: req.user?.email || createdBy || 'unknown'
    });
    if (insertErr) throw insertErr;

    // Queue the scrape worker — automation starts here
    await enqueue('scrape-queue', '/worker/scrape', { jobId, config });

    res.json({
      jobId,
      message: 'Lead generation started. You will receive an email when leads are ready for review.'
    });

  } catch (err) {
    console.error('[POST /api/jobs]', err.message);
    res.status(500).json({ error: 'Failed to start job', detail: err.message });
  }
});

// GET /api/jobs — List all jobs (most recent first, excludes archived)
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('scrape_jobs')
      .select('*')
      .is('archived_at', null)          // ← exclude soft-deleted
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/jobs/:id — Get single job status + counts
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('scrape_jobs')
      .select('*')
      .eq('id', req.params.id)
      .is('archived_at', null)          // ← treat archived as not found
      .single();

    if (error) throw error;
    if (!data)  return res.status(404).json({ error: 'Job not found' });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/jobs/:id/stats — Lead counts breakdown for a job
router.get('/:id/stats', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('leads')
      .select('lead_status, approval_status, pushed_to_hubspot')
      .eq('job_id', req.params.id);

    if (error) throw error;

    const stats = {
      total:    data.length,
      hot:      data.filter(l => l.lead_status === 'Hot').length,
      warm:     data.filter(l => l.lead_status === 'Warm').length,
      low:      data.filter(l => l.lead_status === 'Low').length,
      approved: data.filter(l => l.approval_status === 'approved').length,
      rejected: data.filter(l => l.approval_status === 'rejected').length,
      pushed:   data.filter(l => l.pushed_to_hubspot).length
    };

    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/jobs/:id/contact-stats — Apollo vs fallback contact counts for a job
// Used by the pipeline progress page to show "X/Y found" on each step.
router.get('/:id/contact-stats', async (req, res) => {
  try {
    // Get all leads for this job
    const { data: leads, error: leadsErr } = await supabase
      .from('leads')
      .select('id')
      .eq('job_id', req.params.id);

    if (leadsErr) throw leadsErr;
    if (!leads?.length) return res.json({ apollo: 0, fallback: 0, total: 0, totalLeads: 0, apolloLeads: 0, fallbackLeads: 0 });

    const leadIds = leads.map(l => l.id);

    // Fetch all contacts for these leads (source_type + lead_id to count unique companies)
    const { data: contacts, error: cErr } = await supabase
      .from('key_contacts')
      .select('source_type, lead_id')
      .in('lead_id', leadIds);

    if (cErr) throw cErr;

    const apolloContacts   = (contacts || []).filter(c => c.source_type === 'apollo');
    const fallbackContacts = (contacts || []).filter(c => c.source_type !== 'apollo' && c.source_type !== 'apify');

    res.json({
      totalLeads:      leads.length,
      // contact counts
      apollo:          apolloContacts.length,
      fallback:        fallbackContacts.length,
      total:           (contacts || []).length,
      // unique companies (leads) that got contacts from each source
      apolloLeads:     new Set(apolloContacts.map(c => c.lead_id)).size,
      fallbackLeads:   new Set(fallbackContacts.map(c => c.lead_id)).size,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/jobs/:id — Hard delete: removes job, its leads, and contacts
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Verify job exists
    const { data: job, error: findErr } = await supabase
      .from('scrape_jobs')
      .select('id')
      .eq('id', id)
      .single();

    if (findErr || !job) return res.status(404).json({ error: 'Job not found' });

    // Step 1: collect lead IDs for this job so we can delete their contacts
    const { data: leads } = await supabase
      .from('leads')
      .select('id')
      .eq('job_id', id);

    if (leads && leads.length > 0) {
      const leadIds = leads.map(l => l.id);
      // Delete all key_contacts linked to these leads
      await supabase.from('key_contacts').delete().in('lead_id', leadIds);
    }

    // Step 2: delete all leads for this job
    await supabase.from('leads').delete().eq('job_id', id);

    // Step 3: delete the job itself
    const { error: deleteErr } = await supabase
      .from('scrape_jobs')
      .delete()
      .eq('id', id);

    if (deleteErr) throw deleteErr;

    console.log(`[jobs] Job ${id} deleted (${leads?.length || 0} leads removed)`);
    res.json({ success: true, message: 'Job and all its leads deleted.' });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
