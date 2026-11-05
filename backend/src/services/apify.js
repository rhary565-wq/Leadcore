// Apify Google Maps Scraper service
// Actor: compass~crawler-google-places
//
// Search scale tiers:
//   Small  (<=500):    poll every 5s,  timeout 6 min,  dataset limit 1,000
//   Medium (<=5,000):  poll every 10s, timeout 30 min, dataset limit 10,000
//   Large  (<=25,000): poll every 15s, timeout 90 min, dataset limit 30,000
//
// Province support:
//   config.province = "Chiang Mai"   -> locationQuery = "Chiang Mai, Thailand"
//   config.province = "All Thailand" -> locationQuery = "Thailand"
//   Falls back to config.location + config.country when no province set

const axios = require('axios');

const BASE     = 'https://api.apify.com/v2';
const TOKEN    = () => process.env.APIFY_API_TOKEN;
const ACTOR_ID = 'compass~crawler-google-places';

// ── Scale config based on desired max results ─────────────────────────────────
function scaleConfig(maxResults) {
  if (maxResults <= 500)  return { pollMs: 5000,  maxPolls: 72,  downloadLimit: 1000  };
  if (maxResults <= 5000) return { pollMs: 10000, maxPolls: 180, downloadLimit: 10000 };
  return                         { pollMs: 15000, maxPolls: 360, downloadLimit: 30000 };
}

// ── Build locationQuery from config ──────────────────────────────────────────
function buildLocationQuery(config) {
  // Thai location hierarchy from the YodSales search bar:
  //   sub-district → district → province (most specific first)
  if (config.province && config.province !== 'All Thailand') {
    return [config.subDistrict, config.district, config.province, 'Thailand']
      .filter(Boolean).join(', ');
  }
  if (config.province === 'All Thailand') return 'Thailand';
  // Legacy free-text fallback
  return [config.location, config.country].filter(Boolean).join(', ') || 'Thailand';
}

// ── Start a scraping run ──────────────────────────────────────────────────────
async function startRun(config) {
  const { queries, language, maxResults } = config;
  const searchStringsArray = (queries || []).map(q => q.trim()).filter(Boolean);
  const locationQuery      = buildLocationQuery(config);
  const maxCrawl           = Math.min(maxResults || 50, 25000);

  const input = {
    searchStringsArray,
    locationQuery,
    maxCrawledPlacesPerSearch: maxCrawl,
    language:                  language || 'en',
  };

  console.log(`[apify] Starting run — location="${locationQuery}" maxResults=${maxCrawl}`);
  console.log(`[apify] Input: ${JSON.stringify(input)}`);

  try {
    const res = await axios.post(
      `${BASE}/acts/${ACTOR_ID}/runs`,
      input,
      {
        params:  { token: TOKEN() },
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000,  // 60s — Apify can be slow to accept large runs
      }
    );
    const runId = res.data.data.id;
    console.log(`[apify] Run started: ${runId}`);
    return runId;
  } catch (err) {
    const msg = err.response?.data || err.message;
    console.error('[apify] startRun error:', JSON.stringify(msg));
    throw new Error(`Apify startRun failed: ${JSON.stringify(msg)}`);
  }
}

// ── Poll until the run finishes, then return the dataset ID ──────────────────
async function waitForRun(runId, maxResults) {
  const scale = scaleConfig(maxResults || 50);
  let polls   = 0;
  console.log(`[apify] Polling run ${runId} (max ${scale.maxPolls} polls x ${scale.pollMs}ms)...`);

  while (polls < scale.maxPolls) {
    await new Promise(r => setTimeout(r, scale.pollMs));
    polls++;

    const res = await axios.get(
      `${BASE}/actor-runs/${runId}`,
      { params: { token: TOKEN() } }
    );
    const { status, defaultDatasetId } = res.data.data;
    console.log(`[apify] Poll ${polls}/${scale.maxPolls} — status: ${status}`);

    if (status === 'SUCCEEDED') return defaultDatasetId;
    if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
      throw new Error(`Apify run ${status.toLowerCase()}: ${runId}`);
    }
  }
  throw new Error(`Apify run timed out after ${(scale.maxPolls * scale.pollMs) / 60000} min: ${runId}`);
}

// ── Download results from the dataset ─────────────────────────────────────────
async function getResults(datasetId, maxResults) {
  const scale = scaleConfig(maxResults || 50);
  // Use the exact maxResults as the download limit so we never pull more rows
  // than the user asked for. Cap at scale.downloadLimit as a safety ceiling.
  const limit = Math.min(maxResults || 50, scale.downloadLimit);
  console.log(`[apify] Downloading dataset ${datasetId} (limit ${limit})...`);

  const res = await axios.get(
    `${BASE}/datasets/${datasetId}/items`,
    {
      params:  { token: TOKEN(), format: 'json', limit },
      timeout: 120000,
    }
  );
  console.log(`[apify] Downloaded ${res.data.length} items`);
  return res.data;
}

module.exports = { startRun, waitForRun, getResults, buildLocationQuery };
