// YodSales Admin Portal — user directory, roles, traffic/activity, support inbox.
const router = require('express').Router();
const { supabase } = require('../db/supabase');

router.get('/users', async (req, res) => {
  try {
    const { data, error } = await supabase.from('profiles').select('*').order('updated_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/users/:id/role', async (req, res) => {
  try {
    const role = req.body?.role;
    if (!['admin', 'Manager', 'Sales Rep', 'disabled'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    if (req.params.id === req.user.id && role !== 'admin') {
      return res.status(400).json({ error: 'You cannot remove your own admin access' });
    }
    const { data, error } = await supabase.from('profiles')
      .update({ role, updated_at: new Date().toISOString() }).eq('id', req.params.id).select('*').single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/activity', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 300, 1000);
    const { data, error } = await supabase.from('activity_logs').select('*')
      .order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/support', async (req, res) => {
  try {
    const { data, error } = await supabase.from('support_tickets').select('*')
      .order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/support/:id', async (req, res) => {
  try {
    const status = req.body?.status;
    if (!['open', 'in_progress', 'closed'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const { data, error } = await supabase.from('support_tickets').update({ status }).eq('id', req.params.id).select('*').single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// System usage summary for the admin cards
router.get('/summary', async (req, res) => {
  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const [users, jobs, leads, events, tickets] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      supabase.from('scrape_jobs').select('id', { count: 'exact', head: true }).is('archived_at', null),
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      supabase.from('activity_logs').select('id', { count: 'exact', head: true }).gte('created_at', since),
      supabase.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    ]);
    res.json({
      users: users.count || 0, jobs: jobs.count || 0, leads: leads.count || 0,
      events24h: events.count || 0, openTickets: tickets.count || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
