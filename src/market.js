'use strict';
// Orchestrates a market check: pick the source, cache the raw listings, run the pricing engine.
const store = require('./store');
const pricing = require('./pricing');
const apify = require('./adapters/apify');
const website = require('./adapters/website');
const sample = require('./adapters/sample');
const ai = require('./ai');

const CACHE_MS = Number(process.env.CACHE_HOURS || 6) * 3600 * 1000;

function cacheKey(car) {
  return ['v1', car.make, car.model, car.year, process.env.DEALER_POSTAL_CODE || 'M1R 2Y5', process.env.SEARCH_RADIUS_KM || 100].join('|').toLowerCase();
}

function liveAvailable() { return !!process.env.APIFY_TOKEN; }

function hasCache(car) { return !!store.cache.get(cacheKey(car), CACHE_MS); }

async function fetchListings(car, opts) {
  const o = opts || {};
  const key = cacheKey(car);
  if (!o.refresh) {
    const hit = store.cache.get(key, o.cacheOnly ? 7 * 24 * 3600 * 1000 : CACHE_MS);
    if (hit) return Object.assign({ cached: true, fetchedAt: hit.at }, hit.value);
  }
  if (o.cacheOnly && liveAvailable()) return null;
  if (o.cacheOnly) o.skipMemo = true;
  if (liveAvailable()) {
    try {
      const r = o.onProgress ? await apify.searchWithProgress(apify.buildInput(car, o), o.onProgress) : await apify.search(car, o);
      const value = { source: 'live', sourceLabel: 'Live market search', input: r.input, raw: r.raw, listings: r.listings };
      store.cache.set(key, value);
      return Object.assign({ cached: false, fetchedAt: new Date().toISOString() }, value);
    } catch (e) {
      const r = await sample.search(car);
      return { cached: false, fetchedAt: new Date().toISOString(), source: 'sample', sourceLabel: 'Live search failed, showing sample data. ' + e.message, listings: r.listings, error: e.message };
    }
  }
  const r = await sample.search(car);
  return { cached: false, fetchedAt: new Date().toISOString(), source: 'sample', sourceLabel: r.sampleNote, listings: r.listings };
}

function ownMatcher() {
  const names = [process.env.DEALER_NAME || 'Canadian Fine Motors'].concat((process.env.DEALER_ALIASES || '').split(',')).map((n) => n.trim().toLowerCase()).filter(Boolean);
  return (l) => {
    const seller = String(l.seller || '').toLowerCase();
    if (!seller) return false;
    return names.some((n) => seller.includes(n) || (n.split(' ').length >= 2 && seller.includes(n.split(' ').slice(0, 2).join(' '))));
  };
}

async function enrich(car, data) {
  // Ask Claude to read the listings once per car and keep the result with the cache.
  if (!ai.available() || !data.listings.length) return { listings: data.listings, aiRead: false, aiError: null };
  const key = cacheKey(car) + '|ai2|' + [car.trim, car.bodyStyle].join(' ').toLowerCase();
  const hit = store.cache.get(key, CACHE_MS);
  if (hit && hit.value.fetchedAt === data.fetchedAt) return { listings: hit.value.listings, aiRead: true, aiError: null };
  try {
    const listings = await ai.extractListings(car, data.listings);
    store.cache.set(key, { fetchedAt: data.fetchedAt, listings });
    return { listings, aiRead: true, aiError: null };
  } catch (e) { return { listings: data.listings, aiRead: false, aiError: e.message }; }
}

function memoKey(car, mode, fetchedAt) { return cacheKey(car) + '|memo|' + [car.id || car.trim, mode, car.listPrice, car.totalCost, fetchedAt].join('|'); }
function memoCached(car, mode) {
  const hit = store.cache.get(cacheKey(car), CACHE_MS);
  return !!(hit && store.cache.get(memoKey(car, mode || 'close', hit.at), CACHE_MS));
}

// Claude writes the recommendation and listing copy; cached per car, mode, price and search.
async function writeMemo(car, analysis, fetchedAt, dealer, force) {
  if (!ai.available()) return { ai: null, aiMemoError: null };
  const key = memoKey(car, analysis.mode, fetchedAt);
  if (!force) { const hit = store.cache.get(key, CACHE_MS); if (hit) return { ai: hit.value, aiMemoError: null }; }
  try {
    const out = await ai.memoAndCopy(car, analysis, dealer);
    store.cache.set(key, out);
    return { ai: out, aiMemoError: null };
  } catch (e) { return { ai: null, aiMemoError: e.message }; }
}

