// Contact Finder Service — runs DURING scrape phase (before clean/scoring)
// 4 sources run in PARALLEL for every job:
//   1. LinkedIn  — harvestapi company search → employees (big companies)
//   2. Facebook  — page scraper for FB URLs + Google-found FB pages (Thai SMBs)
//   3. Website   — email/name extractor from /contact /about pages
//   4. Apollo DB — code_crafter~leads-finder: verified B2B emails + mobile via domain
// All Apify calls are BATCHED — one actor run per source, not per company.

const axios = require('axios');

const APIFY_BASE = 'https://api.apify.com/v2';
const token      = () => process.env.APIFY_API_TOKEN;

// ── Domain helpers ────────────────────────────────────────────────────────────
const FB_DOMAINS     = ['facebook.com', 'fb.com', 'm.facebook.com'];
const SOCIAL_SKIP    = ['instagram.com','twitter.com','x.com','tiktok.com','youtube.com','line.me','lin.ee','linktr.ee'];

function isFacebook(url = '')    { try { return FB_DOMAINS.some(d => new URL(url).hostname.includes(d)); } catch { return false; } }
function isSocialNonFB(url = '') { try { return SOCIAL_SKIP.some(d => new URL(url).hostname.includes(d)); } catch { return false; } }
function isRealWebsite(url = '') { return !!url && !isFacebook(url) && !isSocialNonFB(url); }

// ── Clean company name for LinkedIn search ────────────────────────────────────
function cleanName(raw = '') {
  return raw
    .replace(/[-–:]\s*(romklao|sukhumvit|silom|siam|rama|lat krabang|suvarnabhumi|asok|bangna|phra khanong|chaengwattana|pinklao|ramintra|minburi|chatuchak|headquarter).*/gi, '')
    .replace(/\(?formerly[^)]*\)?/gi, '')
    .replace(/\b(co\.?,?\s*ltd\.?|public\s+co\.?|plc|inc\.?|llc|corp\.?|limited|company|group|holding|holdings|thailand|thai|siam)\b/gi, '')
    .replace(/\b(hq|branch|office|warehouse|division|depot|centre|center|hub|terminal)\b/gi, '')
    .replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '')
    .replace(/[&+.,]/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── Apify runner — single actor, waits for result ────────────────────────────
async function runApify(actorId, input, timeoutSecs = 300) {
  const t = token();
  if (!t) throw new Error('APIFY_API_TOKEN not set');
  const safeId = actorId.replace('/', '~');
  console.log(`[contacts] ▶ ${safeId}`);
  const start = await axios.post(
    `${APIFY_BASE}/acts/${safeId}/runs?token=${t}`, input,
    { headers: { 'Content-Type': 'application/json' } }
  );
  const runId = start.data.data.id;
  const maxPolls = Math.ceil(timeoutSecs / 8);
  for (let i = 0; i < maxPolls; i++) {
    await new Promise(r => setTimeout(r, 8000));
    const s = await axios.get(`${APIFY_BASE}/actor-runs/${runId}?token=${t}`);
    const st = s.data.data.status;
    console.log(`[contacts] Run ${runId}: ${st} (${i + 1}/${maxPolls})`);
    if (st === 'SUCCEEDED') break;
    if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(st)) throw new Error(`Run ${runId}: ${st}`);
  }
  const res = await axios.get(`${APIFY_BASE}/actor-runs/${runId}/dataset/items?token=${t}&limit=500`);
  return res.data || [];
}

