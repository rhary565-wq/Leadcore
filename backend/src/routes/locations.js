// Thailand location master: 77 provinces → districts (amphoe/khet) → sub-districts
// (tambon/khwaeng), English + Thai names. Source: kongvut/thai-province-data (MIT).
const router = require('express').Router();
const GEO = require('../data/thailand-geo.json');

const byProvince = new Map(GEO.map(p => [String(p.id), p]));
const byDistrict = new Map(GEO.flatMap(p => p.districts.map(d => [String(d.id), d])));

// GET /api/locations/provinces
router.get('/provinces', (req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  res.json(GEO.map(p => ({ id: String(p.id), nameEn: p.en, nameTh: p.th })));
});

// GET /api/locations/provinces/:id/districts
router.get('/provinces/:id/districts', (req, res) => {
  const p = byProvince.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Province not found' });
  res.set('Cache-Control', 'public, max-age=86400');
  res.json(p.districts.map(d => ({ id: String(d.id), nameEn: d.en, nameTh: d.th })));
});

// GET /api/locations/districts/:id/sub-districts
router.get('/districts/:id/sub-districts', (req, res) => {
  const d = byDistrict.get(req.params.id);
  if (!d) return res.status(404).json({ error: 'District not found' });
  res.set('Cache-Control', 'public, max-age=86400');
  res.json(d.sub.map(s => ({ id: String(s.id), nameEn: s.en, nameTh: s.th, zip: s.zip })));
});

module.exports = router;