const DEALER = { name: process.env.DEALER_NAME || 'Canadian Fine Motors', city: process.env.DEALER_CITY || 'Scarborough, ON' };

async function check(car, opts) {
  const o = opts || {};
  const data = await fetchListings(car, o);
  if (!data) return null;
  const isOwn = ownMatcher();
  const vin = String(car.vin || '').toUpperCase();
  // One record per car (the same car on two sites is read, matched and counted once).
  data.listings = pricing.groupListings(data.listings);
  data.listings.forEach((l) => { l.isOwn = isOwn(l) || (!!vin && String(l.vin || '').toUpperCase() === vin); });
  if (o.onProgress) o.onProgress(80, 'Reading the listings', 'reading');
  const en = await enrich(car, data);
  if (o.onProgress) o.onProgress(90, 'Matching and pricing', 'pricing');
  const analysis = pricing.analyze(car, en.listings, o.mode);
  let memo = { ai: null, aiMemoError: null };
  if (!o.skipMemo) {
    if (o.onProgress) o.onProgress(93, 'Writing the recommendation', 'writing');
    memo = await writeMemo(car, analysis, data.fetchedAt, DEALER, !!o.rewrite);
  }
  return Object.assign({ car, source: data.source, sourceLabel: data.sourceLabel, cached: data.cached, fetchedAt: data.fetchedAt, error: data.error || null, liveAvailable: liveAvailable(), aiRead: en.aiRead, aiError: en.aiError, aiAvailable: ai.available() }, analysis, memo);
}

// Pull the dealer's own listings from one site (AutoTrader by default) and merge them into inventory.
async function importOwnListings(opts) {
  const o = opts || {};
  if (!liveAvailable()) throw new Error('Live search is off (no APIFY_TOKEN)');
  const input = apify.dealerInput(o);
  const r = await apify.searchWithProgress(input, o.onProgress || (() => {}));
  const isOwn = ownMatcher();
  const mine = r.listings.filter(isOwn);
  if (o.onProgress) o.onProgress(92, `${mine.length} of ${r.listings.length} listings belong to the dealer`, 'merging');
  const existing = store.inventory.all();
  const bodyOf = (b) => { const t = String(b || '').toLowerCase(); return /coupe/.test(t) ? 'Coupe' : /sedan/.test(t) ? 'Sedan' : /convertible|cabrio/.test(t) ? 'Convertible' : /wagon/.test(t) ? 'Wagon' : /hatch/.test(t) ? 'Hatchback' : /truck|pickup/.test(t) ? 'Pickup' : ''; };
  let added = 0, updated = 0;
  mine.forEach((l) => {
    const key = l.vin ? 'vin:' + l.vin : 'id:' + l.id.replace(/-[^-]+$/, '');
    let car = existing.find((c) => (l.vin && c.vin === l.vin) || c.importKey === key)
      || existing.find((c) => c.year === l.year && String(c.make).toLowerCase() === String(l.make).toLowerCase() && String(c.model).toLowerCase() === String(l.model).toLowerCase() && c.km && l.km && Math.abs(c.km - l.km) <= Math.max(500, c.km * 0.01));
    const fresh = { year: l.year, make: l.make, model: l.model, trim: l.trim || '', bodyStyle: bodyOf(l.body), km: l.km, drivetrain: l.drivetrain || '', colour: l.colour || '', transmission: l.transmission || '',
      listPrice: l.price, image: l.image || null, listingUrl: l.url || null, listedDays: l.daysOnMarket, listingHeadline: l.headline || '', vin: l.vin || null, importKey: key, importedAt: new Date().toISOString(), importSource: l.source };
    if (car) {
      const before = car.listPrice;
      Object.assign(car, fresh, { features: Object.assign({}, pricing.featuresFromText(`${l.trim} ${l.title} ${l.headline}`), car.features || {}) });
      if (before !== car.listPrice) car.priceHistory = (car.priceHistory || []).concat([{ at: new Date().toISOString(), from: before, to: car.listPrice, reason: 'Synced from ' + l.source }]);
      updated += 1;
    } else {
      car = Object.assign({ id: 'at-' + Math.random().toString(36).slice(2, 8), stockNumber: l.stockNumber || '', purchasePrice: 0, auctionFees: 0, transport: 0, reconditioning: 0, purchasedAt: null, location: 'Main lot', source: 'Imported from ' + l.source, offers: [], features: pricing.featuresFromText(`${l.trim} ${l.title} ${l.headline}`) }, fresh);
      added += 1;
    }
    store.inventory.save(car);
  });
  // Who the other listings belong to, so an empty import can be explained (and checked) instead of guessed at.
  const sellers = {};
  r.listings.forEach((l) => { const n = l.seller || (l.sellerType === 'private' ? 'Private seller' : 'Seller not named'); sellers[n] = (sellers[n] || 0) + 1; });
  const radius = input.radius_km;
  const note = mine.length ? '' : (r.listings.length
    ? `${r.listings.length} listings came back within ${radius} km of ${input.postal_code}, none from ${DEALER.name}. Sellers: ${Object.keys(sellers).map((k) => `${k} (${sellers[k]})`).join(', ')}.`
    : `No listings came back within ${radius} km of ${input.postal_code}.`);
  return { found: r.listings.length, mine: mine.length, added, updated, sellers, note, error: r.error || null };
}

