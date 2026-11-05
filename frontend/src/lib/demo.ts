// Demo mode (VITE_DEMO=true): the whole frontend runs on built-in sample data,
// with no backend and no login. Used for the shareable preview link.
export const demoMode = import.meta.env.VITE_DEMO === 'true';

const day = (n: number) => new Date(Date.now() - n * 864e5).toISOString();
const NAMES = ['Siam Print Center', 'Watthana Office Supply', 'Bangkok Copy Hub', 'Thonglor Printing Co.', 'Ekkamai Paper House', 'Sukhumvit Doc Express',
  'Phrom Phong Print', 'Asoke Office Mart', 'Rama IV Business Supply', 'Silom Print & Copy', 'Ari Stationery Plus', 'Ratchada Office Solutions',
  'On Nut Printing Studio', 'Bang Na Paper Co.', 'Sathorn Doc Center', 'Chatuchak Office Hub', 'Lat Phrao Print Shop', 'Huai Khwang Copy'];
const AREAS = [['Watthana', 13.737, 100.585], ['Khlong Toei', 13.722, 100.566], ['Bang Rak', 13.727, 100.528], ['Sathon', 13.719, 100.53], ['Chatuchak', 13.808, 100.553], ['Huai Khwang', 13.776, 100.574], ['Phaya Thai', 13.78, 100.543], ['Bang Na', 13.668, 100.604]] as const;

const leads = NAMES.map((name, i) => {
  const [area, lat, lng] = AREAS[i % AREAS.length];
  const score = [80, 70, 70, 60, 50, 40, 30][i % 7];
  return {
    id: `lead-${i}`, job_id: i < 12 ? 'job-1' : 'job-2', company_name: name,
    industry: i % 3 ? 'Printing service' : 'Office supply store', address: `${100 + i * 7} ${['Sukhumvit Rd', 'Rama IV Rd', 'Silom Rd', 'Phahonyothin Rd'][i % 4]}, ${area}`,
    city: area, district: area, province: 'Bangkok', sub_district: null,
    phone: i % 5 === 3 ? '' : `+66 2 ${200 + i * 3} ${4100 + i * 17}`, website: i % 3 === 2 ? '' : `https://example-${i}.co.th`, email: i % 4 === 0 ? `sales@example-${i}.co.th` : null,
    rating: Math.round((3.6 + (i % 5) * 0.3) * 10) / 10, reviews_count: 12 + i * 19,
    lead_score: score, lead_status: score >= 70 ? 'Hot' : score >= 40 ? 'Warm' : 'Low',
    approval_status: ['pending', 'approved', 'approved', 'pending', 'rejected'][i % 5], pushed_to_hubspot: i % 4 === 1,
    latitude: lat + ((i * 37) % 11 - 5) * 0.0018, longitude: lng + ((i * 53) % 11 - 5) * 0.0018,
    google_maps_url: 'https://www.google.com/maps', enrichment_status: i % 3 ? 'enriched' : 'no_contacts_found',
    apollo_headcount: i % 3 ? 20 + i * 4 : undefined, apollo_revenue_range: i % 3 ? '$1M–$10M' : undefined, created_at: day(i % 12),
  };
});

const jobs = [
  { id: 'job-1', created_at: day(0), status: 'done', config: { queries: ['printer shop', 'office supplies'], province: 'Bangkok', district: 'Watthana', location: 'Bangkok', country: 'Thailand', maxResults: 50, engine: 'apify', apolloEnabled: true }, total_records: 12, hot_count: 5, warm_count: 6, low_count: 1 },
  { id: 'job-2', created_at: day(1), status: 'done', config: { queries: ['copy shop'], province: 'Bangkok', district: 'Chatuchak', location: 'Bangkok', country: 'Thailand', maxResults: 20 }, total_records: 6, hot_count: 2, warm_count: 3, low_count: 1 },
  { id: 'job-3', created_at: day(2), status: 'running', config: { queries: ['factory'], province: 'Chonburi', location: 'Chonburi', country: 'Thailand', maxResults: 100 }, total_records: 0, hot_count: 0, warm_count: 0, low_count: 0 },
];

