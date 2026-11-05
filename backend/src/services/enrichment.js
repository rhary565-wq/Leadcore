// Key Contact Enrichment Service — v3
// Fallback chain (runs all, merges results):
//   1. LinkedIn company page  → harvestapi/linkedin-company-employees
//   2. LinkedIn profile search → harvestapi/linkedin-profile-search  (small companies)
//   3. Website scraping        → extract emails/names from every page
//   4. Google search           → "[company] CEO director contact Thailand"
// No extra API keys needed beyond Apify (already set up).

const axios    = require('axios');
const { supabase } = require('../db/supabase');

const APIFY_BASE = 'https://api.apify.com/v2';
const token      = () => process.env.APIFY_API_TOKEN;

// ── Social domains — skip website crawl ──────────────────────────────────────
const SOCIAL_DOMAINS = [
  'facebook.com','fb.com','instagram.com','twitter.com','x.com',
  'tiktok.com','youtube.com','line.me','lin.ee','linktr.ee',
  't.co','bit.ly','goo.gl','maps.google.com',
];
function isSocialUrl(url) {
  try {
    const h = new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
    return SOCIAL_DOMAINS.some(d => h.includes(d));
  } catch { return false; }
}

// ── Decision-maker tiers ─────────────────────────────────────────────────────
const TIER_1 = ['owner','founder','co-founder','ceo','chief executive',
  'managing director','country manager','general manager','president','md'];
const TIER_2 = ['commercial director','sales director','marketing director',
  'business development director','operations director','head of sales',
  'head of marketing','head of business development','head of operations',
  'chief commercial','chief marketing','chief sales','vp sales','vp marketing'];
const TIER_3 = ['sales manager','marketing manager','procurement manager',
  'business development manager','operations manager','digital manager',
  'it manager','store manager','branch manager','regional manager',
  'account manager','clinic manager','medical director','practice manager',
  'logistics manager','supply chain manager','import export manager',
  'warehouse manager','freight manager'];

function getTier(title) {
  const t = (title||'').toLowerCase();
  if (TIER_1.some(k => t.includes(k))) return 1;
  if (TIER_2.some(k => t.includes(k))) return 2;
  if (TIER_3.some(k => t.includes(k))) return 3;
  return 0;
}
function getSeniority(title) {
  const t = getTier(title);
  return t===1?'Executive':t===2?'Director':t===3?'Manager':'Other';
}
function getDepartment(title) {
  const t=(title||'').toLowerCase();
  if (t.includes('sales')||t.includes('commercial')) return 'Sales';
  if (t.includes('marketing'))                        return 'Marketing';
  if (t.includes('logistics')||t.includes('supply chain')||t.includes('freight')||t.includes('warehouse')) return 'Logistics';
  if (t.includes('operations')||t.includes('ops'))   return 'Operations';
  if (t.includes('business development')||t.includes(' bd ')) return 'Business Development';
  if (t.includes('procurement')||t.includes('purchasing')||t.includes('import')||t.includes('export')) return 'Procurement';
  if (t.includes('finance')||t.includes('cfo'))      return 'Finance';
  if (t.includes('it ')||t.includes('digital')||t.includes('tech')) return 'IT';
  return 'General Management';
}

// ── Clean company name for search ────────────────────────────────────────────
function cleanCompanyName(raw) {
  return (raw||'')
    .replace(/[-–:]\s*(romklao|sukhumvit|silom|siam|rama|lat krabang|suvarnabhumi|asok|bangna|onnut|phra khanong|chaengwattana|ngamwongwan|pinklao|ramintra|minburi|chatuchak).*/gi,'')
    .replace(/\(?formerly[^)]*\)?/gi,'')
    .replace(/\b(co\.?,?\s*ltd\.?|public\s+co\.?|plc|inc\.?|llc|corp\.?|limited|company|group|holding|holdings|international|thailand|thai|siam)\b/gi,'')
    .replace(/\b(head\s*quarters?|hq|branch|office|warehouse|division|depot|centre|center|hub|terminal)\b/gi,'')
    .replace(/\([^)]*\)/g,'').replace(/\[[^\]]*\]/g,'')
    .replace(/[&+.,]/g,' ').replace(/\s+/g,' ').trim();
}

