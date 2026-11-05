// Apollo Routes — Correct async 2-step flow
//
// STEP 1  POST /search
//   → Apollo People Search (query params — returns names/titles/companies, NO email/phone)
//   → Backend sends candidates to Apollo Bulk People Enrichment (async webhook)
//   → Returns { apolloRunId, status: "processing" } immediately
//
// STEP 2  POST /phone-webhook   (Apollo calls this asynchronously)
//   → Receives enriched people with email from waterfall (phone waterfall disabled for speed)
//   → Saves contacts where public_email OR public_phone exists (not required to have both)
//
// GET  /contacts          — source_type=apollo contacts with email OR phone
// GET  /runs/:runId       — poll run status
// GET  /poll-result/:id   — manual poll if webhook missed
// POST /enrich/:leadId    — re-enrich one lead via Apollo
// POST /test-match        — debug single person (no DB writes)

'use strict';

const router       = require('express').Router();
const axios        = require('axios');
const { supabase } = require('../db/supabase');

// ── Environment ───────────────────────────────────────────────────────────────
const APOLLO_API_KEY  = (process.env.APOLLO_API_KEY  || '').trim();
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')
  || '').trim();
const APOLLO_BASE     = 'https://api.apollo.io/api/v1';

if (!APOLLO_API_KEY)  console.warn('[apollo] ⚠️  APOLLO_API_KEY not set');
if (!PUBLIC_BASE_URL) console.warn('[apollo] ⚠️  PUBLIC_BASE_URL not set — webhook will not work');

const APOLLO_HEADERS = {
  'accept':        'application/json',
  'Content-Type':  'application/json',
  'Cache-Control': 'no-cache',
  'x-api-key':     APOLLO_API_KEY,
};

// ── Mapping: UI labels → Apollo API values ────────────────────────────────────
const SENIORITY_MAP = {
  'Owner':       'owner',     'Founder':     'founder',   'C-Suite':  'c_suite',
  'VP':          'vp',        'Head of':     'head',      'Director': 'director',
  'Manager':     'manager',   'Senior':      'senior',    'Entry / Any': 'entry',
  // passthrough already-mapped values
  'owner': 'owner', 'founder': 'founder', 'c_suite': 'c_suite', 'vp': 'vp',
  'head': 'head', 'director': 'director', 'manager': 'manager', 'senior': 'senior', 'entry': 'entry',
};

const COMPANY_SIZE_MAP = {
  '1-10':    '1,10',       '11-50':    '11,50',
  '51-200':  '51,200',     '201-500':  '201,500',
  '501-1000':'501,1000',   '1001+':    '1001,1000000',
};

const DEPARTMENT_TITLE_MAP = {
  'Sales':      ['sales director','head of sales','sales manager','business development manager','account executive','revenue director','commercial director'],
  'Marketing':  ['marketing director','marketing manager','head of marketing','growth manager','brand manager','chief marketing officer'],
  'Operations': ['operations director','operations manager','head of operations','chief operating officer'],
  'Finance':    ['finance director','finance manager','financial controller','chief financial officer'],
  'IT / Tech':  ['IT manager','technology manager','head of IT','chief technology officer','chief information officer','software engineering manager'],
  'HR':         ['HR manager','human resources manager','people operations manager','head of HR'],
};

// ── Pure helpers ──────────────────────────────────────────────────────────────

// Social / platform domains that belong to the platform, NOT the business.
// Passing these to Apollo would return the platform's own company record
// (e.g. facebook.com → Meta / 76K employees / $116B revenue) instead of the
// coffee-shop or SME that merely uses Facebook as their website.
const SOCIAL_DOMAINS = new Set([
  'facebook.com', 'fb.com', 'instagram.com', 'twitter.com', 'x.com',
  'linkedin.com', 'tiktok.com', 'youtube.com', 'line.me', 'linktree.com',
  'linktr.ee', 'shopee.co.th', 'shopee.com', 'lazada.co.th', 'lazada.com',
  'grab.com', 'foodpanda.com', 'wongnai.com', 'tripadvisor.com',
]);

function cleanDomain(input) {
  if (!input) return null;
  const domain = String(input).replace(/https?:\/\//g,'').replace(/^www\./,'').split('/')[0].split('?')[0].trim().toLowerCase() || null;
  // Return null for social/platform domains so the caller falls back to name search
  if (domain && SOCIAL_DOMAINS.has(domain)) return null;
  return domain;
}

function isValidEmail(v) {
  return !!(v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim()));
}

