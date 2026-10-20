'use strict';
const { cleanUrl } = require('./links');
// Market matching and pricing engine. Pure functions, no I/O.
// Rates are starting assumptions for the demo; tune them with the dealer.

const RATES = {
  perKm: Number(process.env.RATE_PER_KM || 0.06),
  perYear: Number(process.env.RATE_PER_YEAR || 1200),
  beatMarketPct: Number(process.env.BEAT_MARKET_PCT || 2),
  floorPct: Number(process.env.FLOOR_PCT || 7),
  minMargin: Number(process.env.MIN_MARGIN || 800)
};

const FEATURES = [
  { key: 'nav', label: 'Navigation', value: 600, words: ['navi', 'navigation', 'gps'] },
  { key: 'pano', label: 'Panoramic roof', value: 900, words: ['pano', 'panoramic', 'sunroof', 'moonroof'] },
  { key: 'heated', label: 'Heated seats', value: 300, words: ['heated'] },
  { key: 'leather', label: 'Leather seats', value: 700, words: ['leather'] },
  { key: 'carplay', label: 'Apple CarPlay', value: 200, words: ['carplay', 'android auto'] },
  { key: 'camera', label: 'Backup camera', value: 150, words: ['cam', 'camera'] },
  { key: 'premium', label: 'Premium or sport package', value: 1200, words: ['premium', 'm sport', 'sport pkg', 'sport package', 'technik', 'm pkg', 'sport chrono'] },
  { key: 'accident', label: 'Accident-free', value: 1200, words: ['accident free', 'accident-free', 'no accidents', 'clean carfax'] },
  { key: 'owner', label: 'One owner', value: 300, words: ['one owner', '1 owner'] },
  { key: 'winter', label: 'Winter tires included', value: 400, words: ['winter tires', 'snow tires'] }
];

// Body styles: a listing that names a different one than the car is a different variant.
const BODY_GROUPS = [
  ['coupe', 'coupé', '2dr', '2-door'],
  ['sedan', '4dr', '4-door', 'berline'],
  ['convertible', 'cabriolet', 'cabrio', 'roadster', 'spyder', 'spider'],
  ['wagon', 'avant', 'touring', 'estate', 'allroad', 'sport wagon'],
  ['hatchback', 'hatch', '5dr'],
  ['pickup', 'crew cab', 'supercrew', 'double cab', 'quad cab']
];
const BODY_WORDS = [].concat.apply([], BODY_GROUPS);

// Performance and powertrain variants that change the price band.
const VARIANT_TOKENS = ['m40i', 'm40', 'x3m', 'x5m', 'm3', 'm4', 'm5', 'amg', 'rs', 'rs3', 'rs5', 'rs6', 'rs7', 's3', 's4', 's5', 's6', 'srt', 'trackhawk', 'hellcat', 'gts', 'turbo', 'turbo s', 'gt3', 'gt4', 'e-hybrid', 'hybrid', 'phev', 'plug-in', 'diesel', 'tdi', 'ev', 'electric', 'raptor', 'trd pro', 'type r', 'nismo', 'n line', 'sti', 'v8', 'v6', 'v12', 'w12', 'supercharged'];
// Tokens we never treat as trim identity (too generic).
const GENERIC = ['awd', '4wd', 'fwd', 'rwd', '4matic', 'quattro', 'xdrive', '4motion', 'sh-awd', 'all-wheel', 'the', 'and', 'with', 'pkg', 'package', 'auto', 'automatic', '2.0', '2.0t', '2.5', '3.0', '3.0t', '1.5', '1.5t', 'l', 'i4', 'i6', 'sedan', 'suv', 'crossover'];

function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9.\- ]/g, ' ').replace(/\s+/g, ' ').trim(); }
function tokens(s) { return norm(s).split(' ').filter(Boolean); }

function featuresFromText(text) {
  const t = norm(text);
  const out = {};
  FEATURES.forEach((f) => { if (f.words.some((w) => t.includes(w))) out[f.key] = true; });
  return out;
}

