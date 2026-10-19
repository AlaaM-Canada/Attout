'use strict';
// Orchestrates a market check: pick the source, cache the raw listings, run the pricing engine.
const store = require('./store');
const pricing = require('./pricing');
const apify = require('./adapters/apify');
const sample = require('./adapters/sample');

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

async function check(car, opts) {
  const data = await fetchListings(car, opts);
  const analysis = pricing.analyze(car, data.listings);
  return Object.assign({ car, source: data.source, sourceLabel: data.sourceLabel, cached: data.cached, fetchedAt: data.fetchedAt, error: data.error || null, liveAvailable: liveAvailable() }, analysis);
}

module.exports = { check, fetchListings, liveAvailable, cacheKey };
