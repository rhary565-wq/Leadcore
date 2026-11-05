// Apollo Enrichment Service
// Step 1: POST /api/v1/mixed_people/api_search  — find people (no email/phone)
// Step 2: POST /api/v1/people/match per person  — reveal email + phone (uses credits)

var axios = require('axios');

var APOLLO_BASE = 'https://api.apollo.io/api/v1';

// Map UI industry labels → q_keywords string for Apollo mixed_people/api_search
// NOTE: organization_industries is NOT a valid param for this endpoint.
// q_keywords is the correct way to filter by industry — Apollo searches across
// company name, industry, description, and job title fields.
var APOLLO_INDUSTRY_MAP = {
  // ── Dropdown options → q_keywords string ─────────────────────────────────
  // Apollo mixed_people/api_search uses q_keywords for industry filtering
  // (organization_industries is NOT a valid param for this endpoint)
  'Health & Medical':        'clinic hospital medical healthcare doctor physician dentist nursing',
  'Restaurant & Food':       'restaurant food beverage cafe dining chef catering',
  'Retail & Shopping':       'retail shop store ecommerce merchandise consumer goods',
  'Beauty & Spa':            'beauty spa salon cosmetics skincare wellness aesthetic',
  'Hotel & Travel':          'hotel resort hospitality tourism travel accommodation',
  'Education':               'school university college education academy training institute',
  'Finance & Banking':       'bank finance financial investment insurance accounting fintech',
  'Real Estate':             'real estate property developer land agent realty',
  'Construction':            'construction building contractor civil engineering architecture',
  'Manufacturing':           'manufacturing factory production industrial plant',
  'Logistics & Transport':   'logistics transport freight shipping warehouse supply chain',
  'Technology & IT':         'technology software IT developer tech startup digital',
  'Law & Legal':             'law legal attorney lawyer firm legal services',
  'Marketing & Advertising': 'marketing advertising agency PR media brand digital marketing',
  'Auto & Vehicles':         'automotive car vehicle dealer garage motor',
  'Gym & Fitness':           'gym fitness sport exercise training wellness recreation',
  'Entertainment':           'entertainment media production music film event performing arts',

  // ── English synonyms → same keywords ─────────────────────────────────────
  'Clinic':        'clinic hospital medical healthcare doctor physician',
  'Clinics':       'clinic hospital medical healthcare doctor physician',
  'Dental':        'dental dentist clinic oral health',
  'Dentist':       'dental dentist clinic oral health',
  'Hospital':      'hospital medical healthcare clinic doctor',
  'Pharmacy':      'pharmacy pharmaceutical drug medicine dispensary',
  'Wellness':      'wellness health spa clinic fitness',
  'Spa':           'spa wellness beauty massage relaxation',
  'Salon':         'salon beauty hair nail cosmetics',
  'Cafe':          'cafe coffee restaurant food beverage',
  'Coffee':        'coffee cafe restaurant beverage',
  'Hotel':         'hotel hospitality accommodation resort travel',
  'Resort':        'resort hotel hospitality travel tourism',
  'School':        'school education academy training institute',
  'University':    'university college higher education academic',
  'Law Firm':      'law legal attorney lawyer firm',
  'Accounting':    'accounting finance audit tax bookkeeping',
  'Insurance':     'insurance financial risk coverage policy',
  'Logistics':     'logistics freight shipping transport supply chain',
  'Transport':     'transport logistics freight shipping distribution',
  'Gym':           'gym fitness sport exercise training',
  'Fitness':       'fitness gym wellness sport exercise',
  'Software':      'software technology IT developer programming',
  'IT':            'IT technology software digital infrastructure',
  'Agency':        'agency marketing advertising PR media',
  'PR':            'PR public relations media communications',

  // ── Thai language → English keywords (Apollo searches in English) ─────────
  'คลินิก':          'clinic hospital medical healthcare',
  'โรงพยาบาล':       'hospital medical healthcare clinic doctor',
  'ทันตกรรม':        'dental dentist oral health clinic',
  'ทันตแพทย์':       'dental dentist oral health clinic',
  'เภสัชกรรม':       'pharmacy pharmaceutical drug medicine',
  'ร้านยา':          'pharmacy drug medicine health',
  'สุขภาพ':          'health medical healthcare wellness clinic',
  'ความงาม':         'beauty cosmetics spa salon aesthetic',
  'สปา':             'spa wellness beauty massage relaxation',
  'ร้านอาหาร':       'restaurant food dining beverage cafe',
  'อาหาร':           'food restaurant beverage dining catering',
  'คาเฟ่':           'cafe coffee restaurant food beverage',
  'กาแฟ':            'coffee cafe beverage restaurant',
  'โรงแรม':          'hotel hospitality accommodation resort travel',
  'รีสอร์ท':         'resort hotel travel tourism hospitality',
  'ท่องเที่ยว':      'travel tourism hospitality tour agency',
  'ค้าปลีก':         'retail shop store consumer goods merchandise',
  'ห้างสรรพสินค้า':  'retail mall shopping department store',
  'การศึกษา':        'education school university college training',
  'โรงเรียน':        'school education academy training institute',
  'มหาวิทยาลัย':     'university college higher education academic',
  'การเงิน':         'finance financial bank investment insurance',
  'ธนาคาร':          'bank banking finance financial services',
  'ประกันภัย':       'insurance financial risk coverage',
  'อสังหาริมทรัพย์': 'real estate property developer land agent',
  'ก่อสร้าง':        'construction building contractor civil engineering',
  'การผลิต':         'manufacturing factory production industrial',
  'โลจิสติกส์':      'logistics freight shipping supply chain transport',
  'ขนส่ง':           'transport logistics freight shipping distribution',
  'ไอที':            'IT technology software digital developer',
  'เทคโนโลยี':       'technology IT software digital innovation',
  'ซอฟต์แวร์':       'software technology IT developer programming',
  'กฎหมาย':          'law legal attorney lawyer legal services',
  'การตลาด':         'marketing advertising agency media brand',
  'โฆษณา':           'advertising marketing media agency PR',
  'ยานยนต์':         'automotive car vehicle dealer motor',
  'รถยนต์':          'car automotive vehicle dealer garage',
  'ฟิตเนส':          'fitness gym sport exercise wellness training',
  'ออกกำลังกาย':     'fitness gym sport exercise health',
  'บันเทิง':         'entertainment media production event music film',
  'สื่อ':            'media production entertainment publishing news',
};