function bodyOf(text) {
  const t = ' ' + norm(text) + ' ';
  for (let i = 0; i < BODY_GROUPS.length; i++) {
    if (BODY_GROUPS[i].some((w) => t.includes(' ' + w + ' '))) return i;
  }
  return -1;
}

function variantsOf(text) {
  const t = ' ' + norm(text) + ' ';
  return VARIANT_TOKENS.filter((v) => t.includes(' ' + v + ' '));
}

// Identity tokens of the dealer's car: trim words that are not generic, body or feature words.
function keyTokens(car) {
  const t = tokens(`${car.trim || ''} ${car.bodyStyle || ''}`);
  return t.filter((x) => x.length > 1 && !GENERIC.includes(x) && !BODY_WORDS.includes(x));
}

// Match level: exact | close | similar | different, with reasons the user can read.
function classify(car, l) {
  if (l.aiLevel) return { level: l.aiLevel, reasons: [l.aiReason ? `${l.aiReason} (AI)` : 'judged by AI'] };
  if (l.aiSameVariant === false) return { level: 'different', reasons: [`different variant${l.aiVariant ? ` (${l.aiVariant})` : ''}, read by AI`] };
  const carText = `${car.trim || ''} ${car.bodyStyle || ''}`;
  // Model words beyond the car's own model name count as a variant ("A4 allroad", "Cayenne Coupe").
  const carModel = tokens(car.model), listModelExtra = tokens(l.model).filter((t) => !carModel.includes(t) && !tokens(car.make).includes(t));
  const listText = `${l.trim || ''} ${listModelExtra.join(' ')} ${l.title || ''} ${l.headline || ''} ${l.body || ''}`;
  const reasons = [];
  const carBody = bodyOf(carText), listBody = bodyOf(listText);
  if (carBody !== -1 && listBody !== -1 && carBody !== listBody) return { level: 'different', reasons: ['different body style'] };
  const bodyUnsure = carBody === -1 && listBody !== -1 && BODY_GROUPS[listBody][0] !== 'sedan';
  const carVar = variantsOf(carText), listVar = variantsOf(listText);
  const extra = listVar.filter((v) => !carVar.includes(v));
  const missing = carVar.filter((v) => !listVar.includes(v));
  if (extra.length) return { level: 'different', reasons: [`listing is the ${extra.join(' ')} variant`] };
  // A real trim is one with words beyond body style and generic terms ("Coupe" alone is not a trim).
  const trimStated = tokens(l.trim).some((x) => !GENERIC.includes(x) && !BODY_WORDS.includes(x));
  if (missing.length && trimStated) return { level: 'different', reasons: [`not the ${missing.join(' ')} variant`] };
  const keys = keyTokens(car);
  const lt = ' ' + norm(listText) + ' ';
  const hit = keys.filter((k) => lt.includes(' ' + k + ' '));
  const bodyUnknown = carBody !== -1 && listBody === -1;
  if (!trimStated) reasons.push('trim not stated in the listing');
  if (bodyUnknown) reasons.push('body style not stated');
  if (bodyUnsure) reasons.push(`listing says ${BODY_GROUPS[listBody][0]}; confirm your car's body style`);
  const cap = (level) => (level === 'exact' && (bodyUnknown || bodyUnsure)) ? 'close' : level;
  if (keys.length === 0) return { level: trimStated ? cap('exact') : 'similar', reasons };
  if (hit.length === keys.length) return { level: cap('exact'), reasons };
  if (hit.length > 0) { reasons.push(`matches ${hit.join(', ')} but not ${keys.filter((k) => !hit.includes(k)).join(', ')}`); return { level: 'close', reasons }; }
  if (missing.length) return { level: 'similar', reasons: reasons.concat([`does not mention ${missing.join(' ')}`]) };
  return { level: 'similar', reasons };
}

