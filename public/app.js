'use strict';
(function () {
  const main = document.getElementById('main');
  let config = null;
  const money = (n) => n == null ? '—' : '$' + Number(n).toLocaleString('en-CA');
  const num = (n) => n == null ? '—' : Number(n).toLocaleString('en-CA');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const srcClass = (s) => 'src-' + String(s || '').toLowerCase().replace(/[^a-z]/g, '').replace(/ca$/, '');

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

  function setNav(name) {
    document.querySelectorAll('.navlink').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
  }

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
          <div class="row between"><div class="title" style="font-family: var(--display); font-weight: 600; font-size: 17px">${esc(carTitle(c))}</div></div>
          <div class="row"><span class="mono" style="font-size: 22px; font-weight: 500">${money(c.listPrice)}</span>${agePill(c.daysInStock)}</div>
          <div class="row" style="gap: 6px"><span class="pill">${num(c.km)} km</span><span class="pill">${esc(c.drivetrain || '')}</span><span class="pill">${esc(c.location || '')}</span></div>
          <div class="sub">Stock ${esc(c.stockNumber || '')} · bought at ${esc(c.source || '')} · cost ${money(c.totalCost)}</div>
          ${(c.offers || []).length ? `<div class="offers">${c.offers.map((o) => `<span class="pill green">${esc(o.label)}</span>`).join('')}</div>` : ''}
        </a>`).join('')}
      </div>`;
  }

  // ---------- Car page ----------
  let lastResult = null;
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
          <div class="sub">Stock ${esc(car.stockNumber || '')} · ${num(car.km)} km · ${esc(car.drivetrain || '')} · ${esc(car.colour || '')} · bought at ${esc(car.source || '')} · at ${esc(car.location || '')}</div>
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
        <div class="row between">
          <div><h2>Current offers</h2><div class="sub">Shown with the listing, next to the price.</div></div>
        </div>
        <div class="offers" id="offers"></div>
      </section>
      <section class="card">
        <div class="row between">
          <div><h2>Market check</h2><div class="sub">Finds similar cars on AutoTrader.ca, Kijiji and CarGurus.ca within ${config.rates ? '' : ''}100 km, adjusts each to this car, and recommends a price.</div></div>
          <div class="row"><button class="btn" id="btn-check">Search the market</button><button class="btn secondary" id="btn-refresh" title="Ignore cached results and search again">Refresh</button></div>
        </div>
        <div id="result"></div>
      </section>`;
    renderOffers(car);
    document.getElementById('btn-check').addEventListener('click', () => runCheck(car, false));
    document.getElementById('btn-refresh').addEventListener('click', () => runCheck(car, true));
    if (lastResult && lastResult.car.id === car.id) renderResult(car, lastResult);
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

  async function runCheck(car, refresh) {
    const btn = document.getElementById('btn-check'), out = document.getElementById('result');
    btn.disabled = true;
    out.innerHTML = `<div class="banner blue"><span class="spinner"></span>${config.liveAvailable ? 'Searching AutoTrader.ca, Kijiji and CarGurus.ca. A live search takes one to three minutes.' : 'Loading comparables…'}</div>`;
    try {
      const r = await api(`/inventory/${car.id}/market-check`, { method: 'POST', body: JSON.stringify({ refresh }) });
      lastResult = r; renderResult(car, r);
    } catch (e) { out.innerHTML = `<div class="banner orange">Search failed: ${esc(e.message)}</div>`; }
    btn.disabled = false;
  }

  function renderResult(car, r) {
    const out = document.getElementById('result');
    const s = r.stats, rec = r.recommendation;
    const when = r.fetchedAt ? new Date(r.fetchedAt).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '';
    const srcs = Object.keys(s.bySource).map((k) => `<span class="pill ${srcClass(k)}">${esc(k)} · ${s.bySource[k]}</span>`).join('');
    const used = r.listings.filter((l) => l.included);
    const lo = s.low, range = (s.high - s.low) || 1;
    const bar = (name, v, cls, bold) => `<div class="bar-row"><div class="name" style="font-weight:${bold ? 600 : 400}">${esc(name)}</div><div class="track"><div class="fill ${cls}" style="width:${Math.max(3, Math.round((v - lo) / range * 100))}%"></div></div><div class="price">${money(v)}</div></div>`;
    const bars = used.map((l) => ({ n: `${l.source}, ${num(l.km)} km`, v: l.equivalent, c: '', b: false }))
      .concat([{ n: 'Market median', v: s.median, c: 'med', b: true }, { n: 'Recommended list price', v: rec.listAt, c: 'rec', b: true }])
      .concat(s.askingPrice ? [{ n: 'Your list price', v: s.askingPrice, c: 'me', b: true }] : [])
      .sort((a, b) => a.v - b.v).map((x) => bar(x.n, x.v, x.c, x.b)).join('');
    const posCls = s.position === 'above' ? 'color: var(--red-ink)' : (s.position === 'below' ? 'color: var(--blue-ink)' : '');
    const posLabel = !s.askingPrice ? 'No list price' : (s.position === 'above' ? `${s.pctVsMedian}% above the market median` : (s.position === 'below' ? `${Math.abs(s.pctVsMedian)}% below the market median` : 'In line with the market median'));
    out.innerHTML = `
      <div class="banner ${r.source === 'live' ? 'blue' : 'orange'}">${esc(r.sourceLabel)}${when ? ` · ${when}` : ''}${r.cached ? ' · cached result, press Refresh for a new search' : ''}</div>
      <div class="srcs" style="margin-top: 12px">${srcs}</div>
      <div class="grid grid-stats" style="margin-top: 12px">
        <div class="stat"><div class="label">Market median, adjusted to this car</div><div class="value">${money(s.median)}</div><div class="label">range ${money(s.low)} to ${money(s.high)}</div></div>
        <div class="stat"><div class="label">Your list price</div><div class="value">${money(s.askingPrice)}</div><div class="label" style="font-weight: 500; ${posCls}">${posLabel}</div></div>
        <div class="stat"><div class="label">Comparables</div><div class="value">${s.used}</div><div class="label">${s.excluded} shown but excluded (different variant)</div></div>
        <div class="stat"><div class="label">Market signals</div><div class="value">${s.priceCuts}</div><div class="label">recent price cuts${s.avgDaysOnMarket != null ? ` · avg ${s.avgDaysOnMarket} days on market` : ''}</div></div>
      </div>
      <div class="reco" style="margin-top: 16px">
        <h2>Recommendation</h2>
        <div class="tiles">
          <div class="tile primary"><span>List at</span><span class="big">${money(rec.listAt)}</span><span>just under the market median</span></div>
          <div class="tile"><span>Floor for negotiation</span><span class="big">${money(rec.floor)}</span><span>lowest price to accept</span></div>
          <div class="tile"><span>Margin at list price</span><span class="big">${money(rec.margin)}</span><span>${rec.margin < 0 ? 'below cost: bought above the market' : 'after all costs'}</span></div>
        </div>
        <div>${esc(rec.reason)}</div>
        <div class="row">
          <button class="btn" id="btn-apply" style="background: var(--blue)">Set price to ${money(rec.listAt)}</button>
          <button class="btn secondary" id="btn-custom" style="background: var(--dark2); color: #FFF; border-color: #FFF">Set a different price</button>
          <button class="btn secondary" id="btn-offer" style="background: var(--dark2); color: #FFF; border-color: #FFF">Add an offer instead</button>
        </div>
        <div id="action-form"></div>
      </div>
      <div class="grid grid-3" style="margin-top: 16px; align-items: start">
        <section class="card"><h2>Where this car sits</h2><div class="sub">Each bar is a comparable, adjusted to this car's kilometres, year and features.</div><div class="bars">${bars}</div></section>
        <section class="card"><h2>Advantages to highlight</h2>
          ${r.advantages.length ? r.advantages.map((a) => `<div class="row between" style="padding: 10px 12px; background: var(--page); border-radius: 8px"><strong>${esc(a.label)}</strong><span class="sub">${esc(a.note)}</span></div>`).join('') : '<div class="sub">Nothing stands out. Record the car\'s features to see where it beats the comparables.</div>'}
          <div class="sub">Lead with these in the photos and the first line of the listing.</div></section>
      </div>
      <h2 style="margin-top: 16px">Similar cars on the market (${r.listings.length})</h2>
      <div class="sub">Sorted by adjusted price. "Adjusted" is what the listing would cost if it were this car: ${r.rates.perKm * 100} cents per km, ${money(r.rates.perYear)} per model year, plus feature differences.</div>
      <div class="listings" style="margin-top: 8px">${r.listings.map((l) => listingCard(l)).join('')}</div>`;
    document.getElementById('btn-apply').addEventListener('click', () => applyPrice(car, rec.listAt, `Market check: median ${money(s.median)}, ${s.used} comparables`));
    document.getElementById('btn-custom').addEventListener('click', () => priceForm(car, rec.listAt));
    document.getElementById('btn-offer').addEventListener('click', () => offerForm(car));
  }

  function listingCard(l) {
    const sim = l.similarity === 'close' ? '<span class="pill green">Close match</span>' : (l.similarity === 'similar' ? '<span class="pill blue">Similar</span>' : '<span class="pill orange">Different variant, excluded</span>');
    const link = l.url ? `<a class="btn secondary small" href="${esc(l.url)}" target="_blank" rel="noopener" style="text-decoration: none; display: inline-flex; align-items: center">Open on ${esc(l.source)}</a>` : `<span class="sub">No direct link in this sample</span>`;
    return `<article class="listing ${l.included ? '' : 'excluded'}">
      <div class="photo">${l.image ? `<img src="${esc(l.image)}" alt="">` : 'No photo'}</div>
      <div class="body">
        <div class="row between"><div class="title">${esc(l.title)}</div><span class="pill ${srcClass(l.source)}">${esc(l.source)}</span></div>
        ${l.headline ? `<div class="sub">${esc(l.headline)}</div>` : ''}
        <div class="row"><span class="price">${money(l.price)}</span>${l.dealRating ? `<span class="pill green">${esc(l.dealRating)}</span>` : ''}${l.priceDrop ? '<span class="pill orange">Price dropped</span>' : ''}${l.daysOnMarket != null ? `<span class="pill">${l.daysOnMarket} days listed</span>` : ''}</div>
        <div class="meta"><span class="pill">${num(l.km)} km</span>${l.transmission ? `<span class="pill">${esc(l.transmission)}</span>` : ''}${l.drivetrain ? `<span class="pill">${esc(l.drivetrain)}</span>` : ''}${l.fuel ? `<span class="pill">${esc(l.fuel)}</span>` : ''}${l.colour ? `<span class="pill">${esc(l.colour)}</span>` : ''}</div>
        <div class="seller">${esc(l.seller || (l.sellerType === 'private' ? 'Private seller' : 'Seller not named'))}${l.city ? ` · ${esc(l.city)}` : ''}${l.distanceKm != null ? ` · ${num(l.distanceKm)} km away` : ''}</div>
        <div class="adj">${sim}${l.included ? `<span>Adjusted to this car: <span class="eq">${money(l.equivalent)}</span></span>` : ''}${l.adjustNotes.length ? `<span class="sub">${esc(l.adjustNotes.join(', '))}</span>` : ''}</div>
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
    f.innerHTML = `<form class="row" style="align-items: flex-end"><label class="field" style="color:#FFF">New list price<input class="input" name="price" type="number" min="1" step="50" value="${suggested}" style="width: 180px"></label>
      <label class="field" style="color:#FFF; flex: 1 1 240px">Reason<input class="input" name="reason" type="text" placeholder="Why this price" value="Beat the market"></label>
      <button class="btn" type="submit" style="background: var(--blue)">Save price</button></form>`;
    f.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); applyPrice(car, Number(e.target.price.value), e.target.reason.value); });
    f.querySelector('input').focus();
  }

  function offerForm(car) {
    const presets = ['6 months no payment', 'Winter tires included', '1-year extended warranty', 'Free delivery in the GTA', 'Full tank and detailing'];
    const f = document.getElementById('action-form');
    f.innerHTML = `<div style="display: flex; flex-direction: column; gap: 10px">
      <div class="chips">${presets.map((p) => `<button type="button" class="chip" data-preset="${esc(p)}">${esc(p)}</button>`).join('')}</div>
      <form class="row" style="align-items: flex-end"><label class="field" style="color:#FFF; flex: 1 1 260px">Offer text<input class="input" name="label" type="text" placeholder="For example: 6 months no payment"></label>
      <label class="field" style="color:#FFF">Cost to you, $<input class="input" name="value" type="number" min="0" step="50" value="0" style="width: 140px"></label>
      <button class="btn" type="submit" style="background: var(--blue)">Add offer</button></form></div>`;
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
    const m = h.match(/^#\/car\/([^/]+)/);
    try {
      if (m) await renderCar(decodeURIComponent(m[1]));
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
