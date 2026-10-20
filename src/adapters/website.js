'use strict';
// The dealer's own website (a Carpages "DealerSite" WordPress install): the authoritative list of what is on the lot.
// Server-rendered HTML, 100 cars per page (?dsp_page=N), with body-style category pages that share the same card markup.
const BASE = (process.env.DEALER_WEBSITE || 'https://canadianfinemotors.ca').replace(/\/+$/, '');
const INVENTORY_PATH = process.env.DEALER_WEBSITE_INVENTORY || '/vehicles/';
const CATEGORIES = { 1: 'Convertible', 2: 'Coupe', 3: 'Hatchback', 4: 'Minivan', 5: 'Sedan', 6: 'SUV', 7: 'Pickup', 8: 'Wagon' };
const TWO_WORD_MAKES = ['Land Rover', 'Alfa Romeo', 'Aston Martin', 'Rolls Royce', 'Range Rover'];

function available() { return !!BASE; }
function decode(s) {
  return String(s || '').replace(/&#0*38;|&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0*39;|&#8217;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
function num(s) { const n = parseInt(String(s || '').replace(/[^0-9]/g, ''), 10); return isNaN(n) ? 0 : n; }
function pick(block, re) { const m = block.match(re); return m ? decode(m[1]) : ''; }

function splitTitle(title) {
  const m = String(title || '').match(/^(\d{4})\s+(.*)$/);
  if (!m) return { year: 0, make: '', model: title || '' };
  const rest = m[2].trim();
  const two = TWO_WORD_MAKES.find((mk) => rest.toLowerCase().startsWith(mk.toLowerCase() + ' '));
  const make = two || rest.split(' ')[0];
  return { year: Number(m[1]), make, model: rest.slice(make.length).trim() };
}

// One record per card on an inventory page.
function parseCards(html) {
  const out = [];
  const parts = String(html || '').split(/<div class="result-row-modern">/).slice(1);
  parts.forEach((raw) => {
    const block = raw.replace(/\s+/g, ' ');
    const url = pick(block, /href="([^"]*\/inventory\/[^"]+)"/);
    if (!url) return;
    const siteId = (url.match(/\/(\d+)\/?$/) || [])[1] || url;
    const title = pick(block, /result-row-card-title">\s*([^<]+?)\s*</);
    const headline = pick(block, /itemprop="vehicleConfiguration">\s*([^<]*?)\s*<\/h5>/);
    const img = pick(block, /<img[^>]*data-lazy-src="([^"]+)"/) || pick(block, /<img[^>]*src="(https?:[^"]+)"/);
    const priceLabels = [];
    const re = /text-blue-gray-500">\s*([^<]+?)\s*<\/span>[\s\S]*?itemprop="price">\s*\$?([\d,]+)/g;
    let m; while ((m = re.exec(block))) priceLabels.push([decode(m[1]).toLowerCase(), num(m[2])]);
    const cash = (priceLabels.find((p) => /cash/.test(p[0])) || [])[1] || num(pick(block, /data-price="(\d+)"/)) || (priceLabels[0] || [])[1] || 0;
    const finance = (priceLabels.find((p) => /financ/.test(p[0])) || [])[1] || 0;
    const t = splitTitle(title);
    out.push({
      siteId, url, title, year: t.year, make: t.make, model: t.model,
      trim: (headline.split('|')[0] || '').trim(),
      headline,
      km: num(pick(block, /Mileage<\/span>\s*<span[^>]*>\s*([\d,]+)/)),
      stockNumber: pick(block, /Stock #<\/span>\s*<span[^>]*>([^<]+)</),
      vin: pick(block, /VIN<\/span>\s*<span[^>]*>([^<]+)</).toUpperCase(),
      transmission: pick(block, /Transmission<\/span>\s*<span[^>]*>([^<]+)</),
      cashPrice: cash, financePrice: finance && finance !== cash ? finance : 0,
      image: img || null,
      dealRating: pick(block, /<span title="([^":]+)[^"]*"[^>]*class="cg-dealrating-badge"/)
    });
  });
  return out;
}

async function fetchHtml(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (DealerConsole inventory sync)', Accept: 'text/html' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    return await res.text();
  } finally { clearTimeout(timer); }
}

async function fetchPages(query, onPage) {
  const seen = new Set(); const all = [];
  for (let page = 1; page <= 10; page++) {
    const sep = INVENTORY_PATH.includes('?') ? '&' : '?';
    const url = BASE + INVENTORY_PATH + sep + (query ? query + '&' : '') + 'dsp_page=' + page;
    const cards = parseCards(await fetchHtml(url)).filter((c) => !seen.has(c.siteId));
    if (!cards.length) break;
    cards.forEach((c) => { seen.add(c.siteId); all.push(c); });
    if (onPage) onPage(page, all.length);
    if (cards.length < 100) break;
  }
  return all;
}

// Everything on the lot, with the body style taken from the site's own category pages.
async function fetchInventory(onProgress) {
  const progress = onProgress || (() => {});
  progress(5, 'Reading the website inventory', 'searching');
  const cars = await fetchPages('', (page, n) => progress(Math.min(50, 5 + page * 15), `${n} cars read from the website (page ${page})`, 'searching'));
  const bodyOf = {};
  const keys = Object.keys(CATEGORIES);
  for (let i = 0; i < keys.length; i++) {
    progress(50 + Math.round((i / keys.length) * 35), `Reading body styles: ${CATEGORIES[keys[i]]}`, 'reading');
    try { (await fetchPages('category=' + keys[i])).forEach((c) => { bodyOf[c.siteId] = bodyOf[c.siteId] || CATEGORIES[keys[i]]; }); } catch (e) { /* body style stays unknown */ }
  }
  cars.forEach((c) => { c.bodyStyle = bodyOf[c.siteId] || ''; });
  return cars;
}

module.exports = { available, parseCards, splitTitle, fetchInventory, BASE, CATEGORIES };
