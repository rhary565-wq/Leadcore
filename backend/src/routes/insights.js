// Real numbers for the YodSales Home / Sales Hub / Territory map, computed from
// LeadGen data (scrape_jobs, leads, key_contacts) — replaces the old mock charts.
const router = require('express').Router();
const { supabase } = require('../db/supabase');

const DAY = 24 * 3600 * 1000;

// GET /api/insights/summary
router.get('/summary', async (req, res) => {
  try {
    const since = new Date(Date.now() - 30 * DAY).toISOString();
    const [{ data: leads, error }, jobsRes, contactsRes] = await Promise.all([
      supabase.from('leads')
        .select('lead_status, approval_status, industry, city, province, pushed_to_hubspot, created_at')
        .gte('created_at', since).limit(20000),
      supabase.from('scrape_jobs').select('id, status, config, total_records, hot_count, warm_count, low_count, created_at')
        .is('archived_at', null).order('created_at', { ascending: false }).limit(8),
      supabase.from('key_contacts').select('status', { count: 'exact' }).gte('created_at', since).limit(20000),
    ]);
    if (error) throw error;

    const L = leads || [];
    const count = (fn) => L.filter(fn).length;
    const group = (key) => {
      const m = {};
      L.forEach(l => { const v = l[key] || 'Unknown'; m[v] = (m[v] || 0) + 1; });
      return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, value]) => ({ name, value }));
    };

    const trend = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * DAY);
      const key = d.toISOString().slice(0, 10);
      trend.push({ day: key.slice(5), leads: L.filter(l => (l.created_at || '').slice(0, 10) === key).length });
    }

    const contacts = contactsRes.data || [];
    res.json({
      totals: {
        leads: L.length,
        hot: count(l => l.lead_status === 'Hot'),
        warm: count(l => l.lead_status === 'Warm'),
        low: count(l => l.lead_status === 'Low'),
        pending: count(l => l.approval_status === 'pending'),
        approved: count(l => l.approval_status === 'approved'),
        pushed: count(l => l.pushed_to_hubspot),
        contacts: contactsRes.count ?? contacts.length,
        contactsPushed: contacts.filter(c => c.status === 'pushed').length,
      },
      byIndustry: group('industry'),
      byCity: group('city'),
      byProvince: group('province'),
      trend,
      recentJobs: jobsRes.data || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/insights/leads?province=&district=&status=&approval=&q=&jobId=&limit=
// All leads with filters (territory map + global leads table)
router.get('/leads', async (req, res) => {
  try {
    const { province, district, status, approval, q, jobId, mapOnly } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 500, 5000);
    let query = supabase.from('leads').select('*').order('lead_score', { ascending: false }).limit(limit);
    if (province) query = query.eq('province', province);
    if (district) query = query.eq('district', district);
    if (status)   query = query.eq('lead_status', status);
    if (approval) query = query.eq('approval_status', approval);
    if (jobId)    query = query.eq('job_id', jobId);
    if (mapOnly === '1') query = query.not('latitude', 'is', null);
    if (q) {
      const s = String(q).replace(/[%,()]/g, ' ').trim();
      if (s) query = query.or(`company_name.ilike.%${s}%,address.ilike.%${s}%,industry.ilike.%${s}%,city.ilike.%${s}%`);
    }
    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/insights/export?jobId=&format=csv|json  (+ same filters as /leads)
router.get('/export', async (req, res) => {
  try {
    const { jobId, status, approval, province } = req.query;
    let query = supabase.from('leads').select('*').order('lead_score', { ascending: false }).limit(25000);
    if (jobId)    query = query.eq('job_id', jobId);
    if (status)   query = query.eq('lead_status', status);
    if (approval) query = query.eq('approval_status', approval);
    if (province) query = query.eq('province', province);
    const { data, error } = await query;
    if (error) throw error;

    const rows = data || [];
    const stamp = new Date().toISOString().slice(0, 10);
    if (req.query.format === 'json') {
      res.setHeader('Content-Disposition', `attachment; filename="leads-${stamp}.json"`);
      return res.json(rows);
    }
    const cols = ['company_name', 'industry', 'lead_status', 'lead_score', 'approval_status', 'phone', 'email', 'website',
      'address', 'city', 'district', 'province', 'rating', 'reviews_count', 'google_maps_url', 'latitude', 'longitude', 'created_at'];
    const esc = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads-${stamp}.csv"`);
    res.send('﻿' + csv); // BOM so Excel shows Thai correctly
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