const FIRST = ['Somchai', 'Nattaya', 'Kittipong', 'Pimchanok', 'Anan', 'Waraporn', 'Thanakorn', 'Siriporn'];
const LAST = ['Wongsakul', 'Chaiyaporn', 'Rattanakul', 'Srisuk', 'Boonmee', 'Phanthong', 'Kaewmanee', 'Saetang'];
const TITLES = ['Managing Director', 'Owner', 'Purchasing Manager', 'Operations Director', 'General Manager', 'Office Manager'];
const contacts = leads.filter((_, i) => i % 3).flatMap((l, j) => [0, 1].map(k => {
  const n = (j * 2 + k) % 8;
  return {
    id: `c-${l.id}-${k}`, lead_id: l.id, company_name: l.company_name, person_name: `${FIRST[n]} ${LAST[(n + 3) % 8]}`, first_name: FIRST[n], last_name: LAST[(n + 3) % 8],
    job_title: TITLES[(j + k) % 6], department: 'Management', seniority: k ? 'manager' : 'owner', linkedin_url: 'https://www.linkedin.com', source_url: '', source_type: 'apollo',
    public_email: `${FIRST[n].toLowerCase()}@example-${l.id.split('-')[1]}.co.th`, public_phone: k ? '' : `+66 8${n} ${300 + j} ${5000 + j * 7}`,
    confidence_score: 85 - k * 15, confidence_reason: 'apollo', status: ['pending', 'approved', 'pushed'][(j + k) % 3], reviewer_notes: '',
    pushed_to_hubspot: (j + k) % 3 === 2, created_at: day(j % 5), updated_at: day(j % 5), job_id: l.job_id, apollo_run_id: 'run-1',
    company_domain: `example-${l.id.split('-')[1]}.co.th`, apollo_person_id: null, apollo_request_id: null,
  };
}));

const runs = [
  { id: 'run-1', job_id: null, lead_id: null, status: 'completed', search_count: 40, enrichment_requested_count: 24, valid_contacts_count: contacts.length, search_payload: { person_titles: ['Owner', 'Managing Director'], organization_locations: ['Bangkok, Thailand'] }, request_ids: [], error_message: null, created_at: day(1), updated_at: day(1) },
  { id: 'run-2', job_id: null, lead_id: null, status: 'processing', search_count: 25, enrichment_requested_count: 18, valid_contacts_count: 0, search_payload: { organization_locations: ['Chiang Mai, Thailand'] }, request_ids: [], error_message: null, created_at: day(0), updated_at: day(0) },
];

let pipeline = leads.slice(0, 8).map((l, i) => ({
  id: `p-${i}`, lead_id: l.id, company_name: l.company_name, phone: l.phone, website: l.website, industry: l.industry, city: l.city, province: 'Bangkok',
  lead_score: l.lead_score, lead_status: l.lead_status, stage: ['new', 'contacted', 'meeting', 'proposal', 'won', 'new', 'contacted', 'lost'][i],
  deal_value: [0, 25000, 48000, 120000, 90000, 0, 15000, 30000][i], next_follow_up: i % 2 ? day(-2).slice(0, 10) : day(1).slice(0, 10),
  notes: i === 2 ? 'Met the purchasing manager. Wants a quote for 3 colour printers on rental.' : '', created_at: day(i), updated_at: day(i),
}));
let templates = [{ id: 't1', name: 'Printers – Watthana, Bangkok', config: { queries: ['printer shop'], province: 'Bangkok' }, created_at: day(3) }];
let profile: any = { id: 'demo', email: 'demo@leadcore.app', full_name: 'Demo User', role: 'admin', isAdmin: true, language: 'EN', theme: 'Light', targets: { daily: 10, weekly: 50, monthly: 300 }, phone: '', territory: 'Bangkok – Watthana' };
const activity = Array.from({ length: 16 }, (_, i) => ({
  id: `a${i}`, user_id: i % 2 ? 'u2' : 'demo', user_email: i % 2 ? 'nattaya@example.co.th' : 'demo@leadcore.app',
  event_type: ['Session Active', 'Lead Search', 'Pipeline Stage', 'Logout'][i % 4], ip_address: `182.52.174.${10 + i}`,
  device_info: i % 3 ? 'Mozilla/5.0 (Windows NT 10.0)' : 'Mozilla/5.0 (iPhone)', location_text: i % 4 === 1 ? 'printer shop @ Watthana, Bangkok' : '',
  created_at: new Date(Date.now() - i * 2.7 * 3600e3).toISOString(),
}));

