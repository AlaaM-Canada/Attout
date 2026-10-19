'use strict';
const path = require('path');
const express = require('express');
const store = require('./store');
const market = require('./market');
const pricing = require('./pricing');
const ai = require('./ai');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const DEALER = {
  name: process.env.DEALER_NAME || 'Canadian Fine Motors',
  city: process.env.DEALER_CITY || 'Scarborough, ON',
  postalCode: process.env.DEALER_POSTAL_CODE || 'M1R 2Y5'
};

function totalCost(c) { return (c.purchasePrice || 0) + (c.auctionFees || 0) + (c.transport || 0) + (c.reconditioning || 0); }
function withDerived(c) {
  const days = c.purchasedAt ? Math.max(0, Math.round((Date.now() - new Date(c.purchasedAt).getTime()) / 86400000)) : null;
  return Object.assign({}, c, { totalCost: totalCost(c), daysInStock: days });
}

app.get('/api/config', (req, res) => {
  res.json({ dealer: DEALER, liveAvailable: market.liveAvailable(), aiAvailable: ai.available(), aiModel: ai.MODEL, features: pricing.FEATURES.map((f) => ({ key: f.key, label: f.label, value: f.value })), rates: pricing.RATES });
});

app.get('/api/inventory', (req, res) => res.json(store.inventory.all().map(withDerived)));

app.get('/api/inventory/:id', (req, res) => {
  const c = store.inventory.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Car not found' });
  res.json(withDerived(c));
});

app.put('/api/inventory/:id', (req, res) => {
  const c = store.inventory.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Car not found' });
  const allowed = ['year', 'make', 'model', 'trim', 'bodyStyle', 'km', 'drivetrain', 'colour', 'listPrice', 'purchasePrice', 'auctionFees', 'transport', 'reconditioning', 'features', 'location', 'stockNumber', 'source', 'image'];
  allowed.forEach((k) => { if (req.body[k] !== undefined) c[k] = req.body[k]; });
  store.inventory.save(c);
  store.audit.add({ action: 'Car updated', module: 'Inventory', target: `${c.year} ${c.make} ${c.model}` });
  res.json(withDerived(c));
});

// The core flow: pick a car, search the market, get statistics and a recommendation.
app.post('/api/inventory/:id/market-check', async (req, res) => {
  const c = store.inventory.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Car not found' });
  try {
    const result = await market.check(withDerived(c), { refresh: !!(req.body && req.body.refresh), mode: req.body && req.body.mode });
    store.audit.add({ action: `Market check run (${result.source}${result.cached ? ', cached' : ''})`, module: 'Market check', target: `${c.year} ${c.make} ${c.model} ${c.trim || ''}`.trim(), detail: `${result.stats.used} comparables, median $${result.stats.median.toLocaleString('en-CA')}` });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
  try {
    const result = await market.check(car, { refresh: !!b.refresh, mode: b.mode });
    store.audit.add({ action: `Market search run (${result.source}${result.cached ? ', cached' : ''})`, module: 'Market check', target: `${car.year} ${car.make} ${car.model} ${car.trim}`.trim(), detail: `${result.stats.used} comparables, median $${result.stats.median.toLocaleString('en-CA')}` });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
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
app.post('/api/inventory/:id/memo', async (req, res) => {
  const c = store.inventory.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Car not found' });
  if (!ai.available()) return res.status(503).json({ error: 'AI is not configured. Set ANTHROPIC_API_KEY.' });
  try {
    const analysis = await market.check(withDerived(c), { mode: req.body && req.body.mode });
    const out = await ai.memoAndCopy(withDerived(c), analysis, DEALER);
    store.audit.add({ action: 'AI memo and listing copy written', module: 'Market check', target: `${c.year} ${c.make} ${c.model}` });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/assistant', async (req, res) => {
  const q = String((req.body || {}).question || '').trim();
  if (!q) return res.status(400).json({ error: 'Question is required' });
  if (!ai.available()) return res.status(503).json({ error: 'AI is not configured. Set ANTHROPIC_API_KEY.' });
  try {
    const inventory = store.inventory.all().map(withDerived).map((c) => ({ id: c.id, car: `${c.year} ${c.make} ${c.model} ${c.trim || ''}`.trim(), km: c.km, listPrice: c.listPrice, totalCost: c.totalCost, daysInStock: c.daysInStock, location: c.location, offers: (c.offers || []).map((o) => o.label), priceHistory: c.priceHistory || [] }));
    const marketChecks = [];
    store.cache.keys().forEach((k) => { if (k.indexOf('|ai|') === -1) { const hit = store.cache.get(k, 7 * 24 * 3600 * 1000); if (hit && hit.value && hit.value.listings) marketChecks.push({ key: k, fetchedAt: hit.at, listings: hit.value.listings.length, prices: hit.value.listings.map((l) => l.price).sort((a, b) => a - b) }); } });
    const answer = await ai.assistant(q, { inventory, marketChecks, audit: store.audit.all().slice(0, 40) }, DEALER);
    store.audit.add({ action: 'Assistant question', module: 'Assistant', target: q.slice(0, 80) });
    res.json({ answer });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/audit', (req, res) => res.json(store.audit.all()));

app.get('/api/health', (req, res) => res.json({ ok: true, live: market.liveAvailable() }));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

const port = Number(process.env.PORT || 3000);
if (require.main === module) {
  app.listen(port, () => console.log(`Dealer console listening on ${port}. Live search: ${market.liveAvailable() ? 'on' : 'off (set APIFY_TOKEN)'}`));
}
module.exports = app;
