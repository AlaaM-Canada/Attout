'use strict';
const path = require('path');
const express = require('express');
const store = require('./store');
const market = require('./market');
const pricing = require('./pricing');
const ai = require('./ai');
const jobs = require('./jobs');

const app = express();
app.use(express.json());

// Every deploy gets a new build id, so browsers never keep an old app.js after a redeploy.
const BUILD = (process.env.RENDER_GIT_COMMIT || '').slice(0, 10) || String(Date.now());
const PUBLIC = path.join(__dirname, '..', 'public');
const indexHtml = () => require('fs').readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replace(/\/(app\.js|styles\.css)"/g, '/$1?v=' + BUILD + '"');
app.get(['/', '/index.html'], (req, res) => { res.set('Cache-Control', 'no-cache'); res.type('html').send(indexHtml()); });
app.use(express.static(PUBLIC, { index: false, etag: true, setHeaders: (res, p) => { if (/\.(js|css)$/.test(p)) res.set('Cache-Control', 'no-cache'); } }));

const DEALER = {
  name: process.env.DEALER_NAME || 'Canadian Fine Motors',
  city: process.env.DEALER_CITY || 'Scarborough, ON',
  postalCode: process.env.DEALER_POSTAL_CODE || 'M1R 2Y5'
};

function totalCost(c) { return (c.purchasePrice || 0) + (c.auctionFees || 0) + (c.transport || 0) + (c.reconditioning || 0); }
function withDerived(c) {
  const days = c.purchasedAt ? Math.max(0, Math.round((Date.now() - new Date(c.purchasedAt).getTime()) / 86400000)) : (c.listedDays != null ? c.listedDays : null);
  return Object.assign({}, c, { totalCost: totalCost(c), daysInStock: days, daysFromListing: !c.purchasedAt && c.listedDays != null });
}

app.get('/api/config', (req, res) => {
  res.json({ dealer: DEALER, liveAvailable: market.liveAvailable(), websiteAvailable: market.websiteAvailable(), website: market.websiteBase, radiusKm: Number(process.env.SEARCH_RADIUS_KM || 100), aiAvailable: ai.available(), aiModel: ai.MODEL, features: pricing.FEATURES.map((f) => ({ key: f.key, label: f.label, value: f.value })), rates: pricing.RATES });
});

app.get('/api/inventory', (req, res) => {
  const cars = store.inventory.all().map(withDerived);
  const market = market_summaries(cars);
  res.json(cars.map((c) => Object.assign({}, c, { market: market[c.id] || null })));
});
function market_summaries(cars) { try { return market.summaries(cars); } catch (e) { return {}; } }

app.get('/api/inventory/:id', (req, res) => {
  const c = store.inventory.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Car not found' });
  const d = withDerived(c);
  res.json(Object.assign(d, { market: market_summaries([d])[d.id] || null }));
});

app.put('/api/inventory/:id', (req, res) => {
  const c = store.inventory.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Car not found' });
  const allowed = ['year', 'make', 'model', 'trim', 'bodyStyle', 'transmission', 'km', 'drivetrain', 'colour', 'listPrice', 'purchasePrice', 'auctionFees', 'transport', 'reconditioning', 'features', 'location', 'stockNumber', 'source', 'image', 'vin', 'purchasedAt'];
  allowed.forEach((k) => { if (req.body[k] !== undefined) c[k] = req.body[k]; });
  store.inventory.save(c);
  store.audit.add({ action: 'Car updated', module: 'Inventory', target: `${c.year} ${c.make} ${c.model}` });
  res.json(withDerived(c));
});

// The core flow: pick a car, search the market, get statistics and a recommendation.
function logCheck(label, car, result) {
  store.audit.add({ action: `${label} (${result.source}${result.cached ? ', cached' : ''})`, module: 'Market check', target: `${car.year} ${car.make} ${car.model} ${car.trim || ''}`.trim(), detail: `${result.stats.used} comparables, median $${result.stats.median.toLocaleString('en-CA')}` });
}

// Fast path when the search is cached; otherwise a background job the client polls for progress.
async function checkOrJob(car, body, label, res) {
  const opts = { refresh: !!body.refresh, mode: body.mode };
  const memoReady = !ai.available() || market.memoCached(car, opts.mode);
  if (!opts.refresh && memoReady && (market.hasCache(car) || !market.liveAvailable())) {
    const result = await market.check(car, opts);
    logCheck(label, car, result);
    return res.json(result);
  }
  const job = jobs.create('market-check', async (progress) => {
    progress(3, 'Starting the search', 'searching');
    const result = await market.check(car, Object.assign({}, opts, { onProgress: progress }));
    logCheck(label, car, result);
    return result;
  });
  res.status(202).json({ jobId: job.id });
}

app.post('/api/inventory/:id/market-check', async (req, res) => {
  const c = store.inventory.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Car not found' });
  try { await checkOrJob(withDerived(c), req.body || {}, 'Market check run', res); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(jobs.publicView(job));
});

app.post('/api/inventory/import', (req, res) => {
  if (!market.liveAvailable()) return res.status(503).json({ error: 'Live search is off (no APIFY_TOKEN)' });
  const job = jobs.create('import', async (progress) => {
    progress(3, 'Contacting AutoTrader.ca', 'searching');
    const r = await market.importOwnListings({ source: 'autotrader', onProgress: progress });
    store.audit.add({ action: 'Inventory refreshed from AutoTrader.ca', module: 'Inventory', target: `${r.mine} listings`, detail: `${r.added} added, ${r.updated} updated.${r.note ? ' ' + r.note : ''}` });
    return r;
  });
  res.status(202).json({ jobId: job.id });
});

// Mirror the dealer's own website into the inventory (background job with progress).
app.post('/api/inventory/import-website', (req, res) => {
  if (!market.websiteAvailable()) return res.status(503).json({ error: 'No dealer website configured' });
  const job = jobs.create('import-website', async (progress) => {
    const r = await market.importFromWebsite({ onProgress: progress });
    store.audit.add({ action: 'Inventory refreshed from the website', module: 'Inventory', target: `${r.found} cars`, detail: `${r.added} added, ${r.updated} updated${r.delisted ? `, ${r.delisted} no longer listed` : ''}${r.relisted ? `, ${r.relisted} back on the lot` : ''}` });
    return r;
  });
  res.status(202).json({ jobId: job.id });
});

// Ad-hoc market search: the user types the car's specifications.
app.post('/api/market-check', async (req, res) => {
  const b = req.body || {};
  const num = (v) => { const n = parseInt(String(v == null ? '' : v).replace(/[^0-9]/g, ''), 10); return isNaN(n) ? 0 : n; };
  const car = {
    id: null, year: num(b.year), make: String(b.make || '').trim(), model: String(b.model || '').trim(), trim: String(b.trim || '').trim(), bodyStyle: String(b.bodyStyle || '').trim(),
    km: num(b.km), drivetrain: b.drivetrain || '', colour: b.colour || '', features: b.features || {}, listPrice: num(b.listPrice), totalCost: num(b.totalCost)
  };
  if (!car.year || !car.make || !car.model) return res.status(400).json({ error: 'Year, make and model are required' });
  try { await checkOrJob(car, b, 'Market search run', res); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/inventory/:id/price', (req, res) => {
  const c = store.inventory.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Car not found' });
  const price = Number(req.body.price);
  if (!price || price <= 0) return res.status(400).json({ error: 'Price must be a positive number' });
  const old = c.listPrice;
  c.priceHistory = (c.priceHistory || []).concat([{ at: new Date().toISOString(), from: old, to: price, reason: req.body.reason || 'Market check' }]);
  c.listPrice = price;
  store.inventory.save(c);
  store.audit.add({ action: 'Price changed', module: 'Inventory', target: `${c.year} ${c.make} ${c.model}`, detail: `$${(old || 0).toLocaleString('en-CA')} to $${price.toLocaleString('en-CA')}. ${req.body.reason || ''}`.trim() });
  res.json(withDerived(c));
});

app.post('/api/inventory/:id/offers', (req, res) => {
  const c = store.inventory.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Car not found' });
  const label = String(req.body.label || '').trim();
  if (!label) return res.status(400).json({ error: 'Offer text is required' });
  const offer = { id: 'o' + Date.now(), label, value: Number(req.body.value) || 0, at: new Date().toISOString() };
  c.offers = (c.offers || []).concat([offer]);
  store.inventory.save(c);
  store.audit.add({ action: 'Offer added', module: 'Inventory', target: `${c.year} ${c.make} ${c.model}`, detail: label });
  res.json(withDerived(c));
});

app.delete('/api/inventory/:id/offers/:offerId', (req, res) => {
  const c = store.inventory.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Car not found' });
  const before = (c.offers || []).length;
  c.offers = (c.offers || []).filter((o) => o.id !== req.params.offerId);
  if (c.offers.length === before) return res.status(404).json({ error: 'Offer not found' });
  store.inventory.save(c);
  store.audit.add({ action: 'Offer removed', module: 'Inventory', target: `${c.year} ${c.make} ${c.model}` });
  res.json(withDerived(c));
});

// Claude writes the pricing memo and listing copy from the latest analysis.
// Rewrite the AI recommendation and listing copy for a car (background job, polled by the client).
app.post('/api/inventory/:id/memo', (req, res) => {
  const c = store.inventory.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Car not found' });
  if (!ai.available()) return res.status(503).json({ error: 'AI is not configured. Set ANTHROPIC_API_KEY.' });
  const job = jobs.create('memo', async (progress) => {
    progress(10, 'Reading the comparables', 'writing');
    const result = await market.check(withDerived(c), { mode: req.body && req.body.mode, rewrite: true, onProgress: progress });
    if (result.aiMemoError) throw new Error(result.aiMemoError);
    store.audit.add({ action: 'AI recommendation rewritten', module: 'Market check', target: `${c.year} ${c.make} ${c.model}` });
    return result;
  });
  res.status(202).json({ jobId: job.id });
});

app.post('/api/assistant', async (req, res) => {
  const q = String((req.body || {}).question || '').trim();
  if (!q) return res.status(400).json({ error: 'Question is required' });
  if (!ai.available()) return res.status(503).json({ error: 'AI is not configured. Set ANTHROPIC_API_KEY.' });
  try {
    const inventory = store.inventory.all().map(withDerived).map((c) => ({ id: c.id, car: `${c.year} ${c.make} ${c.model} ${c.trim || ''}`.trim(), km: c.km, listPrice: c.listPrice, totalCost: c.totalCost, daysInStock: c.daysInStock, location: c.location, offers: (c.offers || []).map((o) => o.label), priceHistory: c.priceHistory || [] }));
    // Market statistics for every car that has a cached search (no new searches are triggered here).
    const marketChecks = [];
    for (const c of store.inventory.all().map(withDerived)) {
      const r = await market.check(c, { cacheOnly: true });
      if (r) marketChecks.push({ id: c.id, car: `${c.year} ${c.make} ${c.model}`, checkedAt: r.fetchedAt, comparables: r.stats.used, median: r.stats.median, low: r.stats.low, high: r.stats.high, pctVsMedian: r.stats.pctVsMedian, position: r.stats.position, rank: r.stats.rank, verdict: r.recommendation.verdict, targetPrice: r.recommendation.listAt, floor: r.recommendation.floor, ownListings: r.own.map((o) => ({ listedOn: o.sources || [o.source], price: o.price, daysOnMarket: o.daysOnMarket })) });
    }
    const answer = await ai.assistant(q, { inventory, marketChecks, audit: store.audit.all().slice(0, 40) }, DEALER);
    store.audit.add({ action: 'Assistant question', module: 'Assistant', target: q.slice(0, 80) });
    res.json({ answer });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/inventory/:id', (req, res) => {
  const c = store.inventory.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Car not found' });
  store.inventory.remove(c.id);
  store.audit.add({ action: 'Car removed from inventory', module: 'Inventory', target: `${c.year} ${c.make} ${c.model}` });
  res.json({ ok: true });
});

app.get('/api/audit', (req, res) => res.json(store.audit.all()));

app.get('/api/health', (req, res) => res.json({ ok: true, live: market.liveAvailable() }));

app.get('*', (req, res) => { res.set('Cache-Control', 'no-cache'); res.type('html').send(indexHtml()); });

const port = Number(process.env.PORT || 3000);
if (require.main === module) {
  app.listen(port, () => console.log(`Dealer console listening on ${port}. Live search: ${market.liveAvailable() ? 'on' : 'off (set APIFY_TOKEN)'}`));
}
module.exports = app;