// ════════════════════════════════════════════════════════════════════════════
// SOURCE 1 — LinkedIn (HarvestAPI, no cookies)
//   Step A: batch company name search  → get LinkedIn company URLs
//   Step B: batch employee scrape      → get people + emails
// ════════════════════════════════════════════════════════════════════════════
async function linkedInSource(companies) {
  if (!companies.length) return {};
  console.log(`[contacts:linkedin] ── INPUT ──────────────────────────────────`);
  console.log(`[contacts:linkedin] Searching ${companies.length} companies on LinkedIn`);
  companies.forEach((c, i) => console.log(`  [${i+1}] "${c}" → cleaned: "${cleanName(c)}"`));

  // Step A — find LinkedIn company URLs (one run, all company names)
  const nameToUrl = {};
  try {
    const actorInput = {
      queries:  companies.map(c => cleanName(c)),
      maxItems: companies.length * 3,
    };
    console.log(`[contacts:linkedin] Actor input (harvestapi/linkedin-company-search):`, JSON.stringify(actorInput));
    const searchResults = await runApify('harvestapi/linkedin-company-search', actorInput, 180);

    console.log(`[contacts:linkedin] ── STEP A RESPONSE (${searchResults.length} results) ──`);
    searchResults.forEach((r, i) => {
      const rName = (r.name || r.companyName || '').toLowerCase();
      const liUrl = r.linkedinUrl || r.url || r.profileUrl || '';
      const match = companies.find(c => {
        const cn = cleanName(c).toLowerCase();
        return rName.includes(cn.slice(0, 6)) || cn.includes(rName.slice(0, 6));
      });
      console.log(`  [${i+1}] name="${r.name || r.companyName}" url="${liUrl}" → matched="${match || 'NO MATCH'}"`);
      if (liUrl && match && !nameToUrl[match]) nameToUrl[match] = liUrl;
    });

    if (!searchResults.length) console.warn(`[contacts:linkedin] Actor returned 0 results — actor may be failing silently (check Apify subscription)`);
    console.log(`[contacts:linkedin] LinkedIn URLs matched: ${Object.keys(nameToUrl).length}/${companies.length}`);
    Object.entries(nameToUrl).forEach(([c, url]) => console.log(`  ✓ "${c}" → ${url}`));
    companies.filter(c => !nameToUrl[c]).forEach(c => console.log(`  ✗ "${c}" → no LinkedIn URL found`));
  } catch (e) {
    console.warn(`[contacts:linkedin] FAILED — Company search actor threw: ${e.message}`);
    return {};
  }

  if (!Object.keys(nameToUrl).length) {
    console.warn(`[contacts:linkedin] No LinkedIn URLs found — skipping employee step`);
    return {};
  }

  // Step B — get employees for all found LinkedIn company pages
  const contactsByCompany = {};
  try {
    const actorInput = {
      companies: Object.values(nameToUrl),
      maxItems:  Object.keys(nameToUrl).length * 20,
    };
    console.log(`[contacts:linkedin] Actor input (harvestapi/linkedin-company-employees):`, JSON.stringify(actorInput));
    const employeeResults = await runApify('harvestapi/linkedin-company-employees', actorInput, 360);

    console.log(`[contacts:linkedin] ── STEP B RESPONSE (${employeeResults.length} employees) ──`);
    employeeResults.forEach((p, i) => {
      const name        = p.fullName || p.name || `${p.firstName||''} ${p.lastName||''}`.trim();
      const title       = p.headline || p.jobTitle || p.position || p.title || p.currentPosition || '';
      const companyHint = (p.companyName || p.currentCompany || '').toLowerCase();
      const owner = Object.keys(nameToUrl).find(c => {
        const liUrl = nameToUrl[c];
        return (liUrl && (p.companyLinkedinUrl || '').includes(liUrl.split('/').pop())) ||
               companyHint.includes(cleanName(c).toLowerCase().slice(0, 5)) ||
               cleanName(c).toLowerCase().includes(companyHint.slice(0, 5));
      }) || Object.keys(nameToUrl)[0];

      if (!name) {
        console.log(`  [${i+1}] SKIPPED — no name (raw: ${JSON.stringify({ firstName: p.firstName, lastName: p.lastName, fullName: p.fullName })})`);
        return;
      }
      console.log(`  [${i+1}] "${name}" | title="${title}" | email="${p.email||'—'}" | phone="${p.phone||'—'}" | li="${p.linkedinUrl||'—'}" → company="${owner}"`);

      if (!contactsByCompany[owner]) contactsByCompany[owner] = [];
      contactsByCompany[owner].push({
        person_name:  name,
        job_title:    title,
        public_email: p.email || '',
        public_phone: p.phone || '',
        linkedin_url: p.linkedinUrl || p.profileUrl || p.url || '',
        source_url:   p.linkedinUrl || p.profileUrl || nameToUrl[owner] || '',
        source_type:  'linkedin',
        company:      owner,
      });
    });
    if (!employeeResults.length) console.warn(`[contacts:linkedin] Employee actor returned 0 results — actor may need a paid HarvestAPI subscription`);
    console.log(`[contacts:linkedin] Saved contacts per company:`);
    Object.entries(contactsByCompany).forEach(([c, arr]) => console.log(`  ✓ "${c}": ${arr.length} contact(s)`));
  } catch (e) {
    console.warn(`[contacts:linkedin] FAILED — Employee actor threw: ${e.message}`);
  }

  return contactsByCompany;
}

