'use strict';
(function () {
  const main = document.getElementById('main');
  let config = null;
  const money = (n) => n == null ? '—' : '$' + Number(n).toLocaleString('en-CA');
  const num = (n) => n == null ? '—' : Number(n).toLocaleString('en-CA');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Minimal, safe formatting for AI text: escape first, then bold and bullet lines.
  const md = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').split('\n').map((line) => /^\s*[-•]\s+/.test(line) ? `<div class="bul">${line.replace(/^\s*[-•]\s+/, '')}</div>` : line).join('\n');
  const srcClass = (s) => 'src-' + String(s || '').toLowerCase().replace(/[^a-z]/g, '').replace(/ca$/, '');
  const LEVELS = { exact: ['Exact match', 'green'], close: ['Close match', 'blue'], similar: ['Similar, trim not confirmed', ''], different: ['Different variant', 'orange'] };
  const MODES = [['exact', 'Same trim only'], ['close', 'Same trim or close'], ['broad', 'Same model']];

  async function api(path, opts) {
    const res = await fetch('/api' + path, Object.assign({ headers: { 'content-type': 'application/json' } }, opts || {}));
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || ('Request failed: ' + res.status));
    return body;
  }

  function progressBar(pct, message) {
    return `<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div class="progress-head"><span>${esc(message)}</span><span class="mono">${pct}%</span></div><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div></div>`;
  }
  // Follows a background job until it finishes, drawing progress into `el`.
  async function followJob(jobId, el, label) {
    for (;;) {
      const j = await api('/jobs/' + jobId);
      if (j.done) { if (j.error) throw new Error(j.error); return j.result; }
      el.innerHTML = progressBar(j.pct, `${label}: ${j.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
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
        <div class="stat"><div class="label">Capital tied up</div><div class="value">${money(capital)}</div></div>
        <button class="btn" id="btn-import" ${config.liveAvailable ? '' : 'disabled title="Live search is off"'}>Refresh from AutoTrader</button></div>
      </div>
      <div id="import-status"></div>
      ${cars.length ? '' : `<div class="empty">No cars yet. ${config.liveAvailable ? 'Click <strong>Refresh from AutoTrader</strong> to load the dealership\'s current listings.' : 'Live search is off, so nothing can be loaded here.'}</div>`}
      <div class="grid grid-3">${cars.map((c) => `
        <a class="card car-card" href="#/car/${esc(c.id)}">
          <div class="photo">${c.image ? `<img src="${esc(c.image)}" alt="">` : 'No photo yet'}</div>
          <div class="title" style="font-family: var(--display); font-weight: 600; font-size: 17px">${esc(carTitle(c))}</div>
          <div class="row"><span class="mono" style="font-size: 22px; font-weight: 500">${money(c.listPrice)}</span>${c.daysFromListing ? `<span class="pill blue">${c.daysInStock} days listed</span>` : agePill(c.daysInStock)}</div>
          <div class="row" style="gap: 6px"><span class="pill">${num(c.km)} km</span><span class="pill">${esc(c.drivetrain || '')}</span><span class="pill">${esc(c.location || '')}</span></div>
          <div class="sub">${c.stockNumber ? `Stock ${esc(c.stockNumber)} · ` : ''}${c.importSource ? `listed on ${esc(c.importSource)}` : `bought at ${esc(c.source || '')}`}${c.totalCost ? ` · cost ${money(c.totalCost)}` : ' · cost not entered'}</div>
          ${(c.offers || []).length ? `<div class="offers">${c.offers.map((o) => `<span class="pill green">${esc(o.label)}</span>`).join('')}</div>` : ''}
        </a>`).join('')}
      </div>`;
    const imp = document.getElementById('btn-import');
    if (imp) imp.addEventListener('click', async () => {
      imp.disabled = true;
      const box = document.getElementById('import-status');
      box.innerHTML = progressBar(2, 'Refreshing from AutoTrader: starting');
      try {
        const start = await api('/inventory/import', { method: 'POST', body: '{}' });
        const r = await followJob(start.jobId, box, 'Refreshing from AutoTrader');
        toast(`${r.mine} of your listings found: ${r.added} added, ${r.updated} updated.`);
        renderInventory();
      } catch (e) { box.innerHTML = `<div class="banner orange">${esc(e.message)}</div>`; imp.disabled = false; }
    });
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
      <div class="crumbs"><a href="#/inventory">Inventory</a><span>›</span><span>${esc(carTitle(car))}</span></div>
      <section class="card car-head">
        <div class="car-head-photo">${car.image ? `<img src="${esc(car.image)}" alt="">` : 'No photo yet'}</div>
        <div class="car-head-body">
          <div class="row between" style="align-items: flex-start">
            <div><h1>${esc(carTitle(car))}</h1>
            <div class="sub">${car.stockNumber ? `Stock ${esc(car.stockNumber)} · ` : ''}${num(car.km)} km · ${esc(car.drivetrain || '')}${car.colour ? ` · ${esc(car.colour)}` : ''}${car.bodyStyle ? ` · ${esc(car.bodyStyle)}` : ''} · ${car.importSource ? `listed on ${esc(car.importSource)}` : `bought at ${esc(car.source || '')}`} · ${esc(car.location || '')}${car.listingUrl ? ` · <a href="${esc(car.listingUrl)}" target="_blank" rel="noopener">Open listing</a>` : ''}</div>
            ${car.listingHeadline ? `<div class="sub" style="margin-top: 4px">${esc(car.listingHeadline)}</div>` : ''}</div>
            ${car.daysFromListing ? `<span class="pill blue">${car.daysInStock} days listed</span>` : agePill(car.daysInStock)}
          </div>
          <div class="kv">
            <div><div class="label">List price</div><div class="value" id="cur-price">${money(car.listPrice)}</div></div>
            <div><div class="label">Total cost</div><div class="value">${car.totalCost ? money(car.totalCost) : '—'}</div>${car.totalCost ? '' : '<div class="label">not entered</div>'}</div>
            <div><div class="label">Margin at list</div><div class="value" id="cur-margin">${car.totalCost ? money(car.listPrice - car.totalCost) : '—'}</div></div>
          </div>
          <div class="row" style="gap: 6px">${feats.length ? feats.map((f) => `<span class="pill">${esc(f)}</span>`).join('') : '<span class="sub">No features recorded</span>'}</div>
          <div class="row" style="gap: 8px; align-items: center"><span class="label">Offers:</span><span class="offers" id="offers"></span></div>
        </div>
      </section>
      <section class="card">
        <div class="row between">
          <div><h2>Market check</h2><div class="sub">Finds similar cars for sale within 100 km and matches them on trim, body style and features.</div></div>
          <div class="row"><button class="btn" id="btn-check">Search the market</button><button class="btn secondary" id="btn-refresh" title="Ignore cached results and search again">Refresh</button>
          <a class="btn secondary" style="text-decoration: none; display: inline-flex; align-items: center" href="#/market?from=${esc(car.id)}">Edit specs and search</a>
          <button class="btn danger small" id="btn-remove" title="Remove this car from the inventory">Remove</button></div>
        </div>
        <div id="result"></div>
      </section>`;
    renderOffers(car);
    document.getElementById('btn-remove').addEventListener('click', async () => {
      if (!window.confirm(`Remove ${carTitle(car)} from the inventory?`)) return;
      try { await api('/inventory/' + car.id, { method: 'DELETE' }); toast('Car removed.'); location.hash = '#/inventory'; } catch (e) { toast(e.message); }
    });
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
    if (!mode) out.innerHTML = progressBar(1, 'Searching the market: starting');
    try {
      const body = { refresh: refresh === true, mode: mode || state.mode };
      const res = await fetch('/api' + (car.id ? `/inventory/${car.id}/market-check` : '/market-check'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(car.id ? body : Object.assign({}, car, body)) });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || ('Request failed: ' + res.status));
      const r = res.status === 202 ? await followJob(payload.jobId, out, 'Searching the market') : payload;
      state.result = r; state.mode = r.mode; renderResult(car, r);
    } catch (e) { out.innerHTML = `<div class="banner orange">Search failed: ${esc(e.message)}</div>`; }
    if (btn) btn.disabled = false;
  }

  function renderResult(car, r) {
    const out = document.getElementById('result');
    const s = r.stats, rec = r.recommendation;
    const when = r.fetchedAt ? new Date(r.fetchedAt).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '';
    const srcs = Object.keys(s.bySource).map((k) => `<span class="pill ${srcClass(k)}">${esc(k)} · ${s.bySource[k]}</span>`).join('');
    const posCls = s.position === 'above' ? 'var(--red-ink)' : (s.position === 'below' ? 'var(--blue-ink)' : 'var(--ink)');
    const posLabel = !s.askingPrice ? 'No list price' : (s.position === 'above' ? `${s.pctVsMedian}% above the median` : (s.position === 'below' ? `${Math.abs(s.pctVsMedian)}% below the median` : 'In line with the median'));
    const modeChips = MODES.map((m) => `<button class="chip ${r.mode === m[0] ? 'on' : ''}" data-mode="${m[0]}">${m[1]}</button>`).join('');
    const filterChips = [['all', `All · ${r.listings.length}`]].concat(Object.keys(LEVELS).map((k) => [k, `${LEVELS[k][0]} · ${r.counts[k]}`])).map((f) => `<button class="chip ${state.filter === f[0] ? 'on' : ''}" data-filter="${f[0]}">${f[1]}</button>`).join('');
    const shown = r.listings.filter((l) => state.filter === 'all' || l.level === state.filter);
    const canAct = !!car.id;
    const verdictTitle = { raise: 'Room to raise the price', lower: 'Lower the price to move it', keep: 'Keep the price', none: 'No recommendation yet' }[rec.verdict];
    const actionLabel = { raise: `Raise to ${money(rec.listAt)}`, lower: `Lower to ${money(rec.listAt)}`, keep: `Keep ${money(s.askingPrice)}`, none: '' }[rec.verdict];
    const ownPrice = r.own.length ? Math.min.apply(null, r.own.map((o) => o.price)) : 0;
    const ownStrip = r.own.length ? `<section class="own">
        <div class="row between"><div><strong>Your listing on the market</strong><span class="sub"> · ${r.own.length} platform${r.own.length > 1 ? 's' : ''}${rec.listedFor != null ? ` · listed ${rec.listedFor} days` : ''}${s.rank ? ` · ranks ${s.rank} of ${s.used + 1} on price` : ''}</span></div></div>
        <div class="own-row">${r.own.map((o) => `<div class="own-item"><span class="pill ${srcClass(o.source)}">${esc(o.source)}</span><span class="mono" style="font-weight: 600">${money(o.price)}</span>${o.dealRating ? `<span class="pill green">${esc(o.dealRating)}</span>` : ''}${o.daysOnMarket != null ? `<span class="sub">${o.daysOnMarket} days</span>` : ''}${o.url ? `<a href="${esc(o.url)}" target="_blank" rel="noopener">Open</a>` : ''}</div>`).join('')}</div>
        ${canAct && ownPrice && ownPrice !== car.listPrice ? `<div class="row" style="gap: 10px"><span class="sub">The listing says ${money(ownPrice)} but the inventory says ${money(car.listPrice)}.</span><button class="btn secondary small" id="btn-sync">Use the listed price ${money(ownPrice)}</button></div>` : ''}
      </section>` : '';
    out.innerHTML = `
      <div class="banner ${r.source === 'live' ? 'blue' : 'orange'}">${r.source === 'live' ? `Live market search · ${when}` : esc(r.sourceLabel)}${r.cached ? ' · from the last search, press Refresh for a new one' : ''}${r.aiRead ? ' · listings read by AI' : (r.aiError ? ' · AI reading failed, rules used' : '')}</div>
      ${r.modeNote ? `<div class="banner orange" style="margin-top: 10px">${esc(r.modeNote)}</div>` : ''}
      <div class="results">
        <div class="results-main">
          ${ownStrip}
          <div class="row between"><h2>Similar cars on the market</h2><div class="srcs">${srcs}</div></div>
          <div class="chips" id="filters">${filterChips}</div>
          <div class="listings">${shown.length ? shown.map((l) => listingCard(l)).join('') : '<div class="empty">No listings at this level.</div>'}</div>
        </div>
        <aside class="results-side">
          <div class="side-scroll">
          <div class="card compact">
            <h2>Market position</h2>
            <div class="row" style="gap: 6px"><span class="label">Compare with:</span>${modeChips}</div>
            <div class="kv kv-2">
              <div><div class="label">Market median</div><div class="value">${money(s.median)}</div><div class="label">${s.used} comparables, adjusted to this car</div></div>
              <div><div class="label">${rec.isListed ? 'Your current price' : 'Your list price'}</div><div class="value">${money(s.askingPrice)}</div><div class="label" style="font-weight: 600; color: ${posCls}">${posLabel}</div></div>
            </div>
            ${distribution(r)}
            <div class="sub">${s.priceCuts} recent price cut${s.priceCuts === 1 ? '' : 's'}${s.avgDaysOnMarket != null ? ` · comparables average ${s.avgDaysOnMarket} days on market` : ''}</div>
          </div>
          <div class="reco">
            <div class="label" style="color: #B8B8B8">Recommendation</div>
            <h2>${verdictTitle}</h2>
            <div class="tiles">
              <div class="tile ${rec.verdict === 'keep' ? '' : 'primary'}"><span>${rec.verdict === 'keep' ? 'Keep at' : 'Target price'}</span><span class="big">${money(rec.verdict === 'keep' ? s.askingPrice : rec.listAt)}</span><span>${rec.verdict === 'keep' ? 'no change' : (rec.limited ? 'held at your minimum margin' : '2% under the median')}</span></div>
              <div class="tile"><span>Floor</span><span class="big">${money(rec.floor)}</span><span>lowest to accept</span></div>
              <div class="tile"><span>Margin</span><span class="big">${money((rec.verdict === 'keep' ? s.askingPrice : rec.listAt) - (car.totalCost || 0))}</span><span>${car.totalCost ? 'after all costs' : 'no cost entered'}</span></div>
            </div>
            <div style="font-size: 14px; line-height: 1.5">${esc(rec.reason)}</div>
            ${config.aiAvailable && canAct ? `<div id="memo"><button class="btn secondary small" id="btn-memo" style="background: var(--dark2); color: #FFF; border-color: #FFF">Write the memo and listing copy with AI</button></div>` : ''}
            ${canAct ? `<div class="row" style="gap: 8px">
              ${rec.verdict === 'raise' || rec.verdict === 'lower' ? `<button class="btn small" id="btn-apply" style="background: var(--blue)">${actionLabel}</button>` : ''}
              <button class="btn secondary small" id="btn-custom" style="background: var(--dark2); color: #FFF; border-color: #FFF">Other price</button>
              <button class="btn secondary small" id="btn-offer" style="background: var(--dark2); color: #FFF; border-color: #FFF">Add an offer</button>
            </div><div id="action-form"></div>` : '<div class="sub" style="color:#B8B8B8">Add this car to inventory to apply a price or offer.</div>'}
          </div>
          <div class="card compact"><h2>Advantages to highlight</h2>
            ${r.advantages.length ? r.advantages.map((a) => `<div class="row between" style="padding: 8px 10px; background: var(--page); border-radius: 8px; font-size: 14px"><strong>${esc(a.label)}</strong><span class="sub">${esc(a.note)}</span></div>`).join('') : '<div class="sub">Nothing stands out. Record the car\'s features to see where it beats the comparables.</div>'}
            <div class="sub">Lead with these in the photos and the first line of the listing.</div></div>
          <div class="sub" style="padding: 0 4px">Adjusted price = listing price ± ${r.rates.perKm * 100}¢ per km, ${money(r.rates.perYear)} per model year, and feature differences.</div>
          </div>
        </aside>
      </div>`;
    out.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { state.mode = b.dataset.mode; runCheck(car, 'cached', b.dataset.mode); }));
    out.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { state.filter = b.dataset.filter; renderResult(car, r); }));
    const syncBtn = document.getElementById('btn-sync');
    if (syncBtn) syncBtn.addEventListener('click', async () => {
      await applyPrice(car, ownPrice, 'Synced with the live listing');
      runCheck(car, 'cached', r.mode);
    });
    const writeMemo = async () => {
      const box = document.getElementById('memo');
      box.innerHTML = '<div style="font-size: 14px"><span class="spinner" style="border-top-color:#FFF"></span>Claude is reading the comparables and writing (20 to 40 seconds)…</div>';
      try {
        const m = await api(`/inventory/${car.id}/memo`, { method: 'POST', body: JSON.stringify({ mode: r.mode }) });
        box.innerHTML = `<div class="memo"><div class="label" style="color:#B8B8B8">AI pricing memo</div><div style="white-space: pre-line">${md(m.memo)}</div>
          <div class="label" style="color:#B8B8B8; margin-top: 8px">Listing headline</div><div style="font-weight: 600">${esc(m.headline)}</div>
          <div class="label" style="color:#B8B8B8; margin-top: 8px">Listing description</div><div style="white-space: pre-line">${md(m.description)}</div></div>`;
      } catch (e) {
        box.innerHTML = `<div class="banner orange" style="display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; align-items: center"><span>${esc(e.message === 'Load failed' || /fetch/i.test(e.message) ? 'The connection dropped before the memo arrived.' : e.message)}</span><button class="btn secondary small" id="btn-memo-retry">Try again</button></div>`;
        document.getElementById('btn-memo-retry').addEventListener('click', writeMemo);
      }
    };
    const memoBtn = document.getElementById('btn-memo');
    if (memoBtn) memoBtn.addEventListener('click', writeMemo);
    if (canAct) {
      const ap = document.getElementById('btn-apply');
      if (ap) ap.addEventListener('click', () => applyPrice(car, rec.listAt, `Market check: median ${money(s.median)}, ${s.used} comparables`));
      document.getElementById('btn-custom').addEventListener('click', () => priceForm(car, rec.listAt));
      document.getElementById('btn-offer').addEventListener('click', () => offerForm(car));
    }
  }

  // Price distribution: every comparable as a dot on one scale, with the median, target and the dealer's price marked.
  function distribution(r) {
    const s = r.stats, pts = r.points || [];
    if (!pts.length) return '<div class="sub">No comparables in this set.</div>';
    const W = 320, H = 96, padL = 8, padR = 8, base = 44;
    const lo = Math.min(s.low, s.askingPrice || s.low), hi = Math.max(s.high, s.askingPrice || s.high), span = (hi - lo) || 1;
    const x = (v) => padL + (v - lo) / span * (W - padL - padR);
    // Stack dots that land close together.
    const cols = {}, dots = pts.map((v) => { const k = Math.round(x(v) / 9); cols[k] = (cols[k] || 0) + 1; return `<circle cx="${x(v).toFixed(1)}" cy="${base - 6 - (cols[k] - 1) * 9}" r="3.6" fill="#8A8A88"/>`; }).join('');
    const q1 = pts[Math.floor((pts.length - 1) * 0.25)], q3 = pts[Math.floor((pts.length - 1) * 0.75)];
    const mark = (v, color, label, dy, bold) => `<line x1="${x(v).toFixed(1)}" x2="${x(v).toFixed(1)}" y1="${base - 42}" y2="${base + 4}" stroke="${color}" stroke-width="2"/><text x="${x(v).toFixed(1)}" y="${base + dy}" text-anchor="${x(v) < 40 ? 'start' : (x(v) > W - 40 ? 'end' : 'middle')}" font-size="11" font-weight="${bold ? 700 : 500}" fill="${color}">${label} ${money(v)}</text>`;
    return `<svg class="dist" viewBox="0 0 ${W} ${H}" role="img" aria-label="Price distribution of ${pts.length} comparables">
      <rect x="${x(q1).toFixed(1)}" y="${base - 10}" width="${Math.max(2, x(q3) - x(q1)).toFixed(1)}" height="8" rx="4" fill="#E3E8F4"/>
      <line x1="${padL}" x2="${W - padR}" y1="${base}" y2="${base}" stroke="#DCDCDA" stroke-width="2"/>
      ${dots}
      ${mark(s.median, '#151515', 'Median', 18, true)}
      ${s.askingPrice ? mark(s.askingPrice, s.position === 'above' ? '#B4470E' : '#3D62A8', 'You', 34, true) : ''}
      ${r.recommendation.verdict !== 'keep' && r.recommendation.verdict !== 'none' ? mark(r.recommendation.listAt, '#3D62A8', 'Target', 50, false) : ''}
    </svg>
    <div class="row between" style="font-size: 11px; color: var(--muted); margin-top: -4px"><span>${money(s.low)}</span><span>middle half of the market shaded</span><span>${money(s.high)}</span></div>`;
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

  // ---------- Assistant ----------
  const chat = [];
  async function renderAssistant() {
    setNav('assistant');
    main.innerHTML = `<div><h1>Assistant</h1><div class="sub">Ask about the stock, prices, margins and what happened recently. Answers come from the inventory, market checks and the audit log.</div></div>
      ${config.aiAvailable ? '' : '<div class="banner orange">AI is not configured. Add ANTHROPIC_API_KEY in Render to switch it on.</div>'}
      <div class="chips">${['Which cars are over 60 days in stock?', 'Which car has the smallest margin?', 'What changed this week?', 'Which cars are priced above the market?'].map((q) => `<button class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <div class="card" id="chat" style="min-height: 200px">${chat.length ? '' : '<div class="sub">No questions yet.</div>'}</div>
      <form class="row" id="qform" style="align-items: flex-end"><label class="field" style="flex: 1 1 320px">Your question<input class="input" name="q" type="text" placeholder="For example: which cars should I reprice this week?" ${config.aiAvailable ? '' : 'disabled'}></label><button class="btn" type="submit" ${config.aiAvailable ? '' : 'disabled'}>Ask</button></form>`;
    const box = document.getElementById('chat');
    const draw = () => { box.innerHTML = chat.map((m) => `<div class="msg ${m.who}"><div class="label">${m.who === 'you' ? 'You' : 'Assistant'}</div><div style="white-space: pre-line">${md(m.text)}</div></div>`).join('') || '<div class="sub">No questions yet.</div>'; box.scrollTop = box.scrollHeight; };
    draw();
    const send = async (q) => {
      if (!q) return;
      chat.push({ who: 'you', text: q }); chat.push({ who: 'ai', text: '…' }); draw();
      try { const r = await api('/assistant', { method: 'POST', body: JSON.stringify({ question: q }) }); chat[chat.length - 1].text = r.answer; }
      catch (e) { chat[chat.length - 1].text = 'Error: ' + e.message; }
      draw();
    };
    document.getElementById('qform').addEventListener('submit', (e) => { e.preventDefault(); const q = e.target.q.value.trim(); e.target.q.value = ''; send(q); });
    main.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => send(b.dataset.q)));
  }

  // ---------- Router ----------
  async function route() {
    const h = location.hash || '#/inventory';
    const m = h.match(/^#\/car\/([^/?]+)/);
    try {
      if (m) await renderCar(decodeURIComponent(m[1]));
      else if (h.startsWith('#/market')) await renderMarket(h.split('?')[1] || '');
      else if (h.startsWith('#/assistant')) await renderAssistant();
      else if (h.startsWith('#/audit')) await renderAudit();
      else await renderInventory();
    } catch (e) { main.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }

  async function init() {
    config = await api('/config');
    document.getElementById('dealer-name').textContent = config.dealer.name;
    document.getElementById('brand-name').textContent = config.dealer.name;
    document.getElementById('brand-sub').textContent = 'Owner console · ' + config.dealer.city;
    const note = document.getElementById('source-note');
    if (config.liveAvailable) note.remove(); else note.textContent = 'Live search is off (no APIFY_TOKEN). Showing bundled sample data.';
    window.addEventListener('hashchange', route);
    route();
  }
  init();
})();
