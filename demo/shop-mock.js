/* BRUNITO demo runtime.
 *
 * The storefront pages are the original BRUNITO theme. The theme talks to Shopify's
 * Ajax Cart API and Section Rendering API; this file answers those requests in the
 * browser instead, so the cart, the cart drawer, quantities and search keep working on
 * static hosting. Nothing is sent anywhere: the cart lives in localStorage and checkout
 * shows a "purchases are disabled" notice.
 */
(function () {
  'use strict';
  const CFG = window.BRUNITO_DEMO || { base: '' };
  const BASE = CFG.base;
  const KEY = 'brunito-demo-cart-v1';
  const CURRENCY = 'EUR';
  // Where "back to portfolio" leads: the page the visitor came from when it is one of
  // Carla's sites, otherwise her portfolio.
  const PORTFOLIO = (() => {
    try {
      const r = new URL(document.referrer);
      if (r.hostname === 'carlatres3.github.io' && !r.pathname.startsWith(BASE + '/')) { sessionStorage.setItem('brunito-demo-from', r.href); return r.href; }
    } catch {}
    try { const saved = sessionStorage.getItem('brunito-demo-from'); if (saved) return saved; } catch {}
    return CFG.portfolio || 'https://carlatres3.github.io/carla-tres-portfolio/';
  })();
  const NOTICE = {
    es: 'Esta es una demo interactiva de ecommerce. Las compras están desactivadas.',
    en: 'This is an interactive ecommerce demo. Purchases are disabled.',
  };

  // Shopify globals the theme reads.
  window.Shopify = Object.assign(window.Shopify || {}, {
    shop: 'brunito-demo', locale: 'es', country: 'ES', designMode: false,
    currency: { active: CURRENCY, rate: '1.0' }, routes: { root: BASE + '/' },
  });

  // ── Catalogue ──────────────────────────────────────────────────────────────
  // Written by tools/build.mjs into demo/data.js, loaded just before this file.
  const catalogue = window.BRUNITO_CATALOGUE || [];
  const loadCatalogueSync = () => catalogue;
  const catalogueReady = Promise.resolve(catalogue);
  function findVariant(id) {
    for (const p of loadCatalogueSync()) for (const v of p.variants) if (String(v.id) === String(id)) return { p, v };
    return null;
  }

  // ── Money ──────────────────────────────────────────────────────────────────
  const cents = price => Number(price); // catalogue prices are already in cents
  function money(c) {
    const [i, d] = (c / 100).toFixed(2).split('.');
    return '€' + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d;
  }
  const moneyWithCurrency = c => money(c) + ' ' + CURRENCY;

  // ── Cart state ─────────────────────────────────────────────────────────────
  function readLines() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } }
  function writeLines(lines) { try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch {} }
  const lineKey = id => `${id}:demo${String(id).slice(-6)}`;

  function lineItem(line, index) {
    const hit = findVariant(line.id); if (!hit) return null;
    const { p, v } = hit;
    const price = cents(v.price), compare = v.compare_at_price ? cents(v.compare_at_price) : null;
    const options = p.options.map((name, i) => ({ name, value: v.options[i] })).filter(o => o.value && o.value !== 'Default Title');
    return {
      id: v.id, variant_id: v.id, key: lineKey(v.id), quantity: line.quantity, title: v.title === 'Default Title' ? p.title : `${p.title} - ${v.title}`,
      product_title: p.title, variant_title: v.title === 'Default Title' ? null : v.title, product_id: p.id, handle: p.handle,
      price, original_price: price, discounted_price: price, line_price: price * line.quantity, original_line_price: price * line.quantity,
      final_price: price, final_line_price: price * line.quantity, compare_at_price: compare, total_discount: 0, discounts: [],
      url: `${BASE}/products/${p.handle}/?variant=${v.id}`, image: v.featured_image || p.images[0]?.src || '',
      featured_image: { url: v.featured_image || p.images[0]?.src || '', alt: p.title }, options_with_values: options,
      requires_shipping: v.requires_shipping, sku: v.sku, vendor: p.vendor, product_type: p.type, properties: {}, line: index + 1,
    };
  }
  function cart() {
    const items = readLines().map(lineItem).filter(Boolean);
    const total = items.reduce((a, i) => a + i.line_price, 0);
    return { token: 'brunito-demo', note: '', attributes: {}, original_total_price: total, total_price: total, total_discount: 0,
      total_weight: 0, item_count: items.reduce((a, i) => a + i.quantity, 0), items, requires_shipping: items.length > 0,
      currency: CURRENCY, items_subtotal_price: total, cart_level_discount_applications: [], discount_codes: [] };
  }
  function addLine(id, qty) {
    if (!findVariant(id)) return { status: 422, message: 'Producto no disponible', description: 'Producto no disponible en la demo.' };
    const lines = readLines(); const hit = lines.find(l => String(l.id) === String(id));
    if (hit) hit.quantity += qty; else lines.push({ id: Number(id), quantity: qty });
    writeLines(lines); return null;
  }
  function changeLine({ line, id, quantity }) {
    let lines = readLines();
    let i = line ? Number(line) - 1 : lines.findIndex(l => lineKey(l.id) === String(id) || String(l.id) === String(id).split(':')[0]);
    if (i >= 0 && lines[i]) { if (Number(quantity) <= 0) lines.splice(i, 1); else lines[i].quantity = Number(quantity); }
    writeLines(lines);
  }

  // ── Section rendering (cart drawer, cart page, cart icon) ──────────────────
  const T = () => window.BRUNITO_TEMPLATES;
  const fillAll = (s, map) => s.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in map ? map[k] : m));
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  function payload(c) {
    return esc(JSON.stringify({ context: null, cart: { totalQuantity: c.item_count, cost: { totalAmount: { amount: (c.total_price / 100).toFixed(2), currencyCode: CURRENCY } },
      lines: c.items.map(i => ({ id: i.key, quantity: i.quantity, cost: { totalAmount: { amount: (i.line_price / 100).toFixed(2), currencyCode: CURRENCY } } })), discountCodes: [] } }));
  }
  function rowHtml(tpl, item) {
    const opts = item.options_with_values.length ? '<dl class="cart-items__variants">' + item.options_with_values.map((o, n, all) =>
      `<div class="cart-items__variant">\n<dt class="visually-hidden">${esc(o.name)}:</dt>\n<dd>${esc(o.value)}${n < all.length - 1 ? ',&nbsp;' : ''}</dd>\n</div>`).join('') + '</dl>' : '';
    const unit = item.compare_at_price && item.compare_at_price > item.price
      ? `\n<div>\n<span class="visually-hidden">Precio de oferta</span>\n<span>${money(item.price)}</span>\n<span class="visually-hidden">Precio habitual</span>\n<s class="compare-at-price">${money(item.compare_at_price)}</s>\n</div>\n`
      : `\n<div>\n<span>${money(item.price)}</span>\n</div>\n`;
    return fillAll(tpl, { KEY: item.key, VID: item.variant_id, HANDLE: item.handle, TITLE: esc(item.product_title), VTITLE: esc(item.variant_title || ''),
      OPTIONS: opts, UNIT: unit, LINE_PRICE: money(item.line_price), IMG: item.image, QTY: item.quantity, LINE: item.line });
  }
  function sectionHtml(kind, c = cart()) {
    const t = T(); if (!t) return '';
    if (!c.items.length) return kind === 'drawer' ? t.drawerEmpty : t.pageEmpty;
    const k = t[kind];
    const map = { COUNT: c.item_count, TOTAL: moneyWithCurrency(c.total_price), PAYLOAD: payload(c) };
    return fillAll(k.pre, map) + c.items.map(i => rowHtml(k.row, i)).join('') + fillAll(k.post, map);
  }
  function sectionFor(id, c) {
    const t = T();
    if (id === 'cart-drawer-section') return sectionHtml('drawer', c);
    if (t && id === t.cartSectionId) return sectionHtml('page', c);
    return null;
  }
  function sectionsFor(list, c = cart()) {
    const out = {};
    String(list || '').split(',').map(s => s.trim()).filter(Boolean).forEach(id => { const h = sectionFor(id, c); if (h !== null) out[id] = h; });
    return out;
  }

  // ── Fetch interception ─────────────────────────────────────────────────────
  const realFetch = window.fetch.bind(window);
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const html = (text, status = 200) => new Response(text, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

  async function readBody(init, req) {
    const body = init?.body ?? (req ? await req.clone().text() : null);
    if (!body) return {};
    if (body instanceof FormData) {
      const o = {}; for (const [k, v] of body.entries()) o[k] = v;
      if (o['items[0][id]']) o.items = [{ id: o['items[0][id]'], quantity: o['items[0][quantity]'] }];
      return o;
    }
    if (body instanceof URLSearchParams) return Object.fromEntries(body.entries());
    const s = String(body);
    try { return JSON.parse(s); } catch { return Object.fromEntries(new URLSearchParams(s).entries()); }
  }

  // The theme's paths are rewritten to BASE at build time, but a few scripts use
  // hard-coded "/cart" or "/products/…" paths: both forms are accepted.
  function storePath(url) {
    if (url.origin !== location.origin) return null;
    let p = url.pathname;
    if (BASE && p.startsWith(BASE + '/')) p = p.slice(BASE.length); else if (BASE && p === BASE) p = '/';
    return p.replace(/\/+$/, '') || '/';
  }

  window.fetch = async function (input, init) {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : String(input), location.href);
    const method = (init?.method || req?.method || 'GET').toUpperCase();
    if (/(^|\.)(shopify|shopifycloud|judge)\.(com|me)$|thebrunito\.com$|myshopify\.com$/.test(url.hostname)) return json({ demo: true });
    const p = storePath(url);
    if (p === null) return realFetch(input, init);
    await catalogueReady;

    if (p === '/cart/add' || p === '/cart/add.js') {
      const b = await readBody(init, req);
      const items = b.items || [{ id: b.id, quantity: b.quantity }];
      let first = null;
      for (const it of items) {
        const err = addLine(it.id, Math.max(1, Number(it.quantity) || 1));
        if (err) return json(err, 422);
        first = first || cart().items.find(i => String(i.variant_id) === String(it.id));
      }
      const c = cart();
      const out = items.length > 1 || b.items ? { items: c.items } : Object.assign({}, first);
      if (b.sections) out.sections = sectionsFor(b.sections, c);
      announceCount(c);
      return json(out);
    }
    if (p === '/cart/change' || p === '/cart/change.js' || p === '/cart/update' || p === '/cart/update.js') {
      const b = await readBody(init, req);
      if (p.startsWith('/cart/change')) changeLine(b);
      if (b.updates) {
        const lines = readLines();
        if (Array.isArray(b.updates)) b.updates.forEach((q, i) => lines[i] && (lines[i].quantity = Number(q)));
        else Object.entries(b.updates).forEach(([id, q]) => { const l = lines.find(x => String(x.id) === String(id).split(':')[0]); if (l) l.quantity = Number(q); });
        writeLines(lines.filter(l => l.quantity > 0));
      }
      if (b.discount !== undefined) { const c = cart(); c.discount_codes = b.discount ? [{ code: b.discount, applicable: false }] : []; return json(Object.assign(c, { sections: sectionsFor(b.sections, c) })); }
      const c = cart();
      announceCount(c);
      return json(Object.assign(c, { sections: sectionsFor(b.sections, c) }));
    }
    if (p === '/cart.js' || p === '/cart.json') return json(cart());
    if (p === '/cart/clear' || p === '/cart/clear.js') { writeLines([]); return json(cart()); }

    let m;
    if ((m = /^\/products\/([^/]+)\.js(on)?$/.exec(p))) return realFetch(`${BASE}/products/${m[1]}/product.js.json`);
    if (p === '/search/suggest' || p === '/search/suggest.json') return html(await predictiveSearch(url.searchParams.get('q') || ''));
    if (p.startsWith('/recommendations')) return html('<div></div>');

    // Section Rendering API: cart sections are generated, others come from the static page
    // they belong to, or from a captured standalone section.
    const sectionId = url.searchParams.get('section_id');
    if (url.searchParams.has('sections')) {
      const ids = url.searchParams.get('sections').split(',');
      const out = sectionsFor(ids.join(','));
      for (const id of ids) if (!(id in out)) out[id] = await staticSection(url, id);
      return json(out);
    }
    if (sectionId) {
      if (sectionFor(sectionId) !== null) return html(sectionFor(sectionId));
      return html(await staticSection(url, sectionId));
    }
    if (/^\/collections\/[^/]+$/.test(p) && [...url.searchParams.keys()].some(k => k.startsWith('filter.') || k === 'sort_by')) {
      return html(await filteredCollection(url));
    }
    // Static page (product page with option_values, collection pagination, etc.).
    return realFetch(staticPageUrl(url), init && { headers: init.headers, signal: init.signal });
  };

  const pageCache = new Map();
  function staticPageUrl(url) {
    const u = new URL(url.href); u.search = '';
    if (BASE && !u.pathname.startsWith(BASE + '/')) u.pathname = BASE + u.pathname;
    if (!u.pathname.endsWith('/') && !/\.\w+$/.test(u.pathname)) u.pathname += '/';
    return u.href;
  }
  async function staticSection(url, id) {
    const p = storePath(url); let m;
    if (id === 'section-rendering-product-card' && (m = /^\/products\/([^/]+)/.exec(p))) {
      return realFetch(`${BASE}/sections/product-card/${m[1]}.html`).then(r => r.text()).catch(() => '');
    }
    const own = await realFetch(`${BASE}/sections/${id}.html`);
    if (own.ok) return own.text();
    const href = staticPageUrl(url);
    if (!pageCache.has(href)) pageCache.set(href, realFetch(href).then(r => r.text()).catch(() => ''));
    const doc = new DOMParser().parseFromString(await pageCache.get(href), 'text/html');
    return doc.getElementById(`shopify-section-${id}`)?.outerHTML || '';
  }

  // ── Predictive search: the store's own result cards, filtered in the browser ──
  let searchPool = null;
  async function loadSearchPool() {
    if (searchPool) return searchPool;
    const names = ['brunito', 'BumpMove', 'SoftLatch', 'CloudNest', 'BloomShape', 'RecoveryFit', 'CozyNest', 'BumpWear', 'BumpCare', 'ComfortBump', 'RestoreWrap'];
    const docs = await Promise.all(names.map(n => realFetch(`${BASE}/sections/predictive-search/${n}.html`).then(r => r.text()).catch(() => '')));
    const parser = new DOMParser(); const seen = new Map(); let shell = null;
    for (const d of docs) {
      const doc = parser.parseFromString(d, 'text/html');
      if (!shell && doc.querySelector('#predictive-search-products')) shell = d;
      doc.querySelectorAll('.predictive-search-results__card--product').forEach(li => {
        const id = li.querySelector('[data-product-id]')?.dataset.productId; if (id && !seen.has(id)) seen.set(id, li.outerHTML);
      });
    }
    const none = await realFetch(`${BASE}/sections/predictive-search/zzzz.html`).then(r => r.text()).catch(() => '');
    return (searchPool = { shell, items: [...seen.values()], none });
  }
  const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  async function predictiveSearch(q) {
    const pool = await loadSearchPool();
    const words = norm(q).split(/\s+/).filter(Boolean);
    const hits = pool.items.filter(li => { const t = norm(new DOMParser().parseFromString(li, 'text/html').body.textContent); return words.every(w => t.includes(w)); });
    if (!hits.length || !pool.shell) return pool.none.replace(/zzzz/g, esc(q));
    const doc = new DOMParser().parseFromString(pool.shell, 'text/html');
    const list = doc.querySelector('.predictive-search-results__wrapper-products');
    list.innerHTML = hits.join('');
    doc.querySelectorAll('.predictive-search-results__card--product a[href]').forEach(a => { a.href = a.getAttribute('href').replace(/\?.*$/, ''); });
    const status = doc.querySelector('[role="status"]'); if (status) status.textContent = `${hits.length} resultados de búsqueda para "${q}"`;
    // Only product suggestions are filtered; drop the other captured groups.
    doc.querySelectorAll('#predictive-search-results [id^="predictive-search-"]:not(#predictive-search-products)').forEach(n => n.remove());
    return doc.body.innerHTML;
  }

  // ── Collection filters and sorting, applied to the static grid ─────────────
  async function filteredCollection(url) {
    const staticUrl = new URL(url.href); staticUrl.search = ''; if (!staticUrl.pathname.endsWith('/')) staticUrl.pathname += '/';
    const text = await realFetch(staticUrl.href).then(r => r.text());
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const params = url.searchParams;
    const gte = params.get('filter.v.price.gte'), lte = params.get('filter.v.price.lte');
    const avail = params.getAll('filter.v.availability');
    const byHandle = new Map(loadCatalogueSync().map(p => [p.handle, p]));
    const items = [...doc.querySelectorAll('.product-grid__item, .product-grid > li')];
    const info = el => { const h = /\/products\/([^/?]+)/.exec(el.querySelector('a[href*="/products/"]')?.getAttribute('href') || '')?.[1]; const p = byHandle.get(h);
      const min = p ? Math.min(...p.variants.map(v => Number(v.price))) : 0; return { p, min, available: p ? p.variants.some(v => v.available) : true }; };
    items.forEach(el => { const { min, available } = info(el);
      const ok = (!gte || min >= Number(String(gte).replace(',', '.'))) && (!lte || min <= Number(String(lte).replace(',', '.'))) &&
        (!avail.length || avail.includes(available ? '1' : '0'));
      if (!ok) el.remove(); });
    const sort = params.get('sort_by');
    if (sort) {
      const grid = items[0]?.parentElement; const kept = items.filter(el => el.isConnected);
      const key = { 'price-ascending': (a, b) => info(a).min - info(b).min, 'price-descending': (a, b) => info(b).min - info(a).min,
        'title-ascending': (a, b) => (info(a).p?.title || '').localeCompare(info(b).p?.title || ''), 'title-descending': (a, b) => (info(b).p?.title || '').localeCompare(info(a).p?.title || ''),
        'created-descending': (a, b) => String(info(b).p?.created_at).localeCompare(String(info(a).p?.created_at)), 'created-ascending': (a, b) => String(info(a).p?.created_at).localeCompare(String(info(b).p?.created_at)) }[sort];
      if (grid && key) kept.sort(key).forEach(el => grid.appendChild(el));
    }
    return '<!doctype html>' + doc.documentElement.outerHTML;
  }

  // ── Header count after changes made outside the theme's own events ────────
  function announceCount(c) {
    document.querySelectorAll('[ref="cartBubbleCount"], .cart-bubble__text-count').forEach(n => (n.textContent = c.item_count));
  }

  // ── Demo notice (checkout, account, forms) ────────────────────────────────
  function notice(kind) {
    let d = document.getElementById('brunito-demo-notice');
    if (!d) {
      d = document.createElement('dialog');
      d.id = 'brunito-demo-notice'; d.className = 'brunito-demo-notice';
      d.innerHTML = `<form method="dialog" class="brunito-demo-notice__panel">
  <p class="brunito-demo-notice__eyebrow">BRUNITO — Ecommerce Experience</p>
  <h2 class="brunito-demo-notice__title"></h2>
  <p class="brunito-demo-notice__text"></p>
  <p class="brunito-demo-notice__text brunito-demo-notice__text--en" lang="en"></p>
  <button class="button brunito-demo-notice__button" value="close">Seguir explorando</button>
  <p class="brunito-demo-notice__credit">Diseño y desarrollo · Carla Tres<br><a class="brunito-demo-notice__back" href="${PORTFOLIO}">← Volver al portfolio</a></p>
</form>`;
      d.addEventListener('click', e => { if (e.target === d) d.close(); });
      document.body.appendChild(d);
    }
    const titles = { checkout: 'Pago desactivado', account: 'Cuentas desactivadas', form: 'Formulario desactivado' };
    const texts = {
      checkout: [NOTICE.es, NOTICE.en],
      account: ['El acceso de clientes no está disponible en esta demostración de diseño.', 'Customer accounts are not available in this design demonstration.'],
      form: ['Este formulario es parte del diseño original y no envía datos en la demo.', 'This form is part of the original design and sends no data in the demo.'],
    }[kind];
    d.querySelector('.brunito-demo-notice__title').textContent = titles[kind];
    d.querySelectorAll('.brunito-demo-notice__text')[0].textContent = texts[0];
    d.querySelectorAll('.brunito-demo-notice__text')[1].textContent = texts[1];
    if (!d.open) d.showModal();
    d.querySelector('button').focus();
  }

  document.addEventListener('click', e => {
    const t = e.target instanceof Element ? e.target : null; if (!t) return;
    const checkout = t.closest('#checkout, [name="checkout"], .cart__checkout-button, a[href*="/checkout"], .shopify-payment-button__button, [data-demo-checkout]');
    if (checkout) { e.preventDefault(); e.stopImmediatePropagation(); notice('checkout'); return; }
    const a = t.closest('a[href]');
    if (a && a.getAttribute('href') === '#demo-notice') { e.preventDefault(); notice(/account|cuenta|sesi/i.test(a.textContent + a.className + (a.getAttribute('aria-label') || '')) ? 'account' : 'checkout'); return; }
    if (a && /^https?:/.test(a.href) && new URL(a.href).hostname.endsWith('thebrunito.com')) { e.preventDefault(); location.href = BASE + '/'; }
  }, true);

  document.addEventListener('submit', e => {
    const f = e.target; if (!(f instanceof HTMLFormElement)) return;
    const action = f.getAttribute('action') || '';
    if (f.matches('[data-type="add-to-cart-form"]') || f.closest('product-form-component')) return; // handled by the theme + mock
    if (/\/cart\/add/.test(action)) return;
    if (/\/search\/?$/.test(action) || f.matches('[role="search"], .search-form, predictive-search-component form')) return;
    if (e.submitter?.name === 'checkout' || /checkout/.test(action)) { e.preventDefault(); notice('checkout'); return; }
    if (/\/(contact|account|challenge)/.test(action) || f.querySelector('input[type="email"]')) { e.preventDefault(); e.stopImmediatePropagation(); notice('form'); return; }
    if (/\/cart\/?$/.test(action)) { e.preventDefault(); notice('checkout'); }
  }, true);

  // ── First paint: render a stored cart into the static markup ───────────────
  function hydrate() {
    const c = cart(); const t = T();
    if (!t || !c.items.length) return;
    const swap = (id, markup) => { const el = document.getElementById(`shopify-section-${id}`); if (el && markup) el.outerHTML = markup; };
    swap('cart-drawer-section', sectionHtml('drawer', c));
    swap(t.cartSectionId, sectionHtml('page', c));
    document.querySelectorAll('cart-icon').forEach(el => { el.outerHTML = fillAll(t.iconFilled, { COUNT: c.item_count }); });
  }

  // Demo label: small, quiet, consistent with the store's own type and colours.
  function label() {
    if (document.querySelector('.brunito-demo-label')) return;
    const el = document.createElement('aside');
    el.className = 'brunito-demo-label';
    el.setAttribute('aria-label', 'Interactive design demonstration');
    el.innerHTML = `<span class="brunito-demo-label__dot" aria-hidden="true"></span><span><strong>Interactive design demonstration</strong><span class="brunito-demo-label__sub"> · Compras desactivadas</span></span>`;
    el.addEventListener('click', () => notice('checkout'));
    document.body.appendChild(el);
  }

  // Product URLs with ?variant=…: the store rendered that variant on the server; here the
  // static page selects it through the page's own option buttons once the theme is ready.
  function applyVariantFromUrl() {
    const id = new URLSearchParams(location.search).get('variant'); if (!id) return;
    const hit = findVariant(id); const root = document.querySelector('.brunito-approved-product'); if (!hit || !root) return;
    hit.v.options.forEach((value, i) => {
      const btn = [...root.querySelectorAll(`.brunito-approved-product__choice[data-option-index="${i}"]`)]
        .find(b => b.dataset.approvedOptionValue === String(value));
      if (btn && !btn.classList.contains('is-selected')) btn.click();
    });
  }
  window.addEventListener('load', () => setTimeout(applyVariantFromUrl, 0));

  window.BrunitoDemo = { hydrate: () => { hydrate(); label(); }, cart, notice, reset: () => { writeLines([]); location.reload(); } };
})();
