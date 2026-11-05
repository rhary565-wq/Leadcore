// Leadcore account features: profile, targets, activity log, support tickets,
// personal sales pipeline (Sales Hub) and saved search templates.
const router = require('express').Router();
const { supabase } = require('../db/supabase');

function clientIp(req) {
  const fwd = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket?.remoteAddress || '';
}

// ── Profile ───────────────────────────────────────────────────────────────────
// GET /api/me — creates the profile row on first sign-in
router.get('/me', async (req, res) => {
  try {
    const u = req.user;
    let { data: profile, error } = await supabase.from('profiles').select('*').eq('id', u.id).maybeSingle();
    if (error && error.code !== 'PGRST116') throw error;
    if (!profile) {
      const row = { id: u.id, email: u.email, full_name: u.name, role: u.isAdmin ? 'admin' : 'Sales Rep' };
      const ins = await supabase.from('profiles').upsert(row).select('*').single();
      if (ins.error) throw ins.error;
      profile = ins.data;
    }
    res.json({ ...profile, isAdmin: u.isAdmin, role: u.isAdmin ? 'admin' : profile.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/me — name, language, theme, targets
router.patch('/me', async (req, res) => {
  try {
    const allowed = ['full_name', 'language', 'theme', 'targets', 'phone', 'territory'];
    const patch = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('profiles')
      .upsert({ id: req.user.id, email: req.user.email, ...patch }).select('*').single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Activity log ──────────────────────────────────────────────────────────────
router.post('/activity', async (req, res) => {
  try {
    const { eventType, locationText } = req.body || {};
    if (!eventType) return res.status(400).json({ error: 'eventType required' });
    const { error } = await supabase.from('activity_logs').insert({
      user_id: req.user.id,
      user_email: req.user.email,
      event_type: String(eventType).slice(0, 120),
      ip_address: clientIp(req),
      device_info: String(req.headers['user-agent'] || '').slice(0, 200),
      location_text: String(locationText || '').slice(0, 200),
    });
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    // Logging must never break the app
    console.warn('[activity]', err.message);
    res.json({ ok: false });
  }
});

router.get('/activity', async (req, res) => {
  try {
    const { data, error } = await supabase.from('activity_logs').select('*')
      .eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Support tickets ───────────────────────────────────────────────────────────
router.post('/support', async (req, res) => {
  try {
    const { name, email, subject, message } = req.body || {};
    if (!message) return res.status(400).json({ error: 'Message is required' });
    const { data, error } = await supabase.from('support_tickets').insert({
      user_id: req.user.id,
      name: name || req.user.name,
      email: email || req.user.email,
      subject: subject || 'General',
      message,
      status: 'open',
    }).select('*').single();
    if (error) throw error;

    // Optional email to the support inbox (Resend is already used by LeadGen)
    if (process.env.RESEND_API_KEY && process.env.SUPPORT_EMAIL) {
      try {
        const { Resend } = require('resend');
        await new Resend(process.env.RESEND_API_KEY).emails.send({
          from: process.env.RESEND_FROM_EMAIL || 'Leadcore <onboarding@resend.dev>',
          to: process.env.SUPPORT_EMAIL,
          subject: `[Support] ${data.subject}`,
          text: `From: ${data.name} <${data.email}>\n\n${data.message}`,
        });
      } catch (e) { console.warn('[support] email failed:', e.message); }
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sales Hub pipeline ────────────────────────────────────────────────────────
const STAGES = ['new', 'contacted', 'meeting', 'proposal', 'won', 'lost'];

router.get('/pipeline', async (req, res) => {
  try {
    const { data, error } = await supabase.from('pipeline_items').select('*')
      .eq('user_id', req.user.id).order('updated_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pipeline  { leadIds: [...] }  or  { item: {...} }
router.post('/pipeline', async (req, res) => {
  try {
    const { leadIds, item } = req.body || {};
    let rows = [];
    if (Array.isArray(leadIds) && leadIds.length) {
      const { data: leads, error } = await supabase.from('leads').select('*').in('id', leadIds);
      if (error) throw error;
      rows = (leads || []).map(l => ({
        user_id: req.user.id, lead_id: l.id, company_name: l.company_name, phone: l.phone,
        website: l.website, industry: l.industry, city: l.city, province: l.province || null,
        lead_score: l.lead_score, lead_status: l.lead_status, stage: 'new',
      }));
    } else if (item?.company_name) {
      rows = [{ user_id: req.user.id, stage: 'new', ...item }];
    } else {
      return res.status(400).json({ error: 'leadIds or item required' });
    }
    const { data, error } = await supabase.from('pipeline_items')
      .upsert(rows, { onConflict: 'user_id,lead_id', ignoreDuplicates: true }).select('*');
    if (error) throw error;
    res.json({ added: data?.length || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/pipeline/:id', async (req, res) => {
  try {
    const patch = {};
    if (req.body.stage) {
      if (!STAGES.includes(req.body.stage)) return res.status(400).json({ error: 'Invalid stage' });
      patch.stage = req.body.stage;
    }
    if (typeof req.body.notes === 'string') patch.notes = req.body.notes;
    if (req.body.deal_value !== undefined) patch.deal_value = Number(req.body.deal_value) || 0;
    if (req.body.next_follow_up !== undefined) patch.next_follow_up = req.body.next_follow_up || null;
    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('pipeline_items').update(patch)
      .eq('id', req.params.id).eq('user_id', req.user.id).select('*').single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/pipeline/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('pipeline_items').delete()
      .eq('id', req.params.id).eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Saved search templates (from "New search git") ────────────────────────────
router.get('/templates', async (req, res) => {
  try {
    const { data, error } = await supabase.from('search_templates').select('*')
      .eq('user_id', req.user.id).order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/templates', async (req, res) => {
  try {
    const { name, config } = req.body || {};
    if (!name || !config) return res.status(400).json({ error: 'name and config required' });
    const { data, error } = await supabase.from('search_templates')
      .insert({ user_id: req.user.id, name, config }).select('*').single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/templates/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('search_templates').delete()
      .eq('id', req.params.id).eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
