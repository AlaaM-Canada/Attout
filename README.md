# Dealer Console Demo

Pick a car from inventory, search the Canadian market for similar cars, see the statistics, and act on it: match or beat the price, or add an offer.

**Demo only.** Market data comes from AutoTrader.ca, Kijiji and CarGurus.ca through a third-party scraper (Apify). That is fine for a proof of concept; the production product should use a licensed data provider. The source is one file (`src/adapters/apify.js`), so swapping it does not touch the screens.

## What it does

1. **Inventory** – cards for each car with price, days in stock, cost and current offers.
2. **Market check** – one click searches the three sites within 100 km of the dealership for the same make and model, model year ±1.
3. **Matching** – each listing is classified (close match, similar, different variant) and adjusted to the dealer's car: 6¢ per km, $1,200 per model year, and a value per feature the listing has or lacks.
4. **Statistics** – adjusted market median and range, where the dealer's price sits, recent price cuts, days on market.
5. **Recommendation** – list price just under the median, a negotiation floor, and the margin after all costs.
6. **Listing cards** – photo, price, km, transmission, seller, distance, source badge, and a button that opens the original listing.
7. **Actions** – set the recommended price, set a custom price, or add an offer (6 months no payment, winter tires, warranty…). Everything is written to the audit log.

Without `APIFY_TOKEN` the app runs on bundled sample data. The BMW X3 sample is real (17 listings read from CarGurus.ca and Carpages.ca on October 14, 2026); other cars get generated placeholders, clearly labelled.

## Run locally

```bash
npm install
cp .env.example .env      # add APIFY_TOKEN for live search (optional)
npm start                 # http://localhost:3000
npm test
```

Node 18 or newer. No database: data lives in `data/*.json`.

## Deploy on Render (free tier)

1. Push this repo to GitHub.
2. In Render: **New → Blueprint**, pick the repo. Render reads `render.yaml`.
3. When asked, paste the Apify token into `APIFY_TOKEN`.
4. Open the URL Render gives you.

Free services sleep after 15 minutes idle and take 30–60 s to wake. Open the link a few minutes before a demo, or move to the Starter plan.

Render's free disk is not persistent, so price changes and offers reset on each deploy or restart. For the demo that is acceptable; for anything longer, add a Render disk and set `DATA_DIR` to its mount path, or move to a database.

## Warm the cache before a demo

A live search takes one to three minutes per car. Run this once beforehand so the first click is instant:

```bash
APIFY_TOKEN=... npm run warm            # uses the cache if fresh
APIFY_TOKEN=... npm run warm -- --refresh
```

Results are cached for `CACHE_HOURS` (default 6).

## Apify

- Actor: `fayoussef/canada-car-scraper` (AutoTrader.ca, Kijiji, CarGurus.ca).
- Free plan: 25 results per run and about $5 of monthly credit, plenty for demos.
- Get the token in the Apify Console under **Settings → API & Integrations**.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `APIFY_TOKEN` | – | Enables live search |
| `DEALER_POSTAL_CODE` | `M1R 2Y5` | Centre of the search |
| `SEARCH_RADIUS_KM` | `100` | Search radius |
| `SEARCH_MAX_RESULTS` | `25` | Listings per search (free plan cap) |
| `CACHE_HOURS` | `6` | How long results are reused |
| `RATE_PER_KM`, `RATE_PER_YEAR`, `BEAT_MARKET_PCT`, `FLOOR_PCT`, `MIN_MARGIN` | `0.06`, `1200`, `2`, `7`, `800` | Pricing engine assumptions; tune with the dealer |

## Layout

```
src/server.js          Express API and static hosting
src/market.js          Orchestrates a market check (source, cache, pricing)
src/pricing.js         Matching, adjustments, statistics, recommendation
src/adapters/apify.js  Live source (swap this for a licensed provider)
src/adapters/sample.js Bundled fallback data
src/store.js           JSON-file storage
public/                Frontend (plain HTML, CSS, JS)
data/inventory.json    Seed inventory
test/                  Unit tests
```