function normalizePhone(v) {
  if (!v) return null;
  const c = String(v).trim().replace(/[^\d+]/g,'');
  return c.replace('+','').length >= 7 ? c : null;
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function safeUrl(url) { return url.replace(APOLLO_API_KEY, '***'); }

// ── Apollo HTTP wrapper ───────────────────────────────────────────────────────
async function apolloFetch(url, method, bodyObj) {
  try {
    const res = await axios({ method: method || 'GET', url, headers: APOLLO_HEADERS, data: bodyObj || undefined, timeout: 30000 });
    return res.data || {};
  } catch (err) {
    const status = err.response && err.response.status;
    const data   = err.response && err.response.data;
    console.error('[apollo] HTTP error:', { status, url: safeUrl(url), data });
    const e = new Error('Apollo API ' + (status || 'network error'));
    e.status  = status;
    e.details = data;
    throw e;
  }
}

// ── Build Apollo People Search URL ────────────────────────────────────────────
// IMPORTANT: Apollo mixed_people/api_search uses QUERY PARAMS, not body fields.
// Supported filters: organization_locations[], person_seniorities[],
//   contact_email_status[], organization_num_employees_ranges[], person_titles[], q_keywords
function buildSearchUrl(filters) {
  const p = new URLSearchParams();
  // Always request max per page (100); pagination is handled externally
  p.set('page', String(Number(filters.page || 1)));
  p.set('per_page', '100');

  // Location
  const country  = (filters.country  || 'Thailand').trim();
  const location = filters.location ? filters.location.trim() + ', ' + country : country;
  p.append('organization_locations[]', location);

  // NOTE: Do NOT pre-filter by contact_email_status here.
  // Bulk Enrichment (step 2) runs the email waterfall to FIND emails.
  // Pre-filtering to 'verified' shrinks the candidate pool massively — defeats the purpose.

  // Seniority
  (filters.seniority || filters.seniorities || [])
    .filter(s => s && s !== 'Any Contact')
    .map(s => SENIORITY_MAP[s]).filter(Boolean)
    .forEach(s => p.append('person_seniorities[]', s));

  // Company size
  (filters.companySizes || [])
    .map(s => COMPANY_SIZE_MAP[s]).filter(Boolean)
    .forEach(s => p.append('organization_num_employees_ranges[]', s));

  // Department → person titles
  const titles = (filters.departments || []).flatMap(d => DEPARTMENT_TITLE_MAP[d] || []);
  titles.forEach(t => p.append('person_titles[]', t));
  if (titles.length) p.set('include_similar_titles', 'true');

  // Company domains (for lead-targeted enrichment via /enrich route)
  (filters.companyDomains || [])
    .map(cleanDomain).filter(Boolean)
    .forEach(d => p.append('q_organization_domains_list[]', d));

  // Company search — user can enter company name OR domain (comma-separated)
  // Domain (no spaces, has a dot) → q_organization_domains_list[]
  // Name (has spaces or no dot)   → combined with q_keywords for full-text match
  const companySearch = (filters.companySearch || '').trim();
  if (companySearch) {
    const entries = companySearch.split(',').map(s => s.trim()).filter(Boolean);
    const domains = entries.filter(e => !e.includes(' ') && e.includes('.'));
    const names   = entries.filter(e => e.includes(' ') || !e.includes('.'));
    domains.map(cleanDomain).filter(Boolean)
      .forEach(d => p.append('q_organization_domains_list[]', d));
    if (names.length) {
      // Merge company name keywords with industry keywords
      const existing = p.get('q_keywords') || '';
      p.set('q_keywords', [existing, ...names].filter(Boolean).join(' '));
    }
  }

  // Industry — q_keywords is the correct approach (organization_industries is NOT valid here)
  const ind = (filters.industry || '').trim();
  if (ind && ind !== 'Any Industry' && ind !== 'All') {
    const existing = p.get('q_keywords') || '';
    // Only set if companySearch hasn't already claimed q_keywords
    if (!existing) p.set('q_keywords', ind);
    else if (!existing.includes(ind)) p.set('q_keywords', `${ind} ${existing}`);
  }

  const url = `${APOLLO_BASE}/mixed_people/api_search?${p.toString()}`;
  const debug = {};
  for (const [k, v] of p.entries()) { if (!debug[k]) debug[k] = []; debug[k].push(v); }
  return { url, debug };
}

// ── Apollo Bulk People Enrichment ─────────────────────────────────────────────
// POST /api/v1/people/bulk_match?run_waterfall_email=true&run_waterfall_phone=false&webhook_url=...
// run_waterfall_phone=false — phone waterfall is the main delay (30s+ per person via multiple
// phone-lookup vendors). We turn it off for speed. Phones already in Apollo's DB are still
// extracted. Email waterfall runs normally and the webhook fires significantly faster.
// Apollo sends final results to webhook_url asynchronously.
async function requestBulkEnrichment(apolloRunId, people) {
  const details = people.filter(p => p && p.id).map(person => {
    const org = person.organization || {};
    const acc = person.account      || {};
    return {
      id:                person.id,
      first_name:        person.first_name   || undefined,
      last_name:         person.last_name    || undefined,
      name:              person.name         || undefined,
      linkedin_url:      person.linkedin_url || undefined,
      organization_name: org.name || acc.name || undefined,
      domain:            cleanDomain(org.primary_domain || org.website_url || acc.primary_domain) || undefined,
    };
  });

  if (!details.length) return null;

  const webhookUrl = `${PUBLIC_BASE_URL}/api/apollo/phone-webhook?apolloRunId=${encodeURIComponent(apolloRunId)}`;
  const qp = new URLSearchParams({ run_waterfall_email: 'true', run_waterfall_phone: 'true', webhook_url: webhookUrl });
  const url = `${APOLLO_BASE}/people/bulk_match?${qp.toString()}`;

  console.log('[apollo:bulk] Requesting enrichment:', { apolloRunId, count: details.length, webhookUrl });
  const data = await apolloFetch(url, 'POST', { details });
  console.log('[apollo:bulk] Accepted:', { apolloRunId, requestId: data.request_id, queued: data.total_requested_enrichments });
  return data;
}

// ── DB: apollo_enrichment_runs ────────────────────────────────────────────────
async function createRun(jobId, leadId, searchPayload) {
  const { data, error } = await supabase
    .from('apollo_enrichment_runs')
    .insert({ job_id: jobId || null, lead_id: leadId || null, status: 'created', search_payload: searchPayload || null })
    .select('*').single();
  if (error) throw new Error('Failed to create Apollo run: ' + error.message);
  return data;
}

async function updateRun(runId, patch) {
  const { error } = await supabase
    .from('apollo_enrichment_runs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', runId);
  if (error) console.error('[apollo] Failed to update run:', error.message);
}

// ── Email extraction from Apollo enrichment response ──────────────────────────
function extractEmail(person) {
  if (isValidEmail(person.email)) return person.email.trim();
  if (Array.isArray(person.emails)) {
    for (const item of person.emails) {
      if (typeof item === 'string' && isValidEmail(item)) return item.trim();
      if (item && isValidEmail(item.email)) return item.email.trim();
    }
  }
  const wfe = person.waterfall && person.waterfall.emails;
  if (Array.isArray(wfe)) {
    for (const group of wfe) {
      for (const vendor of (group && group.vendors) || []) {
        if (Array.isArray(vendor.emails)) {
          for (const e of vendor.emails) { if (isValidEmail(e)) return String(e).trim(); }
        }
        if (isValidEmail(vendor.email)) return String(vendor.email).trim();
      }
    }
  }
  return null;
}

// ── Personal phone extraction from Apollo enrichment response ─────────────────
function extractPhone(person) {
  const direct = normalizePhone(person.mobile_phone) || normalizePhone(person.phone) || normalizePhone(person.sanitized_phone);
  if (direct) return direct;
  if (Array.isArray(person.phone_numbers)) {
    for (const item of person.phone_numbers) {
      const p = typeof item === 'string' ? normalizePhone(item)
        : normalizePhone(item && (item.sanitized_number || item.raw_number || item.number || item.phone_number));
      if (p) return p;
    }
  }
  const wfp = person.waterfall && person.waterfall.phone_numbers;
  if (Array.isArray(wfp)) {
    for (const group of wfp) {
      for (const vendor of (group && group.vendors) || []) {
        if (Array.isArray(vendor.phone_numbers)) {
          for (const pv of vendor.phone_numbers) {
            const p = typeof pv === 'string' ? normalizePhone(pv)
              : normalizePhone(pv && (pv.sanitized_number || pv.raw_number || pv.number || pv.phone_number));
            if (p) return p;
          }
        }
        const vp = normalizePhone(vendor.phone_number) || normalizePhone(vendor.phone) || normalizePhone(vendor.number);
        if (vp) return vp;
      }
    }
  }
  return null;
}

// ── Company phone fallback — used when no personal number is found ────────────
// Apollo stores company-level contact info on organization / account objects.
function extractCompanyPhone(person) {
  const org = person.organization || {};
  const acc = person.account      || {};
  // Try every known org/account phone field Apollo may populate
  return (
    normalizePhone(org.phone)              ||
    normalizePhone(org.sanitized_phone)    ||
    normalizePhone(org.primary_phone)      ||
    normalizePhone(org.raw_phone)          ||
    normalizePhone(acc.phone)              ||
    normalizePhone(acc.sanitized_phone)    ||
    normalizePhone(acc.primary_phone)      ||
    null
  );
}

// ── Apollo Contact Scorer ─────────────────────────────────────────────────────
// Scores 0–100. Same concept as Apify's Hot/Warm/Low lead scoring.
//
//  Score  → Confidence Level (shown in UI)
//  70+    → High   (verified email + executive + direct phone)
//  45–69  → Medium (enriched email or phone + some seniority)
//  <45    → Low    (company phone only, or missing key data)
//
// Breakdown:
//   Email verified   → +35   (Apollo confirmed this email is real)
//   Email enriched   → +20   (Apollo found it via waterfall — unverified but useful)
//   Direct phone     → +25   (personal mobile/direct number)
//   Company phone    → +12   (office fallback — lower value)
//   Executive title  → +25   (CEO/Founder/Owner/President/MD)
//   Director level   → +15   (Director/VP/Head of)
//   Manager level    → +8    (Manager/Lead/Supervisor)
//   Any other title  → +3
//   LinkedIn URL     → +10   (verifiable identity)
//   Company domain   → +5    (enrichable for future use)
function scoreApolloContact(person, email, phone, phoneSource) {
  let score = 0;

  // ── Email ──────────────────────────────────────────────────────────────────
  if (email) {
    const emailStatus = (person.email_status || person.contact_email_status || '').toLowerCase();
    if (emailStatus === 'verified') score += 35;
    else                            score += 20; // enriched / guessed — still useful
  }

  // ── Phone ──────────────────────────────────────────────────────────────────
  if (phone) {
    if (phoneSource === 'direct')  score += 25;
    else                           score += 12; // company fallback
  }

  // ── Seniority / Decision-maker value ──────────────────────────────────────
  const title = (person.title || person.headline || '').toLowerCase();
  if (/ceo|founder|owner|president|chief|managing.?director/.test(title))  score += 25;
  else if (/\bdirector\b|vp\b|vice.?president|head of/.test(title))        score += 15;
  else if (/manager|supervisor|\blead\b/.test(title))                       score += 8;
  else if (title)                                                           score += 3;

  // ── Contact completeness ───────────────────────────────────────────────────
  if (person.linkedin_url) score += 10;
  const org = person.organization || {};
  const acc = person.account      || {};
  if (org.primary_domain || acc.primary_domain) score += 5;

  return Math.min(score, 100);
}

// ── Normalize Apollo person → key_contacts row ────────────────────────────────
// Saves contact if it has EITHER email OR phone (not required to have both).
// Phone priority: personal direct → personal waterfall → company phone (fallback).
// Returns null only if BOTH email AND phone are completely absent.
// Note: key_contacts has no job_id column — job is tracked via apollo_enrichment_runs.
function normalizeContact(person, runId, requestId, leadId) {
  const email = extractEmail(person);

  // Phone: personal number first, company number as fallback
  const personalPhone = extractPhone(person);
  const companyPhone  = !personalPhone ? extractCompanyPhone(person) : null;
  const phone         = personalPhone || companyPhone;
  const phoneSource   = personalPhone ? 'direct' : companyPhone ? 'company' : null;

  // Discard only if BOTH email AND phone are missing — one is enough to be useful
  if (!email && !phone) return null;

  const org = person.organization || {};
  const acc = person.account      || {};

  // ── Dynamic confidence score (like Apify's Hot/Warm/Low) ─────────────────
  const confidenceScore = scoreApolloContact(person, email, phone, phoneSource);

  // ── Human-readable reason explaining the score ────────────────────────────
  const reasons = [];
  if (email) {
    const emailStatus = (person.email_status || '').toLowerCase();
    reasons.push(emailStatus === 'verified' ? 'verified email' : 'enriched email');
  }
  if (phone)  reasons.push(phoneSource === 'direct' ? 'direct phone' : 'company phone');
  const title = (person.title || person.headline || '').toLowerCase();
  if      (/ceo|founder|owner|president|chief|managing.?director/.test(title)) reasons.push('executive contact');
  else if (/\bdirector\b|vp\b|vice.?president|head of/.test(title))            reasons.push('director-level contact');
  else if (/manager|supervisor|\blead\b/.test(title))                           reasons.push('manager-level contact');
  if (person.linkedin_url) reasons.push('LinkedIn verified');
  const confidenceReason = 'Apollo.io: ' + (reasons.join(' · ') || 'partial data');

  return {
    source_type:       'apollo',
    lead_id:           leadId     || null,
    apollo_run_id:     runId,
    apollo_person_id:  person.id  || null,
    apollo_request_id: requestId  || null,
    person_name:       person.name || [person.first_name, person.last_name].filter(Boolean).join(' ') || null,
    first_name:        person.first_name || null,
    last_name:         person.last_name  || null,
    job_title:         person.title || person.headline || null,
    company_name:      org.name || acc.name || null,
    company_domain:    cleanDomain(org.primary_domain || org.website_url || acc.primary_domain || acc.website_url),
    public_email:      email || null,
    public_phone:      phone || null,
    linkedin_url:      person.linkedin_url || null,
    confidence_score:  confidenceScore,
    confidence_reason: confidenceReason,
    status:            'pending',
    pushed_to_hubspot: false,
    raw_payload:       person,
    updated_at:        new Date().toISOString(),
  };
}

// ── Extract people from various Apollo webhook payload shapes ─────────────────
function extractPeople(payload) {
  if (!payload) return [];
  if (Array.isArray(payload.people))  return payload.people;
  if (Array.isArray(payload.matches)) return payload.matches.filter(Boolean);
  if (Array.isArray(payload.results)) return payload.results.filter(Boolean);
  if (payload.person)                  return [payload.person];
  if (payload.data && Array.isArray(payload.data.people)) return payload.data.people;
  return [];
}

// ── Save contacts where email OR phone is present ─────────────────────────────
async function saveValidContacts(runId, requestId, people) {
  const { data: run, error: runErr } = await supabase.from('apollo_enrichment_runs').select('*').eq('id', runId).single();
  if (runErr) throw new Error('Apollo run not found: ' + runErr.message);

  // Build lookup from People Search candidates (has name/title/company from step 1)
  // Webhook people only have email/phone — we merge to get full profiles
  const candidatesMap = {};
  (run.candidates_json || []).forEach(c => { if (c && c.id) candidatesMap[c.id] = c; });
  const enrichedPeople = people.map(webhookPerson => {
    const profile = candidatesMap[webhookPerson.id] || {};
    // Start with profile (has name/title/company/phone from People Search)
    // then overlay webhook data (has enriched email, may have phone)
    const merged = Object.assign({}, profile, webhookPerson);

    // PHONE FIX: Apollo's Bulk Enrichment webhook often returns phone_numbers:[]
    // (empty array) even when People Search had phone data — Object.assign would
    // clobber the good data. Restore People Search phones if webhook has none.
    const webhookHasPhone = extractPhone(webhookPerson);
    if (!webhookHasPhone) {
      if (Array.isArray(profile.phone_numbers) && profile.phone_numbers.length)
        merged.phone_numbers  = profile.phone_numbers;
      if (profile.mobile_phone)    merged.mobile_phone    = profile.mobile_phone;
      if (profile.phone)           merged.phone           = profile.phone;
      if (profile.sanitized_phone) merged.sanitized_phone = profile.sanitized_phone;
    }

    return merged;
  });

  // key_contacts has no job_id column — only lead_id
  const rows = enrichedPeople.map(p => normalizeContact(p, runId, requestId, run.lead_id)).filter(Boolean);
  if (!rows.length) {
    console.log('[apollo:webhook] No usable contacts (need at least email OR phone). Received:', people.length);
    return 0;
  }

  const { error } = await supabase.from('key_contacts').upsert(rows, { onConflict: 'apollo_run_id,apollo_person_id', ignoreDuplicates: false });
  if (error) throw new Error('Failed to save Apollo contacts: ' + error.message);

  // Count contacts where at least email OR phone exists
  const { count } = await supabase.from('key_contacts')
    .select('*', { count: 'exact', head: true })
    .eq('source_type', 'apollo').eq('apollo_run_id', runId)
    .or('public_email.not.is.null,public_phone.not.is.null');

  await updateRun(runId, { status: 'completed', valid_contacts_count: count || rows.length });
  console.log('[apollo:webhook] Saved', rows.length, 'contacts (email or phone) for run', runId);
  return rows.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/apollo/search
// ─────────────────────────────────────────────────────────────────────────────
router.post('/search', async (req, res) => {
  try {
    const filters = req.body || {};

    // Validate required fields
    const location        = (filters.location      || '').trim();
    const country         = (filters.country       || '').trim();
    const customIndustry  = (filters.customIndustry|| '').trim();
    const industry        = (filters.industry      || '').trim();
    const companySearch   = (filters.companySearch || '').trim();
    const effectiveIndustry = customIndustry || (industry !== 'Any Industry' && industry !== 'All' ? industry : '');

    if (!location)                           return res.status(400).json({ error: 'City is required — e.g. Bangkok' });
    if (!country)                            return res.status(400).json({ error: 'Country is required — e.g. Thailand' });
    if (!effectiveIndustry && !companySearch) return res.status(400).json({ error: 'Industry or Company name is required' });

    const { url: baseUrl, debug } = buildSearchUrl({ ...filters, location, country, industry: effectiveIndustry, companySearch });
    const run = await createRun(filters.jobId || null, filters.leadId || null, debug);
    console.log('[apollo:search] Run:', run.id, 'payload:', JSON.stringify(debug));

    // Step 1 — People Search with pagination (names/companies only — NO email/phone yet)
    // Apollo max is 100 per page; we fetch multiple pages to reach resultsLimit
    const resultsWanted = Math.min(Math.max(Number(filters.resultsLimit || 100), 1), 500);
    const maxPages      = Math.ceil(resultsWanted / 100);
    const people        = [];
    let   totalEntries  = 0;

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const pageUrl = baseUrl.replace(/page=\d+/, `page=${pageNum}`);
      console.log('[apollo:search] Fetching page', pageNum, '/', maxPages, 'url:', safeUrl(pageUrl));
      const pageData  = await apolloFetch(pageUrl, 'POST');
      const pagePeople = Array.isArray(pageData.people) ? pageData.people : [];
      if (pageNum === 1) totalEntries = (pageData.pagination && pageData.pagination.total_entries) || pagePeople.length;
      people.push(...pagePeople);
      console.log('[apollo:search] Page', pageNum, '→', pagePeople.length, 'people (total so far:', people.length, ')');
      if (pagePeople.length < 100 || people.length >= resultsWanted) break; // no more pages
      if (pageNum < maxPages) await new Promise(r => setTimeout(r, 300)); // small delay between pages
    }

    console.log('[apollo:search] Total people fetched:', people.length, '/ available on Apollo:', totalEntries);

    if (!people.length) {
      await updateRun(run.id, { status: 'completed', search_count: 0, enrichment_requested_count: 0, valid_contacts_count: 0 });
      return res.json({ success: true, apolloRunId: run.id, status: 'completed', searchedCount: 0, enrichmentRequestedCount: 0, contacts: [], message: 'No people found matching your filters. Try fewer filters or a broader location.' });
    }

    const candidates = people.filter(p => p && p.id);
    if (!candidates.length) {
      await updateRun(run.id, { status: 'completed', search_count: people.length, enrichment_requested_count: 0, valid_contacts_count: 0 });
      return res.json({ success: true, apolloRunId: run.id, status: 'completed', searchedCount: people.length, enrichmentRequestedCount: 0, contacts: [], message: 'Apollo returned people but none had usable IDs for enrichment.' });
    }

    // Step 2 — Bulk Enrichment (parallel chunk submission — waterfall email+phone, async webhook)
    const chunks  = chunkArray(candidates, 10);
    const results = await Promise.all(chunks.map(chunk => requestBulkEnrichment(run.id, chunk)));
    const requestIds = results.filter(Boolean).map(r => String(r.request_id)).filter(Boolean);

    // Save full People Search candidates (name/title/company) so webhook can merge profile data
    await updateRun(run.id, { status: 'processing', search_count: people.length, enrichment_requested_count: candidates.length, request_ids: requestIds, candidates_json: candidates });

    return res.json({
      success: true,
      apolloRunId: run.id,
      status: 'processing',
      searchedCount: people.length,
      enrichmentRequestedCount: candidates.length,
      requestIds,
      message: 'Apollo enrichment running. Contacts with email or phone will appear when the webhook is received.',
    });

  } catch (err) {
    console.error('[apollo] Search error:', err.message);
    return res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/apollo/phone-webhook?apolloRunId=<uuid>
// Apollo calls this when bulk enrichment is done. Saves email+phone contacts only.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/phone-webhook', async (req, res) => {
  try {
    const apolloRunId = (req.query.apolloRunId || '').trim();
    if (!apolloRunId) return res.status(400).json({ success: false, error: 'Missing apolloRunId' });

    const payload   = req.body || {};
    const requestId = payload.request_id ? String(payload.request_id) : null;
    const people    = extractPeople(payload);

    console.log('[apollo:webhook] Received:', {
      apolloRunId, requestId,
      status:          payload.status,
      totalRequested:  payload.total_requested_enrichments,
      emailEnriched:   payload.email_records_enriched,
      phoneEnriched:   payload.mobile_records_enriched,
      peopleInPayload: people.length,
    });

    const savedCount = await saveValidContacts(apolloRunId, requestId, people);

    // Always 200 — Apollo retries on non-200
    return res.status(200).json({
      success: true,
      apolloRunId,
      requestId,
      receivedPeople:          people.length,
      savedSalesReadyContacts: savedCount,
    });

  } catch (err) {
    console.error('[apollo:webhook] Error:', err.message);
    return res.status(200).json({ success: false, error: err.message }); // still 200
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/apollo/contacts
// Returns ONLY source_type=apollo contacts with BOTH public_email AND public_phone.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/contacts', async (req, res) => {
  try {
    const { status, search, apolloRunId } = req.query;

    let query = supabase
      .from('key_contacts')
      .select('*')
      .eq('source_type', 'apollo')
      .or('public_email.not.is.null,public_phone.not.is.null')   // email OR phone — not both required
      .order('created_at', { ascending: false })
      .limit(1000);

    if (status)      query = query.eq('status', status);
    if (apolloRunId) query = query.eq('apollo_run_id', apolloRunId);

    const { data, error } = await query;
    if (error) throw error;

    let contacts = data || [];
    if (search) {
      const q = search.toLowerCase();
      contacts = contacts.filter(c =>
        (c.person_name  || '').toLowerCase().includes(q) ||
        (c.company_name || '').toLowerCase().includes(q) ||
        (c.public_email || '').toLowerCase().includes(q) ||
        (c.public_phone || '').toLowerCase().includes(q)
      );
    }

    return res.json({
      success:  true,
      count:    contacts.length,
      contacts,
      message:  contacts.length === 0 ? 'No Apollo contacts found with email or phone.' : undefined,
    });

  } catch (err) {
    console.error('[apollo] GET /contacts error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/apollo/runs  — list all runs newest first (Apollo Dashboard, excludes archived)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/runs', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('apollo_enrichment_runs')
      .select('*')
      .is('archived_at', null)          // <- exclude soft-deleted runs
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    return res.json({ success: true, count: (data || []).length, runs: data || [] });
  } catch (err) {
    console.error('[apollo] GET /runs error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/apollo/runs/:runId  — poll run status (with auto-timeout)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/runs/:runId', async (req, res) => {
  try {
    const { data: run, error } = await supabase
      .from('apollo_enrichment_runs').select('*').eq('id', req.params.runId).single();
    if (error) return res.status(404).json({ error: 'Run not found.' });

    // ── Auto-timeout: if still stuck after 10 minutes, mark as error ──────────
    if (run.status === 'processing' || run.status === 'created') {
      const ageMs = Date.now() - new Date(run.created_at).getTime();
      if (ageMs > 10 * 60 * 1000) {
        const timeoutMsg = 'Enrichment timed out — Apollo webhook not received within 10 minutes. This usually means PUBLIC_BASE_URL is not set correctly on the backend.';
        await supabase
          .from('apollo_enrichment_runs')
          .update({ status: 'error', error_message: timeoutMsg, updated_at: new Date().toISOString() })
          .eq('id', run.id);
        run.status       = 'error';
        run.error_message = timeoutMsg;
        console.log('[apollo] Run auto-timed-out:', run.id);
      }
    }

    const { count } = await supabase.from('key_contacts')
      .select('*', { count: 'exact', head: true })
      .eq('source_type', 'apollo').eq('apollo_run_id', req.params.runId)
      .or('public_email.not.is.null,public_phone.not.is.null');   // email OR phone

    return res.json({ success: true, run, validContactsFound: count || 0 });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/apollo/poll-result/:requestId?apolloRunId=<uuid>
// Manual poll if webhook was missed (Apollo stores results 30 days).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/poll-result/:requestId', async (req, res) => {
  try {
    const { requestId }   = req.params;
    const { apolloRunId } = req.query;
    const url  = `${APOLLO_BASE}/webhook_result/${encodeURIComponent(requestId)}`;
    const data = await apolloFetch(url, 'GET');

    if (apolloRunId) {
      const people     = extractPeople(data);
      const savedCount = await saveValidContacts(apolloRunId, requestId, people);
      return res.json({ success: true, requestId, apolloRunId, savedSalesReadyContacts: savedCount, raw: data });
    }
    return res.json({ success: true, requestId, raw: data });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/apollo/enrich/:leadId — re-enrich one lead via Apollo
// ─────────────────────────────────────────────────────────────────────────────
router.post('/enrich/:leadId', async (req, res) => {
  try {
    const { leadId } = req.params;
    const { data: lead, error: leadErr } = await supabase.from('leads').select('*').eq('id', leadId).single();
    if (leadErr || !lead) return res.status(404).json({ error: 'Lead not found.' });

    const domain = cleanDomain(lead.website || lead.website_url || lead.domain || lead.company_domain);
    const filters = {
      leadId,
      jobId:         lead.job_id  || null,
      country:       lead.country || 'Thailand',
      location:      lead.city    || lead.location || undefined,
      // Use domain when it's a real business domain; fall back to company name keyword
      // when domain is null (social/platform URL) to avoid wrong-company matches
      companyDomains: domain ? [domain] : [],
      companySearch:  !domain && lead.company_name ? lead.company_name : '',
      // No default seniority — get ALL contacts Apollo has for this company.
      // Caller can still pass seniority[] in the body to narrow down.
      seniority:     req.body.seniority   || [],
      departments:   req.body.departments || [],
      companySizes:  req.body.companySizes || [],
      resultsLimit:  req.body.resultsLimit || 100,
    };

    const { url, debug } = buildSearchUrl(filters);
    const run = await createRun(filters.jobId, leadId, debug);
    console.log('[apollo:enrich] Lead', leadId, 'run:', run.id);

    const searchData = await apolloFetch(url, 'POST');
    const people     = Array.isArray(searchData.people) ? searchData.people : [];
    const candidates = people.filter(p => p && p.id);

    if (!candidates.length) {
      await updateRun(run.id, { status: 'completed', search_count: people.length, enrichment_requested_count: 0, valid_contacts_count: 0 });
      return res.json({ success: true, apolloRunId: run.id, status: 'completed', searchedCount: people.length, enrichmentRequestedCount: 0, message: 'No Apollo candidates found for this lead.' });
    }

    const chunks2  = chunkArray(candidates, 10);
    const results2 = await Promise.all(chunks2.map(chunk => requestBulkEnrichment(run.id, chunk)));
    const requestIds = results2.filter(Boolean).map(r => String(r.request_id)).filter(Boolean);

    await updateRun(run.id, { status: 'processing', search_count: people.length, enrichment_requested_count: candidates.length, request_ids: requestIds });
    return res.json({ success: true, apolloRunId: run.id, status: 'processing', searchedCount: people.length, enrichmentRequestedCount: candidates.length, requestIds, message: 'Apollo enrichment started. Contacts with email or phone will be saved.' });

  } catch (err) {
    console.error('[apollo:enrich] Error:', err.message);
    return res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/apollo/runs/:runId/cancel
// Marks a stuck "processing" run as "cancelled" in DB.
// (We cannot cancel Apollo's server-side enrichment once submitted.)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/runs/:runId/cancel', async (req, res) => {
  try {
    const { runId } = req.params;

    // Verify run exists
    const { data: run, error: findErr } = await supabase
      .from('apollo_enrichment_runs')
      .select('id, status')
      .eq('id', runId)
      .single();
    if (findErr || !run) return res.status(404).json({ error: 'Run not found.' });

    // Only cancel if it is still processing (idempotent — skip if already done/cancelled)
    if (run.status !== 'processing' && run.status !== 'created') {
      return res.json({ success: true, message: `Run already in '${run.status}' state — nothing to cancel.` });
    }

    const { error } = await supabase
      .from('apollo_enrichment_runs')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', runId);
    if (error) throw error;

    console.log('[apollo] Run cancelled:', runId);
    return res.json({ success: true, message: 'Run marked as cancelled.' });
  } catch (err) {
    console.error('[apollo] Cancel run error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/apollo/runs/cancel-all-stuck
// Cancels ALL runs still in "processing" or "created" state.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/runs/cancel-all-stuck', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('apollo_enrichment_runs')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .in('status', ['processing', 'created'])
      .select('id');

    if (error) throw error;

    const count = (data || []).length;
    console.log('[apollo] Cancelled all stuck runs — count:', count);
    return res.json({ success: true, cancelledCount: count, message: `${count} stuck run(s) cancelled.` });
  } catch (err) {
    console.error('[apollo] Cancel-all-stuck error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/apollo/runs/:runId
// Soft-deletes immediately (sets archived_at). Contacts are preserved in DB.
// No age restriction — manual delete is always allowed by the user.
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/runs/:runId', async (req, res) => {
  try {
    const { runId } = req.params;

    const { data: run, error: findErr } = await supabase
      .from('apollo_enrichment_runs')
      .select('id, archived_at')
      .eq('id', runId)
      .single();
    if (findErr || !run) return res.status(404).json({ error: 'Run not found.' });

    if (run.archived_at) {
      return res.status(410).json({ error: 'Run is already deleted.' });
    }

    const { error: archiveErr } = await supabase
      .from('apollo_enrichment_runs')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', runId);
    if (archiveErr) throw archiveErr;

    console.log(`[apollo] Run ${runId} deleted (soft-archived)`);
    return res.json({ success: true, message: 'Run deleted. Contacts are preserved.' });
  } catch (err) {
    console.error('[apollo] DELETE /runs/:runId error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/apollo/runs/:runId/retry
// Re-runs a failed or cancelled Apollo job using its original search payload.
// Re-does People Search → Bulk Enrichment → webhook delivery.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/runs/:runId/retry', async (req, res) => {
  try {
    const { runId } = req.params;

    const { data: run, error: findErr } = await supabase
      .from('apollo_enrichment_runs')
      .select('*')
      .eq('id', runId)
      .single();
    if (findErr || !run) return res.status(404).json({ error: 'Run not found.' });

    if (!['error', 'cancelled'].includes(run.status)) {
      return res.status(400).json({ error: `Cannot retry a run with status '${run.status}'. Only failed or cancelled runs can be retried.` });
    }

    if (!run.search_payload || Object.keys(run.search_payload).length === 0) {
      return res.status(400).json({ error: 'No search payload stored — cannot retry this run.' });
    }

    // Reset run status so polling picks it up
    await updateRun(runId, {
      status:                    'created',
      error_message:             null,
      valid_contacts_count:      0,
      search_count:              0,
      enrichment_requested_count: 0,
      request_ids:               [],
    });

    // Rebuild Apollo search URL from stored params (force per_page=100 for pagination)
    const stored = run.search_payload || {};
    const baseParams = new URLSearchParams();
    for (const [key, values] of Object.entries(stored)) {
      const arr = Array.isArray(values) ? values : [values];
      for (const val of arr) {
        if (val !== undefined && val !== null && key !== 'page' && key !== 'per_page') baseParams.append(key, String(val));
      }
    }
    baseParams.set('per_page', '100');
    const baseRetryUrl = `${APOLLO_BASE}/mixed_people/api_search?${baseParams.toString()}`;
    console.log('[apollo:retry] Run:', runId, 're-searching with original payload (paginated)');

    // Re-run People Search with pagination
    const retryPerPage = 100;
    const retryWanted  = 500; // retry always fetches max available
    const retryMaxPages = Math.ceil(retryWanted / retryPerPage);
    const people = [];

    for (let pageNum = 1; pageNum <= retryMaxPages; pageNum++) {
      const pageUrl = `${baseRetryUrl}&page=${pageNum}`;
      const pageData = await apolloFetch(pageUrl, 'POST');
      const pagePeople = Array.isArray(pageData.people) ? pageData.people : [];
      people.push(...pagePeople);
      console.log('[apollo:retry] Page', pageNum, '→', pagePeople.length, 'people');
      if (pagePeople.length < retryPerPage || people.length >= retryWanted) break;
      if (pageNum < retryMaxPages) await new Promise(r => setTimeout(r, 300));
    }

    if (!people.length) {
      await updateRun(runId, { status: 'completed', search_count: 0, enrichment_requested_count: 0, valid_contacts_count: 0 });
      return res.json({ success: true, status: 'completed', message: 'Retry complete — no people found with these filters.' });
    }

    const candidates = people.filter(p => p && p.id);

    // Re-submit to Bulk Enrichment (new webhook URL built inside requestBulkEnrichment)
    const chunks     = chunkArray(candidates, 10);
    const results    = await Promise.all(chunks.map(chunk => requestBulkEnrichment(runId, chunk)));
    const requestIds = results.filter(Boolean).map(r => String(r.request_id)).filter(Boolean);

    // Save full People Search candidates (name/title/company) so webhook can merge profile data
    await updateRun(runId, {
      status:                     'processing',
      search_count:               people.length,
      enrichment_requested_count: candidates.length,
      request_ids:                requestIds,
      candidates_json:            candidates,
    });

    console.log('[apollo:retry] Run', runId, 'restarted — people:', people.length, 'requestIds:', requestIds);
    return res.json({
      success:                  true,
      status:                   'processing',
      searchedCount:            people.length,
      enrichmentRequestedCount: candidates.length,
      message:                  'Retry started — contacts will appear when Apollo webhook is received.',
    });

  } catch (err) {
    console.error('[apollo] Retry run error:', err.message);
    return res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/apollo/test-match — debug single person, no DB writes
// ─────────────────────────────────────────────────────────────────────────────
router.post('/test-match', async (req, res) => {
  try {
    const p = new URLSearchParams();
    if (req.body.id)           p.set('id',           req.body.id);
    if (req.body.first_name)   p.set('first_name',   req.body.first_name);
    if (req.body.last_name)    p.set('last_name',     req.body.last_name);
    if (req.body.name)         p.set('name',          req.body.name);
    if (req.body.linkedin_url) p.set('linkedin_url',  req.body.linkedin_url);
    if (req.body.domain)       p.set('domain',        cleanDomain(req.body.domain) || '');
    p.set('run_waterfall_email', 'true');
    p.set('run_waterfall_phone', 'true');
    p.set('webhook_url', PUBLIC_BASE_URL + '/api/apollo/phone-webhook-debug');
    const url  = `${APOLLO_BASE}/people/match?${p.toString()}`;
    const data = await apolloFetch(url, 'POST');
    return res.json({ success: true, data, note: 'Synchronous response only. Final email/phone arrives via webhook.' });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

// GET /api/apollo/leads
// Approved Apify leads with per-lead Apollo contact stats.
// Optional ?jobId=xxx filter.
router.get('/leads', async (req, res) => {
  try {
    const { jobId } = req.query;
    let query = supabase
      .from('leads')
      .select('*')
      .eq('approval_status', 'approved')
      .order('lead_score', { ascending: false });
    if (jobId) query = query.eq('job_id', jobId);
    const { data: leads, error } = await query;
    if (error) throw error;
    const leadIds = (leads || []).map(l => l.id);
    const statsMap = {};
    if (leadIds.length) {
      const { data: contacts } = await supabase
        .from('key_contacts')
        .select('lead_id, status')
        .in('lead_id', leadIds)
        .eq('source_type', 'apollo');
      (contacts || []).forEach(c => {
        if (!statsMap[c.lead_id]) statsMap[c.lead_id] = { total:0, pending:0, approved:0, rejected:0, pushed:0 };
        statsMap[c.lead_id].total++;
        if (statsMap[c.lead_id][c.status] !== undefined) statsMap[c.lead_id][c.status]++;
      });
    }
    res.json((leads || []).map(l => ({ ...l, apollo_stats: statsMap[l.id] || null })));
  } catch (err) {
    console.error('[apollo] GET /leads error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/apollo/contacts/:leadId
// Apollo-sourced contacts for one lead (email OR phone required).
router.get('/contacts/:leadId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('key_contacts')
      .select('*')
      .eq('lead_id', req.params.leadId)
      .eq('source_type', 'apollo')
      .or('public_email.not.is.null,public_phone.not.is.null')
      .order('confidence_score', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[apollo] GET /contacts/:leadId error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
