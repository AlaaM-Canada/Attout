'use strict';
// Orchestrates a market check: pick the source, cache the raw listings, run the pricing engine.
const store = require('./store');
const pricing = require('./pricing');
const apify = require('./adapters/apify');
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
  const key = cacheKey(car) + '|ai|' + [car.trim, car.bodyStyle].join(' ').toLowerCase();
  const hit = store.cache.get(key, CACHE_MS);
  if (hit && hit.value.fetchedAt === data.fetchedAt) return { listings: hit.value.listings, aiRead: true, aiError: null };
  try {
    const listings = await ai.extractListings(car, data.listings);
    store.cache.set(key, { fetchedAt: data.fetchedAt, listings });
    return { listings, aiRead: true, aiError: null };
  } catch (e) { return { listings: data.listings, aiRead: false, aiError: e.message }; }
}

async function check(car, opts) {
  const o = opts || {};
  const data = await fetchListings(car, o);
  if (!data) return null;
  const isOwn = ownMatcher();
  data.listings.forEach((l) => { l.isOwn = isOwn(l); });
  if (o.onProgress) o.onProgress(88, 'Reading the listings', 'reading');
  const en = await enrich(car, data);
  if (o.onProgress) o.onProgress(96, 'Matching and pricing', 'pricing');
  const analysis = pricing.analyze(car, en.listings, (opts || {}).mode);
  return Object.assign({ car, source: data.source, sourceLabel: data.sourceLabel, cached: data.cached, fetchedAt: data.fetchedAt, error: data.error || null, liveAvailable: liveAvailable(), aiRead: en.aiRead, aiError: en.aiError, aiAvailable: ai.available() }, analysis);
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
  return { found: r.listings.length, mine: mine.length, added, updated };
}

module.exports = { check, fetchListings, hasCache, liveAvailable, cacheKey, importOwnListings };
