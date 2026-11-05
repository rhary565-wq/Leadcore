// HubSpot CRM Service
// Standard HubSpot CRM v3 API — only standard built-in properties to avoid 400 errors.
//
// Functions:
//   createContact(lead)                           — push Apify lead as HubSpot Contact
//   findExisting(lead)                            — dedup check by phone
//   createEnrichedContact(c)                      — push key contact (person with name/title/email)
//   createOrUpdateHubSpotCompany(lead, apolloData)— push Company object
//   findExistingCompany(name, domain)             — dedup check by domain then name
//   associateContactWithCompany(contactId, companyId) — CRM association

const axios = require('axios');

const BASE    = 'https://api.hubapi.com/crm/v3';
const headers = () => ({
  Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
  'Content-Type': 'application/json'
});

// ── Internal domain cleaner ───────────────────────────────────────────────────
function cleanDomain(url) {
  if (!url) return null;
  try {
    const u    = url.startsWith('http') ? url : `https://${url}`;
    const host = new URL(u).hostname.replace(/^www\./, '');
    return host || null;
  } catch { return null; }
}

// ── Push a single lead as a HubSpot Contact (from Apify/Google Maps scrape) ──
async function createContact(lead) {
  const nameParts = (lead.company_name || 'Unknown').trim().split(/\s+/);
  const firstName = nameParts.slice(0, -1).join(' ') || lead.company_name || 'Unknown';
  const lastName  = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '-';

  const descParts = [
    lead.rating          ? `Google Rating: ${lead.rating}`    : '',
    lead.reviews_count   ? `Reviews: ${lead.reviews_count}`   : '',
    lead.google_maps_url ? `Maps: ${lead.google_maps_url}`    : '',
    lead.dbd_url         ? `DBD: ${lead.dbd_url}`            : '',
    'Source: Cipher LeadGen (Apify)',
  ].filter(Boolean).join(' | ');

  const properties = {
    firstname:      firstName,
    lastname:       lastName,
    company:        lead.company_name    || '',
    website:        lead.website         || '',
    phone:          lead.phone_formatted || lead.phone || '',
    address:        lead.address         || '',
    industry:       lead.industry        || '',
    city:           lead.city            || '',
    hs_lead_status: lead.lead_status === 'Hot' ? 'NEW' : 'OPEN',
    description:    descParts,
  };

  Object.keys(properties).forEach(k => {
    if (properties[k] === '' || properties[k] == null) delete properties[k];
  });

  const res = await axios.post(
    `${BASE}/objects/contacts`,
    { properties },
    { headers: headers() }
  );
  return res.data.id;
}

// ── Check if a contact already exists by phone ────────────────────────────────
async function findExisting(lead) {
  try {
    const phone = lead.phone_formatted || lead.phone;
    if (!phone) return null;
    const res = await axios.post(
      `${BASE}/objects/contacts/search`,
      { filterGroups: [{ filters: [{ propertyName: 'phone', operator: 'EQ', value: phone }] }], limit: 1 },
      { headers: headers() }
    );
    return res.data.total > 0 ? res.data.results[0].id : null;
  } catch { return null; }
}

// ── Push an enriched key contact (real person with name / title / email) ──────
async function createEnrichedContact(c) {
  const descParts = [
    c.job_title           ? `Title: ${c.job_title}`               : '',
    c.company_description ? `About: ${c.company_description}`      : '',
    c.person_headline     ? `Headline: ${c.person_headline}`       : '',
    c.rating              ? `Google Rating: ${c.rating}`           : '',
    c.reviews_count       ? `Reviews: ${c.reviews_count}`          : '',
    c.google_maps_url     ? `Maps: ${c.google_maps_url}`           : '',
    c.dbd_url             ? `DBD: ${c.dbd_url}`                   : '',
    c.contact_location    ? `Location: ${c.contact_location}`      : '',
    `Source: Cipher LeadGen (${c.source_type || 'Apollo'})`,
  ].filter(Boolean).join(' | ');

  const properties = {
    firstname:       c.first_name   || c.company_name || 'Unknown',
    lastname:        c.last_name    || '-',
    jobtitle:        c.job_title    || '',
    email:           c.public_email || '',
    phone:           c.public_phone || '',
    hs_linkedin_url: c.linkedin_url || '',
    city:            c.person_city  || c.contact_location || c.company_city || '',
    company:         c.company_name || '',
    website:         c.website      || '',
    industry:        c.industry     || '',
    hs_lead_status:  'OPEN',
    description:     descParts,
  };

  Object.keys(properties).forEach(k => {
    if (properties[k] === '' || properties[k] == null) delete properties[k];
  });

  // Dedup by email
  if (properties.email) {
    try {
      const searchRes = await axios.post(
        `${BASE}/objects/contacts/search`,
        { filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: properties.email }] }], limit: 1 },
        { headers: headers() }
      );
      if (searchRes.data.total > 0) return searchRes.data.results[0].id;
    } catch { /* ignore dedup error, proceed to create */ }
  }

  const res = await axios.post(
    `${BASE}/objects/contacts`,
    { properties },
    { headers: headers() }
  );
  return res.data.id;
}

