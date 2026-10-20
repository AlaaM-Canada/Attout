'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'attout-test-'));
fs.writeFileSync(path.join(process.env.DATA_DIR, 'inventory.json'), '[]');
const website = require('../src/adapters/website');
const market = require('../src/market');
const store = require('../src/store');
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'website-page.html'), 'utf8');

test('the website inventory page is read into cars', () => {
  const cars = website.parseCards(fixture);
  assert.strictEqual(cars.length, 2);
  const q7 = cars[0];
  assert.deepStrictEqual([q7.year, q7.make, q7.model, q7.trim], [2018, 'Audi', 'Q7', 'Progressiv']);
  assert.strictEqual(q7.km, 109173);
  assert.strictEqual(q7.stockNumber, '027116');
  assert.strictEqual(q7.vin, 'WA1LAAF79JD027116');
  assert.strictEqual(q7.cashPrice, 20498, 'cash price, not the financing price');
  assert.strictEqual(q7.financePrice, 18998);
  assert.ok(q7.image.startsWith('https://images.carpages.ca/inventory/14988266') && q7.image.includes('&h=480'), 'lazy image with decoded entities');
  assert.strictEqual(q7.dealRating, 'Great Deal');
  const rr = cars[1];
  assert.deepStrictEqual([rr.make, rr.model, rr.trim], ['Land Rover', 'Range Rover Sport', 'HST AWD']);
  assert.strictEqual(rr.vin, 'SALWR2SU6MA700001', 'VIN upper-cased');
  assert.strictEqual(rr.financePrice, 0);
  assert.deepStrictEqual(website.splitTitle('2022 Mercedes-Benz GLC-Class'), { year: 2022, make: 'Mercedes-Benz', model: 'GLC-Class' });
});

test('importing from the website merges by VIN, keeps costs and flags cars that left the lot', async () => {
  // A car already in the inventory (say from AutoTrader) with a cost entered.
  store.inventory.save({ id: 'at-1', year: 2018, make: 'Audi', model: 'Q7', km: 109000, listPrice: 21000, purchasePrice: 15000, vin: 'WA1LAAF79JD027116', listingUrl: 'https://www.autotrader.ca/x', listedDays: 12, features: { nav: true }, offers: [] });
  store.inventory.save({ id: 'cf-old', year: 2015, make: 'BMW', model: 'X1', km: 1, listPrice: 9000, websiteId: '1', importKey: 'site:1', features: {}, offers: [] });
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    const u = String(url);
    const body = /dsp_page=1(&|$)/.test(u) && !/category=[^6]/.test(u) ? fixture : '<html></html>';
    return { ok: true, status: 200, text: async () => body };
  };
  const progress = [];
  const r = await market.importFromWebsite({ onProgress: (pct, msg) => progress.push([pct, msg]) });
  assert.deepStrictEqual([r.found, r.added, r.updated, r.delisted], [2, 1, 1, 1]);
  const q7 = store.inventory.all().find((c) => c.vin === 'WA1LAAF79JD027116');
  assert.strictEqual(q7.id, 'at-1', 'matched the existing car by VIN');
  assert.strictEqual(q7.listPrice, 20498);
  assert.strictEqual(q7.purchasePrice, 15000, 'cost kept');
  assert.strictEqual(q7.listingUrl, 'https://www.autotrader.ca/x', 'AutoTrader link kept');
  assert.strictEqual(q7.bodyStyle, 'SUV', 'body style from the category page');
  assert.strictEqual(q7.priceHistory.length, 1);
  assert.ok(store.inventory.all().find((c) => c.id === 'cf-old').delisted, 'car no longer on the website is flagged');
  assert.ok(progress.some((p) => /cars read from the website/.test(p[1])));
  assert.ok(calls.some((u) => /category=2/.test(u)), 'category pages read for body styles');
});
