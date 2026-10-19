'use strict';
const path = require('path');
const express = require('express');
const store = require('./store');
const market = require('./market');
const pricing = require('./pricing');

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
  res.json({ dealer: DEALER, liveAvailable: market.liveAvailable(), features: pricing.FEATURES.map((f) => ({ key: f.key, label: f.label, value: f.value })), rates: pricing.RATES });
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
  const allowed = ['year', 'make', 'model', 'trim', 'km', 'drivetrain', 'colour', 'listPrice', 'purchasePrice', 'auctionFees', 'transport', 'reconditioning', 'features', 'location', 'stockNumber', 'source', 'image'];
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
    const result = await market.check(withDerived(c), { refresh: !!(req.body && req.body.refresh) });
    store.audit.add({ action: `Market check run (${result.source}${result.cached ? ', cached' : ''})`, module: 'Market check', target: `${c.year} ${c.make} ${c.model} ${c.trim || ''}`.trim(), detail: `${result.stats.used} comparables, median $${result.stats.median.toLocaleString('en-CA')}` });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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

app.get('/api/audit', (req, res) => res.json(store.audit.all()));

app.get('/api/health', (req, res) => res.json({ ok: true, live: market.liveAvailable() }));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

const port = Number(process.env.PORT || 3000);
if (require.main === module) {
  app.listen(port, () => console.log(`Dealer console listening on ${port}. Live search: ${market.liveAvailable() ? 'on' : 'off (set APIFY_TOKEN)'}`));
}
module.exports = app;
