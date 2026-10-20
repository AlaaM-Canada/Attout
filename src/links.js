'use strict';
// Listing links as the sites open them today. The scraper's CarGurus links use a query parameter
// CarGurus.ca no longer recognises (it falls back to the generic search page); the car page is /details/<id>.
function cleanUrl(source, url) {
  if (!url) return url || null;
  const u = String(url).trim();
  if (/cargurus\./i.test(u)) {
    const m = u.match(/(?:inventoryListing|listingId|#listing)=(\d+)/i) || u.match(/\/details\/(\d+)/i) || u.match(/\/Cars\/link\/(\d+)/i);
    if (m) return 'https://www.cargurus.ca/details/' + m[1];
  }
  return u;
}

function listingId(source, url) {
  const u = cleanUrl(source, url) || '';
  const m = u.match(/\/details\/(\d+)/) || u.match(/\/(\d+)\/?(?:\?|$)/);
  return m ? m[1] : null;
}

module.exports = { cleanUrl, listingId };
