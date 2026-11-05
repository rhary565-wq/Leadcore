// Alternative Google Maps scrape engines (ported from the "New search git" Go app).
//
//   engine = 'apify' (default) → services/apify.js  (Leadgen, unchanged)
//   engine = 'gosom'           → runs the open-source gosom/google-maps-scraper
//                                Docker image on this machine (no Apify cost)
//   engine = 'demo'            → realistic sample data, for testing the full flow
//
// Every engine returns items in the SAME shape as the Apify actor
// (title, categoryName, address, city, phone, website, totalScore, reviewsCount,
// url, location{lat,lng}, emails[]) so the clean/score/approval pipeline is shared.

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { buildLocationQuery } = require('./apify');

function query(config, q) {
  return `${q} in ${buildLocationQuery(config)}`;
}

// ── gosom/google-maps-scraper via Docker ─────────────────────────────────────
function runGosom(config, onLog = () => {}) {
  const image       = process.env.SCRAPER_IMAGE || 'gosom/google-maps-scraper:latest';
  const depth       = process.env.SCRAPER_DEPTH || '10';
  const concurrency = process.env.SCRAPER_CONCURRENCY || '4';
  const inactivity  = process.env.SCRAPER_INACTIVITY || '3m';

  const dir = fs.mkdtempSync(path.join(process.env.SCRAPER_DATA_DIR || os.tmpdir(), 'gmaps-'));
  const queries = (config.queries || []).map(q => q.trim()).filter(Boolean).map(q => query(config, q));
  fs.writeFileSync(path.join(dir, 'queries.txt'), queries.join('\n') + '\n');

  const args = [
    'run', '--rm', '-v', `${dir}:/data`, image,
    '-input', '/data/queries.txt', '-results', '/data/results.json', '-json',
    '-depth', String(depth), '-c', String(concurrency),
    '-exit-on-inactivity', inactivity, '-lang', config.language || 'en',
  ];
  if (config.extractEmail) args.push('-email');
  if (process.env.SCRAPER_PROXIES) args.push('-proxies', process.env.SCRAPER_PROXIES);

  onLog(`Launching ${image} for ${queries.length} quer${queries.length === 1 ? 'y' : 'ies'}`);

  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const relay = buf => String(buf).split('\n').map(s => s.trim()).filter(Boolean).forEach(onLog);
    child.stdout.on('data', relay);
    child.stderr.on('data', relay);
    child.on('error', err => reject(new Error(`Could not start Docker: ${err.message}`)));
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`gosom scraper exited with code ${code}`));
      try {
        const raw = fs.readFileSync(path.join(dir, 'results.json'), 'utf8');
        resolve(parseGosom(raw).slice(0, config.maxResults || 50));
      } catch (err) {
        reject(new Error(`Could not read scraper results: ${err.message}`));
      } finally {
        fs.rm(dir, { recursive: true, force: true }, () => {});
      }
    });
  });
}

// gosom writes either a JSON array or newline-delimited JSON objects.
function parseGosom(raw) {
  const text = (raw || '').trim();
  if (!text) return [];
  let rows = [];
  if (text.startsWith('[')) {
    try { rows = JSON.parse(text); } catch { rows = []; }
  }
  if (!rows.length) {
    rows = text.split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }
  return rows.map(toApifyShape);
}

function toApifyShape(g) {
  const lat = g.latitude ?? g.lat ?? null;
  const lng = g.longitude ?? g.longtitude ?? g.lng ?? null; // gosom spells it "longtitude"
  return {
    title:        g.title || '',
    categoryName: g.category || (Array.isArray(g.categories) ? g.categories[0] : '') || '',
    address:      g.address || '',
    city:         g.complete_address?.city || '',
    phone:        g.phone || '',
    website:      g.web_site || g.website || '',
    totalScore:   g.review_rating ?? g.rating ?? null,
    reviewsCount: g.review_count ?? 0,
    url:          g.link || (lat && lng ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : ''),
    location:     lat && lng ? { lat: Number(lat), lng: Number(lng) } : null,
    emails:       Array.isArray(g.emails) ? g.emails : [],
  };
}

// ── Demo engine (sample data) ────────────────────────────────────────────────
const STREETS  = ['Sukhumvit Rd', 'Silom Rd', 'Rama IV Rd', 'Phahonyothin Rd', 'Ratchadaphisek Rd', 'Charoen Krung Rd', 'Nimman Rd', 'Beach Rd'];
const SUFFIXES = ['Co., Ltd.', 'Group', 'Center', 'Express', 'Studio', 'Clinic', 'Supply', 'Thailand'];
const CENTERS  = { Bangkok: [13.7563, 100.5018], 'Chiang Mai': [18.7883, 98.9853], Phuket: [7.8804, 98.3923], Chonburi: [13.3611, 100.9847], 'Khon Kaen': [16.4419, 102.8360] };

async function runDemo(config, onLog = () => {}) {
  const max  = Math.min(config.maxResults || 20, 60);
  const area = config.subDistrict || config.district || config.province || 'Bangkok';
  const [bl, bg] = CENTERS[config.province] || CENTERS.Bangkok;
  const out = [];
  let n = 0;
  for (const q of (config.queries || ['Business'])) {
    for (let i = 0; i < Math.ceil(max / (config.queries?.length || 1)) && out.length < max; i++) {
      n++;
      const name = `${area} ${q.replace(/\b\w/g, c => c.toUpperCase())} ${SUFFIXES[n % SUFFIXES.length]}`;
      const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const hasWeb = Math.random() < 0.7;
      const lat = bl + (Math.random() - 0.5) * 0.12;
      const lng = bg + (Math.random() - 0.5) * 0.12;
      out.push({
        title: name,
        categoryName: q,
        address: `${10 + Math.floor(Math.random() * 900)} ${STREETS[n % STREETS.length]}, ${area}`,
        city: config.district || config.province || 'Bangkok',
        phone: `+66 ${2 + Math.floor(Math.random() * 7)} ${100 + Math.floor(Math.random() * 899)} ${1000 + Math.floor(Math.random() * 8999)}`,
        website: hasWeb ? `https://${slug.slice(0, 24)}.co.th` : '',
        totalScore: Math.round((3 + Math.random() * 2) * 10) / 10,
        reviewsCount: Math.floor(Math.random() * 900),
        url: `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`,
        location: { lat, lng },
        emails: hasWeb && Math.random() < 0.5 ? [`info@${slug.slice(0, 24)}.co.th`] : [],
      });
    }
    onLog(`Demo: generated results for "${q}"`);
  }
  await new Promise(r => setTimeout(r, 800));
  return out;
}

module.exports = { runGosom, runDemo, parseGosom };