function adjust(car, l) {
  const myF = car.features || {};
  const theirs = Object.assign({}, featuresFromText(`${l.trim} ${l.title} ${l.headline}`), l.knownFeatures || {});
  let eq = l.price;
  const notes = [];
  if (l.km != null && car.km != null) eq += Math.round((l.km - car.km) * RATES.perKm);
  if (l.year && car.year) eq += (car.year - l.year) * RATES.perYear;
  FEATURES.forEach((f) => {
    if (myF[f.key] && theirs[f.key] === false) eq += f.value;
    if (!myF[f.key] && theirs[f.key] === true) { eq -= f.value; notes.push(`has ${f.label.toLowerCase()}`); }
  });
  return { equivalent: Math.round(eq), notes, theirFeatures: theirs };
}

function median(xs) {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : Math.round((s[n / 2 - 1] + s[n / 2]) / 2);
}
function round50(x) { return Math.round(x / 50) * 50; }
function fmt(n) { return Number(n || 0).toLocaleString('en-CA'); }

const MODES = { exact: ['exact'], close: ['exact', 'close'], broad: ['exact', 'close', 'similar'] };

const SITE_ORDER = ['AutoTrader.ca', 'Kijiji', 'CarGurus.ca'];
const siteRank = (s) => { const i = SITE_ORDER.indexOf(s); return i === -1 ? 99 : i; };

// One card per car: the same vehicle listed on several sites becomes a single record with a `sites` list.
// Grouped by VIN, then by the scraper's vehicle id, then by seller + year/make/model + mileage.
function groupListings(listings) {
  const groups = [], byKey = {};
  const keysOf = (l) => {
    const k = [];
    if (l.vin) k.push('vin:' + String(l.vin).toUpperCase());
    if (l.id && /-[^-]+$/.test(l.id) && !l.sites) k.push('id:' + l.id.replace(/-[^-]+$/, ''));
    else if (l.id) k.push('id:' + l.id);
    return k;
  };
  const norm = (v) => String(v || '').trim().toLowerCase();
  // Same seller, same year/make/model and mileage within 1%: the same car posted on another site.
  const sameCar = (a, b) => a.seller && b.seller && norm(a.seller) === norm(b.seller) && a.year === b.year && norm(a.make) === norm(b.make) && norm(a.model) === norm(b.model)
    && a.km && b.km && Math.abs(a.km - b.km) <= Math.max(300, a.km * 0.01);
  listings.forEach((l) => {
    const sites = (l.sites && l.sites.length ? l.sites : [{ source: l.source, url: l.url || null, price: l.price, daysOnMarket: l.daysOnMarket, dealRating: l.dealRating || '', priceDrop: !!l.priceDrop }])
      .map((st) => Object.assign({}, st, { url: cleanUrl(st.source, st.url) }));
    const keys = keysOf(l);
    let g = null;
    keys.forEach((k) => { if (!g && byKey[k]) g = byKey[k]; });
    if (!g) g = groups.find((x) => sameCar(x, l)) || null;
    if (!g) {
      g = Object.assign({}, l, { id: (keys[0] || l.id || String(groups.length)).replace(/^(vin|id|car):/, ''), sites: [] });
      groups.push(g);
    } else {
      // Keep the first non-empty value of every field.
      Object.keys(l).forEach((f) => { if ((g[f] == null || g[f] === '') && l[f] != null && l[f] !== '' && f !== 'sites') g[f] = l[f]; });
    }
    sites.forEach((st) => { if (!g.sites.some((x) => x.source === st.source && (x.url || '') === (st.url || ''))) g.sites.push(Object.assign({}, st)); });
    keys.forEach((k) => { byKey[k] = g; });
  });
  groups.forEach((g) => {
    g.sites.sort((a, b) => siteRank(a.source) - siteRank(b.source));
    g.sources = g.sites.map((x) => x.source);
    g.source = g.sites[0].source;
    g.url = (g.sites.find((x) => x.url) || {}).url || null;
    const prices = g.sites.map((x) => Number(x.price) || 0).filter(Boolean);
    g.price = prices.length ? Math.min.apply(null, prices) : g.price;
    const days = g.sites.map((x) => x.daysOnMarket).filter((d) => d != null);
    g.daysOnMarket = days.length ? Math.max.apply(null, days) : (g.daysOnMarket != null ? g.daysOnMarket : null);
    g.priceDrop = g.sites.some((x) => x.priceDrop);
    g.dealRating = (g.sites.find((x) => x.dealRating) || {}).dealRating || g.dealRating || '';
  });
  return groups;
}