// ── Confidence scoring ────────────────────────────────────────────────────────
function calculateScore(contact, lead) {
  let score = 0; const reasons = [];
  const cn = (contact.company||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const ln = (lead.company_name||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  if (cn && ln) {
    if (cn.includes(ln.slice(0,6))||ln.includes(cn.slice(0,6))) { score+=40; reasons.push('+40 company match'); }
    else { score-=20; reasons.push('-20 company mismatch'); }
  } else { score+=20; reasons.push('+20 unverified'); }
  const tier = getTier(contact.job_title);
  if (tier===1)      { score+=30; reasons.push('+30 Tier-1'); }
  else if (tier===2) { score+=20; reasons.push('+20 Tier-2'); }
  else if (tier===3) { score+=10; reasons.push('+10 Tier-3'); }
  else               { score-=15; reasons.push('-15 unknown role'); }
  if (contact.source_type==='linkedin')        { score+=15; reasons.push('+15 LinkedIn'); }
  else if (contact.source_type==='team_page')  { score+=12; reasons.push('+12 team page'); }
  else if (contact.source_type==='about_page') { score+=10; reasons.push('+10 about page'); }
  else if (contact.source_type==='google')     { score+=8;  reasons.push('+8 Google'); }
  else if (contact.source_type==='website')    { score+=5;  reasons.push('+5 website'); }
  if (contact.linkedin_url) { score+=10; reasons.push('+10 has LinkedIn URL'); }
  if (contact.public_email) { score+=10; reasons.push('+10 has email'); }
  if (contact.public_phone) { score+=5;  reasons.push('+5 has phone'); }
  return { score: Math.max(0,Math.min(100,score)), reason: reasons.join(', ') };
}
function confidenceLevel(s) { return s>=70?'High':s>=45?'Medium':'Low'; }

// ── Apify runner ─────────────────────────────────────────────────────────────
async function runApify(actorId, input, timeoutSecs=240) {
  const t = token();
  if (!t) throw new Error('APIFY_API_TOKEN not set');
  // Apify REST API requires ~ not / as the separator: "owner~actorName"
  const safeId = actorId.replace('/', '~');
  const start = await axios.post(
    `${APIFY_BASE}/acts/${safeId}/runs?token=${t}`, input,
    { headers: { 'Content-Type':'application/json' } }
  );
  const runId = start.data.data.id;
  console.log(`[enrich] Actor ${safeId} started → runId=${runId}`);
  const maxPolls = Math.ceil(timeoutSecs/8);
  for (let i=0; i<maxPolls; i++) {
    await new Promise(r=>setTimeout(r,8000));
    const s = await axios.get(`${APIFY_BASE}/actor-runs/${runId}?token=${t}`);
    const status = s.data.data.status;
    console.log(`[enrich] Run ${runId}: ${status} (${i+1}/${maxPolls})`);
    if (status==='SUCCEEDED') break;
    if (['FAILED','ABORTED','TIMED-OUT'].includes(status)) throw new Error(`Run ${runId}: ${status}`);
  }
  const res = await axios.get(`${APIFY_BASE}/actor-runs/${runId}/dataset/items?token=${t}&limit=50`);
  const items = res.data||[];
  console.log(`[enrich] Run ${runId} → ${items.length} item(s)`);
  return items;
}

// ── Parse LinkedIn profile objects ───────────────────────────────────────────
function parseLinkedInProfiles(results, sourceUrl, lead) {
  const contacts = [];
  for (const p of results) {
    const name = p.fullName||p.name||`${p.firstName||''} ${p.lastName||''}`.trim();
    const title = p.headline||p.jobTitle||p.position||p.title||p.currentPosition||'';
    if (!name) continue;
    contacts.push({
      person_name:  name,
      job_title:    title,
      linkedin_url: p.linkedinUrl||p.profileUrl||p.url||'',
      source_url:   p.linkedinUrl||p.profileUrl||sourceUrl||'',
      source_type:  'linkedin',
      public_email: p.email||'',
      public_phone: p.phone||'',
      company:      p.currentCompany||p.companyName||lead.company_name,
      country:      p.country||p.location||lead.country||'',
    });
  }
  return contacts;
}

// ── SOURCE 1: LinkedIn company page ──────────────────────────────────────────
async function linkedInCompanySource(lead) {
  const cleaned = cleanCompanyName(lead.company_name);
  const variants = [
    cleaned,
    cleaned.split(' ').slice(0,2).join(' '),
    cleaned.split(' ')[0],
  ].filter((v,i,a)=>v.length>=3&&a.indexOf(v)===i);

  let companyUrl = null;
  for (const query of variants) {
    console.log(`[enrich:linkedin] Company search: "${query}"`);
    try {
      const results = await runApify('harvestapi/linkedin-company-search',
        { queries:[query], maxItems:5 }, 120);
      if (!results.length) continue;
      results.forEach((r,i)=>
        console.log(`  [${i}] "${r.name||r.companyName}" → ${r.linkedinUrl||r.url||r.profileUrl}`)
      );
      const qLow = query.toLowerCase();
      const best = results.find(r=>{
        const rn=(r.name||r.companyName||'').toLowerCase();
        return rn.includes(qLow)||qLow.includes(rn.slice(0,5));
      })||results[0];
      companyUrl = best.linkedinUrl||best.url||best.profileUrl||null;
      if (companyUrl) { console.log(`[enrich:linkedin] ✓ Company page: ${companyUrl}`); break; }
    } catch(e) { console.warn(`[enrich:linkedin] Search failed: ${e.message}`); }
  }
  if (!companyUrl) return [];

  try {
    const employees = await runApify('harvestapi/linkedin-company-employees',
      { companies:[companyUrl], maxItems:25 }, 300);
    const contacts = parseLinkedInProfiles(employees, companyUrl, lead);
    console.log(`[enrich:linkedin] Company page → ${contacts.length} profile(s)`);
    return contacts;
  } catch(e) {
    console.warn(`[enrich:linkedin] Employees failed: ${e.message}`);
    return [];
  }
}

// ── SOURCE 2: LinkedIn direct profile search ──────────────────────────────────
async function linkedInProfileSearch(lead) {
  const cleaned = cleanCompanyName(lead.company_name);
  const titleGroups = [
    'CEO OR "Managing Director" OR Owner OR Founder',
    '"Sales Director" OR "Head of Sales" OR "Country Manager" OR "General Manager"',
    '"Sales Manager" OR "Marketing Manager" OR "Logistics Manager" OR "Operations Manager"',
  ];
  const all = [];
  for (const titles of titleGroups) {
    const query = `"${cleaned}" ${titles} Thailand`;
    console.log(`[enrich:profile-search] Query: "${query}"`);
    try {
      const results = await runApify('harvestapi/linkedin-profile-search',
        { searchTerms:[query], maxItems:5 }, 120);
      all.push(...parseLinkedInProfiles(results, null, lead));
      if (all.length>=8) break;
    } catch(e) { console.warn(`[enrich:profile-search] Failed: ${e.message}`); }
  }
  console.log(`[enrich:profile-search] → ${all.length} profile(s)`);
  return all;
}

// ── SOURCE 3: Company website — extract emails + names ────────────────────────
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const NAME_NEAR_TITLE_RE = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s*[\n\r,|–-]+\s*(.{5,60})/g;

function extractContactsFromText(text, pageUrl, lead) {
  const contacts = [];
  const srcType = pageUrl.includes('/team')||pageUrl.includes('/staff')||pageUrl.includes('/people')||pageUrl.includes('/management')||pageUrl.includes('/leadership') ? 'team_page'
    : pageUrl.includes('/about') ? 'about_page'
    : pageUrl.includes('/contact') ? 'about_page'
    : 'website';

  // Extract emails
  const emails = (text||'').match(EMAIL_RE)||[];
  const businessEmails = emails.filter(e=>
    !e.includes('example')&&!e.includes('noreply')&&!e.includes('info@')&&
    !e.includes('support@')&&!e.includes('admin@')&&!e.includes('webmaster@')
  );
  if (businessEmails.length>0) {
    // Try to extract person name from email local-part ONLY when it looks like first.last format.
    // e.g. john.doe@company.com → John Doe ✓
    // e.g. info@company.com → skipped (generic)
    // e.g. thexaesthetic88@gmail.com → skipped (no dot, looks like username)
    businessEmails.forEach(email=>{
      const local = email.split('@')[0];
      // Only parse if the local part has a separator (dot, underscore, dash) suggesting first.last
      if (!local.includes('.') && !local.includes('_')) return; // skip username-style emails
      const nameParts = local.replace(/[._-]/g,' ').split(' ')
        .filter(p=>p.length>1&&!/^\d+$/.test(p)&&!/^[a-z]{1,2}$/.test(p));
      if (nameParts.length < 2) return; // need at least first + last
      const guessedName = nameParts.map(p=>p[0].toUpperCase()+p.slice(1)).join(' ');
      contacts.push({
        person_name:  guessedName,
        job_title:    '',
        linkedin_url: '',
        source_url:   pageUrl,
        source_type:  srcType,
        public_email: email,
        public_phone: '',
        company:      lead.company_name,
        country:      lead.country||'',
      });
    });
  }

  // Extract Name + Title patterns from text
  const allTitles = [...TIER_1,...TIER_2,...TIER_3];
  const lines = (text||'').split('\n').map(l=>l.trim()).filter(Boolean);
  for (let i=0; i<lines.length; i++) {
    const lc = lines[i].toLowerCase();
    if (!allTitles.some(t=>lc.includes(t))) continue;
    // Check surrounding lines for a person name
    const candidates = [lines[i-1],lines[i+1],lines[i-2],lines[i+2]].filter(Boolean);
    const name = candidates.find(c=>/^[A-Z][a-z]+(\s+[A-Z][a-z]+){1,3}$/.test(c.trim()));
    if (!name) continue;
    contacts.push({
      person_name:  name.trim(),
      job_title:    lines[i].trim(),
      linkedin_url: '',
      source_url:   pageUrl,
      source_type:  srcType,
      public_email: businessEmails[0]||'',
      public_phone: '',
      company:      lead.company_name,
      country:      lead.country||'',
    });
  }
  return contacts;
}

async function websiteSource(lead) {
  if (!lead.website||isSocialUrl(lead.website)) {
    console.log(`[enrich:website] Skipping social/empty URL: ${lead.website}`);
    return [];
  }
  const base = (lead.website.startsWith('http')?lead.website:`https://${lead.website}`).replace(/\/$/,'');
  console.log(`[enrich:website] Crawling: ${base}`);
  try {
    const pages = await runApify('apify/website-content-crawler', {
      startUrls: [{ url: base }],
      maxCrawlDepth:  2,
      maxCrawlPages:  20,
      crawlerType:    'cheerio',
      // Target contact-rich pages
      includeUrlGlobs: [
        `${base}/about*`,`${base}/about-us*`,`${base}/our-story*`,
        `${base}/team*`,`${base}/our-team*`,`${base}/staff*`,`${base}/people*`,
        `${base}/management*`,`${base}/leadership*`,`${base}/board*`,
        `${base}/contact*`,`${base}/contact-us*`,`${base}/reach-us*`,
        `${base}/`,  // homepage always
      ],
      excludeUrlGlobs: ['*#*','*.pdf','*.jpg','*.png','*.css','*.js'],
    }, 180);

    const contacts = [];
    for (const page of pages) {
      contacts.push(...extractContactsFromText(page.text||'', page.url||base, lead));
    }
    console.log(`[enrich:website] ${contacts.length} contact(s) from ${pages.length} page(s)`);
    return contacts;
  } catch(e) {
    console.warn(`[enrich:website] Failed: ${e.message}`);
    return [];
  }
}

// ── SOURCE 4: Google search ───────────────────────────────────────────────────
async function googleSearchSource(lead) {
  const cleaned = cleanCompanyName(lead.company_name);
  const queries = [
    `"${cleaned}" CEO OR director OR manager Thailand contact`,
    `"${cleaned}" site:linkedin.com/in`,
  ];
  console.log(`[enrich:google] Searching for: ${cleaned}`);
  const contacts = [];
  try {
    const results = await runApify('apify/google-search-scraper', {
      queries:    queries.join('\n'),
      maxPagesPerQuery: 1,
      resultsPerPage:   5,
      languageCode: 'en',
      countryCode:  'TH',
    }, 120);

    for (const r of results) {
      // LinkedIn profile URLs in Google results
      const linkedInHits = (r.organicResults||[]).filter(h=>(h.url||'').includes('linkedin.com/in/'));
      for (const hit of linkedInHits) {
        // Title snippet often has: "Name - Job Title at Company"
        const snippet = hit.title||'';
        const match = snippet.match(/^([^–\-|]+)\s*[-–|]\s*([^–\-|]+)/);
        if (match) {
          contacts.push({
            person_name:  match[1].trim(),
            job_title:    match[2].replace(/ at .*/i,'').trim(),
            linkedin_url: hit.url,
            source_url:   hit.url,
            source_type:  'google',
            public_email: '',
            public_phone: '',
            company:      lead.company_name,
            country:      lead.country||'',
          });
        }
      }
    }
    console.log(`[enrich:google] → ${contacts.length} contact(s)`);
  } catch(e) {
    console.warn(`[enrich:google] Failed: ${e.message}`);
  }
  return contacts;
}

// ── Main enrichLead ───────────────────────────────────────────────────────────
async function enrichLead(lead) {
  console.log(`\n[enrich] ════ START: ${lead.company_name} (id=${lead.id})`);
  const allContacts = [];

  // Run all sources — later sources fill gaps left by earlier ones
  const [liCompany, website, google] = await Promise.allSettled([
    linkedInCompanySource(lead),
    websiteSource(lead),
    googleSearchSource(lead),
  ]);

  if (liCompany.status==='fulfilled') allContacts.push(...liCompany.value);
  if (website.status==='fulfilled')   allContacts.push(...website.value);
  if (google.status==='fulfilled')    allContacts.push(...google.value);

  // If LinkedIn company page gave <3 results, also try direct profile search
  const liCount = liCompany.status==='fulfilled'?liCompany.value.length:0;
  if (liCount<3) {
    try {
      const profileHits = await linkedInProfileSearch(lead);
      allContacts.push(...profileHits);
    } catch(e) { console.warn(`[enrich] Profile search error: ${e.message}`); }
  }

  console.log(`[enrich] Raw total: ${allContacts.length} contact(s) from all sources`);

  // De-duplicate by normalised name OR email
  const seenKeys = new Set();
  const unique = allContacts.filter(c=>{
    const nameKey  = (c.person_name||'').toLowerCase().replace(/\s+/g,'');
    const emailKey = (c.public_email||'').toLowerCase();
    const key = emailKey||nameKey;
    if (!key||key==='contact'||seenKeys.has(key)) return false;
    seenKeys.add(key);
    if (emailKey) seenKeys.add(nameKey); // prevent same person via name too
    return true;
  });

  // Score, enrich metadata, filter, sort
  const scored = unique.map(c=>{
    const {score,reason} = calculateScore(c,lead);
    const parts = (c.person_name||'Contact').trim().split(/\s+/);
    return {
      lead_id:           lead.id,
      company_name:      lead.company_name||'',
      person_name:       c.person_name,
      first_name:        parts[0]||'',
      last_name:         parts.slice(1).join(' ')||'',
      job_title:         c.job_title||'',
      department:        getDepartment(c.job_title),
      seniority:         getSeniority(c.job_title),
      linkedin_url:      c.linkedin_url||'',
      source_url:        c.source_url||'',
      source_type:       c.source_type||'unknown',
      public_email:      c.public_email||'',
      public_phone:      c.public_phone||'',
      confidence_score:  score,
      confidence_reason: `${reason} → ${confidenceLevel(score)}`,
      status:            'pending',
    };
  })
  .filter(c=>c.confidence_score>=15)   // very low bar — show anything useful
  .sort((a,b)=>b.confidence_score-a.confidence_score)
  .slice(0,20);

  console.log(`[enrich] After scoring: ${scored.length} qualified contact(s)`);

  if (!scored.length) {
    console.log(`[enrich] ════ END: no contacts found for ${lead.company_name}`);
    return 0;
  }

  await supabase.from('key_contacts').delete().eq('lead_id',lead.id);
  const {error} = await supabase.from('key_contacts').insert(scored);
  if (error) throw error;

  console.log(`[enrich] ════ END: saved ${scored.length} contact(s) for ${lead.company_name}`);
  return scored.length;
}

module.exports = { enrichLead, confidenceLevel };
