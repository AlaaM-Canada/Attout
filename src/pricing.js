'use strict';
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
  { key: 'premium', label: 'Premium or sport package', value: 1200, words: ['premium', 'm sport', 'sport pkg', 'sport package', 'technik', 'm pkg'] },
  { key: 'accident', label: 'Accident-free', value: 1200, words: ['accident free', 'accident-free', 'no accidents', 'clean carfax'] },
  { key: 'owner', label: 'One owner', value: 300, words: ['one owner', '1 owner'] },
  { key: 'winter', label: 'Winter tires included', value: 400, words: ['winter tires', 'snow tires'] }
];

const ENGINE_TOKENS = ['m40i', 'm40', 'x3m', 'amg', 'rs', 's4', 's5', 'srt', 'hybrid', 'diesel', 'tdi', 'plug-in', 'phev', 'ev', 'v8', 'v6', '2.0', '3.0', '2.5', '1.5'];

function featuresFromText(text) {
  const t = String(text || '').toLowerCase();
  const out = {};
  FEATURES.forEach((f) => { if (f.words.some((w) => t.includes(w))) out[f.key] = true; });
  return out;
}

function tokens(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9. ]/g, ' ').split(/\s+/).filter(Boolean); }

// Similarity: 'close' (same trim family), 'similar' (same model, different trim words), 'different' (different engine/performance variant).
function classify(car, l) {
  const carT = tokens(car.trim), lT = tokens(`${l.trim} ${l.title} ${l.headline}`);
  const carEng = carT.filter((t) => ENGINE_TOKENS.includes(t)), lEng = lT.filter((t) => ENGINE_TOKENS.includes(t));
  if (lEng.some((t) => !carEng.includes(t) && !['2.0', '2.5', '3.0', '1.5', 'v6', 'v8'].includes(t))) return 'different';
  if (carEng.some((t) => ['m40i', 'm40', 'x3m', 'amg', 'srt'].includes(t)) && !lEng.some((t) => carEng.includes(t))) return 'different';
  const overlap = carT.filter((t) => t.length > 2 && lT.includes(t)).length;
  return overlap > 0 || carT.length === 0 ? 'close' : 'similar';
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

function analyze(car, listings) {
  const rows = listings.map((l) => {
    const sim = classify(car, l);
    const a = adjust(car, l);
    return Object.assign({}, l, { similarity: sim, included: sim !== 'different', equivalent: a.equivalent, adjustNotes: a.notes, theirFeatures: a.theirFeatures });
  });
  const used = rows.filter((r) => r.included);
  const eqs = used.map((r) => r.equivalent);
  const med = median(eqs);
  const lo = eqs.length ? Math.min.apply(null, eqs) : 0, hi = eqs.length ? Math.max.apply(null, eqs) : 0;
  const ask = car.listPrice || 0, cost = car.totalCost || 0;
  const listAt = round50(med * (1 - RATES.beatMarketPct / 100));
  const floor = Math.max(cost + RATES.minMargin, round50(med * (1 - RATES.floorPct / 100)));
  const margin = listAt - cost;
  const pct = med ? Math.round((ask - med) / med * 100) : 0;
  const cuts = used.filter((r) => r.priceDrop).length;
  const bySource = {};
  rows.forEach((r) => { bySource[r.source] = (bySource[r.source] || 0) + 1; });
  const avgDom = used.filter((r) => r.daysOnMarket != null).map((r) => r.daysOnMarket);
  let position = 'in line', reason;
  if (!ask) reason = 'Enter a list price to see where it sits against the market.';
  else if (pct > 2) { position = 'above'; reason = `Buyers compare prices online before they visit. At ${pct}% above the median of ${used.length} comparable cars, this car gets fewer enquiries. Listing at $${fmt(listAt)} puts it just under the median while keeping $${fmt(margin)} of margin.${cuts ? ` ${cuts} seller${cuts > 1 ? 's' : ''} cut their price recently, so waiting is unlikely to help.` : ''}`; }
  else if (pct < -2) { position = 'below'; reason = `The car is priced ${Math.abs(pct)}% below the market. It could go to $${fmt(listAt)} and still sit under the median, adding $${fmt(listAt - ask)} of margin.`; }
  else reason = `The price is in line with the market. Listing at $${fmt(listAt)} keeps it just under the median; the advantages below are what make a buyer pick this car over the others.`;
  const advantages = FEATURES.filter((f) => (car.features || {})[f.key]).map((f) => {
    const n = used.filter((r) => r.theirFeatures[f.key] === true).length;
    return n <= used.length / 2 ? { label: f.label, note: n ? `only ${n} of ${used.length} comparables mention it` : 'none of the comparables mention it' } : null;
  }).filter(Boolean);
  return {
    stats: { median: med, low: lo, high: hi, used: used.length, excluded: rows.length - used.length, total: rows.length, bySource, askingPrice: ask, pctVsMedian: pct, position, priceCuts: cuts, avgDaysOnMarket: avgDom.length ? Math.round(avgDom.reduce((a, b) => a + b, 0) / avgDom.length) : null },
    recommendation: { listAt, floor, margin, reason },
    advantages,
    listings: rows.sort((a, b) => (a.included === b.included ? a.equivalent - b.equivalent : a.included ? -1 : 1)),
    rates: RATES
  };
}

function fmt(n) { return Number(n || 0).toLocaleString('en-CA'); }

module.exports = { analyze, classify, adjust, featuresFromText, FEATURES, RATES };