// ── Find existing HubSpot Company by domain or name ───────────────────────────
async function findExistingCompany(companyName, website) {
  const domain = cleanDomain(website);

  if (domain) {
    try {
      const res = await axios.post(
        `${BASE}/objects/companies/search`,
        {
          filterGroups: [{ filters: [{ propertyName: 'domain', operator: 'EQ', value: domain }] }],
          limit: 1,
          properties: ['name', 'domain'],
        },
        { headers: headers() }
      );
      if (res.data.total > 0) return res.data.results[0].id;
    } catch { /* ignore */ }
  }

  if (companyName) {
    try {
      const res = await axios.post(
        `${BASE}/objects/companies/search`,
        {
          filterGroups: [{ filters: [{ propertyName: 'name', operator: 'EQ', value: companyName }] }],
          limit: 1,
          properties: ['name', 'domain'],
        },
        { headers: headers() }
      );
      if (res.data.total > 0) return res.data.results[0].id;
    } catch { /* ignore */ }
  }

  return null;
}

// ── Create or update a HubSpot Company record ─────────────────────────────────
async function createOrUpdateHubSpotCompany(lead, apolloData) {
  const domain = cleanDomain(lead.website);

  const descParts = [
    lead.rating              ? `Google Rating: ${lead.rating}`            : '',
    lead.reviews_count       ? `Google Reviews: ${lead.reviews_count}`    : '',
    apolloData?.revenueRange ? `Revenue Range: ${apolloData.revenueRange}`: '',
    apolloData?.dbdUrl       ? `DBD: ${apolloData.dbdUrl}`                : '',
    lead.google_maps_url     ? `Maps: ${lead.google_maps_url}`            : '',
    'Source: Cipher LeadGen (Apollo/Apify)',
  ].filter(Boolean).join(' | ');

  const properties = {
    name:        lead.company_name    || '',
    domain:      domain               || '',
    phone:       lead.phone_formatted || lead.phone || '',
    city:        lead.city            || '',
    address:     lead.address         || '',
    industry:    lead.industry        || '',
    website:     lead.website         || '',
    description: descParts,
  };

  if (apolloData?.headcount) properties.numberofemployees = apolloData.headcount;
  if (apolloData?.revenue)   properties.annualrevenue     = apolloData.revenue;

  Object.keys(properties).forEach(k => {
    if (properties[k] === '' || properties[k] == null) delete properties[k];
  });

  const existingId = await findExistingCompany(lead.company_name, lead.website);

  if (existingId) {
    await axios.patch(
      `${BASE}/objects/companies/${existingId}`,
      { properties },
      { headers: headers() }
    );
    console.log(`[hubspot] Updated existing company ${existingId} for "${lead.company_name}"`);
    return existingId;
  }

  const res = await axios.post(
    `${BASE}/objects/companies`,
    { properties },
    { headers: headers() }
  );
  const newId = res.data.id;
  console.log(`[hubspot] Created new company ${newId} for "${lead.company_name}"`);
  return newId;
}

// ── Associate a Contact with a Company in HubSpot ────────────────────────────
async function associateContactWithCompany(contactId, companyId) {
  await axios.put(
    `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}/associations/companies/${companyId}/contact_to_company`,
    {},
    { headers: headers() }
  );
  console.log(`[hubspot] Associated contact ${contactId} ↔ company ${companyId}`);
}

module.exports = {
  createContact,
  findExisting,
  createEnrichedContact,
  createOrUpdateHubSpotCompany,
  findExistingCompany,
  associateContactWithCompany,
};
