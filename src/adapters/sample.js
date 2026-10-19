'use strict';
// Fallback source when APIFY_TOKEN is missing or a live search fails.
// The BMW X3 set is real: 17 listings read by hand from CarGurus.ca and Carpages.ca on October 14, 2026.
// Everything else is generated from the car's own price and labelled as a sample.

const X3 = [
  ['CarGurus.ca', 2019, 'xDrive30i AWD', 21888, 113000, 'North York', 15, {}, false, 'https://www.cargurus.ca/Cars/l-Used-2019-BMW-X3-Toronto-c27548_L414276'],
  ['CarGurus.ca', 2019, 'xDrive30i AWD', 20995, 94206, 'North York', 15, {}, false, 'https://www.cargurus.ca/Cars/l-Used-2019-BMW-X3-Toronto-c27548_L414276'],
  ['CarGurus.ca', 2019, 'xDrive30i AWD', 22222, 85208, 'Oakville', 27, {}, true, 'https://www.cargurus.ca/Cars/l-Used-2019-BMW-X3-Toronto-c27548_L414276'],
  ['CarGurus.ca', 2019, 'xDrive30i AWD', 21770, 103000, 'North York', 16, {}, false, 'https://www.cargurus.ca/Cars/l-Used-2019-BMW-X3-Toronto-c27548_L414276'],
  ['CarGurus.ca', 2019, 'xDrive30i AWD', 18595, 141404, 'Guelph', 72, {}, false, 'https://www.cargurus.ca/Cars/l-Used-2019-BMW-X3-Toronto-c27548_L414276'],
  ['CarGurus.ca', 2019, 'xDrive30i AWD', 22499, 102803, 'Burlington', 44, {}, true, 'https://www.cargurus.ca/Cars/l-Used-2019-BMW-X3-Toronto-c27548_L414276'],
  ['CarGurus.ca', 2019, 'xDrive30i AWD', 24900, 76000, 'North York', 14, {}, false, 'https://www.cargurus.ca/Cars/l-Used-2019-BMW-X3-Toronto-c27548_L414276'],
  ['CarGurus.ca', 2019, 'xDrive30i AWD', 18888, 141773, 'North York', 15, {}, false, 'https://www.cargurus.ca/Cars/l-Used-2019-BMW-X3-Toronto-c27548_L414276'],
  ['Carpages.ca', 2019, 'xDrive30i', 28990, 18018, 'Toronto', 12, { carplay: true, heated: true }, false, 'https://www.carpages.ca/used-cars/ontario/toronto/bmw/x3/'],
  ['Carpages.ca', 2019, 'xDrive30i', 27890, 75600, 'Toronto', 12, {}, false, 'https://www.carpages.ca/used-cars/ontario/toronto/bmw/x3/'],
  ['Carpages.ca', 2019, 'xDrive30i M Sport package', 26985, 119954, 'North York', 15, { carplay: true, pano: true, premium: true }, false, 'https://www.carpages.ca/used-cars/ontario/toronto/bmw/x3/'],
  ['Carpages.ca', 2019, 'xDrive30i AWD', 22490, 139300, 'Toronto', 12, { carplay: true, heated: true }, false, 'https://www.carpages.ca/used-cars/ontario/toronto/bmw/x3/'],
  ['Carpages.ca', 2019, 'xDrive30i Sport package', 20750, 129352, 'North York', 15, { leather: true, pano: true, nav: true }, false, 'https://www.carpages.ca/used-cars/ontario/toronto/bmw/x3/'],
  ['Carpages.ca', 2019, 'M40i', 37590, 86500, 'Toronto', 12, { carplay: true, nav: true, pano: true }, false, 'https://www.carpages.ca/used-cars/ontario/toronto/bmw/x3/'],
  ['Carpages.ca', 2019, 'xDrive30i', 21590, 97061, 'Toronto', 12, { carplay: true, heated: true }, false, 'https://www.carpages.ca/used-cars/ontario/toronto/bmw/x3/'],
  ['Carpages.ca', 2019, 'xDrive30i AWD', 24690, 93210, 'Toronto', 12, { carplay: true, heated: true }, false, 'https://www.carpages.ca/used-cars/ontario/toronto/bmw/x3/'],
  ['Carpages.ca', 2019, 'xDrive30i', 20790, 131891, 'Toronto', 12, { carplay: true, heated: true }, false, 'https://www.carpages.ca/used-cars/ontario/toronto/bmw/x3/']
];

function x3Listings() {
  return X3.map((r, i) => ({
    id: `x3-${i}`, source: r[0], url: r[9], title: `${r[1]} BMW X3 ${r[2]}`, year: r[1], make: 'BMW', model: 'X3', trim: r[2], body: 'SUV',
    headline: '', price: r[3], km: r[4], transmission: 'Automatic', drivetrain: 'AWD', fuel: 'Gas', colour: '',
    seller: r[0] === 'Carpages.ca' ? 'Dealer' : '', sellerType: 'dealer', city: r[5], distanceKm: r[6], image: null,
    dealRating: '', marketValue: null, daysOnMarket: null, priceDrop: r[8], listedAt: null, vin: null, knownFeatures: r[7]
  }));
}

function generated(car) {
  const base = car.listPrice || car.askingPrice || Math.round(car.totalCost * 1.18) || 20000;
  const km = car.km || 90000;
  const rows = [
    [0.88, 1.28, 'Mississauga', 30, 'AutoTrader.ca'], [0.93, 1.14, 'North York', 15, 'Kijiji'], [0.96, 1.06, 'Scarborough', 4, 'AutoTrader.ca'],
    [0.98, 1.0, 'Markham', 18, 'CarGurus.ca'], [1.01, 0.96, 'Toronto', 12, 'AutoTrader.ca'], [1.04, 0.9, 'Vaughan', 32, 'Kijiji'],
    [1.08, 0.82, 'Oakville', 45, 'CarGurus.ca'], [1.14, 0.68, 'Brampton', 38, 'AutoTrader.ca']
  ];
  return rows.map((r, i) => ({
    id: `gen-${i}`, source: r[4], url: null, title: `${car.year + (i === 1 ? -1 : (i === 6 ? 1 : 0))} ${car.make} ${car.model} ${car.trim || ''}`.trim(),
    year: car.year + (i === 1 ? -1 : (i === 6 ? 1 : 0)), make: car.make, model: car.model, trim: i % 4 === 2 ? '' : (car.trim || ''), body: '', headline: 'Sample listing',
    price: Math.round(base * r[0] / 10) * 10, km: Math.round(km * r[1] / 100) * 100, transmission: 'Automatic', drivetrain: car.drivetrain || '',
    fuel: 'Gas', colour: '', seller: i % 3 === 1 ? 'Private seller' : 'Dealer', sellerType: i % 3 === 1 ? 'private' : 'dealer',
    city: r[2], distanceKm: r[3], image: null, dealRating: '', marketValue: null, daysOnMarket: 10 + i * 7, priceDrop: i === 3, listedAt: null, vin: null, knownFeatures: {}
  }));
}

async function search(car) {
  const isX3 = /bmw/i.test(car.make) && /x3/i.test(car.model) && car.year >= 2018 && car.year <= 2020;
  return {
    input: { note: 'sample source' },
    raw: 0,
    listings: isX3 ? x3Listings() : generated(car),
    sampleNote: isX3
      ? 'Real listings read from CarGurus.ca and Carpages.ca on October 14, 2026 (bundled sample, not a live search).'
      : 'Sample listings generated from this car\'s own price. Set APIFY_TOKEN for a live search.'
  };
}

module.exports = { name: 'sample', search };
