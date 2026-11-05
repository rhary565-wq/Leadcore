// Apollo Company Enrichment Service
// Used by the Apify → Apollo → HubSpot pipeline for company-level data.
//
// Flow:
//   1. enrichCompanyWithApollo(lead)
//      a. Try domain-based org enrich (exact match, best quality)
//      b. Fall back to name-based mixed_companies/search
//      c. Store result to leads table (apollo_company_id, headcount, revenue)
//      d. Always generate + store DBD URL
//      e. Return { apolloOrgId, headcount, revenue, revenueRange, found }
//
//   2. getContactsFromApolloOrg(apolloOrgId, companyName, leadId)
//      a. Call mixed_people/search filtered by organization_ids
//      b. Return contacts array ready for key_contacts insert

'use strict';

const axios        = require('axios');
const { supabase } = require('../db/supabase');

const APOLLO_BASE = 'https://api.apollo.io/api/v1';
const apiKey      = () => (process.env.APOLLO_API_KEY || '').trim();

const APOLLO_HEADERS = () => ({
  'accept':        'application/json',
  'Content-Type':  'application/json',
  'Cache-Control': 'no-cache',
  'x-api-key':     apiKey(),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

// Social / shared-platform domains that belong to the platform, not the business.
// Using these as Apollo domain lookup would return the platform's own company record
// (e.g. facebook.com → Meta with 76K employees, $116B revenue).
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
  // Return null for social/platform domains so Apollo falls back to name search
  if (domain && SOCIAL_DOMAINS.has(domain)) return null;
  return domain;
}

function buildDbdUrl(companyName) {
  // DBD site requires unencoded spaces — browser handles encoding on click
  const keyword = (companyName || '').trim();
  return `https://datawarehouse.dbd.go.th/juristic/searchInfo?keyword=${keyword}`;
}

async function apolloPost(endpoint, body) {
  const res = await axios.post(
    `${APOLLO_BASE}${endpoint}`,
    body,
    { headers: APOLLO_HEADERS(), timeout: 25000 }
  );
  return res.data || {};
}

async function apolloGet(endpoint) {
  const res = await axios.get(
    `${APOLLO_BASE}${endpoint}`,
    { headers: APOLLO_HEADERS(), timeout: 25000 }
  );
  return res.data || {};
}

// ── 1a. Domain-based org enrichment ──────────────────────────────────────────
async function enrichByDomain(domain) {
  try {
    const data = await apolloGet(`/organizations/enrich?domain=${encodeURIComponent(domain)}`);
    return data.organization || null;
  } catch (err) {
    console.warn(`[apolloCompany] Domain enrich failed for ${domain}: ${err.message}`);
    return null;
  }
}

// ── 1b. Name-based company search ────────────────────────────────────────────
async function searchByName(companyName) {
  try {
    const data = await apolloPost('/mixed_companies/search', {
      q_organization_name: companyName,
      page:     1,
      per_page: 3,
    });
    const orgs = data.organizations || [];
    if (!orgs.length) return null;
    // Pick the best match: prefer name overlap
    const nameLow = companyName.toLowerCase();
    const best = orgs.find(o =>
      (o.name || '').toLowerCase().includes(nameLow.slice(0, 6)) ||
      nameLow.includes((o.name || '').toLowerCase().slice(0, 6))
    ) || orgs[0];
    return best;
  } catch (err) {
    console.warn(`[apolloCompany] Name search failed for "${companyName}": ${err.message}`);
    return null;
  }
}

// ── Extract uniform fields from Apollo org object ─────────────────────────────
function extractOrgData(org) {
  if (!org) return null;
  return {
    apolloOrgId:   org.id || null,
    headcount:     org.num_employees || org.estimated_num_employees || null,
    revenue:       org.annual_revenue || null,
    revenueRange:  org.annual_revenue_printed || org.revenue_range || null,
    phone:         org.phone || null,
    linkedinUrl:   org.linkedin_url || null,
    city:          org.city || null,
    country:       org.country || null,
    description:   org.short_description || org.seo_description || null,
    founded:       org.founded_year || null,
    website:       org.website_url || null,
  };
}

// ── Main: enrich one lead with Apollo company data ────────────────────────────
async function enrichCompanyWithApollo(lead) {
  console.log(`[apolloCompany] Enriching: "${lead.company_name}" (id=${lead.id})`);

  const dbdUrl = buildDbdUrl(lead.company_name);
  let orgData  = null;

  // Try domain first (more precise)
  const domain = cleanDomain(lead.website);
  if (domain) {
    const org = await enrichByDomain(domain);
    orgData = extractOrgData(org);
    if (orgData) console.log(`[apolloCompany] ✓ Domain match: ${domain} → orgId=${orgData.apolloOrgId}`);
  }

  // Fall back to name search
  if (!orgData) {
    const org = await searchByName(lead.company_name);
    orgData = extractOrgData(org);
    if (orgData) console.log(`[apolloCompany] ✓ Name match: "${lead.company_name}" → orgId=${orgData.apolloOrgId}`);
    else         console.log(`[apolloCompany] ✗ No Apollo match for "${lead.company_name}"`);
  }

  // Always save DBD URL; save Apollo data if found
  const updatePayload = {
    dbd_url:                    dbdUrl,
    apollo_company_enriched_at: new Date().toISOString(),
  };

  if (orgData) {
    updatePayload.apollo_company_id    = orgData.apolloOrgId;
    updatePayload.apollo_headcount     = orgData.headcount;
    updatePayload.apollo_revenue       = orgData.revenue;
    updatePayload.apollo_revenue_range = orgData.revenueRange;
  }

  const { error } = await supabase
    .from('leads')
    .update(updatePayload)
    .eq('id', lead.id);

  if (error) console.error(`[apolloCompany] DB update error: ${error.message}`);

  return {
    found:        !!orgData,
    dbdUrl,
    apolloOrgId:  orgData?.apolloOrgId  || null,
    headcount:    orgData?.headcount     || null,
    revenue:      orgData?.revenue       || null,
    revenueRange: orgData?.revenueRange  || null,
    description:  orgData?.description  || null,
    linkedinUrl:  orgData?.linkedinUrl   || null,
    orgCity:      orgData?.city          || null,
  };
}

// ── 2. Get business contacts from matched Apollo company ──────────────────────
async function getContactsFromApolloOrg(apolloOrgId, leadId, companyName) {
  if (!apolloOrgId) return [];
  console.log(`[apolloCompany] Fetching contacts for orgId=${apolloOrgId}`);

  try {
    const data = await apolloPost('/mixed_people/search', {
      organization_ids:    [apolloOrgId],
      // No seniority filter — return ALL contacts Apollo has for this company.
      // Sales team decides who to reach out to.
      contact_email_status: ['verified', 'likely to engage', 'unavailable'],
      page:     1,
      per_page: 100,
    });

    const people = data.people || [];
    console.log(`[apolloCompany] Got ${people.length} contacts for orgId=${apolloOrgId}`);

    return people.map(p => {
      const firstName  = p.first_name  || '';
      const lastName   = p.last_name   || '';
      const personName = [firstName, lastName].filter(Boolean).join(' ') || p.name || '';
      const email      = p.email || '';
      const phone      = (p.sanitized_phone || p.phone_numbers?.[0]?.sanitized_number || '').trim();

      return {
        lead_id:           leadId,
        company_name:      companyName || p.organization_name || '',
        person_name:       personName,
        first_name:        firstName,
        last_name:         lastName,
        job_title:         p.title || '',
        department:        p.departments?.[0] || '',
        seniority:         mapSeniority(p.seniority || ''),
        linkedin_url:      p.linkedin_url || '',
        source_url:        p.linkedin_url || '',
        source_type:       'apollo',
        public_email:      email,
        public_phone:      phone,
        contact_location:  [p.city, p.country].filter(Boolean).join(', '),
        apollo_company_id: apolloOrgId,
        apollo_person_id:  p.id || null,
        confidence_score:  email ? 80 : phone ? 70 : 50,
        confidence_reason: `Apollo company contacts (orgId=${apolloOrgId})`,
        status:            'pending',
      };
    }).filter(c => c.person_name); // skip empty-name records
  } catch (err) {
    console.error(`[apolloCompany] getContactsFromApolloOrg failed: ${err.message}`);
    return [];
  }
}

function mapSeniority(raw) {
  const s = (raw || '').toLowerCase();
  if (['owner','founder','c_suite'].some(k => s.includes(k))) return 'Executive';
  if (['vp','director','head'].some(k => s.includes(k)))      return 'Director';
  if (s.includes('manager'))                                   return 'Manager';
  return 'Other';
}

// ── Save Apollo contacts to key_contacts table ────────────────────────────────
// limit: optional max contacts to save for this lead (honours job-level maxContacts budget)
async function saveApolloContactsForLead(leadId, companyName, apolloOrgId, limit = Infinity) {
  const contacts = await getContactsFromApolloOrg(apolloOrgId, leadId, companyName);
  if (!contacts.length) return 0;

  // Apply per-call budget limit
  const toSave = limit < contacts.length ? contacts.slice(0, limit) : contacts;

  // Remove any existing apollo contacts for this lead from this org
  await supabase
    .from('key_contacts')
    .delete()
    .eq('lead_id', leadId)
    .eq('apollo_company_id', apolloOrgId);

  const { error } = await supabase.from('key_contacts').insert(toSave);
  if (error) {
    console.error(`[apolloCompany] saveApolloContacts insert error: ${error.message}`);
    return 0;
  }
  console.log(`[apolloCompany] Saved ${toSave.length} Apollo contacts for lead ${leadId}${limit !== Infinity ? ` (budget limit: ${limit})` : ''}`);
  return toSave.length;
}

module.exports = {
  enrichCompanyWithApollo,
  getContactsFromApolloOrg,
  saveApolloContactsForLead,
  buildDbdUrl,
};