// ════════════════════════════════════════════════════════════════════════════
// SOURCE 2 — Facebook pages
//   Uses FB URLs already in the data + searches for missing ones via Google
// ════════════════════════════════════════════════════════════════════════════
async function facebookSource(fbUrlMap, noFbCompanies) {
  const allFbUrls = { ...fbUrlMap };

  console.log(`[contacts:facebook] ── INPUT ──────────────────────────────────`);
  console.log(`[contacts:facebook] Direct FB URLs: ${Object.keys(fbUrlMap).length}`);
  Object.entries(fbUrlMap).forEach(([url, name]) => console.log(`  ✓ "${name}" → ${url}`));
  console.log(`[contacts:facebook] Need Google search: ${noFbCompanies.length}`);
  noFbCompanies.forEach(n => console.log(`  ? "${n}"`));

  // Find FB pages for companies that don't have one via Google search
  // Batch to 15 queries per run — the actor rejects large payloads with 400
  if (noFbCompanies.length) {
    const queries = noFbCompanies.map(n => `"${cleanName(n)}" site:facebook.com Thailand`);
    console.log(`[contacts:facebook] Google queries (${queries.length} total, batching 15/run):\n${queries.map(q => '  ' + q).join('\n')}`);

    const BATCH_SIZE = 15;
    for (let i = 0; i < queries.length; i += BATCH_SIZE) {
      const batchQueries   = queries.slice(i, i + BATCH_SIZE);
      const batchCompanies = noFbCompanies.slice(i, i + BATCH_SIZE);
      console.log(`[contacts:facebook] Google batch ${Math.floor(i/BATCH_SIZE)+1}: ${batchQueries.length} queries`);
      try {
        const googleResults = await runApify('apify/google-search-scraper', {
          queries:          batchQueries.join('\n'),
          maxPagesPerQuery: 1,
          languageCode:     'en',
          countryCode:      'TH',
        }, 120);

        console.log(`[contacts:facebook] Google batch returned ${googleResults.length} result pages`);
        googleResults.forEach(r => {
          const query       = r.searchQuery?.term || '';
          const companyName = batchCompanies.find(n => query.includes(cleanName(n))) || '';
          const organic     = r.organicResults || [];
          console.log(`  Query: "${query}" → ${organic.length} organic hits`);
          organic.forEach(h => console.log(`    ${isFacebook(h.url||'') ? '✓ FB' : '✗   '} ${h.url}`));
          if (!companyName) { console.log(`    ← could not match query to company name`); return; }
          const fbHit = organic.find(h => isFacebook(h.url || ''));
          if (fbHit?.url && !allFbUrls[fbHit.url]) {
            allFbUrls[fbHit.url] = companyName;
            console.log(`  ✓ Matched "${companyName}" → ${fbHit.url}`);
          } else if (!fbHit) {
            console.log(`  ✗ No Facebook result found for "${companyName}"`);
          }
        });
      } catch (e) {
        console.warn(`[contacts:facebook] FAILED batch ${Math.floor(i/BATCH_SIZE)+1} — Google search threw: ${e.message}`);
        // Continue with next batch even if one fails
      }
    }
  }

  if (!Object.keys(allFbUrls).length) {
    console.warn(`[contacts:facebook] No Facebook URLs to scrape — skipping`);
    return {};
  }

  const urlList = Object.keys(allFbUrls);
  console.log(`[contacts:facebook] Scraping ${urlList.length} Facebook page(s): ${urlList.join(', ')}`);
  const contactsByCompany = {};
  try {
    const pages = await runApify('apify/facebook-pages-scraper', {
      startUrls:       urlList.map(u => ({ url: u })),
      maxPosts:        5,
      maxPostComments: 0,
      maxReviews:      0,
    }, 240);

    console.log(`[contacts:facebook] ── RESPONSE (${pages.length} pages) ──`);
    pages.forEach((page, pi) => {
      const pageUrl     = page.url || page.pageUrl || '';
      const companyName = allFbUrls[pageUrl]
        || allFbUrls[Object.keys(allFbUrls).find(u => pageUrl.includes(u.split('/').filter(Boolean).pop() || '')) || '']
        || '';
      console.log(`  [${pi+1}] url="${pageUrl}" → company="${companyName||'NO MATCH'}"`);
      console.log(`       email="${page.email||'—'}" phone="${page.phone||'—'}" about="${(page.about||'').slice(0,80)}"`);
      if (!companyName) return;
      if (!contactsByCompany[companyName]) contactsByCompany[companyName] = [];

      if (page.email) {
        console.log(`       ✓ Saving email contact: email=${page.email} phone=${page.phone||'—'}`);
        contactsByCompany[companyName].push({
          person_name:  'Business Contact',
          job_title:    page.category || 'Contact',
          public_email: page.email,
          public_phone: page.phone  || '',
          linkedin_url: '',
          source_url:   pageUrl,
          source_type:  'facebook',
          company:      companyName,
        });
      }

      const about = page.about || page.description || '';
      const titleKw = ['ceo','owner','founder','director','manager','managing','president','md'];
      const pattern = new RegExp(`(${titleKw.join('|')})[:\\s]+([A-Z][a-z]+(?:\\s+[A-Z][a-z]+){1,2})`, 'gi');
      let m;
      while ((m = pattern.exec(about)) !== null) {
        console.log(`       ✓ Found person in about: "${m[2]}" title="${m[1]}"`);
        contactsByCompany[companyName].push({
          person_name:  m[2].trim(),
          job_title:    m[1].charAt(0).toUpperCase() + m[1].slice(1),
          public_email: page.email || '',
          public_phone: page.phone || '',
          linkedin_url: '',
          source_url:   pageUrl,
          source_type:  'facebook',
          company:      companyName,
        });
      }
      if (!page.email && !about) console.log(`       ✗ No email or about text on this page`);
    });
    if (!pages.length) console.warn(`[contacts:facebook] Actor returned 0 pages — FB scraper may be blocked or URLs invalid`);
  } catch (e) {
    console.warn(`[contacts:facebook] FAILED — Page scraper threw: ${e.message}`);
  }

  return contactsByCompany;
}