function summary() {
  const count = (f: (l: any) => boolean) => leads.filter(f).length;
  const group = (k: string) => Object.entries(leads.reduce((m: any, l: any) => { m[l[k] || 'Unknown'] = (m[l[k] || 'Unknown'] || 0) + 1; return m; }, {}))
    .sort((a: any, b: any) => b[1] - a[1]).map(([name, value]) => ({ name, value }));
  return {
    totals: { leads: leads.length, hot: count(l => l.lead_status === 'Hot'), warm: count(l => l.lead_status === 'Warm'), low: count(l => l.lead_status === 'Low'),
      pending: count(l => l.approval_status === 'pending'), approved: count(l => l.approval_status === 'approved'), pushed: count(l => l.pushed_to_hubspot),
      contacts: contacts.length, contactsPushed: contacts.filter(c => c.status === 'pushed').length },
    byIndustry: group('industry'), byCity: group('city'), byProvince: [{ name: 'Bangkok', value: leads.length }],
    trend: Array.from({ length: 14 }, (_, i) => ({ day: day(13 - i).slice(5, 10), leads: leads.filter(l => l.created_at.slice(0, 10) === day(13 - i).slice(0, 10)).length })),
    recentJobs: jobs,
  };
}

let geo: any[] | null = null;
async function loadGeo() {
  if (!geo) geo = (await import('../data/thailand-geo.json')).default as any[];
  return geo;
}

