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
  assert.strictEqual(pricing.classify(x3, { trim: 'M40i', title: '2019 BMW X3 M40i', headline: '' }).level, 'different');
  assert.strictEqual(pricing.classify(x3, { trim: 'xDrive30i AWD', title: '', headline: '' }).level, 'exact');
  assert.strictEqual(pricing.classify(x3, { trim: '', title: '2019 BMW X3', headline: 'premium package' }).level, 'similar');
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

test('body style and variant matching for a Porsche Cayenne Coupe', () => {
  const car = { year: 2021, make: 'Porsche', model: 'Cayenne', trim: 'GTS', bodyStyle: 'Coupe', km: 40000, features: {} };
  assert.strictEqual(pricing.classify(car, { trim: 'GTS Coupe', title: '2021 Porsche Cayenne GTS Coupe', headline: '' }).level, 'exact');
  assert.strictEqual(pricing.classify(car, { trim: 'GTS', title: '2021 Porsche Cayenne GTS', headline: 'sport chrono' }).level, 'close');
  assert.strictEqual(pricing.classify(car, { trim: '', title: '2021 Porsche Cayenne', headline: '' }).level, 'similar');
  assert.strictEqual(pricing.classify(car, { trim: 'Coupe', title: '2021 Porsche Cayenne Coupe', headline: '' }).level, 'similar');
  assert.strictEqual(pricing.classify(car, { trim: 'Turbo Coupe', title: '2021 Porsche Cayenne Turbo Coupe', headline: '' }).level, 'different');
  assert.strictEqual(pricing.classify(car, { trim: 'E-Hybrid', title: '2021 Porsche Cayenne E-Hybrid', headline: '' }).level, 'different');
});

test('mode widens automatically when too few exact matches', async () => {
  const car = { year: 2019, make: 'BMW', model: 'X3', trim: 'xDrive30i Sport package', km: 98000, listPrice: 24900, totalCost: 20600, features: {} };
  const r = await sample.search(car);
  const a = pricing.analyze(car, r.listings, 'exact');
  assert.ok(a.counts.exact < 3);
  assert.notStrictEqual(a.mode, 'exact');
  assert.ok(a.modeNote.length > 0);
  assert.ok(a.stats.used >= 3);
  assert.strictEqual(a.buckets.length, 6);
});

test('A4 allroad is a different variant of an A4 sedan, even when only the model field says so', () => {
  const a4 = { year: 2017, make: 'Audi', model: 'A4', trim: '2.0 Technik Quattro', bodyStyle: 'Sedan', km: 216399, features: {} };
  assert.strictEqual(pricing.classify(a4, { model: 'A4 allroad', trim: 'Technik', title: '2017 Audi A4 allroad', headline: '' }).level, 'different');
  assert.strictEqual(pricing.classify(a4, { model: 'A4', trim: 'Technik quattro', title: '2017 Audi A4 Technik', headline: '' }).level, 'close');
  assert.strictEqual(pricing.classify(a4, { model: 'A4', trim: '2.0T quattro Technik', title: '2017 Audi A4 Sedan 2.0 Technik', headline: '' }).level, 'exact');
});

test('own listings are separated and the verdict reflects the current price', async () => {
  const a4 = { year: 2017, make: 'Audi', model: 'A4', trim: '2.0 Technik Quattro', bodyStyle: 'Sedan', km: 216399, listPrice: 8888, totalCost: 7750, features: {} };
  const r = await sample.search(a4);
  const own = { id: 'own', source: 'AutoTrader.ca', title: '2017 Audi A4', trim: 'Technik', model: 'A4', price: 8888, km: 216399, year: 2017, seller: 'Canadian Fine Motors Inc', daysOnMarket: 11, isOwn: true };
  const a = pricing.analyze(a4, r.listings.concat([own]), 'close');
  assert.strictEqual(a.own.length, 1);
  assert.strictEqual(a.stats.total, r.listings.length);
  assert.strictEqual(a.recommendation.isListed, true);
  assert.strictEqual(a.recommendation.listedFor, 11);
  assert.ok(['raise', 'lower', 'keep'].includes(a.recommendation.verdict));
  assert.ok(a.stats.rank >= 1);
});

test('AI variant judgement overrides the rules when present', () => {
  const car = { year: 2021, make: 'Porsche', model: 'Cayenne', trim: 'GTS', bodyStyle: 'Coupe', km: 40000, features: {} };
  assert.strictEqual(pricing.classify(car, { trim: 'GTS Coupe', title: '2021 Porsche Cayenne GTS Coupe', headline: '', aiSameVariant: false, aiVariant: 'GTS Coupe with GT package' }).level, 'different');
  assert.strictEqual(pricing.classify(car, { trim: 'GTS Coupe', title: '2021 Porsche Cayenne GTS Coupe', headline: '', aiSameVariant: true }).level, 'exact');
});

test('ai module is off without a key and the memo endpoint says so', async () => {
  const ai = require('../src/ai');
  delete process.env.ANTHROPIC_API_KEY;
  assert.strictEqual(ai.available(), false);
  await assert.rejects(ai.assistant('x', {}, { name: 'd' }), /ANTHROPIC_API_KEY/);
});

