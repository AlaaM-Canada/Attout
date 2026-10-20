'use strict';
(function () {
  const main = document.getElementById('main');
  let config = null;
  const money = (n) => n == null ? '—' : '$' + Number(n).toLocaleString('en-CA');
  const num = (n) => n == null ? '—' : Number(n).toLocaleString('en-CA');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Minimal, safe formatting for AI text: escape first, then bold and bullet lines.
  const md = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').split('\n').map((line) => /^\s*[-•]\s+/.test(line) ? `<div class="bul">${line.replace(/^\s*[-•]\s+/, '')}</div>` : line).join('\n');
  const LEVELS = { exact: ['Same trim', 'green'], close: ['Close match', 'blue'], similar: ['Trim not stated', ''], different: ['Different variant', ''] };
  const MODES = [['close', 'Same trim or close'], ['exact', 'Same trim only'], ['broad', 'Same model']];
  const CHEVRON = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
  const when = (iso) => iso ? new Date(iso).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const ago = (iso) => {
    if (!iso) return '';
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 2) return 'just now'; if (m < 60) return `${m} min ago`; if (m < 36 * 60) return `${Math.round(m / 60)} h ago`; return `${Math.round(m / 1440)} days ago`;
  };

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
      if (el) el.innerHTML = progressBar(j.pct, `${label}: ${j.message}`);
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

  // ---------- Small UI pieces: dropdown menu and dialog ----------
  function closeMenus() { document.querySelectorAll('.menu').forEach((m) => m.remove()); }
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu') && !e.target.closest('[data-menu]')) closeMenus(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenus(); const d = document.querySelector('.overlay'); if (d) d.remove(); } });
  function openMenu(anchor, items) {
    if (document.querySelector('.menu')) { closeMenus(); return; }
    const m = document.createElement('div');
    m.className = 'menu'; m.setAttribute('role', 'menu');
    m.innerHTML = items.map((it, i) => it === '-' ? '<div class="menu-sep" aria-hidden="true"></div>' : `<button type="button" role="menuitem" class="menu-item ${it.danger ? 'danger' : ''}" data-i="${i}">${esc(it.label)}</button>`).join('');
    anchor.parentElement.appendChild(m);
    m.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => { closeMenus(); items[Number(b.dataset.i)].onClick(); }));
    anchor.setAttribute('aria-expanded', 'true');
  }
  function dialog(title, bodyHtml, opts) {
    const o = opts || {};
    const old = document.querySelector('.overlay'); if (old) old.remove();
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title"><div class="row between"><h2 id="dlg-title">${esc(title)}</h2><button type="button" class="icon-btn" aria-label="Close" data-close>×</button></div><div class="dialog-body">${bodyHtml}</div></div>`;
    document.body.appendChild(ov);
    const close = () => ov.remove();
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-close]')) close(); });
    const first = ov.querySelector('input, select, textarea, button:not([data-close])'); if (first) first.focus();
    if (o.onOpen) o.onOpen(ov, close);
    return { el: ov, close };
  }

  // ---------- Inventory ----------
  const inv = { filter: '', body: 'All', focus: '', sort: 'newest', view: 'cards', showDelisted: false, note: '' };
  function marketPill(m) {
    if (!m) return '<span class="pill ghost">Not checked</span>';
    if (m.verdict === 'none') return '<span class="pill ghost">No price</span>';
    if (m.position === 'above') return `<span class="pill orange">${m.pctVsMedian}% above market</span>`;
    if (m.position === 'below') return `<span class="pill green">${Math.abs(m.pctVsMedian)}% under market</span>`;
    return '<span class="pill">In line with market</span>';
  }
  async function renderInventory() {
    setNav('inventory');
    main.innerHTML = '<h1>Inventory</h1><div class="sub">Loading…</div>';
    const all = await api('/inventory');
    const live = all.filter((c) => !c.delisted);
    const delisted = all.filter((c) => c.delisted);
    const pool = inv.showDelisted ? all : live;
    const q = inv.filter.trim().toLowerCase();
    const bodies = {};
    live.forEach((c) => { const b = c.bodyStyle || 'Other'; bodies[b] = (bodies[b] || 0) + 1; });
    const unchecked = live.filter((c) => !c.market);
    const above = live.filter((c) => c.market && c.market.position === 'above');
    const raise = live.filter((c) => c.market && c.market.verdict === 'raise');
    const gain = raise.reduce((a, c) => a + Math.max(0, (c.market.listAt || 0) - (c.listPrice || 0)), 0);
    let cars = pool.filter((c) => !q || `${c.year} ${c.make} ${c.model} ${c.trim || ''} ${c.stockNumber || ''} ${c.vin || ''} ${c.bodyStyle || ''} ${c.location || ''}`.toLowerCase().includes(q));
    if (inv.body !== 'All') cars = cars.filter((c) => (c.bodyStyle || 'Other') === inv.body);
    if (inv.focus === 'unchecked') cars = cars.filter((c) => !c.market);
    if (inv.focus === 'above') cars = cars.filter((c) => c.market && c.market.position === 'above');
    if (inv.focus === 'raise') cars = cars.filter((c) => c.market && c.market.verdict === 'raise');
    const sorters = {
      newest: (a, b) => String(b.importedAt || '').localeCompare(String(a.importedAt || '')),
      'price-desc': (a, b) => (b.listPrice || 0) - (a.listPrice || 0),
      'price-asc': (a, b) => (a.listPrice || 0) - (b.listPrice || 0),
      market: (a, b) => Math.abs((b.market || {}).pctVsMedian || 0) - Math.abs((a.market || {}).pctVsMedian || 0),
      km: (a, b) => (a.km || 0) - (b.km || 0)
    };
    cars = cars.slice().sort(sorters[inv.sort] || sorters.newest);
    const synced = live.map((c) => c.importedAt).filter(Boolean).sort().pop();
    const siteName = (config.website || '').replace(/^https?:\/\//, '');
    const canSite = !!config.websiteAvailable, canAT = !!config.liveAvailable;
    const tile = (key, label, value, note, cls) => `<button type="button" class="tile ${cls || ''} ${inv.focus === key ? 'on' : ''}" data-focus="${key}"><span class="label">${label}</span><span class="row" style="gap: 8px; align-items: baseline"><span class="value">${value}</span><span class="note">${note}</span></span></button>`;
    main.innerHTML = `
      <div class="inv-head">
        <div><h1>Inventory</h1><div class="sub">${live.length} car${live.length === 1 ? '' : 's'} on the lot${synced ? ` · synced from ${canSite ? 'the website' : 'AutoTrader'} ${ago(synced)}` : ''}</div></div>
        <div class="row" style="position: relative">
          ${canSite ? '<button class="btn" id="btn-import-site">Refresh from website</button>' : (canAT ? '<button class="btn" id="btn-import">Refresh from AutoTrader</button>' : '')}
          <button type="button" class="icon-btn" id="inv-menu" data-menu aria-label="More actions" aria-haspopup="menu" aria-expanded="false">···</button>
        </div>
      </div>
      <div id="import-status">${inv.note ? `<div class="banner orange">${esc(inv.note)}</div>` : ''}</div>
      ${live.length ? `<section class="tiles3" aria-label="Needs attention">
        ${tile('unchecked', 'Not checked against the market yet', unchecked.length, unchecked.length ? 'Show them ›' : 'All checked')}
        ${tile('above', 'Priced above the market', above.length, above.length ? 'Review these first ›' : 'None', above.length ? 'warn' : '')}
        ${tile('raise', 'Room to raise the price', raise.length, raise.length ? `about ${money(gain)} in total ›` : 'None yet', raise.length ? 'good' : '')}
      </section>` : ''}
      ${all.length ? `<div class="toolbar">
        <label class="search"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><span class="sr-only">Filter the inventory</span><input id="inv-filter" type="search" placeholder="Make, model, stock # or VIN" value="${esc(inv.filter)}"></label>
        <div class="chips" id="body-chips">${[['All', live.length]].concat(Object.keys(bodies).sort((a, b) => bodies[b] - bodies[a]).map((b) => [b, bodies[b]])).map((b) => `<button type="button" class="chip small ${inv.body === b[0] ? 'on' : ''}" data-body="${esc(b[0])}">${esc(b[0])} · ${b[1]}</button>`).join('')}</div>
        <span style="flex: 1 1 auto"></span>
        <label class="inline">Sort <select id="inv-sort" class="select">${[['newest', 'Newest on the website'], ['price-desc', 'Price, high to low'], ['price-asc', 'Price, low to high'], ['market', 'Furthest from the market'], ['km', 'Kilometres']].map((o) => `<option value="${o[0]}" ${inv.sort === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></label>
        <div class="seg" role="group" aria-label="View"><button type="button" data-view="cards" aria-pressed="${inv.view === 'cards'}">Cards</button><button type="button" data-view="list" aria-pressed="${inv.view === 'list'}">List</button></div>
      </div>
      <div class="sub">${cars.length} of ${pool.length} shown${inv.focus ? ` · <a href="#" id="clear-focus">clear the filter</a>` : ''}${inv.showDelisted ? ' · including cars no longer on the website' : ''}</div>` : ''}
      ${all.length ? '' : `<div class="empty">No cars yet. ${canSite ? `Click <strong>Refresh from website</strong> to load everything on ${esc(siteName)}.` : (canAT ? 'Click <strong>Refresh from AutoTrader</strong> to load the dealership\'s current listings.' : 'Live search is off, so nothing can be loaded here.')}</div>`}
      ${inv.view === 'list' ? `<div class="table"><table><thead><tr><th>Car</th><th>Price</th><th>Market</th><th>km</th><th>Body</th><th>Stock</th></tr></thead><tbody>
        ${cars.map((c) => `<tr><td><a href="#/car/${esc(c.id)}"><strong>${esc(carTitle(c))}</strong></a>${c.delisted ? ' <span class="pill ghost">No longer on the website</span>' : ''}</td><td class="mono">${money(c.listPrice)}</td><td>${marketPill(c.market)}</td><td class="mono">${num(c.km)}</td><td>${esc(c.bodyStyle || '')}</td><td class="mono">${esc(c.stockNumber || '')}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="grid grid-3">${cars.map((c) => `
        <a class="card car-card" href="#/car/${esc(c.id)}">
          <div class="photo">${c.image ? `<img src="${esc(c.image)}" alt="" loading="lazy">` : 'No photo yet'}</div>
          <div class="title" style="font-family: var(--display); font-weight: 600; font-size: 16px; line-height: 1.25">${esc(carTitle(c))}</div>
          <div class="row between" style="gap: 6px"><span class="mono" style="font-size: 20px; font-weight: 500">${money(c.listPrice)}</span>${c.delisted ? '<span class="pill ghost">No longer on the website</span>' : marketPill(c.market)}</div>
          <div class="sub">${[num(c.km) + ' km', c.bodyStyle, c.stockNumber ? 'Stock ' + c.stockNumber : ''].filter(Boolean).map(esc).join(' · ')}</div>
        </a>`).join('')}</div>`}`;

    const rerender = () => renderInventory();
    const filt = document.getElementById('inv-filter');
    if (filt) filt.addEventListener('input', () => { inv.filter = filt.value; const pos = filt.selectionStart; rerender().then(() => { const f = document.getElementById('inv-filter'); if (f) { f.focus(); f.setSelectionRange(pos, pos); } }); });
    main.querySelectorAll('[data-body]').forEach((b) => b.addEventListener('click', () => { inv.body = b.dataset.body; rerender(); }));
    main.querySelectorAll('[data-focus]').forEach((b) => b.addEventListener('click', () => { inv.focus = inv.focus === b.dataset.focus ? '' : b.dataset.focus; rerender(); }));
    main.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => { inv.view = b.dataset.view; rerender(); }));
    const cf = document.getElementById('clear-focus'); if (cf) cf.addEventListener('click', (e) => { e.preventDefault(); inv.focus = ''; rerender(); });
    const sort = document.getElementById('inv-sort'); if (sort) sort.addEventListener('change', () => { inv.sort = sort.value; rerender(); });

    const runImport = async (btn, path, label, done) => {
      if (btn) btn.disabled = true;
      const box = document.getElementById('import-status');
      box.innerHTML = progressBar(2, `${label}: starting`);
      try {
        const start = await api(path, { method: 'POST', body: '{}' });
        const r = await followJob(start.jobId, box, label);
        done(r);
        rerender();
      } catch (e) { box.innerHTML = `<div class="banner orange">${esc(e.message)}</div>`; if (btn) btn.disabled = false; }
    };
    const importSite = (btn) => runImport(btn, '/inventory/import-website', 'Refreshing from the website', (r) => { inv.note = ''; toast(`${r.found} cars on the website: ${r.added} added, ${r.updated} updated${r.delisted ? `, ${r.delisted} no longer listed` : ''}.`); });
    const importAT = (btn) => runImport(btn, '/inventory/import', 'Refreshing from AutoTrader', (r) => { inv.note = !r.mine && r.note ? r.note : ''; toast(`${r.mine} of your listings found: ${r.added} added, ${r.updated} updated.`); });
    const bs = document.getElementById('btn-import-site'); if (bs) bs.addEventListener('click', () => importSite(bs));
    const ba = document.getElementById('btn-import'); if (ba) ba.addEventListener('click', () => importAT(ba));
    document.getElementById('inv-menu').addEventListener('click', (e) => {
      const items = [];
      if (canSite && canAT) items.push({ label: 'Refresh from AutoTrader', onClick: () => importAT(null) });
      if (delisted.length) items.push({ label: `${inv.showDelisted ? 'Hide' : 'Show'} ${delisted.length} car${delisted.length === 1 ? '' : 's'} no longer on the website`, onClick: () => { inv.showDelisted = !inv.showDelisted; rerender(); } });
      items.push({ label: 'Export the list (CSV)', onClick: () => exportCsv(pool) });
      openMenu(e.currentTarget, items);
    });
  }
  function exportCsv(cars) {
    const cols = ['year', 'make', 'model', 'trim', 'bodyStyle', 'km', 'stockNumber', 'vin', 'listPrice', 'financePrice', 'totalCost'];
    const cell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lines = [cols.concat(['marketMedian', 'vsMarket', 'suggested', 'checkedAt']).join(',')].concat(cars.map((c) => cols.map((k) => cell(c[k])).concat([cell(c.market ? c.market.median : ''), cell(c.market ? c.market.pctVsMedian + '%' : ''), cell(c.market ? c.market.listAt : ''), cell(c.market ? c.market.checkedAt : '')]).join(',')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = `inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  // ---------- Car page ----------
  const state = { result: null, mode: 'close', showWhy: false, showExcluded: false, open: {} };

  async function renderCar(id) {
    setNav('inventory');
    main.innerHTML = '<div class="sub">Loading…</div>';
    let car;
    try { car = await api('/inventory/' + id); } catch (e) { main.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const feats = config.features.filter((f) => (car.features || {})[f.key]).map((f) => f.label);
    const metaLine = [car.stockNumber ? `Stock ${esc(car.stockNumber)}` : '', `${num(car.km)} km`, car.bodyStyle ? esc(car.bodyStyle) : '', car.drivetrain ? esc(car.drivetrain) : '', car.transmission ? esc(car.transmission) : '', car.colour ? esc(car.colour) : '', esc(car.location || '')].filter(Boolean).join(' · ');
    const linkLine = [car.vin ? `VIN ${esc(car.vin)}` : '', car.websiteUrl ? `<a href="${esc(car.websiteUrl)}" target="_blank" rel="noopener">Open on the website</a>` : '', car.listingUrl ? `<a href="${esc(car.listingUrl)}" target="_blank" rel="noopener">Open on AutoTrader.ca</a>` : '', !car.websiteUrl && !car.listingUrl ? (car.importSource ? `listed on ${esc(car.importSource)}` : (car.source ? `bought at ${esc(car.source)}` : '')) : ''].filter(Boolean).join(' · ');
    main.innerHTML = `
      <div class="crumbs"><a href="#/inventory">Inventory</a><span>›</span><span>${esc(carTitle(car))}</span></div>
      <section class="card car-head">
        <div class="car-head-photo">${car.image ? `<img src="${esc(car.image)}" alt="">` : 'No photo yet'}</div>
        <div class="car-head-body">
          <h1>${esc(carTitle(car))}</h1>
          <div class="sub">${metaLine}</div>
          ${linkLine ? `<div class="sub">${linkLine}</div>` : ''}
          ${car.listingHeadline ? `<div class="sub">${esc(car.listingHeadline)}</div>` : ''}
          <div class="kv kv-tight">
            <div><div class="label">List price</div><div class="value" id="cur-price">${money(car.listPrice)}</div>${car.financePrice ? `<div class="label">${money(car.financePrice)} with financing</div>` : ''}</div>
            <div><div class="label">Total cost</div><div class="value" id="cur-cost">${car.totalCost ? money(car.totalCost) : '—'}</div>${car.totalCost ? '' : '<div class="label"><a href="#" id="link-cost">Enter the cost</a></div>'}</div>
            <div><div class="label">Margin at list</div><div class="value" id="cur-margin">${car.totalCost ? money(car.listPrice - car.totalCost) : '—'}</div></div>
          </div>
          <div class="row" style="gap: 6px">${feats.length ? feats.map((f) => `<span class="pill">${esc(f)}</span>`).join('') : '<span class="sub">No features recorded</span>'}</div>
          <div class="row" style="gap: 8px; align-items: center"><span class="label">Offers:</span><span class="offers" id="offers"></span></div>
        </div>
        <div class="car-head-side">
          <button type="button" class="icon-btn" id="car-menu" data-menu aria-label="More actions" aria-haspopup="menu" aria-expanded="false">···</button>
          ${car.delisted ? '<span class="pill ghost">No longer on the website</span>' : (car.daysFromListing ? `<span class="pill blue">${car.daysInStock} days listed</span>` : (car.daysInStock != null ? `<span class="pill ${car.daysInStock > 60 ? 'orange' : ''}">${car.daysInStock} days in stock</span>` : ''))}
          <div id="own-status"></div>
        </div>
      </section>
      <div id="result" class="stack"></div>`;
    renderOffers(car);
    const lc = document.getElementById('link-cost'); if (lc) lc.addEventListener('click', (e) => { e.preventDefault(); costForm(car); });
    document.getElementById('car-menu').addEventListener('click', (e) => openMenu(e.currentTarget, [
      { label: 'Edit specs and search again', onClick: () => { location.hash = `#/market?from=${encodeURIComponent(car.id)}`; } },
      { label: 'Enter purchase cost', onClick: () => costForm(car) },
      { label: 'Edit car details', onClick: () => detailsForm(car) },
      { label: 'Rewrite the AI memo', onClick: () => writeMemo(car) },
      { label: 'Price history', onClick: () => historyDialog(car) },
      '-',
      { label: 'Remove from inventory', danger: true, onClick: () => removeCar(car) }
    ]));
    const cached = state.result && state.result.car && state.result.car.id === car.id;
    if (cached) renderResult(car, state.result);
    else if (car.market) runCheck(car, 'cached', state.mode);
    else renderIdle(car);
  }

  function renderIdle(car) {
    const out = document.getElementById('result');
    out.innerHTML = `<section class="card idle">
      <div><h2>Check this car against the market</h2><div class="sub">Finds similar cars for sale within ${config.radiusKm || 100} km, matches them on trim, body style and features, and suggests a price.${config.liveAvailable ? ' The first search takes about a minute.' : ''}</div></div>
      <button class="btn" id="btn-check">Search the market</button>
    </section>`;
    document.getElementById('btn-check').addEventListener('click', () => runCheck(car, false));
  }

  function removeCar(car) {
    dialog('Remove this car?', `<p>${esc(carTitle(car))} will disappear from the inventory. The audit log keeps a record.</p><div class="row" style="justify-content: flex-end"><button class="btn secondary" data-close>Cancel</button><button class="btn danger" id="dlg-remove">Remove</button></div>`, {
      onOpen: (el) => el.querySelector('#dlg-remove').addEventListener('click', async () => {
        try { await api('/inventory/' + car.id, { method: 'DELETE' }); toast('Car removed.'); location.hash = '#/inventory'; } catch (e) { toast(e.message); }
      })
    });
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
    const out = document.getElementById('result');
    if (!out) return;
    const quiet = refresh === 'cached' && state.result && state.result.car && state.result.car.id === car.id;
    if (!quiet) out.innerHTML = progressBar(1, refresh === true ? 'Searching the market again: starting' : 'Searching the market: starting');
    try {
      const body = { refresh: refresh === true, mode: mode || state.mode };
      const res = await fetch('/api' + (car.id ? `/inventory/${car.id}/market-check` : '/market-check'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(car.id ? body : Object.assign({}, car, body)) });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || ('Request failed: ' + res.status));
      const r = res.status === 202 ? await followJob(payload.jobId, quiet ? null : out, 'Searching the market') : payload;
      state.result = r; state.mode = r.mode; renderResult(car, r);
    } catch (e) {
      out.innerHTML = `<div class="banner orange row between"><span>Search failed: ${esc(e.message)}</span><button class="btn secondary small" id="btn-retry">Try again</button></div>`;
      document.getElementById('btn-retry').addEventListener('click', () => runCheck(car, refresh, mode));
    }
  }

  function firstSentence(t) { const m = String(t || '').trim().match(/^[\s\S]*?[.!?](?=\s|$)/); return m ? m[0].trim() : String(t || '').trim(); }

  function renderResult(car, r) {
    const out = document.getElementById('result');
    if (!out) return;
    const s = r.stats, rec = r.recommendation, canAct = !!car.id;
    const ask = s.askingPrice;
    const target = rec.verdict === 'keep' ? ask : rec.listAt;
    const delta = target - ask;
    const verdictTitle = { raise: 'Room to raise the price', lower: 'Lower the price to move it', keep: 'The price is right', none: 'No recommendation yet' }[rec.verdict];
    const icon = { raise: '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>', lower: '<path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/>', keep: '<path d="M20 6L9 17l-5-5"/>', none: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/>' }[rec.verdict];
    const iconCls = { raise: 'good', lower: 'warn', keep: 'good', none: '' }[rec.verdict];
    let sentence;
    if (rec.verdict === 'raise') sentence = `You are ${Math.abs(s.pctVsMedian)}% under the median of ${s.used} similar car${s.used === 1 ? '' : 's'}. Listing at <strong>${money(rec.listAt)}</strong> keeps the car under the median and adds <strong>${money(delta)}</strong>.`;
    else if (rec.verdict === 'lower') sentence = `You are ${s.pctVsMedian}% above the median of ${s.used} similar car${s.used === 1 ? '' : 's'}. <strong>${money(rec.listAt)}</strong> puts the car just under the median${rec.limited ? ', held at your minimum margin' : ''}.`;
    else if (rec.verdict === 'keep') sentence = `In line with the median of ${s.used} similar car${s.used === 1 ? '' : 's'}${s.rank ? `, ranking ${s.rank} of ${s.used + 1} on price` : ''}. ${esc(firstSentence(rec.reason.split('. ').slice(1).join('. ')))}`;
    else sentence = esc(rec.reason);
    const aiLine = r.ai && r.ai.memo ? firstSentence(r.ai.memo) : '';
    const ownSites = r.own.reduce((acc, o) => acc.concat(o.sites && o.sites.length ? o.sites : [o]), []);
    const ownPrice = r.own.length ? Math.min.apply(null, r.own.map((o) => o.price)) : 0;
    const included = r.listings.filter((l) => l.included), excluded = r.listings.filter((l) => !l.included);
    const exclCounts = ['similar', 'different'].map((k) => [k, excluded.filter((l) => l.level === k).length]).filter((x) => x[1]);
    const exclText = excluded.length ? `${excluded.length} more listing${excluded.length === 1 ? ' is' : 's are'} not counted: ${exclCounts.map((x) => `${x[1]} ${x[0] === 'similar' ? 'with the trim not stated' : 'different variant' + (x[1] === 1 ? '' : 's')}`).join(', ')}.` : '';
    const sourceNote = r.source === 'live' ? '' : ` · <span class="pill orange">${esc(r.sourceLabel || 'sample data')}</span>`;

    // The dealer's own listing: a status line next to the identity, never a comparable.
    const own = document.getElementById('own-status');
    if (own) own.innerHTML = r.own.length ? `<div class="sub">On the market${rec.listedFor != null ? ` <strong>${rec.listedFor} days</strong>` : ''}${s.rank ? ` · ranks ${s.rank} of ${s.used + 1} on price` : ''}</div><div class="row" style="gap: 6px; justify-content: flex-end">${ownSites.map((o) => o.url ? `<a class="pill link" href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.source)}${o.dealRating ? ` · ${esc(o.dealRating)}` : ''}</a>` : `<span class="pill">${esc(o.source)}</span>`).join('')}</div>` : '';

    out.innerHTML = `
      <section class="card verdict">
        <div class="verdict-top">
          <div class="verdict-text">
            <span class="verdict-icon ${iconCls}" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg></span>
            <div>
              <h2>${verdictTitle}</h2>
              <p>${sentence}</p>
              ${aiLine ? `<p class="ai-line"><span class="ai-tag">AI</span><span>${esc(aiLine)}</span></p>` : ''}
            </div>
          </div>
          <div class="nums">
            <div><div class="label">${rec.isListed ? 'Your current price' : 'Your price'}</div><div class="value">${money(ask)}</div></div>
            <div><div class="label">Market median</div><div class="value">${money(s.median)}</div></div>
            <div class="${rec.verdict === 'raise' || rec.verdict === 'keep' ? 'good' : (rec.verdict === 'lower' ? 'warn' : '')}"><div class="label">${rec.verdict === 'keep' ? 'Keep at' : 'Suggested'}</div><div class="value">${rec.verdict === 'none' ? '—' : money(target)}</div></div>
          </div>
        </div>
        <div class="row" style="gap: 10px">
          ${canAct && (rec.verdict === 'raise' || rec.verdict === 'lower') ? `<button class="btn" id="btn-apply">${rec.verdict === 'raise' ? 'Raise' : 'Lower'} to ${money(rec.listAt)}</button>` : ''}
          ${canAct ? '<button class="btn secondary" id="btn-custom">Other price</button><button class="btn secondary" id="btn-offer">Add an offer</button>' : '<span class="sub">Add the car to the inventory to set a price or an offer.</span>'}
          <span style="flex: 1 1 auto"></span>
          <span class="sub">Checked ${esc(when(r.fetchedAt))}${r.aiRead ? ' · listings read by AI' : ''}${sourceNote} · <a href="#" id="btn-refresh">Search again</a></span>
        </div>
        ${canAct && ownPrice && ownPrice !== car.listPrice ? `<div class="banner orange row between" style="font-weight: 400"><span>Your listing shows ${money(ownPrice)} but the inventory says ${money(car.listPrice)}.</span><button class="btn secondary small" id="btn-sync">Use ${money(ownPrice)}</button></div>` : ''}
        <div class="why">
          <button type="button" class="why-toggle" id="why-toggle" aria-expanded="${state.showWhy}" aria-controls="why-panel"><span class="chev ${state.showWhy ? 'open' : ''}">${CHEVRON}</span><strong>Why this number?</strong><span class="sub">${state.showWhy ? '' : '· where you sit, how the suggestion is made, the AI’s memo'}</span></button>
          <div class="why-panel" id="why-panel" ${state.showWhy ? '' : 'hidden'}>
            <div>
              <div class="h3">Where you sit</div>
              ${distribution(r)}
              <ul class="facts">
                ${s.rank ? `<li><span>Your rank on price</span><strong>${s.rank} of ${s.used + 1}</strong></li>` : ''}
                <li><span>Recent price cuts</span><strong>${s.priceCuts} seller${s.priceCuts === 1 ? '' : 's'}</strong></li>
                ${s.avgDaysOnMarket != null ? `<li><span>Average time on market</span><strong>${s.avgDaysOnMarket} days</strong></li>` : ''}
                <li><span>Listed on</span><strong>${Object.keys(s.bySource).map((k) => `${esc(k.replace('.ca', ''))} ${s.bySource[k]}`).join(' · ') || '—'}</strong></li>
              </ul>
            </div>
            <div>
              <div class="h3">How the suggestion is made</div>
              <p>Each similar car's price is adjusted to your car: ${r.rates.perKm * 100}¢ per km of difference, ${money(r.rates.perYear)} per model year, and the features it has or lacks. The suggestion sits ${r.rates.beatMarketPct}% under the median of those adjusted prices.</p>
              <div class="h3" style="margin-top: 10px">Floor: ${money(rec.floor)}</div>
              <p>${car.totalCost ? `The lowest price worth accepting: ${r.rates.floorPct}% under the median, never less than ${money(r.rates.minMargin)} over your ${money(car.totalCost)} cost. Margin at the suggested price: <strong>${money(target - car.totalCost)}</strong>.` : `The lowest price worth accepting, ${r.rates.floorPct}% under the median. ${canAct ? '<a href="#" id="link-cost2">Enter the purchase cost</a> to see the margin at each price.' : ''}`}</p>
              ${r.modeNote ? `<p class="sub">${esc(r.modeNote)}</p>` : ''}
              ${r.advantages.length ? `<p class="sub">Lead with: ${r.advantages.map((a) => `<span class="pill">${esc(a.label)}</span>`).join(' ')} — ${esc(r.advantages[0].note)}.</p>` : ''}
            </div>
            <div>
              <div class="h3">The AI's memo</div>
              <div id="memo">${r.ai ? `<p style="white-space: pre-line">${md(r.ai.memo)}</p>
                <div class="row" style="gap: 14px"><a href="#" id="copy-toggle">Listing copy for AutoTrader</a>${canAct && config.aiAvailable ? '<a href="#" id="memo-rewrite">Rewrite</a>' : ''}</div>
                <div id="copy" hidden class="copybox"><div class="label">Headline</div><div style="font-weight: 600">${esc(r.ai.headline)}</div><div class="label" style="margin-top: 8px">Description</div><div style="white-space: pre-line">${md(r.ai.description)}</div></div>`
              : `<p>${esc(rec.reason)}</p>${r.aiMemoError ? `<p class="sub">AI write-up failed: ${esc(r.aiMemoError)}</p>` : ''}${canAct && config.aiAvailable ? '<button class="btn secondary small" id="memo-rewrite">Write it with AI</button>' : ''}`}</div>
            </div>
          </div>
        </div>
      </section>

      <section class="similar">
        <div class="row between" style="padding: 4px 0">
          <h2>Similar cars for sale <span class="sub" style="font-size: 16px">· ${included.length} counted</span></h2>
          <label class="inline">Compare with <select class="select" id="mode-select">${MODES.map((m) => `<option value="${m[0]}" ${r.mode === m[0] ? 'selected' : ''}>${m[1]}</option>`).join('')}</select></label>
        </div>
        <div class="rows">${included.length ? included.map((l, i) => listingRow(l, 'in' + i)).join('') : '<div class="empty">No similar cars at this level. Try "Same model".</div>'}</div>
        ${excluded.length ? `<div class="excluded-line"><span>${exclText}</span><a href="#" id="excl-toggle">${state.showExcluded ? 'Hide them' : 'Show them'}</a></div>
        <div class="rows muted" ${state.showExcluded ? '' : 'hidden'}>${excluded.map((l, i) => listingRow(l, 'ex' + i)).join('')}</div>` : ''}
      </section>`;

    // Wiring
    document.getElementById('why-toggle').addEventListener('click', () => { state.showWhy = !state.showWhy; renderResult(car, r); });
    const ex = document.getElementById('excl-toggle'); if (ex) ex.addEventListener('click', (e) => { e.preventDefault(); state.showExcluded = !state.showExcluded; renderResult(car, r); });
    document.getElementById('mode-select').addEventListener('change', (e) => { state.mode = e.target.value; runCheck(car, 'cached', e.target.value); });
    document.getElementById('btn-refresh').addEventListener('click', (e) => { e.preventDefault(); runCheck(car, true, r.mode); });
    out.querySelectorAll('[data-row]').forEach((b) => b.addEventListener('click', () => { const k = b.dataset.row; state.open[k] = !state.open[k]; renderResult(car, r); }));
    const ct = document.getElementById('copy-toggle'); if (ct) ct.addEventListener('click', (e) => { e.preventDefault(); const c = document.getElementById('copy'); c.hidden = !c.hidden; });
    const mr = document.getElementById('memo-rewrite'); if (mr) mr.addEventListener('click', (e) => { e.preventDefault(); writeMemo(car); });
    const lc2 = document.getElementById('link-cost2'); if (lc2) lc2.addEventListener('click', (e) => { e.preventDefault(); costForm(car); });
    const syncBtn = document.getElementById('btn-sync');
    if (syncBtn) syncBtn.addEventListener('click', async () => { await applyPrice(car, ownPrice, 'Synced with the live listing'); runCheck(car, 'cached', r.mode); });
    if (canAct) {
      const ap = document.getElementById('btn-apply');
      if (ap) ap.addEventListener('click', () => confirmPrice(car, r));
      document.getElementById('btn-custom').addEventListener('click', () => priceForm(car, rec.listAt, r));
      document.getElementById('btn-offer').addEventListener('click', () => offerForm(car));
    }
  }

  // Price distribution: every comparable as a dot on one scale, with the median, target and the dealer's price marked.
  function distribution(r) {
    const s = r.stats, pts = r.points || [];
    if (!pts.length) return '<div class="sub">No comparables in this set.</div>';
    const W = 320, H = 106, padL = 8, padR = 8, base = 44;
    const lo = Math.min(s.low, s.askingPrice || s.low), hi = Math.max(s.high, s.askingPrice || s.high), span = (hi - lo) || 1;
    const x = (v) => padL + (v - lo) / span * (W - padL - padR);
    const cols = {}, dots = pts.map((v) => { const k = Math.round(x(v) / 9); cols[k] = (cols[k] || 0) + 1; return `<circle cx="${x(v).toFixed(1)}" cy="${base - 6 - (cols[k] - 1) * 9}" r="3.6" fill="#8A8A88"/>`; }).join('');
    const q1 = pts[Math.floor((pts.length - 1) * 0.25)], q3 = pts[Math.floor((pts.length - 1) * 0.75)];
    const mark = (v, color, label, dy, bold) => `<line x1="${x(v).toFixed(1)}" x2="${x(v).toFixed(1)}" y1="${base - 42}" y2="${base + 4}" stroke="${color}" stroke-width="2"/><text x="${x(v).toFixed(1)}" y="${base + dy}" text-anchor="${x(v) < 40 ? 'start' : (x(v) > W - 40 ? 'end' : 'middle')}" font-size="11" font-weight="${bold ? 700 : 500}" fill="${color}">${label} ${money(v)}</text>`;
    return `<svg class="dist" viewBox="0 0 ${W} ${H}" role="img" aria-label="Price distribution of ${pts.length} comparables">
      <rect x="${x(q1).toFixed(1)}" y="${base - 10}" width="${Math.max(2, x(q3) - x(q1)).toFixed(1)}" height="8" rx="4" fill="#E3E8F4"/>
      <line x1="${padL}" x2="${W - padR}" y1="${base}" y2="${base}" stroke="#DCDCDA" stroke-width="2"/>
      ${dots}
      ${mark(s.median, '#151515', 'Median', 18, true)}
      ${s.askingPrice ? mark(s.askingPrice, s.position === 'above' ? '#B4470E' : '#1F3F74', 'You', 34, true) : ''}
      ${r.recommendation.verdict !== 'keep' && r.recommendation.verdict !== 'none' ? mark(r.recommendation.listAt, '#0B4F44', 'Suggested', 50, false) : ''}
    </svg>
    <div class="row between" style="font-size: 11px; color: var(--muted)"><span>${money(s.low)}</span><span>${pts.length >= 4 ? 'middle half of the market shaded' : ''}</span><span>${money(s.high)}</span></div>`;
  }

  function listingRow(l, key) {
    const lv = LEVELS[l.level];
    const sites = l.sites && l.sites.length ? l.sites : [{ source: l.source, url: l.url, price: l.price }];
    const open = !!state.open[key];
    const sub = [l.seller || (l.sellerType === 'private' ? 'Private seller' : 'Seller not named'), l.city, l.distanceKm != null ? `${num(l.distanceKm)} km away` : '', `${num(l.km)} km`, l.daysOnMarket != null ? `${l.daysOnMarket} days listed` : ''].filter(Boolean).map(esc).join(' · ');
    const notes = (l.matchReasons || []).concat(l.adjustNotes || []);
    return `<article class="rowcard ${l.included ? '' : 'out'}">
      <button type="button" class="rowmain" data-row="${key}" aria-expanded="${open}">
        <span class="thumb" aria-hidden="true">${l.image ? `<img src="${esc(l.image)}" alt="" loading="lazy">` : ''}</span>
        <span class="rowtitle"><span class="t">${esc(l.title)}</span><span class="sub">${sub}</span></span>
        <span class="rowprice"><span class="mono">${money(l.price)}</span><span class="sub">${l.included ? `${money(l.equivalent)} if it were yours` : 'not in the statistics'}</span></span>
        <span class="rowtags"><span class="pill ${lv[1]}">${lv[0]}</span>${sites.length > 1 ? `<span class="sub">${sites.length} sites</span>` : ''}<span class="chev ${open ? 'open' : ''}">${CHEVRON}</span></span>
      </button>
      ${open ? `<div class="rowdetail">
        <div style="flex: 1 1 320px; display: flex; flex-direction: column; gap: 8px">
          ${notes.length ? `<div>${esc(notes.join(' · '))}</div>` : ''}
          ${l.headline ? `<div class="sub">${esc(l.headline)}</div>` : ''}
          <div class="row" style="gap: 6px">${[l.trim ? l.trim : 'Trim not stated', l.body, l.transmission, l.drivetrain, l.colour, l.priceDrop ? 'Price dropped' : '', l.dealRating].filter(Boolean).map((t) => `<span class="pill">${esc(t)}</span>`).join('')}</div>
        </div>
        <div class="row" style="gap: 8px">${sites.filter((st) => st.url).map((st) => `<a class="btn secondary small" href="${esc(st.url)}" target="_blank" rel="noopener" style="text-decoration: none; display: inline-flex; align-items: center; gap: 6px">Open on ${esc(st.source)}${st.price && st.price !== l.price ? `<span class="mono sub">${money(st.price)}</span>` : ''}</a>`).join('') || '<span class="sub">No direct link in this sample</span>'}</div>
      </div>` : ''}
    </article>`;
  }

  // ---------- Actions on a car: price, offers, costs, details ----------
  async function applyPrice(car, price, reason) {
    const updated = await api(`/inventory/${car.id}/price`, { method: 'POST', body: JSON.stringify({ price, reason }) });
    car.listPrice = updated.listPrice; car.priceHistory = updated.priceHistory;
    const p = document.getElementById('cur-price'); if (p) p.textContent = money(updated.listPrice);
    const m = document.getElementById('cur-margin'); if (m) m.textContent = updated.totalCost ? money(updated.listPrice - updated.totalCost) : '—';
    toast(`Price changed to ${money(updated.listPrice)}. Update the listings on AutoTrader and the website.`);
    return updated;
  }

  function confirmPrice(car, r) {
    const rec = r.recommendation, s = r.stats, from = car.listPrice, to = rec.listAt, d = to - from;
    dialog(`${d > 0 ? 'Raise' : 'Lower'} the price to ${money(to)}?`, `
      <div class="row" style="gap: 14px; align-items: baseline"><span class="mono" style="font-size: 18px; color: var(--muted); text-decoration: line-through">${money(from)}</span><span aria-hidden="true" class="sub">→</span><span class="mono" style="font-size: 28px; font-weight: 500">${money(to)}</span><span style="color: ${d > 0 ? 'var(--green-ink)' : 'var(--orange-ink)'}; font-weight: 600">${d > 0 ? '+' : '−'}${money(Math.abs(d))}</span></div>
      <p>${d > 0 ? 'Still' : 'Now'} ${r.rates.beatMarketPct}% under the median of ${s.used} similar car${s.used === 1 ? '' : 's'}${car.totalCost ? `, leaving ${money(to - car.totalCost)} over your cost` : ''}.</p>
      <p class="sub">The change is recorded in the inventory and the audit log. Update the price on AutoTrader and the website yourself; the next market check will confirm it.</p>
      <div class="row" style="justify-content: flex-end"><button class="btn secondary" data-close>Cancel</button><button class="btn" id="dlg-apply">${d > 0 ? 'Raise' : 'Lower'} the price</button></div>`, {
      onOpen: (el, close) => el.querySelector('#dlg-apply').addEventListener('click', async () => {
        try { await applyPrice(car, to, `Market check: median ${money(s.median)}, ${s.used} comparables`); close(); runCheck(car, 'cached', r.mode); } catch (e) { toast(e.message); }
      })
    });
  }

  function priceForm(car, suggested, r) {
    dialog('Set another price', `<form class="form"><label class="field">New list price<input class="input" name="price" type="number" min="1" step="50" value="${suggested || car.listPrice || ''}"></label>
      <label class="field">Reason<input class="input" name="reason" type="text" value="Beat the market"></label>
      <div class="row" style="justify-content: flex-end"><button class="btn secondary" type="button" data-close>Cancel</button><button class="btn" type="submit">Save price</button></div></form>`, {
      onOpen: (el, close) => el.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await applyPrice(car, Number(e.target.price.value), e.target.reason.value); close(); if (r) runCheck(car, 'cached', r.mode); } catch (err) { toast(err.message); }
      })
    });
  }

  function offerForm(car) {
    const presets = ['6 months no payment', 'Winter tires included', '1-year extended warranty', 'Free delivery in the GTA', 'Full tank and detailing'];
    dialog('Add an offer', `<div class="form">
      <div class="chips">${presets.map((p) => `<button type="button" class="chip small" data-preset="${esc(p)}">${esc(p)}</button>`).join('')}</div>
      <form class="form"><label class="field">Offer text<input class="input" name="label" type="text" placeholder="For example: 6 months no payment"></label>
      <label class="field">Cost to you, $<input class="input" name="value" type="number" min="0" step="50" value="0"></label>
      <div class="row" style="justify-content: flex-end"><button class="btn secondary" type="button" data-close>Cancel</button><button class="btn" type="submit">Add offer</button></div></form></div>`, {
      onOpen: (el, close) => {
        el.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => { el.querySelector('input[name=label]').value = b.dataset.preset; }));
        el.querySelector('form').addEventListener('submit', async (e) => {
          e.preventDefault();
          try {
            const updated = await api(`/inventory/${car.id}/offers`, { method: 'POST', body: JSON.stringify({ label: e.target.label.value, value: Number(e.target.value.value) }) });
            car.offers = updated.offers; renderOffers(car); close(); toast('Offer added.');
          } catch (err) { toast(err.message); }
        });
      }
    });
  }

  function costForm(car) {
    const f = [['purchasePrice', 'Purchase price'], ['auctionFees', 'Auction or buying fees'], ['transport', 'Transport'], ['reconditioning', 'Reconditioning and safety']];
    dialog('Purchase cost', `<form class="form">
      <div class="grid" style="grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px">${f.map((x) => `<label class="field">${x[1]}<input class="input" name="${x[0]}" type="number" min="0" step="50" value="${car[x[0]] || ''}"></label>`).join('')}</div>
      <label class="field">Bought on<input class="input" name="purchasedAt" type="date" value="${car.purchasedAt ? String(car.purchasedAt).slice(0, 10) : ''}"></label>
      <div class="sub">The total cost sets the floor and the margin shown with every recommendation.</div>
      <div class="row" style="justify-content: flex-end"><button class="btn secondary" type="button" data-close>Cancel</button><button class="btn" type="submit">Save</button></div></form>`, {
      onOpen: (el, close) => el.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = {}; f.forEach((x) => { body[x[0]] = Number(e.target[x[0]].value) || 0; });
        body.purchasedAt = e.target.purchasedAt.value ? new Date(e.target.purchasedAt.value).toISOString() : null;
        try { await api('/inventory/' + car.id, { method: 'PUT', body: JSON.stringify(body) }); close(); toast('Cost saved.'); state.result = null; renderCar(car.id); } catch (err) { toast(err.message); }
      })
    });
  }

  function detailsForm(car) {
    const f = [['year', 'Year', 'number'], ['make', 'Make', 'text'], ['model', 'Model', 'text'], ['trim', 'Trim', 'text'], ['bodyStyle', 'Body style', 'text'], ['km', 'Odometer, km', 'number'], ['drivetrain', 'Drivetrain', 'text'], ['colour', 'Colour', 'text'], ['stockNumber', 'Stock #', 'text'], ['location', 'Location', 'text']];
    dialog('Car details', `<form class="form">
      <div class="grid" style="grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px">${f.map((x) => `<label class="field">${x[1]}<input class="input" name="${x[0]}" type="${x[2]}" value="${esc(car[x[0]] == null ? '' : car[x[0]])}"></label>`).join('')}</div>
      <div><div class="label" style="margin-bottom: 6px">Features and condition</div><div class="chips">${config.features.map((x) => `<button type="button" class="chip small ${(car.features || {})[x.key] ? 'on' : ''}" data-f="${x.key}" aria-pressed="${!!(car.features || {})[x.key]}">${esc(x.label)}</button>`).join('')}</div></div>
      <div class="row" style="justify-content: flex-end"><button class="btn secondary" type="button" data-close>Cancel</button><button class="btn" type="submit">Save</button></div></form>`, {
      onOpen: (el, close) => {
        el.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { b.classList.toggle('on'); b.setAttribute('aria-pressed', b.classList.contains('on')); }));
        el.querySelector('form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const body = { features: {} };
          f.forEach((x) => { const v = e.target[x[0]].value; body[x[0]] = x[2] === 'number' ? Number(v) || 0 : v; });
          el.querySelectorAll('[data-f].on').forEach((b) => { body.features[b.dataset.f] = true; });
          try { await api('/inventory/' + car.id, { method: 'PUT', body: JSON.stringify(body) }); close(); toast('Details saved.'); state.result = null; renderCar(car.id); } catch (err) { toast(err.message); }
        });
      }
    });
  }

  function historyDialog(car) {
    const h = (car.priceHistory || []).slice().reverse();
    dialog('Price history', h.length ? `<div class="table"><table style="min-width: 0"><thead><tr><th>When</th><th>From</th><th>To</th><th>Reason</th></tr></thead><tbody>${h.map((x) => `<tr><td class="mono" style="font-size: 13px">${esc(when(x.at))}</td><td class="mono">${money(x.from)}</td><td class="mono">${money(x.to)}</td><td>${esc(x.reason || '')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="sub">No price changes recorded yet.</p>');
  }

  async function writeMemo(car) {
    if (!car.id) return;
    if (!config.aiAvailable) { toast('AI is not configured.'); return; }
    const box = document.getElementById('memo');
    const target = box || document.getElementById('result');
    target.innerHTML = progressBar(5, 'Writing the recommendation');
    try {
      const start = await api(`/inventory/${car.id}/memo`, { method: 'POST', body: JSON.stringify({ mode: state.mode }) });
      const fresh = await followJob(start.jobId, target, 'Writing the recommendation');
      state.result = fresh; renderResult(car, fresh);
    } catch (e) {
      target.innerHTML = `<div class="banner orange row between"><span>${esc(e.message)}</span><button class="btn secondary small" id="btn-memo-retry">Try again</button></div>`;
      document.getElementById('btn-memo-retry').addEventListener('click', () => writeMemo(car));
    }
  }

  // ---------- Market search (manual specs) ----------
  async function renderMarket(query) {
    setNav('market');
    const from = (query.match(/from=([^&]+)/) || [])[1];
    let seed = { year: '', make: '', model: '', trim: '', bodyStyle: '', km: '', drivetrain: 'AWD', colour: '', listPrice: '', totalCost: '', features: {} };
    if (from) { try { const c = await api('/inventory/' + decodeURIComponent(from)); seed = Object.assign({}, seed, c, { listPrice: c.listPrice || '', totalCost: c.totalCost || '' }); } catch (e) { /* ignore */ } }
    const fields = [['year', 'Year', 'number'], ['make', 'Make', 'text'], ['model', 'Model', 'text'], ['trim', 'Trim or variant', 'text'], ['bodyStyle', 'Body style (Coupe, Sedan, Wagon…)', 'text'], ['km', 'Odometer, km', 'number'], ['colour', 'Exterior colour', 'text'], ['listPrice', 'Your list price', 'number'], ['totalCost', 'Your total cost', 'number']];
    main.innerHTML = `
      <div><h1>Market search</h1><div class="sub">Type the car's specifications and search the market. The trim and body style decide what counts as the same car.</div></div>
      <form class="card" id="mform">
        <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px">
          ${fields.map((f) => `<label class="field">${f[1]}<input class="input" name="${f[0]}" type="${f[2]}" value="${esc(seed[f[0]] == null ? '' : seed[f[0]])}" ${f[0] === 'year' || f[0] === 'make' || f[0] === 'model' ? 'required' : ''}></label>`).join('')}
        </div>
        <div><div class="label" style="margin-bottom: 6px">Drivetrain</div><div class="chips" id="drive">${['AWD', 'FWD', 'RWD'].map((d) => `<button type="button" class="chip ${seed.drivetrain === d ? 'on' : ''}" data-d="${d}">${d}</button>`).join('')}</div></div>
        <div><div class="label" style="margin-bottom: 6px">Features and condition</div><div class="chips" id="feats">${config.features.map((f) => `<button type="button" class="chip ${(seed.features || {})[f.key] ? 'on' : ''}" data-f="${f.key}" aria-pressed="${!!(seed.features || {})[f.key]}">${esc(f.label)}</button>`).join('')}</div></div>
        <div class="row"><button class="btn" type="submit" id="btn-check">Search the market</button><button class="btn secondary" type="button" id="btn-refresh-form">Search again (ignore the cache)</button></div>
      </form>
      <div id="result" class="stack"><div class="sub">Results appear here.</div></div>`;
    const form = document.getElementById('mform');
    form.querySelectorAll('#drive .chip').forEach((b) => b.addEventListener('click', () => { form.querySelectorAll('#drive .chip').forEach((x) => x.classList.remove('on')); b.classList.add('on'); }));
    form.querySelectorAll('#feats .chip').forEach((b) => b.addEventListener('click', () => { b.classList.toggle('on'); b.setAttribute('aria-pressed', b.classList.contains('on')); }));
    const read = () => {
      const d = new FormData(form), car = { id: null, features: {} };
      fields.forEach((f) => { car[f[0]] = d.get(f[0]); });
      car.year = Number(car.year); car.km = Number(car.km); car.listPrice = Number(car.listPrice); car.totalCost = Number(car.totalCost);
      car.drivetrain = form.querySelector('#drive .chip.on') ? form.querySelector('#drive .chip.on').dataset.d : '';
      form.querySelectorAll('#feats .chip.on').forEach((b) => { car.features[b.dataset.f] = true; });
      return car;
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); runCheck(read(), false); });
    document.getElementById('btn-refresh-form').addEventListener('click', () => { if (form.reportValidity()) runCheck(read(), true); });
  }

  // ---------- Audit ----------
  async function renderAudit() {
    setNav('audit');
    const rows = await api('/audit');
    main.innerHTML = `<h1>Audit log</h1><div class="sub">Every market check, price change and offer, newest first.</div>
      <div class="table"><table><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Module</th><th>Record</th><th>Detail</th></tr></thead>
      <tbody>${rows.length ? rows.map((r) => `<tr><td class="mono" style="font-size: 13px; white-space: nowrap">${esc(when(r.at))}</td><td>${esc(r.user)}</td><td><strong>${esc(r.action)}</strong></td><td>${esc(r.module)}</td><td>${esc(r.target || '')}</td><td>${esc(r.detail || '')}</td></tr>`).join('') : '<tr><td colspan="6" class="sub">Nothing yet. Run a market check to see entries here.</td></tr>'}</tbody></table></div>`;
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
    closeMenus();
    const ov = document.querySelector('.overlay'); if (ov) ov.remove();
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
