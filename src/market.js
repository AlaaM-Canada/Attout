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

async function fetchListings(car, opts) {
  const o = opts || {};
  const key = cacheKey(car);
  if (!o.refresh) {
    const hit = store.cache.get(key, CACHE_MS);
    if (hit) return Object.assign({ cached: true, fetchedAt: hit.at }, hit.value);
  }
  if (liveAvailable()) {
    try {
      const r = await apify.search(car, o);
      const value = { source: 'live', sourceLabel: 'Live search: AutoTrader.ca, Kijiji and CarGurus.ca via Apify', input: r.input, raw: r.raw, listings: r.listings };
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
  const data = await fetchListings(car, opts);
  const isOwn = ownMatcher();
  data.listings.forEach((l) => { l.isOwn = isOwn(l); });
  const en = await enrich(car, data);
  const analysis = pricing.analyze(car, en.listings, (opts || {}).mode);
  return Object.assign({ car, source: data.source, sourceLabel: data.sourceLabel, cached: data.cached, fetchedAt: data.fetchedAt, error: data.error || null, liveAvailable: liveAvailable(), aiRead: en.aiRead, aiError: en.aiError, aiAvailable: ai.available() }, analysis);
}

module.exports = { check, fetchListings, liveAvailable, cacheKey };