function getApiKey() {
  var k = (process.env.APOLLO_API_KEY || '').trim();
  if (!k) throw new Error('APOLLO_API_KEY not set');
  return k;
}

// Step 1 — People Search (returns names/titles/companies, NO email/phone)
async function apolloRaw(payload) {
  var apiKey = getApiKey();
  console.log('[apollo] payload=' + JSON.stringify(payload));
  try {
    var res = await axios.post(APOLLO_BASE + '/mixed_people/api_search', payload, {
      headers: {
        'Content-Type':  'application/json',
        'accept':        'application/json',
        'Cache-Control': 'no-cache',
        'x-api-key':     apiKey,
      },
      timeout: 30000,
    });
    console.log('[apollo] Search OK — people=' + ((res.data && res.data.people && res.data.people.length) || 0));
    return res.data || {};
  } catch (err) {
    var status = err.response && err.response.status;
    var body   = err.response && JSON.stringify(err.response.data);
    console.error('[apollo] Search HTTP ' + status + ' body=' + body);
    throw err;
  }
}

// Step 2 — People Match (reveals email + phone, costs 1 credit per person)
async function apolloEnrichPerson(p) {
  var apiKey = getApiKey();
  try {
    var payload = {
      api_key:                apiKey,
      reveal_personal_emails: true,
      reveal_phone_number:    true,
      webhook_url:            (process.env.BACKEND_URL || 'https://leadgen-backend-769244413910.asia-southeast1.run.app') + '/api/apollo/phone-webhook',
    };
    if (p.apollo_id)    payload.id                = p.apollo_id;
    if (p.first_name)   payload.first_name        = p.first_name;
    if (p.last_name)    payload.last_name         = p.last_name;
    if (p.linkedin_url) payload.linkedin_url      = p.linkedin_url;
    if (p.company_name) payload.organization_name = p.company_name;

    var res = await axios.post(APOLLO_BASE + '/people/match', payload, {
      headers: {
        'Content-Type':  'application/json',
        'Cache-Control': 'no-cache',
        'x-api-key':     apiKey,
      },
      timeout: 15000,
    });
    var matched = res.data && res.data.person;
    if (matched) {
      // Email: primary field first, then personal_emails array
      var email = matched.email
        || (matched.personal_emails && matched.personal_emails[0])
        || '';
      if (email) p.public_email = email;

      // Phone: Apollo returns phone_numbers[] — NOT sanitized_phone on person root
      var phones = matched.phone_numbers || [];
      if (phones.length) {
        p.public_phone = phones[0].sanitized_number || phones[0].raw_number || '';
      }
    }
    // Log raw matched fields to help debug
    console.log('[apollo:match] ' + p.person_name
      + ' -> email=' + (p.public_email || 'none')
      + ' phone=' + (p.public_phone || 'none')
      + ' raw_email=' + (matched && matched.email || 'none')
      + ' phones=' + JSON.stringify((matched && matched.phone_numbers) || []));
  } catch (e) {
    var msg = (e.response && JSON.stringify(e.response.data)) || e.message;
    console.log('[apollo:match] ' + p.person_name + ' skipped: ' + msg);
  }
  return p;
}

