'use strict';
(function () {
  const main = document.getElementById('main');
  let config = null;
  const money = (n) => n == null ? '—' : '$' + Number(n).toLocaleString('en-CA');
  const num = (n) => n == null ? '—' : Number(n).toLocaleString('en-CA');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const srcClass = (s) => 'src-' + String(s || '').toLowerCase().replace(/[^a-z]/g, '').replace(/ca$/, '');
  const LEVELS = { exact: ['Exact match', 'green'], close: ['Close match', 'blue'], similar: ['Similar, trim not confirmed', ''], different: ['Different variant', 'orange'] };
  const MODES = [['exact', 'Same trim only'], ['close', 'Same trim or close'], ['broad', 'Same model']];

  async function api(path, opts) {
    const res = await fetch('/api' + path, Object.assign({ headers: { 'content-type': 'application/json' } }, opts || {}));
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || ('Request failed: ' + res.status));
    return body;
  }

  let toastTimer;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
  }
  function setNav(name) { document.querySelectorAll('.navlink').forEach((a) => a.classList.toggle('active', a.dataset.nav === name)); }
  function carTitle(c) { return `${c.year} ${c.make} ${c.model} ${c.trim || ''}`.trim(); }
  function agePill(days) {
    if (days == null) return '';
    const cls = days > 90 ? 'red' : (days > 60 ? 'orange' : (days > 30 ? 'blue' : 'green'));
    return `<span class="pill ${cls}">${days} days in stock</span>`;
  }

  // ---------- Inventory ----------
  async function renderInventory() {
    setNav('inventory');
    main.innerHTML = '<h1>Inventory</h1><div class="sub">Loading…</div>';
    const cars = await api('/inventory');
    const capital = cars.reduce((a, c) => a + c.totalCost, 0);
    main.innerHTML = `
      <div class="inv-head">
        <div><h1>Inventory</h1><div class="sub">Pick a car to check it against the market.</div></div>
        <div class="row"><div class="stat"><div class="label">Cars in stock</div><div class="value">${cars.length}</div></div>
        <div class="stat"><div class="label">Capital tied up</div><div class="value">${money(capital)}</div></div></div>
      </div>
      <div class="grid grid-3">${cars.map((c) => `
        <a class="card car-card" href="#/car/${esc(c.id)}">
          <div class="photo">${c.image ? `<img src="${esc(c.image)}" alt="">` : 'No photo yet'}</div>
          <div class="title" style="font-family: var(--display); font-weight: 600; font-size: 17px">${esc(carTitle(c))}</div>
          <div class="row"><span class="mono" style="font-size: 22px; font-weight: 500">${money(c.listPrice)}</span>${agePill(c.daysInStock)}</div>
          <div class="row" style="gap: 6px"><span class="pill">${num(c.km)} km</span><span class="pill">${esc(c.drivetrain || '')}</span><span class="pill">${esc(c.location || '')}</span></div>
          <div class="sub">Stock ${esc(c.stockNumber || '')} · bought at ${esc(c.source || '')} · cost ${money(c.totalCost)}</div>
          ${(c.offers || []).length ? `<div class="offers">${c.offers.map((o) => `<span class="pill green">${esc(o.label)}</span>`).join('')}</div>` : ''}
        </a>`).join('')}
      </div>`;
  }

  // ---------- Car page ----------
  const state = { result: null, mode: 'close', filter: 'all' };

  async function renderCar(id) {
    setNav('inventory');
    main.innerHTML = '<div class="sub">Loading…</div>';
    let car;
    try { car = await api('/inventory/' + id); } catch (e) { main.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const feats = config.features.filter((f) => (car.features || {})[f.key]).map((f) => f.label);
    main.innerHTML = `
      <a href="#/inventory" class="btn secondary small" style="align-self: flex-start; text-decoration: none; display: inline-flex; align-items: center">Back to inventory</a>
      <div class="inv-head">
        <div>
          <h1>${esc(carTitle(car))}</h1>
          <div class="sub">Stock ${esc(car.stockNumber || '')} · ${num(car.km)} km · ${esc(car.drivetrain || '')} · ${esc(car.colour || '')}${car.bodyStyle ? ` · ${esc(car.bodyStyle)}` : ''} · bought at ${esc(car.source || '')} · at ${esc(car.location || '')}</div>
        </div>
        ${agePill(car.daysInStock)}
      </div>
      <div class="grid grid-stats">
        <div class="stat"><div class="label">List price</div><div class="value" id="cur-price">${money(car.listPrice)}</div></div>
        <div class="stat"><div class="label">Total cost</div><div class="value">${money(car.totalCost)}</div><div class="label">purchase, fees, transport, reconditioning</div></div>
        <div class="stat"><div class="label">Margin at list price</div><div class="value" id="cur-margin">${money(car.listPrice - car.totalCost)}</div></div>
        <div class="stat"><div class="label">Features</div><div style="font-size: 14px">${feats.length ? esc(feats.join(', ')) : 'None recorded'}</div></div>
      </div>
      <section class="card">
        <div class="row between"><div><h2>Current offers</h2><div class="sub">Shown with the listing, next to the price.</div></div></div>
        <div class="offers" id="offers"></div>
      </section>
      <section class="card">
        <div class="row between">
          <div><h2>Market check</h2><div class="sub">Searches AutoTrader.ca, Kijiji and CarGurus.ca within 100 km for the same make and model, then matches on trim, body style and features.</div></div>
          <div class="row"><button class="btn" id="btn-check">Search the market</button><button class="btn secondary" id="btn-refresh" title="Ignore cached results and search again">Refresh</button>
          <a class="btn secondary" style="text-decoration: none; display: inline-flex; align-items: center" href="#/market?from=${esc(car.id)}">Edit specs and search</a></div>
        </div>
        <div id="result"></div>
      </section>`;
    renderOffers(car);
    document.getElementById('btn-check').addEventListener('click', () => runCheck(car, false));
    document.getElementById('btn-refresh').addEventListener('click', () => runCheck(car, true));
    if (state.result && state.result.car && state.result.car.id === car.id) renderResult(car, state.result);
  }

  function renderOffers(car) {
    const el = document.getElementById('offers');
    if (!el) return;
    el.innerHTML = (car.offers || []).length
      ? car.offers.map((o) => `<span class="offer">${esc(o.label)}${o.value ? ` · ${money(o.value)}` : ''}<button data-del="${esc(o.id)}" aria-label="Remove offer ${esc(o.label)}">Remove</button></span>`).join('')
      : '<span class="sub">No offers yet.</span>';
    el.querySelectorAll('button[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const updated = await api(`/inventory/${car.id}/offers/${b.dataset.del}`, { method: 'DELETE' });
      car.offers = updated.offers; renderOffers(car); toast('Offer removed.');
    }));
  }

  async function runCheck(car, refresh, mode) {
    const btn = document.getElementById('btn-check'), out = document.getElementById('result');
    if (btn) btn.disabled = true;
    if (!mode) out.innerHTML = `<div class="banner blue"><span class="spinner"></span>${config.liveAvailable && refresh !== 'cached' ? 'Searching AutoTrader.ca, Kijiji and CarGurus.ca. A live search takes one to three minutes.' : 'Loading comparables…'}</div>`;
    try {
      const body = { refresh: !!refresh, mode: mode || state.mode };
      const r = car.id ? await api(`/inventory/${car.id}/market-check`, { method: 'POST', body: JSON.stringify(body) })
        : await api('/market-check', { method: 'POST', body: JSON.stringify(Object.assign({}, car, body)) });
      state.result = r; state.mode = r.mode; renderResult(car, r);
    } catch (e) { out.innerHTML = `<div class="banner orange">Search failed: ${esc(e.message)}</div>`; }
    if (btn) btn.disabled = false;
  }

  function renderResult(car, r) {
    const out = document.getElementById('result');
    const s = r.stats, rec = r.recommendation;
    const when = r.fetchedAt ? new Date(r.fetchedAt).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '';
    const srcs = Object.keys(s.bySource).map((k) => `<span class="pill ${srcClass(k)}">${esc(k)} · ${s.bySource[k]}</span>`).join('');
    const posCls = s.position === 'above' ? 'color: var(--red-ink)' : (s.position === 'below' ? 'color: var(--blue-ink)' : '');
    const posLabel = !s.askingPrice ? 'No list price' : (s.position === 'above' ? `${s.pctVsMedian}% above the market median` : (s.position === 'below' ? `${Math.abs(s.pctVsMedian)}% below the market median` : 'In line with the market median'));
    const maxB = Math.max.apply(null, r.buckets.map((b) => b.count).concat([1]));
    const dist = r.buckets.length ? `<div class="hist">${r.buckets.map((b) => `<div class="hbar" title="${b.count} between ${money(b.from)} and ${money(b.to)}"><div class="hfill" style="height:${Math.max(4, Math.round(b.count / maxB * 100))}%"></div><div class="hlabel">${b.count}</div></div>`).join('')}</div>
      <div class="row between" style="font-size: 12px; color: var(--muted)"><span>${money(s.low)}</span><span>${money(s.high)}</span></div>
      <div class="markers">${marker('Median', s.median, s, 'med')}${marker('List at', rec.listAt, s, 'rec')}${s.askingPrice ? marker('Yours', s.askingPrice, s, s.position === 'above' ? 'me' : 'rec') : ''}</div>` : '<div class="sub">No comparables in this set.</div>';
    const modeChips = MODES.map((m) => `<button class="chip ${r.mode === m[0] ? 'on' : ''}" data-mode="${m[0]}">${m[1]}</button>`).join('');
    const filterChips = [['all', `All · ${r.listings.length}`]].concat(Object.keys(LEVELS).map((k) => [k, `${LEVELS[k][0]} · ${r.counts[k]}`])).map((f) => `<button class="chip ${state.filter === f[0] ? 'on' : ''}" data-filter="${f[0]}">${f[1]}</button>`).join('');
    const shown = r.listings.filter((l) => state.filter === 'all' || l.level === state.filter);
    const canAct = !!car.id;
    out.innerHTML = `
      <div class="banner ${r.source === 'live' ? 'blue' : 'orange'}">${esc(r.sourceLabel)}${when ? ` · ${when}` : ''}${r.cached ? ' · cached, press Refresh for a new search' : ''}</div>
      <div class="row between" style="margin-top: 12px"><div class="srcs">${srcs}</div><div class="row" style="gap: 6px"><span class="label">Statistics use:</span>${modeChips}</div></div>
      ${r.modeNote ? `<div class="banner orange" style="margin-top: 10px">${esc(r.modeNote)}</div>` : ''}
      <div class="results">
        <div class="results-main">
          <div class="row between"><h2>Similar cars on the market</h2></div>
          <div class="chips" id="filters">${filterChips}</div>
          <div class="listings">${shown.length ? shown.map((l) => listingCard(l)).join('') : '<div class="empty">No listings at this level.</div>'}</div>
        </div>
        <aside class="results-side">
          <div class="stat"><div class="label">Market median, adjusted to this car</div><div class="value">${money(s.median)}</div><div class="label">${s.used} comparables · range ${money(s.low)} to ${money(s.high)}</div></div>
          <div class="stat"><div class="label">Your list price</div><div class="value">${money(s.askingPrice)}</div><div class="label" style="font-weight: 500; ${posCls}">${posLabel}</div></div>
          <div class="reco">
            <h2>Recommendation</h2>
            <div class="tiles">
              <div class="tile primary"><span>List at</span><span class="big">${money(rec.listAt)}</span><span>just under the median</span></div>
              <div class="tile"><span>Floor</span><span class="big">${money(rec.floor)}</span><span>lowest to accept</span></div>
              <div class="tile"><span>Margin at list</span><span class="big">${money(rec.margin)}</span><span>${car.totalCost ? (rec.margin < 0 ? 'below cost' : 'after all costs') : 'no cost entered'}</span></div>
            </div>
            <div style="font-size: 14px">${esc(rec.reason)}</div>
            ${canAct ? `<div class="row">
              <button class="btn small" id="btn-apply" style="background: var(--blue)">Set price to ${money(rec.listAt)}</button>
              <button class="btn secondary small" id="btn-custom" style="background: var(--dark2); color: #FFF; border-color: #FFF">Other price</button>
              <button class="btn secondary small" id="btn-offer" style="background: var(--dark2); color: #FFF; border-color: #FFF">Add an offer</button>
            </div><div id="action-form"></div>` : '<div class="sub" style="color:#B8B8B8">Add this car to inventory to apply a price or offer.</div>'}
          </div>
          <div class="card"><h2>Price distribution</h2><div class="sub">Comparables adjusted to this car's km, year and features.</div>${dist}
            <div class="sub">Signals: ${s.priceCuts} recent price cut${s.priceCuts === 1 ? '' : 's'}${s.avgDaysOnMarket != null ? `, average ${s.avgDaysOnMarket} days on market` : ''}.</div></div>
          <div class="card"><h2>Advantages to highlight</h2>
            ${r.advantages.length ? r.advantages.map((a) => `<div class="row between" style="padding: 8px 10px; background: var(--page); border-radius: 8px; font-size: 14px"><strong>${esc(a.label)}</strong><span class="sub">${esc(a.note)}</span></div>`).join('') : '<div class="sub">Nothing stands out. Record the car\'s features to see where it beats the comparables.</div>'}
            <div class="sub">Lead with these in the photos and the first line of the listing.</div></div>
          <div class="sub">Adjusted price = listing price ± ${r.rates.perKm * 100}¢ per km, ${money(r.rates.perYear)} per model year, and feature differences.</div>
        </aside>
      </div>`;
    out.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { state.mode = b.dataset.mode; runCheck(car, 'cached', b.dataset.mode); }));
    out.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { state.filter = b.dataset.filter; renderResult(car, r); }));
    if (canAct) {
      document.getElementById('btn-apply').addEventListener('click', () => applyPrice(car, rec.listAt, `Market check: median ${money(s.median)}, ${s.used} comparables`));
      document.getElementById('btn-custom').addEventListener('click', () => priceForm(car, rec.listAt));
      document.getElementById('btn-offer').addEventListener('click', () => offerForm(car));
    }
  }

  function marker(label, v, s, cls) {
    const span = (s.high - s.low) || 1;
    const pct = Math.min(100, Math.max(0, (v - s.low) / span * 100));
    return `<div class="marker ${cls}" style="left:${pct}%"><span>${label} ${money(v)}</span></div>`;
  }

  function listingCard(l) {
    const lv = LEVELS[l.level];
    const link = l.url ? `<a class="btn secondary small" href="${esc(l.url)}" target="_blank" rel="noopener" style="text-decoration: none; display: inline-flex; align-items: center">Open on ${esc(l.source)}</a>` : `<span class="sub">No direct link in this sample</span>`;
    return `<article class="listing ${l.included ? '' : 'excluded'}">
      <div class="photo">${l.image ? `<img src="${esc(l.image)}" alt="" loading="lazy">` : 'No photo'}</div>
      <div class="body">
        <div class="row between"><div class="title">${esc(l.title)}</div><span class="pill ${srcClass(l.source)}">${esc(l.source)}</span></div>
        ${l.headline ? `<div class="sub">${esc(l.headline)}</div>` : ''}
        <div class="row"><span class="price">${money(l.price)}</span>${l.dealRating ? `<span class="pill green">${esc(l.dealRating)}</span>` : ''}${l.priceDrop ? '<span class="pill orange">Price dropped</span>' : ''}${l.daysOnMarket != null ? `<span class="pill">${l.daysOnMarket} days listed</span>` : ''}</div>
        <div class="meta"><span class="pill">${num(l.km)} km</span>${l.trim ? `<span class="pill">${esc(l.trim)}</span>` : '<span class="pill orange">Trim not stated</span>'}${l.body ? `<span class="pill">${esc(l.body)}</span>` : ''}${l.transmission ? `<span class="pill">${esc(l.transmission)}</span>` : ''}${l.drivetrain ? `<span class="pill">${esc(l.drivetrain)}</span>` : ''}${l.colour ? `<span class="pill">${esc(l.colour)}</span>` : ''}</div>
        <div class="seller">${esc(l.seller || (l.sellerType === 'private' ? 'Private seller' : 'Seller not named'))}${l.city ? ` · ${esc(l.city)}` : ''}${l.distanceKm != null ? ` · ${num(l.distanceKm)} km away` : ''}</div>
        <div class="adj"><span class="pill ${lv[1]}">${lv[0]}</span>${l.included ? `<span>Adjusted: <span class="eq">${money(l.equivalent)}</span></span>` : '<span class="sub">Not in the statistics</span>'}${(l.matchReasons.concat(l.adjustNotes)).length ? `<span class="sub">${esc(l.matchReasons.concat(l.adjustNotes).join(' · '))}</span>` : ''}</div>
        <div class="row">${link}</div>
      </div>
    </article>`;
  }

  async function applyPrice(car, price, reason) {
    try {
      const updated = await api(`/inventory/${car.id}/price`, { method: 'POST', body: JSON.stringify({ price, reason }) });
      car.listPrice = updated.listPrice;
      document.getElementById('cur-price').textContent = money(updated.listPrice);
      document.getElementById('cur-margin').textContent = money(updated.listPrice - updated.totalCost);
      document.getElementById('action-form').innerHTML = `<div class="banner blue">Price set to ${money(updated.listPrice)}. Update the listing on AutoTrader and the website.</div>`;
      toast(`Price changed to ${money(updated.listPrice)}.`);
    } catch (e) { toast(e.message); }
  }

  function priceForm(car, suggested) {
    const f = document.getElementById('action-form');
    f.innerHTML = `<form style="display: flex; flex-direction: column; gap: 8px"><label class="field" style="color:#FFF">New list price<input class="input" name="price" type="number" min="1" step="50" value="${suggested}"></label>
      <label class="field" style="color:#FFF">Reason<input class="input" name="reason" type="text" value="Beat the market"></label>
      <button class="btn small" type="submit" style="background: var(--blue)">Save price</button></form>`;
    f.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); applyPrice(car, Number(e.target.price.value), e.target.reason.value); });
    f.querySelector('input').focus();
  }

  function offerForm(car) {
    const presets = ['6 months no payment', 'Winter tires included', '1-year extended warranty', 'Free delivery in the GTA', 'Full tank and detailing'];
    const f = document.getElementById('action-form');
    f.innerHTML = `<div style="display: flex; flex-direction: column; gap: 10px">
      <div class="chips">${presets.map((p) => `<button type="button" class="chip" style="background: var(--dark2); color: #FFF; border-color: #FFF" data-preset="${esc(p)}">${esc(p)}</button>`).join('')}</div>
      <form style="display: flex; flex-direction: column; gap: 8px"><label class="field" style="color:#FFF">Offer text<input class="input" name="label" type="text" placeholder="For example: 6 months no payment"></label>
      <label class="field" style="color:#FFF">Cost to you, $<input class="input" name="value" type="number" min="0" step="50" value="0"></label>
      <button class="btn small" type="submit" style="background: var(--blue)">Add offer</button></form></div>`;
    f.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => { f.querySelector('input[name=label]').value = b.dataset.preset; }));
    f.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const updated = await api(`/inventory/${car.id}/offers`, { method: 'POST', body: JSON.stringify({ label: e.target.label.value, value: Number(e.target.value.value) }) });
        car.offers = updated.offers; renderOffers(car);
        f.innerHTML = `<div class="banner blue">Offer added. It will show next to the price in the listing.</div>`;
        toast('Offer added.');
      } catch (err) { toast(err.message); }
    });
  }

  // ---------- Market search (manual specs) ----------
  async function renderMarket(query) {
    setNav('market');
    const from = (query.match(/from=([^&]+)/) || [])[1];
    let seed = { year: '', make: '', model: '', trim: '', bodyStyle: '', km: '', drivetrain: 'AWD', colour: '', listPrice: '', totalCost: '', features: {} };
    if (from) { try { const c = await api('/inventory/' + decodeURIComponent(from)); seed = Object.assign({}, seed, c, { listPrice: c.listPrice || '', totalCost: c.totalCost || '' }); } catch (e) { /* ignore */ } }
    const fields = [['year', 'Year', 'number'], ['make', 'Make', 'text'], ['model', 'Model', 'text'], ['trim', 'Trim or variant', 'text'], ['bodyStyle', 'Body style (Coupe, Sedan, Wagon…)', 'text'], ['km', 'Odometer, km', 'number'], ['colour', 'Exterior colour', 'text'], ['listPrice', 'Your list price', 'number'], ['totalCost', 'Your total cost', 'number']];
    main.innerHTML = `
      <div><h1>Market search</h1><div class="sub">Type the car's specifications and search the market. The trim and body style decide what counts as an exact match.</div></div>
      <form class="card" id="mform">
        <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px">
          ${fields.map((f) => `<label class="field">${f[1]}<input class="input" name="${f[0]}" type="${f[2]}" value="${esc(seed[f[0]] == null ? '' : seed[f[0]])}" ${f[0] === 'year' || f[0] === 'make' || f[0] === 'model' ? 'required' : ''}></label>`).join('')}
        </div>
        <div><div class="label" style="margin-bottom: 6px">Drivetrain</div><div class="chips" id="drive">${['AWD', 'FWD', 'RWD'].map((d) => `<button type="button" class="chip ${seed.drivetrain === d ? 'on' : ''}" data-d="${d}">${d}</button>`).join('')}</div></div>
        <div><div class="label" style="margin-bottom: 6px">Features and condition</div><div class="chips" id="feats">${config.features.map((f) => `<button type="button" class="chip ${(seed.features || {})[f.key] ? 'on' : ''}" data-f="${f.key}" aria-pressed="${!!(seed.features || {})[f.key]}">${esc(f.label)}</button>`).join('')}</div></div>
        <div class="row"><button class="btn" type="submit" id="btn-check">Search the market</button><button class="btn secondary" type="button" id="btn-refresh">Refresh (ignore cache)</button></div>
        <div class="sub">Example from the client: a Porsche Cayenne Coupe. Enter "Cayenne" as the model, "Coupe" as the body style and the trim (for example "GTS"); plain Cayennes are then shown as a different variant and kept out of the statistics.</div>
      </form>
      <section class="card"><div id="result"><div class="sub">Results appear here.</div></div></section>`;
    const form = document.getElementById('mform');
    form.querySelectorAll('#drive .chip').forEach((b) => b.addEventListener('click', () => { form.querySelectorAll('#drive .chip').forEach((x) => x.classList.remove('on')); b.classList.add('on'); }));
    form.querySelectorAll('#feats .chip').forEach((b) => b.addEventListener('click', () => { b.classList.toggle('on'); b.setAttribute('aria-pressed', b.classList.contains('on')); }));
    const read = () => {
      const d = new FormData(form), car = { id: null, features: {} };
      fields.forEach((f) => { car[f[0]] = d.get(f[0]); });
      car.year = Number(car.year); car.km = Number(car.km); car.listPrice = Number(car.listPrice); car.totalCost = Number(car.totalCost);
      car.drivetrain = (form.querySelector('#drive .chip.on') || {}).dataset ? form.querySelector('#drive .chip.on').dataset.d : '';
      form.querySelectorAll('#feats .chip.on').forEach((b) => { car.features[b.dataset.f] = true; });
      return car;
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); state.filter = 'all'; runCheck(read(), false); });
    document.getElementById('btn-refresh').addEventListener('click', () => { if (form.reportValidity()) { state.filter = 'all'; runCheck(read(), true); } });
  }

  // ---------- Audit ----------
  async function renderAudit() {
    setNav('audit');
    const rows = await api('/audit');
    main.innerHTML = `<h1>Audit log</h1><div class="sub">Every market check, price change and offer, newest first.</div>
      <div class="table"><table><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Module</th><th>Record</th><th>Detail</th></tr></thead>
      <tbody>${rows.length ? rows.map((r) => `<tr><td class="mono" style="font-size: 13px; white-space: nowrap">${esc(new Date(r.at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }))}</td><td>${esc(r.user)}</td><td><strong>${esc(r.action)}</strong></td><td>${esc(r.module)}</td><td>${esc(r.target || '')}</td><td>${esc(r.detail || '')}</td></tr>`).join('') : '<tr><td colspan="6" class="sub">Nothing yet. Run a market check to see entries here.</td></tr>'}</tbody></table></div>`;
  }

  // ---------- Router ----------
  async function route() {
    const h = location.hash || '#/inventory';
    const m = h.match(/^#\/car\/([^/?]+)/);
    try {
      if (m) await renderCar(decodeURIComponent(m[1]));
      else if (h.startsWith('#/market')) await renderMarket(h.split('?')[1] || '');
      else if (h.startsWith('#/audit')) await renderAudit();
      else await renderInventory();
    } catch (e) { main.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }

  async function init() {
    config = await api('/config');
    document.getElementById('dealer-name').textContent = config.dealer.name;
    document.getElementById('brand-name').textContent = config.dealer.name;
    document.getElementById('brand-sub').textContent = 'Owner console · ' + config.dealer.city;
    document.getElementById('source-note').textContent = config.liveAvailable
      ? 'Live market search is on: AutoTrader.ca, Kijiji and CarGurus.ca via Apify. Results are cached for 6 hours.'
      : 'Live search is off (no APIFY_TOKEN). Showing bundled sample data.';
    window.addEventListener('hashchange', route);
    route();
  }
  init();
})();