// Mirror the dealer's own website into the inventory: every car on the lot, keyed by VIN.
async function importFromWebsite(opts) {
  const o = opts || {};
  if (!website.available()) throw new Error('No dealer website configured (DEALER_WEBSITE)');
  const cars = await website.fetchInventory(o.onProgress);
  if (!cars.length) throw new Error('The website returned no vehicles; the page layout may have changed.');
  if (o.onProgress) o.onProgress(88, `${cars.length} cars on the website; updating the inventory`, 'merging');
  const existing = store.inventory.all();
  const now = new Date().toISOString();
  let added = 0, updated = 0, relisted = 0;
  const seenIds = new Set();
  cars.forEach((w) => {
    const key = 'site:' + w.siteId;
    let car = (w.vin && existing.find((c) => String(c.vin || '').toUpperCase() === w.vin)) || existing.find((c) => c.importKey === key || c.websiteId === w.siteId);
    const fresh = { year: w.year, make: w.make, model: w.model, trim: w.trim, bodyStyle: w.bodyStyle || '', km: w.km, transmission: w.transmission || '',
      listPrice: w.cashPrice, financePrice: w.financePrice || 0, image: w.image || null, websiteUrl: w.url, websiteId: w.siteId, listingHeadline: w.headline, vin: w.vin || null, stockNumber: w.stockNumber || '',
      importedAt: now, importSource: 'canadianfinemotors.ca', delisted: false };
    const feats = pricing.featuresFromText(`${w.trim} ${w.title} ${w.headline}`);
    if (car) {
      const before = car.listPrice;
      if (car.delisted) relisted += 1;
      // Keep what the website does not know: costs, offers, AutoTrader link and days, body style already entered.
      Object.assign(car, fresh, { bodyStyle: w.bodyStyle || car.bodyStyle || '', features: Object.assign({}, feats, car.features || {}) });
      if (before && before !== car.listPrice) car.priceHistory = (car.priceHistory || []).concat([{ at: now, from: before, to: car.listPrice, reason: 'Synced from the website' }]);
      updated += 1;
    } else {
      car = Object.assign({ id: 'cf-' + Math.random().toString(36).slice(2, 8), purchasePrice: 0, auctionFees: 0, transport: 0, reconditioning: 0, purchasedAt: null, location: 'Main lot', source: 'Imported from the website', offers: [], features: feats, importKey: key }, fresh);
      added += 1;
    }
    seenIds.add(car.id);
    store.inventory.save(car);
  });
  // Cars that were on the website before and are not any more are most likely sold: keep them, flagged.
  let delisted = 0;
  store.inventory.all().forEach((c) => {
    if (c.websiteId && !seenIds.has(c.id) && !c.delisted) { c.delisted = true; c.delistedAt = now; store.inventory.save(c); delisted += 1; }
  });
  return { found: cars.length, added, updated, relisted, delisted, source: website.BASE };
}

module.exports = { check, fetchListings, hasCache, memoCached, liveAvailable, cacheKey, importOwnListings, importFromWebsite, websiteAvailable: website.available, websiteBase: website.BASE };