// ════════════════════════════════════════════════════════════════════════════
// SOURCE 3 — Company website crawler
//   Batch crawls all real websites, extracts emails + name/title pairs
// ════════════════════════════════════════════════════════════════════════════
async function websiteSource(websiteUrlMap) {
  if (!Object.keys(websiteUrlMap).length) return {};
  const urls = Object.keys(websiteUrlMap);
  console.log(`[contacts:website] Crawling ${urls.length} website(s)...`);

  // For each site, also seed the crawler with pages most likely to list staff:
  // /about /team /doctors /contact /en (English version) are standard across hospitals & clinics.
  // Without these, depth-1 crawl from root often misses them entirely.
  const HOSPITAL_PATHS = ['/about', '/about-us', '/team', '/our-team', '/doctors', '/doctor',
                          '/staff', '/contact', '/contact-us', '/en', '/en/about', '/en/doctors'];
  const startUrls = urls.flatMap(u => [
    { url: u },
    ...HOSPITAL_PATHS.map(p => ({ url: u.replace(/\/$/, '') + p })),
  ]);

  console.log(`[contacts:website] ── INPUT ──────────────────────────────────`);
  console.log(`[contacts:website] Crawling ${urls.length} site(s):`);
  urls.forEach(u => console.log(`  ${u}`));
  console.log(`[contacts:website] Start URLs (with hospital paths): ${startUrls.length} total`);

  const contactsByCompany = {};
  try {
    const actorInput = {
      startUrls,
      maxCrawlDepth:   1,
      maxCrawlPages:   urls.length * 8,
      crawlerType:     'cheerio',
      excludeUrlGlobs: ['*#*', '*.pdf', '*.jpg', '*.png', '*.css', '*.js'],
    };
    const pages = await runApify('apify/website-content-crawler', actorInput, 360);
    console.log(`[contacts:website] ── RESPONSE: ${pages.length} pages crawled ──`);

    const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

    // Generic / role-based email prefixes — NOT personal contacts.
    // Matched after stripping punctuation (medical.laboratory → medicallaboratory).
    const SKIP_EMAIL_PREFIX = [
      'noreply','noreply','webmaster','example','test','postmaster',
      'privacy','legal','info','contact','admin','support','hello',
      'mail','office','enquiry','inquiry','booking','reservation',
      'appointment','nurse','doctor','medical','laboratory','lab',
      'hospital','clinic','general','reception','hr','marketing',
      'sales','accounting','finance','service','help','feedback',
      'news','events','media','pr',
    ];

    // Words that can NEVER appear in a real person's name.
    // Blocks website headings ("Our History"), facility names ("Mali Hospital"),
    // and service labels ("Medical Laboratory") from being saved as contacts.
    const NON_PERSON_WORDS = new Set([
      // Facility / healthcare
      'hospital','clinic','medical','centre','center','laboratory','lab',
      'department','ward','pharmacy','nursing','emergency','icu',
      'outpatient','inpatient','surgery','radiology','pathology',
      'international','national','regional','general','private',
      // Common English page-heading words
      'history','about','contact','services','service','home','page',
      'information','company','group','institute','foundation',
      'our','their','your','the','and','or','for','with','from',
      'all','new','see','more','read','click','here','view',
      'link','menu','news','blog','faq','help','support',
    ]);

    // Returns true only when text looks like an actual human name.
    // "Our History" → false.  "Medical Laboratory" → false.  "Somchai Panya" → true.
    function isRealPersonName(text) {
      const words = (text || '').trim().split(/\s+/);
      if (words.length < 2 || words.length > 4) return false;
      if (words.some(w => NON_PERSON_WORDS.has(w.toLowerCase()))) return false;
      if (!words.every(w => /^[A-Z]/.test(w))) return false;
      if (words.some(w => w.length < 2)) return false;
      return true;
    }

    // English + Thai title keywords — hospitals use both
    const TITLE_KW = [
      // English
      'ceo','owner','founder','director','manager','head of','managing','president','officer',
      'physician','medical director','chief physician','chief executive',
      // Thai (hospital roles)
      'ผู้จัดการ','ผู้อำนวยการ','ผู้บริหาร','แพทย์','นายแพทย์','ผู้ช่วยแพทย์',
      'พยาบาล','ผู้ดูแล','หัวหน้า',
    ];

    pages.forEach((page, pi) => {
      const pageUrl     = page.url || '';
      const companyName = Object.entries(websiteUrlMap).find(([base]) => pageUrl.startsWith(base))?.[1] || '';
      if (!companyName) {
        console.log(`  [${pi+1}] ${pageUrl} → NO COMPANY MATCH — skipped`);
        return;
      }
      if (!contactsByCompany[companyName]) contactsByCompany[companyName] = [];

      const text  = page.text || '';
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      console.log(`  [${pi+1}] "${companyName}" | ${pageUrl} | ${lines.length} lines of text`);

      // ── Email extraction ──────────────────────────────────────────────────
      const allEmails = (text.match(EMAIL_RE) || []);
      const emails = [...new Set(allEmails.filter(e => {
        const localStripped = e.split('@')[0].toLowerCase().replace(/[._\-+]/g, '');
        const skip = SKIP_EMAIL_PREFIX.some(s => localStripped === s || localStripped.startsWith(s));
        if (skip) console.log(`       ✗ email skipped (generic prefix): ${e}`);
        return !skip;
      }))];

      if (allEmails.length === 0) console.log(`       ✗ no emails found on page`);
      else if (emails.length === 0) console.log(`       ✗ ${allEmails.length} email(s) found but all were generic prefixes`);

      emails.slice(0, 3).forEach(email => {
        const local = email.split('@')[0].replace(/[._\-+]/g, ' ');
        const parts = local.split(' ').filter(p => p.length > 1 && !/^\d+$/.test(p));
        const candidateName = parts.length >= 2
          ? parts.map(p => p[0].toUpperCase() + p.slice(1)).join(' ')
          : null;

        if (!candidateName) {
          console.log(`       ✗ email ${email} → single-word local part, no person name derivable`);
          return;
        }
        if (!isRealPersonName(candidateName)) {
          const badWords = candidateName.split(/\s+/).filter(w => NON_PERSON_WORDS.has(w.toLowerCase()));
          console.log(`       ✗ email ${email} → name="${candidateName}" rejected (non-person words: ${badWords.join(', ')})`);
          return;
        }
        console.log(`       ✓ email ${email} → name="${candidateName}" SAVED`);
        contactsByCompany[companyName].push({
          person_name:  candidateName,
          job_title:    '',
          public_email: email,
          public_phone: '',
          linkedin_url: '',
          source_url:   pageUrl,
          source_type:  pageUrl.includes('/contact') || pageUrl.includes('/about') ? 'about_page' : 'website',
          company:      companyName,
        });
      });

      // ── Title + nearby name extraction ───────────────────────────────────
      let titleHits = 0;
      lines.forEach((line, i) => {
        const lc = line.toLowerCase();
        if (!TITLE_KW.some(k => lc.includes(k))) return;
        const nearby = [lines[i-1], lines[i+1], lines[i-2]].filter(Boolean);
        const candidates = nearby.filter(l => /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}$/.test(l.trim()));
        const name = candidates.find(l => isRealPersonName(l.trim()));

        if (candidates.length && !name) {
          candidates.forEach(c => {
            const badWords = c.trim().split(/\s+/).filter(w => NON_PERSON_WORDS.has(w.toLowerCase()));
            console.log(`       ✗ title-hit near "${line.slice(0,50)}" → candidate="${c.trim()}" rejected (non-person: ${badWords.join(', ')})`);
          });
        }
        if (!name) return;
        titleHits++;
        console.log(`       ✓ title-hit "${line.slice(0,50)}" → name="${name.trim()}" SAVED`);
        contactsByCompany[companyName].push({
          person_name:  name.trim(),
          job_title:    line.trim().slice(0, 80),
          public_email: emails[0] || '',
          public_phone: '',
          linkedin_url: '',
          source_url:   pageUrl,
          source_type:  'about_page',
          company:      companyName,
        });
      });
      if (titleHits === 0 && emails.length === 0) {
        console.log(`       → nothing found on this page`);
      }
    });
    console.log(`[contacts:website] Processed ${pages.length} page(s)`);
  } catch (e) {
    console.warn(`[contacts:website] Crawler failed: ${e.message}`);
  }

  return contactsByCompany;
}