async function apolloSearch(payload) {
  var data = await apolloRaw(payload);
  return data.people || [];
}

function formatPerson(p, domain) {
  var org = p.organization || {};

  var pastJobs = (p.employment_history || [])
    .filter(function(h) { return h.organization_name && h.organization_name !== org.name; })
    .slice(0, 3)
    .map(function(h) { return h.organization_name; })
    .join(', ');

  return {
    apollo_id:             p.id || '',
    person_name:           ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || p.name || '',
    first_name:            p.first_name  || '',
    last_name:             p.last_name   || '',
    job_title:             p.title       || p.headline || '',
    public_email:          p.email       || '',
    public_phone:          p.sanitized_phone || '',
    linkedin_url:          p.linkedin_url || '',
    source_url:            domain ? ('https://' + domain) : (org.website_url || ''),
    source_type:           'apollo',
    organization:          org,
    company_name:          org.name || (p.employment_history && p.employment_history[0] && p.employment_history[0].organization_name) || '',
    company_headcount:     org.estimated_num_employees || null,
    company_revenue:       org.revenue_range || '',
    company_description:   (org.short_description || org.seo_description || '').slice(0, 500),
    company_tech_stack:    (org.technology_names || []).slice(0, 10).join(', '),
    company_founded_year:  org.founded_year || null,
    company_city:          org.city || '',
    company_linkedin:      org.linkedin_url || '',
    person_city:           p.city || '',
    person_headline:       p.headline || '',
    person_past_companies: pastJobs,
  };
}

async function enrichBatch(people) {
  var results = [];
  var batchSize = 5;
  for (var i = 0; i < people.length; i += batchSize) {
    var batch = people.slice(i, i + batchSize);
    var enriched = await Promise.all(batch.map(function(p) { return apolloEnrichPerson(p); }));
    results = results.concat(enriched);
    if (i + batchSize < people.length) {
      await new Promise(function(r) { setTimeout(r, 500); });
    }
  }
  return results;
}

async function apolloEnrichLead(lead, jobConfig) {
  if (!jobConfig) jobConfig = {};
  var name     = (lead.company_name || '').trim();
  var city     = lead.city || jobConfig.location || '';
  var country  = jobConfig.country || 'Thailand';
  var location = [city, country].filter(Boolean).join(', ');

  var domain = '';
  try {
    var rawUrl  = (lead.website || '');
    var fullUrl = rawUrl.indexOf('http') === 0 ? rawUrl : ('https://' + rawUrl);
    var host    = new URL(fullUrl).hostname.replace(/^www\./, '');
    var SOCIAL  = ['facebook.com', 'fb.com', 'instagram.com', 'twitter.com', 'line.me'];
    if (!SOCIAL.some(function(s) { return host.includes(s); })) domain = host;
  } catch (e) {}

  if (!name) {
    console.log('[apollo] Lead ' + lead.id + ' has no company name, skipping');
    return [];
  }

  var payload = {
    page:                1,
    per_page:            10,
    person_seniorities:  ['owner', 'founder', 'c_suite', 'vp', 'director', 'manager'],
    q_organization_name: name,
  };
  if (location) payload.organization_locations      = [location];
  if (domain)   payload.q_organization_domains_list = [domain];

  var industryFilter = jobConfig.industryFilter || '';
  if (industryFilter && industryFilter !== 'Any Industry') {
    var kw = APOLLO_INDUSTRY_MAP[industryFilter] || industryFilter;
    if (kw) payload.q_keywords = kw;
  }

  var people = [];
  try {
    people = await apolloSearch(payload);
    if (people.length === 0 && domain) {
      delete payload.q_organization_domains_list;
      people = await apolloSearch(payload);
    }
    console.log('[apollo] "' + name + '" -> ' + people.length + ' result(s)');
  } catch (err) {
    var msg = (err.response && err.response.data && err.response.data.message) || err.message;
    throw new Error('Apollo API: ' + msg);
  }

  var formatted = people.map(function(p) { return formatPerson(p, domain); }).filter(function(c) { return c.person_name; });
  var enriched  = await enrichBatch(formatted);
  return enriched;
}

