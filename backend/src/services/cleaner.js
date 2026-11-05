const axios = require('axios');

// ─── JUNK CATEGORY FILTER ────────────────────────────────────────────────────
// Google Maps returns auxiliary places (parking, ATMs, toilets) attached to a venue.
// These are never valid leads — filter them before scoring so they don't waste
// Apollo API quota or pollute the fallback contact search.
const JUNK_CATEGORIES = new Set([
  'parking lot', 'parking garage', 'parking facility', 'car park', 'parkade',
  'parking', 'paid parking lot',
  'atm', 'cash machine', 'bank machine',
  'food court', 'food stall', 'canteen', 'cafeteria',
  'restroom', 'public restroom', 'public toilet', 'toilet',
  'vending machine', 'phone booth', 'elevator', 'escalator',
]);

// ─── SCORING RULES ────────────────────────────────────────────────────────────
// Edit these values to change how leads are scored
const SCORE_RULES = {
  has_website:             20,
  has_phone:               10,
  relevant_industry:       30,
  twenty_plus_reviews:     10,
  active_business:         10   // rating >= 3.5
};

// Total possible = 80 pts
const STATUS = {
  HOT:  { min: 70 },
  WARM: { min: 40 },
  LOW:  { min: 0  }
};

// ─── DEDUPLICATION ────────────────────────────────────────────────────────────
function deduplicate(records) {
  const seen = new Set();
  return records.map(r => {
    const site  = (r.website || '').toLowerCase().replace(/https?:\/\/(www\.)?/, '').trim();
    const phone = (r.phone || '').replace(/\D/g, '').slice(-9);
    const key   = `${site}|${phone}`;

    if (key !== '|' && seen.has(key)) {
      return { ...r, is_duplicate: true };
    }
    seen.add(key);
    return { ...r, is_duplicate: false };
  });
}

// ─── PHONE FORMATTER ──────────────────────────────────────────────────────────
function formatPhone(raw) {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8) return null;
  // Already has country code
  if (digits.startsWith('66') && digits.length === 11) return `+${digits}`;
  // Thai local format
  if (digits.startsWith('0') && digits.length === 10) return `+66${digits.slice(1)}`;
  // Generic: just prefix +
  if (digits.length >= 10) return `+${digits}`;
  return null;
}

// ─── WEBSITE VALIDATOR ────────────────────────────────────────────────────────
async function checkWebsite(url) {
  if (!url || !url.startsWith('http')) return false;
  try {
    const res = await axios.get(url, {
      timeout: 6000,
      maxRedirects: 5,
      validateStatus: s => s < 500
    });
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

// ─── LEAD SCORER ──────────────────────────────────────────────────────────────
function score(lead, userIndustries) {
  const breakdown = {};
  let total = 0;

  if (lead.website_valid) {
    breakdown.has_website = SCORE_RULES.has_website;
    total += SCORE_RULES.has_website;
  }
  if (lead.phone_formatted) {
    breakdown.has_phone = SCORE_RULES.has_phone;
    total += SCORE_RULES.has_phone;
  }

  // Industry match — if user passed industry filters, check against them
  // If no filter set, any industry scores the points
  const leadIndustry = (lead.industry || '').toLowerCase();
  const industryMatch = !userIndustries?.length ||
    userIndustries.some(i => leadIndustry.includes(i.toLowerCase()));
  if (industryMatch && leadIndustry) {
    breakdown.relevant_industry = SCORE_RULES.relevant_industry;
    total += SCORE_RULES.relevant_industry;
  }

  if ((lead.reviews_count || 0) >= 20) {
    breakdown.twenty_plus_reviews = SCORE_RULES.twenty_plus_reviews;
    total += SCORE_RULES.twenty_plus_reviews;
  }
  if ((lead.rating || 0) >= 3.5) {
    breakdown.active_business = SCORE_RULES.active_business;
    total += SCORE_RULES.active_business;
  }

  const status = total >= STATUS.HOT.min ? 'Hot'
               : total >= STATUS.WARM.min ? 'Warm'
               : 'Low';

  return { lead_score: total, lead_status: status, score_breakdown: breakdown };
}

// ─── MAIN PIPELINE ────────────────────────────────────────────────────────────
async function cleanAndScore(rawRecords, config = {}) {
  // 1. Deduplicate
  const deduped = deduplicate(rawRecords);

  const results = [];

  for (const raw of deduped) {
    // Map Apify field names to our schema
    const record = {
      company_name:    raw.title || raw.name || raw.company_name || null,
      website:         raw.website || null,
      phone:           raw.phone || raw.phoneUnformatted || null,
      address:         raw.address || raw.street || null,
      city:            raw.city || raw.neighborhood || raw.location?.city || null,
      industry:        raw.categoryName || raw.category || raw.industry || null,
      rating:          parseFloat(raw.totalScore || raw.rating) || null,
      reviews_count:   parseInt(raw.reviewsCount || raw.reviews_count) || 0,
      google_maps_url: raw.url || raw.googleMapsUrl || null,
      latitude:        raw.location?.lat ?? raw.latitude ?? null,
      longitude:       raw.location?.lng ?? raw.longitude ?? null,
      email:           (Array.isArray(raw.emails) && raw.emails[0]) || raw.email || null,
      is_duplicate:    raw.is_duplicate || false
    };

    if (record.is_duplicate) {
      results.push({ ...record, lead_status: 'Duplicate', lead_score: 0, score_breakdown: {} });
      continue;
    }

    // Filter junk categories — parking lots, ATMs, food courts etc. are never leads.
    // Mark as duplicate so they're excluded from goodLeads in clean.js.
    const industryLower = (record.industry || '').toLowerCase().trim();
    if (JUNK_CATEGORIES.has(industryLower)) {
      console.log(`[cleaner] Filtered junk category: "${record.company_name}" (${record.industry})`);
      results.push({ ...record, is_duplicate: true, lead_status: 'Duplicate', lead_score: 0, score_breakdown: {} });
      continue;
    }

    // 2. Validate phone
    const phone_formatted = formatPhone(record.phone);
    const phone_valid     = !!phone_formatted;

    // 3. Validate website (async)
    const website_valid = await checkWebsite(record.website);

    // 4. Check missing fields
    const missing_fields = ['company_name', 'website', 'phone', 'address']
      .filter(f => !record[f]);

    // 5. Score
    const scored = score(
      { ...record, website_valid, phone_formatted },
      config.industry_filter
    );

    results.push({
      ...record,
      phone_formatted,
      phone_valid,
      website_valid,
      missing_fields,
      ...scored
    });
  }

  return results;
}

module.exports = { cleanAndScore };