async function route(method: string, path: string, q: URLSearchParams, body: any): Promise<unknown> {
  const m = (re: RegExp) => path.match(re);
  if (path === '/api/me') return method === 'PATCH' ? (profile = { ...profile, ...body }) : profile;
  if (path === '/api/activity') return method === 'POST' ? { ok: true } : activity.filter(a => a.user_id === 'demo');
  if (path === '/api/insights/summary') return summary();
  if (path === '/api/insights/leads') {
    const s = (q.get('q') || '').toLowerCase();
    return leads.filter(l => (!q.get('status') || l.lead_status === q.get('status')) && (!q.get('approval') || l.approval_status === q.get('approval'))
      && (!q.get('province') || l.province === q.get('province')) && (!s || `${l.company_name} ${l.address} ${l.industry}`.toLowerCase().includes(s)));
  }
  if (path === '/api/locations/provinces') return (await loadGeo()).map(p => ({ id: String(p.id), nameEn: p.en, nameTh: p.th }));
  if (m(/^\/api\/locations\/provinces\/(\d+)\/districts$/)) {
    const p = (await loadGeo()).find(x => String(x.id) === path.split('/')[4]);
    return (p?.districts || []).map((d: any) => ({ id: String(d.id), nameEn: d.en, nameTh: d.th }));
  }
  if (m(/^\/api\/locations\/districts\/(\d+)\/sub-districts$/)) {
    const id = path.split('/')[4];
    const d = (await loadGeo()).flatMap(p => p.districts).find((x: any) => String(x.id) === id);
    return (d?.sub || []).map((s: any) => ({ id: String(s.id), nameEn: s.en, nameTh: s.th, zip: s.zip }));
  }
  if (path === '/api/pipeline') {
    if (method === 'POST') {
      const add = leads.filter(l => (body?.leadIds || []).includes(l.id) && !pipeline.some(p => p.lead_id === l.id))
        .map((l, i) => ({ id: `p-new-${Date.now()}-${i}`, lead_id: l.id, company_name: l.company_name, phone: l.phone, website: l.website, industry: l.industry, city: l.city, province: 'Bangkok', lead_score: l.lead_score, lead_status: l.lead_status, stage: 'new', deal_value: 0, next_follow_up: null as any, notes: '', created_at: day(0), updated_at: day(0) }));
      pipeline = [...add, ...pipeline];
      return { added: add.length };
    }
    return pipeline;
  }
  if (m(/^\/api\/pipeline\/[^/]+$/)) {
    const id = path.split('/')[3];
    if (method === 'DELETE') { pipeline = pipeline.filter(p => p.id !== id); return { ok: true }; }
    pipeline = pipeline.map(p => (p.id === id ? { ...p, ...body, updated_at: day(0) } : p));
    return pipeline.find(p => p.id === id);
  }
  if (path === '/api/templates') {
    if (method === 'POST') { const t = { id: `t${Date.now()}`, name: body.name, config: body.config, created_at: day(0) }; templates = [t, ...templates]; return t; }
    return templates;
  }
  if (m(/^\/api\/templates\//)) { templates = templates.filter(t => t.id !== path.split('/')[3]); return { ok: true }; }
  if (path === '/api/support') return { id: 's-new', ...body, status: 'open', created_at: day(0) };
  if (path === '/api/ai/chat') {
    const hot = leads.filter(l => l.lead_status === 'Hot').slice(0, 3);
    return { reply: `**Demo reply** (the live app answers with Gemini, using your real leads).\n\nBased on the sample data, call these first:\n${hot.map(l => `- ${l.company_name}: ${l.lead_status} (${l.lead_score}), ${l.rating}★, ${l.reviews_count} reviews`).join('\n')}\n\nTip: late morning (10:00–11:30) usually reaches owners best.` };
  }
  if (path === '/api/admin/summary') return { users: 6, jobs: jobs.length, leads: leads.length, events24h: activity.length, openTickets: 1 };
  if (path === '/api/admin/users') return [profile, { id: 'u2', email: 'nattaya@example.co.th', full_name: 'Nattaya C.', role: 'Sales Rep', language: 'TH', theme: 'Light', updated_at: day(1) }, { id: 'u3', email: 'anan@example.co.th', full_name: 'Anan B.', role: 'Manager', language: 'EN', theme: 'Dark', updated_at: day(2) }];
  if (path === '/api/admin/activity') return activity;
  if (path === '/api/admin/support') return [{ id: 's1', name: 'Nattaya C.', email: 'nattaya@example.co.th', subject: 'Apollo contacts missing for one job', message: 'The Chonburi factory search shows 0 contacts after approval.', status: 'open', created_at: day(0) }];
  if (m(/^\/api\/admin\//)) return body || {};

  // LeadGen
  if (path === '/api/jobs') return method === 'POST' ? { jobId: 'job-1', message: 'Demo: opening a finished sample job.' } : jobs;
  if (m(/^\/api\/jobs\/[^/]+\/stats$/)) { const id = path.split('/')[3]; const L = leads.filter(l => l.job_id === id); return { total: L.length, Hot: L.filter(l => l.lead_status === 'Hot').length, Warm: L.filter(l => l.lead_status === 'Warm').length, Low: L.filter(l => l.lead_status === 'Low').length, pending: L.filter(l => l.approval_status === 'pending').length, approved: L.filter(l => l.approval_status === 'approved').length }; }
  if (m(/^\/api\/jobs\/[^/]+\/contact-stats$/)) { const id = path.split('/')[3]; const L = leads.filter(l => l.job_id === id).map(l => l.id); const C = contacts.filter(c => L.includes(c.lead_id)); return { totalLeads: L.length, apollo: C.length, fallback: 0, total: C.length, apolloLeads: new Set(C.map(c => c.lead_id)).size, fallbackLeads: 0 }; }
  if (m(/^\/api\/jobs\/[^/]+$/)) return method === 'DELETE' ? { success: true } : jobs.find(j => j.id === path.split('/')[3]) || jobs[0];
  if (path === '/api/leads') return leads.filter(l => (!q.get('jobId') || l.job_id === q.get('jobId')) && (!q.get('status') || l.lead_status === q.get('status')) && (!q.get('approval') || l.approval_status === q.get('approval')));
  if (m(/^\/api\/leads\/[^/]+\/apollo-contacts$/)) { const C = contacts.filter(c => c.lead_id === path.split('/')[3]); return { success: true, count: C.length, contacts: C }; }
  if (m(/^\/api\/leads\/[^/]+\/enrich-apollo$/)) return { success: true, found: true, apolloOrgId: 'demo', headcount: 45, revenue: 4500000, revenueRange: '$1M–$10M', dbdUrl: 'https://datawarehouse.dbd.go.th', contactCount: 2, message: 'Demo: sample company data' };
  if (m(/^\/api\/leads\/(approve|reject)$/)) return { success: true };
  if (m(/^\/api\/leads\/[^/]+\/notes$/)) return { success: true };
  if (m(/^\/api\/leads\/[^/]+$/)) return leads.find(l => l.id === path.split('/')[3]) || leads[0];
  if (path === '/api/key-contacts') return contacts.filter(c => (!q.get('leadId') || c.lead_id === q.get('leadId')) && (!q.get('jobId') || c.job_id === q.get('jobId')) && (!q.get('status') || c.status === q.get('status')));
  if (m(/^\/api\/key-contacts\/stats\//)) { const C = contacts.filter(c => c.job_id === path.split('/')[4]); return { total: C.length, pending: C.filter(c => c.status === 'pending').length, approved: C.filter(c => c.status === 'approved').length, rejected: 0, pushed: C.filter(c => c.status === 'pushed').length }; }
  if (m(/^\/api\/key-contacts\//)) return { message: 'Demo: no changes are saved' };
  if (path === '/api/apollo/runs') return { success: true, count: runs.length, runs };
  if (m(/^\/api\/apollo\/runs\/[^/]+$/)) { const r = runs.find(x => x.id === path.split('/')[4]) || runs[0]; return method === 'DELETE' ? { success: true, message: 'Demo' } : { success: true, run: r, validContactsFound: r.valid_contacts_count }; }
  if (m(/^\/api\/apollo\/runs\//)) return { success: true, message: 'Demo: no changes are saved', cancelledCount: 0, status: 'completed' };
  if (path === '/api/apollo/contacts') { const C = contacts.filter(c => !q.get('apolloRunId') || c.apollo_run_id === q.get('apolloRunId')); return { success: true, count: C.length, contacts: C }; }
  if (m(/^\/api\/apollo\/contacts\//)) return contacts.filter(c => c.lead_id === path.split('/')[4]);
  if (path === '/api/apollo/leads') return leads.filter(l => l.approval_status === 'approved').map(l => ({ ...l, apollo_stats: { total: contacts.filter(c => c.lead_id === l.id).length, pending: 0, approved: 0, rejected: 0, pushed: 0 } }));
  if (path === '/api/apollo/search') return { success: true, apolloRunId: 'run-1', status: 'processing', searchedCount: 40, enrichmentRequestedCount: 24, message: 'Demo: opening a finished sample run' };
  if (m(/^\/api\/apollo\//)) return { success: true, count: 0 };
  return {};
}

export async function demoFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const u = new URL(url, 'http://demo.local');
  let body: any = null;
  try { body = options.body ? JSON.parse(String(options.body)) : null; } catch { body = null; }
  const data = await route((options.method || 'GET').toUpperCase(), u.pathname, u.searchParams, body);
  await new Promise(r => setTimeout(r, 120));
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
