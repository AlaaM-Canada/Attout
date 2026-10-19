'use strict';
const test = require('node:test');
const assert = require('node:assert');
const pricing = require('../src/pricing');
const apify = require('../src/adapters/apify');
const sample = require('../src/adapters/sample');

const x3 = { id: 'x3', year: 2019, make: 'BMW', model: 'X3', trim: 'xDrive30i', km: 98000, listPrice: 24900, totalCost: 20600, features: { heated: true, carplay: true, pano: true, accident: true } };

test('X3 sample analysis matches the hand-checked numbers', async () => {
  const r = await sample.search(x3);
  const a = pricing.analyze(x3, r.listings);
  assert.strictEqual(a.stats.total, 17);
  assert.strictEqual(a.stats.excluded, 1, 'the M40i is excluded');
  assert.strictEqual(a.stats.used, 16);
  assert.ok(a.stats.median > 22000 && a.stats.median < 23500, 'median ' + a.stats.median);
  assert.strictEqual(a.stats.position, 'above');
  assert.ok(a.recommendation.listAt < a.stats.median);
  assert.ok(a.recommendation.floor >= x3.totalCost + 800);
  assert.ok(a.advantages.some((x) => x.label === 'Accident-free'));
});

test('classify excludes performance variants and keeps trim family', () => {
  assert.strictEqual(pricing.classify(x3, { trim: 'M40i', title: '2019 BMW X3 M40i', headline: '' }), 'different');
  assert.strictEqual(pricing.classify(x3, { trim: 'xDrive30i AWD', title: '', headline: '' }), 'close');
  assert.strictEqual(pricing.classify(x3, { trim: '', title: '2019 BMW X3', headline: 'premium package' }), 'similar');
});

test('adjust accounts for km, year and features', () => {
  const a = pricing.adjust(x3, { price: 20000, km: 118000, year: 2018, trim: '', title: '', headline: 'navigation leather', knownFeatures: {} });
  // +20,000 km * 0.06 = +1200; one year older = +1200; listing has nav (600) and leather (700) that the X3 lacks = -1300
  assert.strictEqual(a.equivalent, 20000 + 1200 + 1200 - 1300);
  assert.deepStrictEqual(a.notes, ['has navigation', 'has leather seats']);
});

test('apify normalizer splits one vehicle into one record per site', () => {
  const items = [{
    vehicle_id: 'v1', title: '2017 Audi A4 Technik', year: 2017, make: 'Audi', model: 'A4', trim: 'Technik', mileage_km: 150000, price: 14499,
    autotrader_url: 'https://www.autotrader.ca/a/1', autotrader_price: 14499, kijiji_url: 'https://www.kijiji.ca/v/2', kijiji_price: 14299,
    seller_name: 'BMW Kingston', seller_type: 'dealer', city: 'Kingston', distance_km: 240, image_url: 'https://img/x.jpg', deal_rating: 'Fair price', days_on_market: 12, price_drop: true
  }, { vehicle_id: 'v2', title: 'No price', price: null, autotrader_url: 'https://x' }];
  const out = apify.normalize(items);
  assert.strictEqual(out.length, 2);
  assert.deepStrictEqual(out.map((o) => o.source), ['AutoTrader.ca', 'Kijiji']);
  assert.strictEqual(out[1].price, 14299);
  assert.strictEqual(out[0].url, 'https://www.autotrader.ca/a/1');
  assert.strictEqual(out[0].priceDrop, true);
});

test('apify input is built from the car', () => {
  const inp = apify.buildInput({ year: 2017, make: 'Audi', model: 'A4' }, {});
  assert.deepStrictEqual(inp.vehicles, ['Audi A4']);
  assert.strictEqual(inp.year_from, 2016);
  assert.strictEqual(inp.year_to, 2018);
  assert.deepStrictEqual(inp.sources, ['autotrader', 'kijiji', 'cargurus']);
});
