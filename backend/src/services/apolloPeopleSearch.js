// Apollo People Search — shared service for batch enrichment
//
// 2-step approach to get contacts WITH stored emails synchronously (no webhook):
//
//   Step 1:  GET  /organizations/enrich?domain=<domain>
//            → Find Apollo org ID for the company (fast, no DB write, returns null if not found)
//
//   Step 2a: POST /mixed_people/search  { organization_ids: [orgId] }
//            → Contacts stored in Apollo's database WITH emails synchronously
//            → Used when Step 1 finds an org ID
//
//   Step 2b: POST /mixed_people/api_search?q_organization_domains_list[]=<domain>&...
//            → Fallback when org not found in Apollo's DB (returns names/LinkedIn only, NO emails)
//            → Uses query params (NOT body fields) — this is how Apollo's prospecting endpoint works
//            → Location filter: always "Thailand" (never city-district — Bang Na etc. not recognized)
//
// Used by: apolloBatch.js pre_clean mode

'use strict';

const axios        = require('axios');
const APOLLO_BASE  = 'https://api.apollo.io/api/v1';
const apiKey       = () => (process.env.APOLLO_API_KEY || '').trim();

const APOLLO_HEADERS = () => ({
  'accept':        'application/json',
  'Content-Type':  'application/json',
  'Cache-Control': 'no-cache',
  'x-api-key':     apiKey(),
});

// Social / platform domains — same list as apolloCompany.js
// Using these as search domain would return the platform's employees, not the business's.
const SOCIAL_DOMAINS = new Set([
  'facebook.com', 'fb.com', 'instagram.com', 'twitter.com', 'x.com',
  'linkedin.com', 'tiktok.com', 'youtube.com', 'line.me', 'linktree.com',
  'linktr.ee', 'shopee.co.th', 'shopee.com', 'lazada.co.th', 'lazada.com',
  'grab.com', 'foodpanda.com', 'wongnai.com', 'tripadvisor.com',
]);

function cleanDomain(url) {
  if (!url) return null;
  const domain = String(url)
    .replace(/https?:\/\//g, '')
    .replace(/^www\./, '')
    .split('/')[0].split('?')[0]
    .trim().toLowerCase() || null;
  if (domain && SOCIAL_DOMAINS.has(domain)) return null;
  return domain;
}

function isValidEmail(v) {
  return !!(v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim()));
}

function normalizePhone(v) {
  if (!v) return null;
  const c = String(v).trim().replace(/[^\d+]/g, '');
  return c.replace('+', '').length >= 7 ? c : null;
}

// ── Email extraction — same logic as apollo.js ────────────────────────────────
function extractEmail(person) {
  if (isValidEmail(person.email)) return person.email.trim();
  if (Array.isArray(person.emails)) {
    for (const item of person.emails) {
      if (typeof item === 'string' && isValidEmail(item)) return item.trim();
      if (item && isValidEmail(item.email)) return item.email.trim();
    }
  }
  return null;
}

// ── Phone extraction — same logic as apollo.js ────────────────────────────────
function extractPhone(person) {
  const direct =
    normalizePhone(person.mobile_phone) ||
    normalizePhone(person.phone) ||
    normalizePhone(person.sanitized_phone);
  if (direct) return { phone: direct, source: 'direct' };

  if (Array.isArray(person.phone_numbers)) {
    for (const item of person.phone_numbers) {
      const p = typeof item === 'string'
        ? normalizePhone(item)
        : normalizePhone(item && (item.sanitized_number || item.raw_number || item.number));
      if (p) return { phone: p, source: 'direct' };
    }
  }

  // Company phone fallback (lower confidence)
  const org = person.organization || {};
  const acc = person.account      || {};
  const company =
    normalizePhone(org.phone) || normalizePhone(org.sanitized_phone) ||
    normalizePhone(acc.phone) || normalizePhone(acc.sanitized_phone);
  if (company) return { phone: company, source: 'company' };

  return { phone: null, source: null };
}

// ── Confidence score — same logic as apollo.js ────────────────────────────────
function scoreContact(person, email, phone, phoneSource) {
  let score = 0;
  if (email) {
    const status = (person.email_status || person.contact_email_status || '').toLowerCase();
    score += status === 'verified' ? 35 : 20;
  }
  if (phone) score += phoneSource === 'direct' ? 25 : 12;

  const title = (person.title || person.headline || '').toLowerCase();
  if (/ceo|founder|owner|president|chief|managing.?director/.test(title)) score += 25;
  else if (/\bdirector\b|vp\b|vice.?president|head of/.test(title))       score += 15;
  else if (/manager|supervisor|\blead\b/.test(title))                      score += 8;
  else if (title)                                                          score += 3;

  if (person.linkedin_url) score += 10;
  const org = person.organization || {};
  const acc = person.account      || {};
  if (org.primary_domain || acc.primary_domain) score += 5;

  return Math.min(score, 100);
}

