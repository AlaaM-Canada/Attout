'use strict';
// Listings source: Apify actor "fayoussef/canada-car-scraper" (AutoTrader.ca, Kijiji, CarGurus.ca).
// This is the demo source. The product should move to a licensed data provider; only this file changes.

const ACTOR = process.env.APIFY_ACTOR || 'fayoussef~canada-car-scraper';
const BASE = 'https://api.apify.com/v2';

function buildInput(car, opts) {
  const o = opts || {};
  return {
    vehicles: [`${car.make} ${car.model}`.trim()],
    postal_code: o.postalCode || process.env.DEALER_POSTAL_CODE || 'M1R 2Y5',
    radius_km: o.radiusKm || Number(process.env.SEARCH_RADIUS_KM || 100),
    condition: 'used',
    seller_type: 'any',
    year_from: car.year - 1,
    year_to: car.year + 1,
    max_results: o.maxResults || Number(process.env.SEARCH_MAX_RESULTS || 25),
    sort_by: 'newest',
    sources: ['autotrader', 'kijiji', 'cargurus']
  };
}

// One record per site the car is listed on, so each card can link to its own source.
function normalize(items) {
  const out = [];
  (items || []).forEach((it, i) => {
    const sites = [
      ['AutoTrader.ca', it.autotrader_url, it.autotrader_price],
      ['Kijiji', it.kijiji_url, it.kijiji_price],
      ['CarGurus.ca', it.cargurus_url, it.cargurus_price]
    ].filter((s) => s[1]);
    if (!sites.length) sites.push([siteName(it.listed_on || it.cheapest_on), null, it.price]);
    sites.forEach(([source, url, price]) => {
      const p = Number(price || it.price || 0);
      if (!p) return;
      out.push({
        id: `${it.vehicle_id || i}-${source}`,
        source,
        url: url || null,
        title: it.title || [it.year, it.make, it.model, it.trim].filter(Boolean).join(' '),
        year: Number(it.year) || null,
        make: it.make || '',
        model: it.model || '',
        trim: it.trim || '',
        headline: it.headline || '',
        price: p,
        km: Number(it.mileage_km) || null,
        transmission: it.transmission || '',
        drivetrain: it.drivetrain || '',
        fuel: it.fuel_type || '',
        colour: it.exterior_color || '',
        seller: it.seller_name || (it.seller_type === 'private' ? 'Private seller' : ''),
        sellerType: it.seller_type || '',
        city: it.city || '',
        distanceKm: it.distance_km != null ? Number(it.distance_km) : null,
        image: it.image_url || null,
        dealRating: it.deal_rating || '',
        marketValue: it.market_value != null ? Number(it.market_value) : null,
        daysOnMarket: it.days_on_market != null ? Number(it.days_on_market) : null,
        priceDrop: !!it.price_drop,
        listedAt: it.listed_at || null,
        vin: it.vin || null
      });
    });
  });
  return out;
}

function siteName(s) {
  const k = String(s || '').toLowerCase();
  if (k.includes('autotrader')) return 'AutoTrader.ca';
  if (k.includes('kijiji')) return 'Kijiji';
  if (k.includes('cargurus')) return 'CarGurus.ca';
  if (k.includes('carpages')) return 'Carpages.ca';
  return s || 'Unknown source';
}

async function search(car, opts) {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('APIFY_TOKEN is not set');
  const input = buildInput(car, opts);
  const timeoutS = Number(process.env.APIFY_TIMEOUT_S || 240);
  const url = `${BASE}/acts/${ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=${timeoutS}&format=json&clean=true`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), (timeoutS + 30) * 1000);
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal: ctrl.signal });
  } finally { clearTimeout(t); }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Apify returned ${res.status}: ${text.slice(0, 300)}`);
  }
  const items = await res.json();
  return { input, raw: Array.isArray(items) ? items.length : 0, listings: normalize(items) };
}

module.exports = { name: 'apify', search, normalize, buildInput };