test('AI replies with broken JSON or prose formatting are still read', () => {
  const ai = require('../src/ai');
  const broken = '```json\n[{"i":0,"trim":"Progressiv","matchLevel":"exact","reason":"one trim\nbelow Technik"},{"i":1,"trim":"Tech "quoted" nik","matchLevel":"close","reason":"x"},{"i":2,"trim":"GTS","matchLevel":"different","reason":"Turbo",}]\n```';
  const out = ai.parseJson(broken);
  assert.ok(Array.isArray(out) && out.length >= 2, 'salvaged ' + out.length);
  assert.strictEqual(out[0].matchLevel, 'exact');
  const sec = ai.parseSections('Sure.\n===MEMO===\nLine one.\nLine "two".\n===HEADLINE===\n2019 Audi A7 Technik\n===DESCRIPTION===\nClean CarFax.', ['MEMO', 'HEADLINE', 'DESCRIPTION']);
  assert.strictEqual(sec.memo, 'Line one.\nLine "two".');
  assert.strictEqual(sec.headline, '2019 Audi A7 Technik');
  assert.strictEqual(sec.description, 'Clean CarFax.');
  const loose = ai.parseSections('Just a memo with no markers.', ['MEMO', 'HEADLINE', 'DESCRIPTION']);
  assert.strictEqual(loose.memo, 'Just a memo with no markers.');
});

test('the same car on several sites becomes one record with a button per site', () => {
  const mk = (id, source, url, price, days, extra) => Object.assign({ id, source, url, price, daysOnMarket: days, year: 2016, make: 'BMW', model: 'M6', km: 65191, seller: 'BMW Autohaus', title: '2016 BMW M6', trim: 'Ultimate' }, extra || {});
  const grouped = pricing.groupListings([
    mk('v1-AutoTrader.ca', 'AutoTrader.ca', 'https://a/1', 55888, 25),
    mk('v1-CarGurus.ca', 'CarGurus.ca', 'https://c/1', 55500, 30),
    mk('v9-Kijiji', 'Kijiji', 'https://k/9', 55888, 12, { id: 'v9-Kijiji', km: 65300 }),
    mk('v2-AutoTrader.ca', 'AutoTrader.ca', 'https://a/2', 61000, 40, { seller: 'Other Motors', km: 40000 })
  ]);
  assert.strictEqual(grouped.length, 2, 'two cars');
  const car = grouped[0];
  assert.deepStrictEqual(car.sources, ['AutoTrader.ca', 'Kijiji', 'CarGurus.ca']);
  assert.strictEqual(car.sites.length, 3);
  assert.strictEqual(car.price, 55500, 'lowest price across sites');
  assert.strictEqual(car.daysOnMarket, 30, 'longest listed');
  assert.strictEqual(car.url, 'https://a/1');
  const a = pricing.analyze({ year: 2016, make: 'BMW', model: 'M6', trim: 'Ultimate', km: 60000, listPrice: 36998, features: {} }, grouped, 'broad');
  assert.strictEqual(a.stats.total, 2, 'statistics count cars, not site listings');
  assert.deepStrictEqual(a.stats.bySource, { 'AutoTrader.ca': 2, Kijiji: 1, 'CarGurus.ca': 1 });
  // Grouping twice changes nothing.
  assert.strictEqual(pricing.groupListings(grouped).length, 2);
  assert.strictEqual(pricing.groupListings(grouped)[0].sites.length, 3);
});

test('CarGurus links open the car page, not the search page', () => {
  const { cleanUrl } = require('../src/links');
  assert.strictEqual(cleanUrl('CarGurus.ca', 'https://www.cargurus.ca/Cars/inventorylisting/viewDetailsFilterViewInventoryListing.action?inventoryListing=462025693'), 'https://www.cargurus.ca/details/462025693');
  assert.strictEqual(cleanUrl('CarGurus.ca', 'https://www.cargurus.ca/Cars/inventorylisting/vdp.action?listingId=1#x'), 'https://www.cargurus.ca/details/1');
  assert.strictEqual(cleanUrl('CarGurus.ca', 'https://www.cargurus.ca/details/5?searchUuid=abc'), 'https://www.cargurus.ca/details/5');
  const at = 'https://www.autotrader.ca/offers/honda-accord-touring-cat_ma31-7e66225d';
  assert.strictEqual(cleanUrl('AutoTrader.ca', at), at);
  assert.strictEqual(cleanUrl('Kijiji', null), null);
  // Cached results from before the fix are corrected when they are grouped.
  const g = pricing.groupListings([{ id: 'v1-CarGurus.ca', source: 'CarGurus.ca', url: 'https://www.cargurus.ca/Cars/inventorylisting/viewDetailsFilterViewInventoryListing.action?inventoryListing=99', price: 1, year: 2018, make: 'Honda', model: 'Accord', km: 1000, seller: 'X' }]);
  assert.strictEqual(g[0].url, 'https://www.cargurus.ca/details/99');
  assert.strictEqual(g[0].sites[0].url, 'https://www.cargurus.ca/details/99');
});