function getDepartment(title) {
  const t = (title || '').toLowerCase();
  if (t.includes('sales') || t.includes('commercial'))  return 'Sales';
  if (t.includes('marketing'))                           return 'Marketing';
  if (t.includes('operations'))                          return 'Operations';
  if (t.includes('logistics') || t.includes('freight')) return 'Logistics';
  if (t.includes('finance') || t.includes('cfo'))       return 'Finance';
  if (t.includes('hr') || t.includes('human resources'))return 'HR';
  if (t.includes('tech') || t.includes('cto'))          return 'IT / Tech';
  return 'General Management';
}

function getSeniority(title) {
  const t = (title || '').toLowerCase();
  if (['ceo','owner','founder','managing director','md','president'].some(k => t.includes(k))) return 'Executive';
  if (['director','head of','vp ','chief'].some(k => t.includes(k)))                          return 'Director';
  if (t.includes('manager'))                                                                    return 'Manager';
  return 'Other';
}

// ── Step 1: Find Apollo org ID by domain (no DB writes) ──────────────────────
// Uses organizations/enrich — a direct lookup that returns the org's Apollo ID.
// Returns null if domain is not indexed in Apollo's database.
async function findApolloOrgId(domain) {
  try {
    const res = await axios.get(`${APOLLO_BASE}/organizations/enrich`, {
      params:  { domain },
      headers: APOLLO_HEADERS(),
      timeout: 15000,
    });
    const org = res.data && res.data.organization;
    return (org && org.id) ? org.id : null;
  } catch (err) {
    // 404 = domain not in Apollo's DB (normal for small Thai businesses)
    if (err.response?.status !== 404) {
      console.warn(`[apolloPeopleSearch] Org lookup error for domain "${domain}": ${err.message}`);
    }
    return null;
  }
}

// ── Step 2a: Get contacts WITH emails using org ID ────────────────────────────
// mixed_people/search with organization_ids returns contacts stored in Apollo's
// database INCLUDING their stored email addresses — no webhook needed.
async function searchByOrgId(orgId, companyName, leadId, maxResults) {
  const res = await axios.post(`${APOLLO_BASE}/mixed_people/search`, {
    organization_ids:     [orgId],
    // Request all email verification tiers — we want maximum contacts
    contact_email_status: ['verified', 'likely to engage', 'unavailable'],
    page:     1,
    per_page: Math.min(maxResults, 100),
  }, { headers: APOLLO_HEADERS(), timeout: 30000 });

  const people = (res.data && res.data.people) || [];
  console.log(`[apolloPeopleSearch] "${companyName}" — org search: ${people.length} people (stored emails available)`);

  return buildContactRows(people, companyName, leadId, maxResults, `Apollo org search (orgId=${orgId})`);
}

// ── Step 2b: Fallback — people search by domain/name (names only, no emails) ──
// mixed_people/api_search is a prospecting endpoint using QUERY PARAMS (not body).
// It returns profiles WITHOUT emails — emails require async bulk enrichment webhook.
// Used only when org ID lookup fails. Still useful: gives names + LinkedIn URLs.
async function searchByApiSearch(lead, maxResults) {
  const domain = cleanDomain(lead.website);
  const p = new URLSearchParams();
  p.set('page', '1');
  p.set('per_page', String(Math.min(maxResults || 100, 100)));
  // Country-level only — Bangkok district names (Bang Na, Min Buri, etc.)
  // are NOT recognized by Apollo; city-level filter eliminates most valid contacts
  p.append('organization_locations[]', 'Thailand');

  if (domain) {
    p.append('q_organization_domains_list[]', domain);
    console.log(`[apolloPeopleSearch] "${lead.company_name}" — api_search fallback by domain: ${domain}`);
  } else {
    p.set('q_keywords', (lead.company_name || '').trim());
    console.log(`[apolloPeopleSearch] "${lead.company_name}" — api_search fallback by name keyword`);
  }

  const res = await axios.post(`${APOLLO_BASE}/mixed_people/api_search?${p.toString()}`, {}, {
    headers: APOLLO_HEADERS(),
    timeout: 30000,
  });

  const people = (res.data && res.data.people) || [];
  console.log(`[apolloPeopleSearch] "${lead.company_name}" — api_search fallback: ${people.length} people (names/LinkedIn only, no stored emails)`);

  return buildContactRows(
    people, lead.company_name, lead.id, maxResults,
    `Apollo api_search${domain ? ' (domain)' : ' (name)'}`
  );
}