async function apolloDirectSearch(opts) {
  var location     = opts.location     || '';
  var country      = opts.country      || '';
  var industry     = opts.industry     || '';
  var seniority    = opts.seniority    || null;
  var department   = opts.department   || null;
  var companySizes = opts.companySizes || null;
  var perPage      = opts.perPage      || 25;
  var page         = opts.page         || 1;

  var fullLocation  = [location, country].filter(Boolean).join(', ');
  var seniorityList = (seniority && seniority.length) ? seniority : null;

  // Industry → q_keywords lookup (organization_industries is NOT valid for this endpoint)
  var industryKey      = industry && industry !== 'Any Industry' ? industry.trim() : '';
  var industryKeywords = null;
  if (industryKey) {
    industryKeywords = APOLLO_INDUSTRY_MAP[industryKey] || null;
    if (!industryKeywords) {
      var lowerKey = industryKey.toLowerCase();
      var foundKey = Object.keys(APOLLO_INDUSTRY_MAP).find(function(k) { return k.toLowerCase() === lowerKey; });
      if (foundKey) industryKeywords = APOLLO_INDUSTRY_MAP[foundKey];
    }
    if (!industryKeywords) industryKeywords = industryKey; // raw fallback
  }

  console.log('[apollo:direct] location="' + fullLocation + '" industry="' + industry + '" (q_keywords→ ' + (industryKeywords || 'none') + ') sizes=[' + (companySizes || []).join(',') + '] seniority=[' + (seniorityList || []).join(',') + '] page=' + page);

  // Build payload — q_keywords is the correct industry filter for mixed_people/api_search
  var payload = { page: page, per_page: perPage };
  if (seniorityList && seniorityList.length)   payload.person_seniorities                = seniorityList;
  if (department && department.length)         payload.person_departments                = department;
  if (fullLocation)                            payload.organization_locations            = [fullLocation];
  if (companySizes && companySizes.length)     payload.organization_num_employees_ranges = companySizes;
  if (industryKeywords)                        payload.q_keywords                        = industryKeywords;

  try {
    var raw      = await apolloRaw(payload);
    var people   = (raw.people || []).map(function(p) { return formatPerson(p, ''); });
    var total    = (raw.pagination && raw.pagination.total_entries) || people.length;
    var enriched = await enrichBatch(people);
    return { people: enriched, total: total };
  } catch (err) {
    var msg = (err.response && err.response.data && err.response.data.message) || err.message;
    throw new Error('Apollo search: ' + msg);
  }
}

function getDepartment(title) {
  if (!title) return 'General Management';
  var t = title.toLowerCase();
  if (t.includes('sales') || t.includes('commercial'))   return 'Sales';
  if (t.includes('marketing'))                            return 'Marketing';
  if (t.includes('logistics') || t.includes('freight'))  return 'Logistics';
  if (t.includes('operations'))                           return 'Operations';
  if (t.includes('finance') || t.includes('cfo'))        return 'Finance';
  if (t.includes('medical') || t.includes('doctor') || t.includes('clinic')) return 'Medical';
  return 'General Management';
}

function getSeniority(title) {
  if (!title) return 'Other';
  var t = title.toLowerCase();
  if (t.includes('ceo') || t.includes('founder') || t.includes('owner') || t.includes('president') || t.includes('chief')) return 'Executive';
  if (t.includes('director') || t.includes('vp') || t.includes('vice president') || t.includes('head of')) return 'Director';
  if (t.includes('manager') || t.includes('lead') || t.includes('supervisor')) return 'Manager';
  return 'Other';
}

function scoreContact(p) {
  var score = 50;
  if (p.public_email)  score += 20;
  if (p.public_phone)  score += 10;
  if (p.linkedin_url)  score += 5;
  var sen = getSeniority(p.job_title || '');
  if (sen === 'Executive') score += 20;
  else if (sen === 'Director') score += 12;
  else if (sen === 'Manager')  score += 7;
  return Math.min(score, 100);
}
module.exports = { apolloDirectSearch, apolloEnrichLead, getDepartment, getSeniority, scoreContact };
