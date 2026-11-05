require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const { requireAuth, requireAdmin, requireInternal } = require('./middleware/auth');

// LeadGen routes (search logic + lead data)
const jobRoutes         = require('./routes/jobs');
const leadRoutes        = require('./routes/leads');
const keyContactRoutes  = require('./routes/keyContacts');
const apolloRoutes      = require('./routes/apollo');
// YodSales routes (account, admin, AI, locations) + unified insights
const accountRoutes     = require('./routes/account');
const adminRoutes       = require('./routes/admin');
const aiRoutes          = require('./routes/ai');
const locationRoutes    = require('./routes/locations');
const insightRoutes     = require('./routes/insights');

const { handleScrape }          = require('./workers/scrape');
const { handleClean }           = require('./workers/clean');
const { handleHubspot }         = require('./workers/hubspot');
const { handleEnrich }          = require('./workers/enrich');
const { handleHubspotContacts } = require('./workers/hubspotContacts');
const { handleApolloBatch }     = require('./workers/apolloBatch');

const app  = express();
const PORT = process.env.PORT || 8080;

app.set('trust proxy', true);

// ── Middleware ──────────────────────────────────────────────────────────────
const allowed = (process.env.FRONTEND_URL || 'http://localhost:3000,http://localhost:5173')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: [...allowed, /\.run\.app$/] }));
app.use(express.json({ limit: '10mb' })); // 10mb for large lead batches

// ── Public endpoints ─────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'leadcore-backend', time: new Date().toISOString() });
});
app.use('/api/locations', locationRoutes);            // static Thai geography
// Apollo calls this webhook directly — it can't send a user token
app.post('/api/apollo/phone-webhook', (req, res, next) => {
  const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  req.url = '/phone-webhook' + qs;
  apolloRoutes(req, res, next);
});

// ── Signed-in API ────────────────────────────────────────────────────────────
app.use('/api', requireAuth);
app.use('/api',              accountRoutes);   // /me, /activity, /support, /pipeline, /templates
app.use('/api/admin',        requireAdmin, adminRoutes);
app.use('/api/ai',           aiRoutes);
app.use('/api/insights',     insightRoutes);
app.use('/api/jobs',         jobRoutes);
app.use('/api/leads',        leadRoutes);
app.use('/api/key-contacts', keyContactRoutes);
app.use('/api/apollo',       apolloRoutes);

// ── Worker endpoints (Cloud Tasks / local queue only) ────────────────────────
app.post('/worker/scrape',            requireInternal, handleScrape);
app.post('/worker/clean',             requireInternal, handleClean);
app.post('/worker/hubspot',           requireInternal, handleHubspot);
app.post('/worker/enrich',            requireInternal, handleEnrich);
app.post('/worker/hubspot-contacts',  requireInternal, handleHubspotContacts);
app.post('/worker/apollo-batch',      requireInternal, handleApolloBatch);

// ── 404 / errors ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

if (require.main === module) {
  if (process.env.AUTH_REQUIRED === 'false') console.warn('⚠️  AUTH_REQUIRED=false — NO LOGIN. Anyone who can reach this server can use it. Local testing only!');
  app.listen(PORT, () => console.log(`✅ Leadcore backend running on port ${PORT}`));
}

module.exports = app;