// ── Shared: map Apollo person objects → key_contacts rows ─────────────────────
function buildContactRows(people, companyName, leadId, maxResults, reason) {
  const contacts = [];
  for (const person of people) {
    if (!person || !person.id) continue;
    if (contacts.length >= maxResults) break;

    const firstName = person.first_name || '';
    const lastName  = person.last_name  || '';
    const name      = [firstName, lastName].filter(Boolean).join(' ') || person.name || null;
    if (!name) continue;

    const email                      = extractEmail(person);
    const { phone, source: phoneSrc } = extractPhone(person);

    // Require at least email OR phone — name-only records are not actionable for sales.
    // Contacts with neither are skipped here so the company correctly falls through to
    // the fallback search (LinkedIn / Facebook / Website) which may find richer data.
    if (!email && !phone) continue;

    contacts.push({
      lead_id:           leadId,
      company_name:      companyName,
      person_name:       name,
      first_name:        firstName || null,
      last_name:         lastName  || null,
      job_title:         person.title || person.headline || null,
      department:        getDepartment(person.title || ''),
      seniority:         getSeniority(person.title || ''),
      linkedin_url:      person.linkedin_url || null,
      source_url:        person.linkedin_url || null,
      source_type:       'apollo',
      public_email:      email || null,
      public_phone:      phone || null,
      confidence_score:  scoreContact(person, email, phone, phoneSrc),
      confidence_reason: reason,
      status:            'pending',
      pushed_to_hubspot: false,
      apollo_person_id:  person.id || null,
    });
  }
  return contacts;
}

// ── Main: search and return contacts for a lead ───────────────────────────────
// 2-step approach to get contacts WITH stored emails:
//   Step 1: GET organizations/enrich?domain=... → find Apollo org ID (fast, no DB write)
//   Step 2a: POST mixed_people/search with organization_ids → stored emails synchronously
//   Step 2b: Fallback to mixed_people/api_search (names+LinkedIn only, no emails)
//
// maxResults limits how many contacts to return (per-lead budget from apolloBatch).
async function searchContactsForLead(lead, maxResults = 25) {
  const domain = cleanDomain(lead.website);
  console.log(`[apolloPeopleSearch] "${lead.company_name}" — starting search (domain: ${domain || 'none'}, budget: ${maxResults})`);

  // ── Step 1: Look up Apollo org ID via domain ────────────────────────────────
  let apolloOrgId = null;
  if (domain) {
    apolloOrgId = await findApolloOrgId(domain);
    if (apolloOrgId) {
      console.log(`[apolloPeopleSearch] "${lead.company_name}" — org found: ${apolloOrgId}`);
    } else {
      console.log(`[apolloPeopleSearch] "${lead.company_name}" — domain "${domain}" not in Apollo's DB, will use api_search`);
    }
    // Small gap between org lookup and contact search (same company, different endpoints)
    await new Promise(r => setTimeout(r, 300));
  }

  // ── Step 2a: Org known → get contacts WITH stored emails ───────────────────
  if (apolloOrgId) {
    try {
      const contacts = await searchByOrgId(apolloOrgId, lead.company_name, lead.id, maxResults);
      console.log(`[apolloPeopleSearch] "${lead.company_name}" — ${contacts.length} contacts via org search`);
      return contacts;
    } catch (err) {
      const status = err.response?.status;
      console.warn(`[apolloPeopleSearch] "${lead.company_name}" — org contact search failed (HTTP ${status || 'network'}): ${err.message}. Falling back to api_search.`);
    }
  }

  // ── Step 2b: No org ID → people search by domain or name (names only) ──────
  try {
    const contacts = await searchByApiSearch(lead, maxResults);
    console.log(`[apolloPeopleSearch] "${lead.company_name}" — ${contacts.length} contacts via api_search fallback`);
    return contacts;
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data?.message || err.message;
    console.error(`[apolloPeopleSearch] "${lead.company_name}" — api_search also failed (HTTP ${status || 'network'}): ${detail}`);
    return [];
  }
}

module.exports = { searchContactsForLead, cleanDomain, SOCIAL_DOMAINS };
