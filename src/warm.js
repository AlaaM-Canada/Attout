'use strict';
// Runs a market check for every car in inventory so the first demo click is instant.
// Usage: APIFY_TOKEN=... node src/warm.js
const store = require('./store');
const market = require('./market');

(async () => {
  const cars = store.inventory.all();
  for (const c of cars) {
    const car = Object.assign({}, c, { totalCost: (c.purchasePrice || 0) + (c.auctionFees || 0) + (c.transport || 0) + (c.reconditioning || 0) });
    process.stdout.write(`${car.year} ${car.make} ${car.model}: `);
    try {
      const r = await market.check(car, { refresh: process.argv.includes('--refresh') });
      console.log(`${r.source}${r.cached ? ' (cached)' : ''}, ${r.stats.total} listings, median $${r.stats.median}`);
    } catch (e) { console.log('failed: ' + e.message); }
  }
})();