function analyze(car, listingsIn, modeIn) {
  // The dealer's own listings are shown separately and never compared against themselves.
  const own = listingsIn.filter((l) => l.isOwn);
  const listings = listingsIn.filter((l) => !l.isOwn);
  const rows = listings.map((l) => {
    const c = classify(car, l);
    const a = adjust(car, l);
    return Object.assign({}, l, { level: c.level, matchReasons: c.reasons, equivalent: a.equivalent, adjustNotes: a.notes, theirFeatures: a.theirFeatures });
  });
  const counts = { exact: 0, close: 0, similar: 0, different: 0 };
  rows.forEach((r) => { counts[r.level] += 1; });
  // Pick the mode; widen automatically when there is too little to work with.
  let mode = MODES[modeIn] ? modeIn : 'close';
  let modeNote = '';
  const sizeOf = (m) => rows.filter((r) => MODES[m].includes(r.level)).length;
  if (sizeOf(mode) < 3) {
    const order = ['exact', 'close', 'broad'];
    for (let i = order.indexOf(mode) + 1; i < order.length; i++) {
      if (sizeOf(order[i]) >= 3) { modeNote = `Only ${sizeOf(mode)} ${mode === 'exact' ? 'exact matches' : 'close matches'}, so the statistics use the wider set.`; mode = order[i]; break; }
    }
  }
  rows.forEach((r) => { r.included = MODES[mode].includes(r.level); });
  const used = rows.filter((r) => r.included);
  const eqs = used.map((r) => r.equivalent);
  const med = median(eqs);
  const lo = eqs.length ? Math.min.apply(null, eqs) : 0, hi = eqs.length ? Math.max.apply(null, eqs) : 0;
  const ask = car.listPrice || 0, cost = car.totalCost || 0;
  let listAt = round50(med * (1 - RATES.beatMarketPct / 100));
  const floor = Math.max(cost + RATES.minMargin, round50(med * (1 - RATES.floorPct / 100)));
  let limited = false;
  if (cost && listAt < floor) { listAt = floor; limited = true; }
  const margin = listAt - cost;
  const pct = med ? Math.round((ask - med) / med * 100) : 0;
  const cuts = used.filter((r) => r.priceDrop).length;
  // How many of the cars are listed on each site (a car on two sites counts once per site).
  const bySource = {};
  rows.forEach((r) => { (r.sites || [{ source: r.source }]).forEach((st) => { bySource[st.source] = (bySource[st.source] || 0) + 1; }); });
  const avgDom = used.filter((r) => r.daysOnMarket != null).map((r) => r.daysOnMarket);
  // Where the dealer's price ranks among the comparables (1 = cheapest).
  const rank = ask ? eqs.filter((v) => v < ask).length + 1 : null;
  const isListed = own.length > 0;
  const ownDays = own.map((o) => o.daysOnMarket).filter((d) => d != null);
  const listedFor = ownDays.length ? Math.max.apply(null, ownDays) : null;
  let position = 'in line', verdict = 'keep', reason;
  if (!used.length) { verdict = 'none'; reason = 'No comparable listings were found for this variant. Widen the match or check the trim spelling.'; }
  else if (!ask) { verdict = 'none'; reason = 'Enter a list price to see where it sits against the market.'; }
  else if (pct > 2 && listAt >= ask) {
    position = 'above'; verdict = 'keep';
    reason = `The market median is ${pct}% below this price, but going lower would leave less than the $${fmt(RATES.minMargin)} minimum margin over the $${fmt(cost)} cost. Keep the price and sell on the advantages below, or accept a smaller margin with "Other price".`;
  } else if (pct > 2) {
    position = 'above'; verdict = 'lower';
    reason = `${isListed ? 'The car is already listed' : 'This price is'} ${pct}% above the median of ${used.length} comparable cars${rank ? `, ranking ${rank} of ${used.length + 1} on price` : ''}. Buyers compare online before they visit, so cars above the pack get fewer enquiries${listedFor != null && listedFor > 21 ? `, which fits ${listedFor} days listed without a sale` : ''}. Lowering to $${fmt(listAt)} puts it just under the median and keeps $${fmt(margin)} of margin.${cuts ? ` ${cuts} seller${cuts > 1 ? 's' : ''} cut their price recently, so waiting is unlikely to help.` : ''}`;
  } else if (pct < -2) {
    position = 'below'; verdict = 'raise';
    reason = `${isListed ? 'The car is already listed' : 'This price is'} ${Math.abs(pct)}% below the median${rank === 1 ? ' and is the cheapest of the comparables' : (rank ? `, ranking ${rank} of ${used.length + 1} on price` : '')}. ${listedFor != null && listedFor <= 21 ? `After ${listedFor} days` : 'At this price'} the money is being left on the table: it could go to $${fmt(listAt)}, still under the median, for $${fmt(listAt - ask)} more margin. If the goal is a fast sale, keep the price but do not stack offers on top of it.`;
  } else {
    reason = `${isListed ? 'The car is listed' : 'This price is'} in line with the market median${rank ? `, ranking ${rank} of ${used.length + 1} on price` : ''}. Keep the price; the advantages below and a strong first photo are what make a buyer pick this car over the others.${listedFor != null && listedFor > 30 ? ` After ${listedFor} days listed, consider an offer rather than a price cut.` : ''}`;
  }
  const advantages = FEATURES.filter((f) => (car.features || {})[f.key]).map((f) => {
    const n = used.filter((r) => r.theirFeatures[f.key] === true).length;
    return n <= used.length / 2 ? { label: f.label, note: n ? `only ${n} of ${used.length} comparables mention it` : 'none of the comparables mention it' } : null;
  }).filter(Boolean);
  // Compact distribution for the side panel: 6 buckets across the used range.
  const buckets = [];
  if (used.length) {
    const n = 6, span = (hi - lo) || 1, w = span / n;
    for (let i = 0; i < n; i++) {
      const a = lo + i * w, b = i === n - 1 ? hi + 1 : lo + (i + 1) * w;
      buckets.push({ from: Math.round(a), to: Math.round(b), count: eqs.filter((v) => v >= a && v < b).length });
    }
  }
  return {
    mode, modeNote, counts,
    stats: { median: med, low: lo, high: hi, used: used.length, excluded: rows.length - used.length, total: rows.length, bySource, askingPrice: ask, pctVsMedian: pct, position, rank, priceCuts: cuts, avgDaysOnMarket: avgDom.length ? Math.round(avgDom.reduce((a, b) => a + b, 0) / avgDom.length) : null },
    recommendation: { listAt, floor, margin, reason, verdict, isListed, listedFor, limited },
    own, points: eqs.slice().sort((a, b) => a - b),
    advantages, buckets,
    listings: rows.sort((a, b) => {
      const order = { exact: 0, close: 1, similar: 2, different: 3 };
      return order[a.level] !== order[b.level] ? order[a.level] - order[b.level] : a.equivalent - b.equivalent;
    }),
    rates: RATES
  };
}

module.exports = { analyze, classify, adjust, groupListings, featuresFromText, keyTokens, FEATURES, RATES, MODES };