// ════════════════════════════════════════════════════════════════════════════
// SOURCE 4 — Apollo DB via code_crafter~leads-finder
//   Searches by company domain → returns verified B2B email + mobile + LinkedIn
//   Best for companies that have a real website — domain is the key input
// ════════════════════════════════════════════════════════════════════════════
async function apolloSource(websiteUrlMap) {
  if (!Object.keys(websiteUrlMap).length) return {};

  // Extract bare domains from website URLs
  const domainToCompany = {};
  for (const [url, companyName] of Object.entries(websiteUrlMap)) {
    try {
      const hostname = new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
      const domain   = hostname.replace(/^www\./, '');
      if (domain) domainToCompany[domain] = companyName;
    } catch { /* skip invalid URLs */ }
  }

  if (!Object.keys(domainToCompany).length) return {};
  const domains = Object.keys(domainToCompany);

  console.log(`[contacts:apollo] ── INPUT ──────────────────────────────────`);
  console.log(`[contacts:apollo] Searching ${domains.length} domain(s) via code_crafter~leads-finder`);
  domains.forEach(d => console.log(`  domain="${d}" → company="${domainToCompany[d]}"`));

  const actorInput = {
    company_domain:   domains,
    contact_location: ['Thailand'],
    seniority_level:  ['Founder', 'Owner', 'C-Level', 'Director', 'VP', 'Head'],
    email_status:     ['validated', 'not_validated'],
    fetch_count:      domains.length * 5,
  };
  console.log(`[contacts:apollo] Actor input:`, JSON.stringify(actorInput));

  const contactsByCompany = {};
  try {
    const results = await runApify('code_crafter/leads-finder', actorInput, 300);

    console.log(`[contacts:apollo] ── RESPONSE (${results.length} people) ──`);
    if (!results.length) console.warn(`[contacts:apollo] Actor returned 0 results — domain(s) may not be indexed in Apollo DB`);

    results.forEach((person, i) => {
      const rawDomain   = (person.company_domain || '').toLowerCase().replace(/^www\./, '');
      const companyName = domainToCompany[rawDomain]
        || Object.entries(domainToCompany).find(([d]) => rawDomain.includes(d) || d.includes(rawDomain))?.[1]
        || '';
      const name = person.full_name
        || `${person.first_name || ''} ${person.last_name || ''}`.trim()
        || '';

      console.log(`  [${i+1}] name="${name||'—'}" title="${person.job_title||'—'}" email="${person.email||person.personal_email||'—'}" phone="${person.mobile_number||'—'}" domain="${rawDomain}" → company="${companyName||'NO MATCH'}"`);

      if (!companyName) { console.log(`       ✗ SKIPPED — domain "${rawDomain}" not in our domain map`); return; }
      if (!name)        { console.log(`       ✗ SKIPPED — no name`); return; }

      if (!contactsByCompany[companyName]) contactsByCompany[companyName] = [];
      contactsByCompany[companyName].push({
        person_name:  name,
        job_title:    person.job_title || person.headline || '',
        public_email: person.email     || person.personal_email || '',
        public_phone: person.mobile_number || '',
        linkedin_url: person.linkedin  || '',
        source_url:   `https://${rawDomain}`,
        source_type:  'apollo',
        company:      companyName,
      });
      console.log(`       ✓ SAVED to "${companyName}"`);
    });

    console.log(`[contacts:apollo] Contacts saved per company:`);
    Object.entries(contactsByCompany).forEach(([c, arr]) => console.log(`  ✓ "${c}": ${arr.length}`));
    domains.filter(d => !Object.values(contactsByCompany).length || !contactsByCompany[domainToCompany[d]]?.length)
      .forEach(d => console.log(`  ✗ "${domainToCompany[d]}" (${d}): 0 contacts`));
  } catch (e) {
    if (e.message.includes('403') || e.response?.status === 403) {
      console.warn(`[contacts:apollo] SKIPPED — leads-finder actor returned 403 (subscription required on Apify for code_crafter/leads-finder)`);
    } else {
      console.warn(`[contacts:apollo] FAILED — leads-finder actor threw: ${e.message}`);
    }
  }

  return contactsByCompany;
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN — find contacts for ALL companies, all 4 sources in parallel
// ════════════════════════════════════════════════════════════════════════════
async function findContactsForAll(rawLeads) {
  console.log(`\n[contacts] ════ START: Finding contacts for ${rawLeads.length} companies`);

  // Categorise each lead's website
  const fbUrlMap      = {};   // fbUrl       → companyName
  const websiteUrlMap = {};   // websiteBase → companyName
  const noFbCompanies = [];   // companies without a FB url (for Google FB search)
  const allCompanies  = [];   // all company names (for LinkedIn)

  for (const lead of rawLeads) {
    const name    = (lead.title || lead.company_name || '').trim();
    const website = (lead.website || '').trim();
    if (!name) continue;

    allCompanies.push(name);

    if (isFacebook(website)) {
      fbUrlMap[website] = name;
    } else if (isRealWebsite(website)) {
      const base = (website.startsWith('http') ? website : `https://${website}`).replace(/\/$/, '');
      websiteUrlMap[base] = name;
      noFbCompanies.push(name);   // also try to find their FB page
    } else {
      noFbCompanies.push(name);   // no website at all
    }
  }

  console.log(`[contacts] LinkedIn targets: ${allCompanies.length}`);
  console.log(`[contacts] Facebook URLs direct: ${Object.keys(fbUrlMap).length} | need search: ${noFbCompanies.length}`);
  console.log(`[contacts] Websites: ${Object.keys(websiteUrlMap).length}`);

  // ── Run all 4 sources in parallel ────────────────────────────────────────
  const [liResult, fbResult, webResult, apolloResult] = await Promise.allSettled([
    linkedInSource(allCompanies),
    facebookSource(fbUrlMap, noFbCompanies),
    websiteSource(websiteUrlMap),
    apolloSource(websiteUrlMap),    // SOURCE 4: Apollo DB by domain
  ]);

  // ── Merge by company name ────────────────────────────────────────────────
  const merged = {};
  const mergeIn = result => {
    if (result.status !== 'fulfilled' || !result.value) return;
    Object.entries(result.value).forEach(([company, contacts]) => {
      merged[company] = (merged[company] || []).concat(contacts);
    });
  };
  mergeIn(liResult);
  mergeIn(fbResult);
  mergeIn(webResult);
  mergeIn(apolloResult);

  // ── De-duplicate per company ─────────────────────────────────────────────
  Object.keys(merged).forEach(company => {
    const seen = new Set();
    merged[company] = merged[company].filter(c => {
      const key = (c.public_email || c.linkedin_url || c.person_name || '').toLowerCase().replace(/\s+/g, '');
      if (!key || key === 'contact' || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

  const totalContacts = Object.values(merged).reduce((s, a) => s + a.length, 0);
  const companiesHit  = Object.values(merged).filter(a => a.length > 0).length;

  console.log(`[contacts] ════ END: ${totalContacts} contact(s) found across ${companiesHit}/${rawLeads.length} companies`);
  console.log(`[contacts] Source breakdown:`);
  console.log(`  LinkedIn : ${liResult.status     === 'fulfilled' ? Object.values(liResult.value     || {}).flat().length : 0}`);
  console.log(`  Facebook : ${fbResult.status     === 'fulfilled' ? Object.values(fbResult.value     || {}).flat().length : 0}`);
  console.log(`  Website  : ${webResult.status    === 'fulfilled' ? Object.values(webResult.value    || {}).flat().length : 0}`);
  console.log(`  Apollo   : ${apolloResult.status === 'fulfilled' ? Object.values(apolloResult.value || {}).flat().length : 0}`);

  return merged;
}

// ════════════════════════════════════════════════════════════════════════════
// FALLBACK — LinkedIn + Facebook + Website + Apollo Apify scraper
// Called by apolloBatch pre-clean when Apollo direct API found 0 contacts.
//
// Note: apolloSource (code_crafter/leads-finder) uses domain-based scraping
// which is fundamentally different from the Apollo API call that already failed.
// The Apify actor may find contacts the API missed due to different search logic.
// ════════════════════════════════════════════════════════════════════════════
async function findFallbackContacts(rawLeads) {
  if (!rawLeads.length) return {};
  console.log(`\n[contacts] ════ FALLBACK START: ${rawLeads.length} companies with no Apollo contacts`);

  const fbUrlMap      = {};
  const websiteUrlMap = {};
  const noFbCompanies = [];
  const allCompanies  = [];

  for (const lead of rawLeads) {
    const name    = (lead.title || lead.company_name || '').trim();
    const website = (lead.website || '').trim();
    if (!name) continue;

    allCompanies.push(name);

    if (isFacebook(website)) {
      fbUrlMap[website] = name;
    } else if (isRealWebsite(website)) {
      const base = (website.startsWith('http') ? website : `https://${website}`).replace(/\/$/, '');
      websiteUrlMap[base] = name;
      noFbCompanies.push(name);
    } else {
      noFbCompanies.push(name);
    }
  }

  console.log(`[contacts:fallback] LinkedIn: ${allCompanies.length} | FB: ${Object.keys(fbUrlMap).length}+${noFbCompanies.length} | Web: ${Object.keys(websiteUrlMap).length} | Apollo-Apify: ${Object.keys(websiteUrlMap).length}`);

  // Run all 4 sources in parallel — Apollo Apify scraper included because it uses
  // domain-based scraping (different from the direct API that already found nothing)
  const [liResult, fbResult, webResult, apolloResult] = await Promise.allSettled([
    linkedInSource(allCompanies),
    facebookSource(fbUrlMap, noFbCompanies),
    websiteSource(websiteUrlMap),
    apolloSource(websiteUrlMap),   // domain-based Apollo scraper — different from API
  ]);

  const merged = {};
  const mergeIn = result => {
    if (result.status !== 'fulfilled' || !result.value) return;
    Object.entries(result.value).forEach(([company, contacts]) => {
      merged[company] = (merged[company] || []).concat(contacts);
    });
  };
  mergeIn(liResult);
  mergeIn(fbResult);
  mergeIn(webResult);
  mergeIn(apolloResult);

  // De-duplicate per company
  Object.keys(merged).forEach(company => {
    const seen = new Set();
    merged[company] = merged[company].filter(c => {
      const key = (c.public_email || c.linkedin_url || c.person_name || '').toLowerCase().replace(/\s+/g, '');
      if (!key || key === 'contact' || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

  const totalContacts = Object.values(merged).reduce((s, a) => s + a.length, 0);
  const companiesHit  = Object.values(merged).filter(a => a.length > 0).length;

  console.log(`\n[contacts] ════ FALLBACK END ════════════════════════════════`);
  console.log(`  Source totals:`);
  console.log(`  LinkedIn     : ${liResult.status     === 'fulfilled' ? Object.values(liResult.value     || {}).flat().length + ' contacts' : 'FAILED — ' + liResult.reason?.message}`);
  console.log(`  Facebook     : ${fbResult.status     === 'fulfilled' ? Object.values(fbResult.value     || {}).flat().length + ' contacts' : 'FAILED — ' + fbResult.reason?.message}`);
  console.log(`  Website      : ${webResult.status    === 'fulfilled' ? Object.values(webResult.value    || {}).flat().length + ' contacts' : 'FAILED — ' + webResult.reason?.message}`);
  console.log(`  Apollo-Apify : ${apolloResult.status === 'fulfilled' ? Object.values(apolloResult.value || {}).flat().length + ' contacts' : 'FAILED — ' + apolloResult.reason?.message}`);
  console.log(`  ─────────────────────────────────────────────────────────────`);
  console.log(`  Per-company results (${companiesHit}/${rawLeads.length} companies found contacts):`);
  rawLeads.forEach(lead => {
    const name     = lead.title || lead.company_name || '';
    const contacts = merged[name] || [];
    if (contacts.length) {
      const bySource = contacts.reduce((acc, c) => { acc[c.source_type] = (acc[c.source_type]||0)+1; return acc; }, {});
      const srcStr   = Object.entries(bySource).map(([s,n]) => `${s}:${n}`).join(' ');
      console.log(`  ✓ "${name}" → ${contacts.length} contact(s) [${srcStr}]`);
      contacts.forEach(c => console.log(`      ${c.person_name} | ${c.job_title||'—'} | email:${c.public_email||'—'} phone:${c.public_phone||'—'} li:${c.linkedin_url?'yes':'no'}`));
    } else {
      console.log(`  ✗ "${name}" → 0 contacts — all 4 sources returned nothing`);
    }
  });
  console.log(`  ═════════════════════════════════════════════════════════════\n`);

  return merged;
}

module.exports = { findContactsForAll, findFallbackContacts };
