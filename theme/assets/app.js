/* core.js: the shared front-end engine (window.UI). Same in every app made from APP_MAKER/template;
   app-specific things live in web/app.js (brand, nav, footer) and web/pages/*.html (the pages).

   Pages:   UI.page(name, {title, nav, icon, auth, order, chrome}, mount)
              auth: null (anyone) | 'guest' (signed-out only) | 'user' | 'admin'
              nav: label for the header / phone tab bar (omit to keep it out of the menus)
              mount(view, ctx) draws into `view`; ctx = {args, me, go, api}. Return a Promise (the page
              is "ready" when it resolves) or {ready, destroy}. URLs are #name/arg1/arg2.
   Server:  UI.api(fn, ...args) -> Promise of the server function's return value. A reply of
              {ok: false, error} rejects with that message (shown as a toast unless you .catch it).
            UI.apiQuiet(fn, ...args) is the same without Anvil's loading spinner.
   Auth:    UI.auth('login'|'signup'|'reset'|'logout', {...}) -> Promise of {ok, me, message}
   Helpers: UI.esc, UI.icon, UI.toast, UI.modal, UI.confirm, UI.busy, UI.formData, UI.fmtDate, UI.ago,
            UI.store, UI.setTheme, UI.feedback, UI.go, UI.refresh
   Tests:   window.UI_READY is true when the current page has finished loading. */
(function () {
  'use strict';
  if (window.UI && window.UI.__v) return;
  var UI = window.UI = { __v: 1, pages: {}, me: null, config: { name: 'App', key: 'app', home: 'home', landing: 'landing' } };
  window.UI_READY = false;

  UI.configure = function (cfg) { Object.keys(cfg).forEach(function (k) { UI.config[k] = cfg[k]; }); };

  /* ------------------------------------------------------------------ small helpers */
  UI.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  UI.plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); };
  UI.initials = function (name) {
    var p = String(name || '?').trim().split(/\s+/);
    return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  };
  UI.fmtDate = function (iso, opts) {
    if (!iso) return '';
    var d = iso.length <= 10 ? new Date(iso + 'T12:00:00') : new Date(iso);
    return d.toLocaleDateString(undefined, opts || { day: 'numeric', month: 'short', year: 'numeric' });
  };
  UI.fmtDateTime = function (iso) {
    return iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  };
  UI.ago = function (iso) {
    if (!iso) return '';
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'just now';
    var steps = [[60, 'minute'], [24, 'hour'], [7, 'day'], [4.35, 'week'], [12, 'month'], [Infinity, 'year']], n = s / 60;
    for (var i = 0; i < steps.length; i++) {
      if (n < steps[i][0]) { n = Math.floor(n); return UI.plural(n, steps[i][1]) + ' ago'; }
      n = n / steps[i][0];
    }
    return '';
  };
  UI.store = {
    get: function (k, dflt) { try { var v = localStorage.getItem(UI.config.key + '.' + k); return v == null ? dflt : JSON.parse(v); } catch (e) { return dflt; } },
    set: function (k, v) { try { localStorage.setItem(UI.config.key + '.' + k, JSON.stringify(v)); } catch (e) {} }
  };
  UI.formData = function (form) {
    var out = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.disabled) return;
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
      else out[el.name] = el.value;
    });
    return out;
  };
  /* Disable a button while a Promise runs; returns the Promise. */
  UI.busy = function (btn, promise) {
    if (!btn) return promise;
    btn.disabled = true; btn.classList.add('is-busy');
    var done = function () { btn.disabled = false; btn.classList.remove('is-busy'); };
    promise.then(done, done);
    return promise;
  };

  var ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.7c2.2.6 3.5 2.4 3.5 5.3"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z"/>',
    bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    bug: '<rect x="7" y="8" width="10" height="12" rx="5"/><path d="M12 8V5M9 5.5 7.5 4M15 5.5 16.5 4M7 13H3M21 13h-4M7.5 18l-3 2M16.5 18l3 2M7.5 9.5l-3-2M16.5 9.5l3-2"/>',
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    database: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.5"/><path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13"/><path d="M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
    pin: '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="13.5" r="3.5"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    filter: '<path d="M4 5h16l-6 7.5V19l-4 1.5v-8z"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'
  };
  UI.ICONS = ICONS;
  UI.icon = function (name, cls) {
    return '<svg class="ui-ic ' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || ICONS.sparkle) + '</svg>';
  };

  /* ------------------------------------------------------------------ toasts, modals */
  UI.toast = function (msg, kind) {
    var box = document.querySelector('.ui-toasts');
    if (!box) { box = document.createElement('div'); box.className = 'ui ui-toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    var t = document.createElement('div');
    t.className = 'ui-toast' + (kind ? ' ' + kind : '');
    t.innerHTML = (kind === 'error' ? UI.icon('info') : kind === 'ok' ? UI.icon('check') : '') + '<span>' + UI.esc(msg) + '</span>';
    box.appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 300); }, kind === 'error' ? 6500 : 3200);
  };
  UI.modal = function (html, opts) {
    opts = opts || {};
    var prev = document.activeElement;
    var wrap = document.createElement('div');
    wrap.className = 'ui ui-modal-wrap';
    wrap.innerHTML = '<div class="ui-modal' + (opts.wide ? ' wide' : '') + '" role="dialog" aria-modal="true">' +
      '<button class="ui-btn ghost icon ui-modal-x" data-close aria-label="Close">' + UI.icon('x') + '</button>' + html + '</div>';
    document.body.appendChild(wrap);
    document.documentElement.classList.add('ui-modal-open');
    function key(e) { if (e.key === 'Escape') close(); }
    function close() {
      if (!wrap.parentNode) return;
      wrap.remove(); document.removeEventListener('keydown', key);
      if (!document.querySelector('.ui-modal-wrap')) document.documentElement.classList.remove('ui-modal-open');
      if (opts.onclose) opts.onclose();
      if (prev && prev.focus) prev.focus();
    }
    document.addEventListener('keydown', key);
    wrap.addEventListener('mousedown', function (e) { if (e.target === wrap) close(); });
    wrap.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) close(); });
    var first = wrap.querySelector('input, textarea, select');
    setTimeout(function () { (first || wrap.querySelector('.ui-modal')).focus && (first || wrap.querySelector('.ui-modal')).focus(); }, 30);
    return { el: wrap.querySelector('.ui-modal'), close: close };
  };
  UI.confirm = function (o) {
    o = typeof o === 'string' ? { title: o } : (o || {});
    return new Promise(function (resolve) {
      var answered = false;
      var m = UI.modal('<h2>' + UI.esc(o.title || 'Are you sure?') + '</h2>' + (o.text ? '<p class="muted">' + UI.esc(o.text) + '</p>' : '') +
        '<div class="ui-row end" style="margin-top:20px"><button class="ui-btn ghost" data-close>' + UI.esc(o.cancel || 'Cancel') + '</button>' +
        '<button class="ui-btn ' + (o.danger ? 'danger solid' : 'primary') + '" data-ok>' + UI.esc(o.ok || 'OK') + '</button></div>',
      { onclose: function () { if (!answered) resolve(false); } });
      m.el.querySelector('[data-ok]').onclick = function () { answered = true; m.close(); resolve(true); };
    });
  };

  /* ------------------------------------------------------------------ theme */
  UI.theme = function () { return UI.store.get('theme', 'auto'); };
  UI.applyTheme = function (t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    var dark = t === 'dark' || (t !== 'light' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('ui-dark', !!dark);
  };
  UI.setTheme = function (t) { UI.store.set('theme', t); UI.applyTheme(t); };
  UI.applyTheme(UI.theme());
  if (window.matchMedia) {
    try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { UI.applyTheme(UI.theme()); }); } catch (e) {}
  }

  /* ------------------------------------------------------------------ server bridge */
  var bridge = null;
  function send(kind, payload) {
    if (!bridge) return Promise.reject(new Error('The app is still starting.'));
    var out;
    try { out = bridge(kind, JSON.stringify(payload || {})); } catch (e) { return Promise.reject(e); }
    return Promise.resolve(out).then(function (r) {
      r = typeof r === 'string' ? JSON.parse(r) : (r || {});
      if (r.error) {
        var err = new Error(r.error); err.uiApi = true; err.denied = !!r.denied;
        if (r.detail) console.error(kind, payload && payload.fn, r.detail);
        if (r.reload) setTimeout(function () { location.reload(); }, 2500);
        throw err;
      }
      return r.result;
    });
  }
  function apiCall(quiet, fn, args) {
    return send('call', { fn: fn, args: args, quiet: quiet }).then(function (res) {
      if (res && typeof res === 'object' && res.ok === false) {
        var err = new Error(res.error || 'That didn\'t work.'); err.uiApi = true; err.expected = true; err.result = res;
        throw err;
      }
      return res;
    });
  }
  UI.api = function (fn) { return apiCall(false, fn, Array.prototype.slice.call(arguments, 1)); };
  UI.apiQuiet = function (fn) { return apiCall(true, fn, Array.prototype.slice.call(arguments, 1)); };
  /* Errors nobody caught become a toast, so a failed action is never silent. */
  window.addEventListener('unhandledrejection', function (e) {
    if (e.reason && e.reason.uiApi) { e.preventDefault(); UI.toast(e.reason.message, 'error'); }
  });

  /* Sign in / up / out. On success it navigates: to where the visitor was heading (UI.after) or home
     after signing in, to the landing page after signing out. */
  UI.auth = function (kind, payload) {
    return send(kind, payload || {}).then(function (r) {
      if (r && r.ok === false) { var err = new Error(r.error); err.uiApi = true; err.expected = true; throw err; }
      if (r && 'me' in r && (r.me || kind === 'logout')) {
        UI.me = r.me || null;
        var target = r.me ? (UI.after || '#' + UI.config.home) : '#' + UI.config.landing;
        UI.after = null;
        if (location.hash === target) route(); else location.hash = target;
      }
      return r;
    });
  };
  /* Update the signed-in user's details (e.g. a new name) and redraw the header, without reloading the page. */
  UI.setMe = function (me) {
    UI.me = me || null;
    if (shellRoot) renderChrome(current.name);
  };

  /* ------------------------------------------------------------------ pages and routing */
  UI.page = function (name, opts, mount) {
    if (typeof opts === 'function') { mount = opts; opts = {}; }
    opts.name = name; opts.mount = mount;
    UI.pages[name] = opts;
  };
  UI.allowed = function (p) {
    if (!p) return false;
    if (p.auth === 'user') return !!UI.me;
    if (p.auth === 'admin') return !!(UI.me && UI.me.is_admin);
    if (p.auth === 'guest') return !UI.me;
    return true;
  };
  UI.navPages = function () {
    return Object.keys(UI.pages).map(function (k) { return UI.pages[k]; })
      .filter(function (p) { return p.nav && UI.allowed(p) && (!p.when || p.when()); })
      .sort(function (a, b) { return (a.order || 50) - (b.order || 50); });
  };
  UI.parseHash = function () {
    var h = (location.hash || '').replace(/^#!?\/?/, '');
    var parts = h.split('?')[0].split('/').filter(function (x) { return x !== ''; }).map(decodeURIComponent);
    return { name: parts[0] || '', args: parts.slice(1) };
  };
  UI.hashFor = function (name) {
    var args = Array.prototype.slice.call(arguments, 1).filter(function (a) { return a != null && a !== ''; });
    return '#' + [name].concat(args.map(encodeURIComponent)).join('/');
  };
  UI.go = function (name) {
    var h = UI.hashFor.apply(null, arguments);
    if (location.hash === h) route(); else location.hash = h;
  };
  UI.refresh = function () { route(); };
  UI.after = null;  // where to go after signing in

  var shellRoot = null, view = null, current = { name: null, destroy: null }, routeSeq = 0;

  function defaultPage() { return UI.me ? UI.config.home : UI.config.landing; }

  function route() {
    var r = UI.parseHash(), name = r.name || defaultPage(), p = UI.pages[name];
    if (!p) { name = defaultPage(); p = UI.pages[name]; r.args = []; }
    if (p.auth === 'guest' && UI.me) { p = UI.pages[UI.config.home]; name = UI.config.home; r.args = []; }
    if ((p.auth === 'user' || p.auth === 'admin') && !UI.me) {
      UI.after = location.hash && location.hash !== '#' ? location.hash : null;
      p = UI.pages.auth; name = 'auth'; r.args = [];
    }
    if (p.auth === 'admin' && !(UI.me && UI.me.is_admin)) {
      UI.toast('That page is for admins only.', 'error');
      p = UI.pages[UI.config.home]; name = UI.config.home; r.args = [];
    }
    var seq = ++routeSeq;
    window.UI_READY = false;
    if (current.destroy) { try { current.destroy(); } catch (e) { console.error(e); } }
    current = { name: name, args: r.args, destroy: null };
    if (shellRoot) {
      shellRoot.className = 'ui ui-shell page-' + name + (UI.me ? ' signed-in' : ' signed-out') + (p.chrome === false ? ' no-chrome' : '');
      renderChrome(name);
    }
    // A fresh element for every page, so listeners a page adds to `view` never pile up.
    var fresh = view.cloneNode(false);
    view.parentNode.replaceChild(fresh, view);
    view = fresh;
    window.scrollTo(0, 0);
    document.title = (p.title ? (typeof p.title === 'function' ? p.title(r.args) : p.title) + ' · ' : '') + UI.config.name;
    var ctx = { name: name, args: r.args, me: UI.me, go: UI.go, api: UI.api, page: p };
    var out;
    try { out = p.mount(view, ctx); } catch (e) { console.error(e); out = Promise.reject(e); }
    var ready = out && typeof out.then === 'function' ? out : (out && out.ready) || Promise.resolve();
    if (out && out.destroy) current.destroy = out.destroy;
    Promise.resolve(ready).then(function () { if (seq === routeSeq) window.UI_READY = true; },
      function (e) {
        if (seq !== routeSeq) return;
        console.error(e);
        if (!view.innerHTML) view.innerHTML = '<div class="ui-wrap"><div class="ui-empty">' + UI.icon('info') +
          '<h3>This page didn\'t load</h3><p class="muted">' + UI.esc(e && e.message || 'Something went wrong.') + '</p>' +
          '<button class="ui-btn" onclick="UI.refresh()">Try again</button></div></div>';
        window.UI_READY = true;
      });
  }
  UI.current = function () { return current; };

  /* The shell's parts come from web/app.js: UI.shell = {header(me, active), footer(me), tabbar(me, active)} */
  function renderChrome(active) {
    var S = UI.shell || {};
    var hd = shellRoot.querySelector('[data-ui-header]'), ft = shellRoot.querySelector('[data-ui-footer]'), tb = shellRoot.querySelector('[data-ui-tabbar]');
    if (hd) hd.innerHTML = S.header ? S.header(UI.me, active) : '';
    if (ft) ft.innerHTML = S.footer ? S.footer(UI.me, active) : '';
    if (tb) tb.innerHTML = S.tabbar ? S.tabbar(UI.me, active) : '';
  }
  UI.renderChrome = function () { if (shellRoot) renderChrome(current.name); };

  /* Called by client_code/Main.py (and by the local harness) once the page is up. */
  UI.start = function (node, bridgeFn, bootJson) {
    bridge = bridgeFn;
    var boot = typeof bootJson === 'string' ? JSON.parse(bootJson || '{}') : (bootJson || {});
    UI.me = boot.me || null;
    var host = node && node.matches && node.matches('[data-ui-app]') ? node : (node && node.querySelector('[data-ui-app]')) || node || document.body;
    host.innerHTML = '<div class="ui ui-shell">' +
      '<header class="ui-header" data-ui-header></header>' +
      '<main class="ui-main" data-ui-view></main>' +
      '<footer class="ui-footer" data-ui-footer></footer>' +
      '<nav class="ui-tabbar" data-ui-tabbar aria-label="Main"></nav></div>';
    shellRoot = host.firstChild;
    view = host.querySelector('[data-ui-view]');
    if (UI.shell && UI.shell.wire) UI.shell.wire(shellRoot);
    window.addEventListener('hashchange', route);
    route();
  };

  /* ------------------------------------------------------------------ feedback (footer + menu)
     All feedback goes to Prepsto. The widget tag in head.html (data-prepsto="CODE") slides its panel in;
     any [data-feedback] or [data-prepsto-open] element opens it. If the widget hasn't loaded, the panel opens in a new tab.
     There is no in-app feedback form any more: Admin -> Feedback only lists older messages (and app requests). */
  UI.feedback = function () {
    if (window.Prepsto && window.Prepsto.open) { window.Prepsto.open(); return; }
    var tag = document.querySelector('script[data-prepsto]');
    var code = tag && tag.getAttribute('data-prepsto');
    if (code && code.indexOf('__') !== 0) window.open('https://prepsto.com/#f/' + encodeURIComponent(code), '_blank', 'noopener');
    else UI.toast('Feedback is not set up yet.', 'error');
  };

  /* Shared clicks: [data-go="page/arg"], [data-feedback], [data-theme-set] anywhere in the app. */
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-go],[data-feedback],[data-theme-set]');
    if (!el) return;
    if (el.hasAttribute('data-go')) { e.preventDefault(); UI.go.apply(null, el.getAttribute('data-go').split('/')); }
    else if (el.hasAttribute('data-feedback')) { e.preventDefault(); UI.feedback(el.getAttribute('data-feedback') || null); }
    else if (el.hasAttribute('data-theme-set')) { e.preventDefault(); UI.setTheme(el.getAttribute('data-theme-set')); if (UI.shell && UI.shell.onTheme) UI.shell.onTheme(); }
  });
})();


/* app.js: this app's identity and frame: name, header, footer, phone tab bar.
   Pages live in web/pages/*.html. The engine (window.UI) is web/core.js. */
(function () {
  'use strict';
  UI.configure({
    name: 'VideoBlog Buddy',
    key: 'videoblogbuddy',          // prefix for this app's browser storage
    tagline: 'Broadcast the apps you build.',   // footer line
    home: 'home',                // first page after signing in
    landing: 'landing'           // first page for visitors who aren't signed in
  });

  var esc = UI.esc;

  function brand() {
    return '<a class="ui-brand" href="#" data-go="' + (UI.me ? UI.config.home : UI.config.landing) + '" aria-label="' + esc(UI.config.name) + ' home">' +
      '<img src="_/theme/icon.svg" alt="" width="30" height="30"><span class="vb-logo">VideoBlog<span class="tube">Buddy</span></span></a>';
  }

  function themeSwitch() {
    var t = UI.theme();
    return '<div class="ui-seg" role="group" aria-label="Appearance">' + [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(function (o) {
      return '<button type="button" data-theme-set="' + o[0] + '" class="' + (t === o[0] ? 'on' : '') + '">' + o[1] + '</button>';
    }).join('') + '</div>';
  }

  function userMenu(me) {
    return '<div class="ui-menu" data-menu hidden>' +
      '<div class="ui-menu-head"><strong>' + esc(me.name) + '</strong><span class="muted small">' + esc(me.email) + '</span></div>' +
      '<a href="#profile" data-go="profile">' + UI.icon('user') + 'Your profile</a>' +
      '<a href="#extension" data-go="extension">' + UI.icon('puzzle') + 'Browser extension</a>' +
      (me.is_admin ? '<a href="#admin" data-go="admin">' + UI.icon('shield') + 'Admin</a>' : '') +
      '<div class="ui-menu-block"><span class="small muted">Appearance</span>' + themeSwitch() + '</div>' +
      '<button type="button" data-feedback>' + UI.icon('chat') + 'Submit feedback</button>' +
      '<button type="button" data-lk-open="overview">' + UI.icon('lock') + 'Privacy &amp; Terms</button>' +
      '<button type="button" data-signout>' + UI.icon('logout') + 'Sign out</button></div>';
  }

  UI.shell = {
    header: function (me, active) {
      var nav = UI.navPages();
      return '<div class="ui-header-in">' + brand() +
        (me ? '<nav class="ui-nav" aria-label="Main">' + nav.map(function (p) {
          return '<a href="#' + p.name + '" class="' + (p.name === active ? 'on' : '') + '">' + UI.icon(p.icon) + '<span>' + esc(p.nav) + '</span></a>';
        }).join('') + '</nav>' : '') +
        '<div class="ui-header-right">' +
        (me && active !== 'record' ? '<a class="ui-btn primary vb-record-btn" href="#record" data-go="record" aria-label="Record"><i class="rec-dot"></i><span>Record</span></a>' : '') +
        (me ? '<button type="button" class="ui-avatar-btn" data-menu-toggle aria-label="Your account" aria-haspopup="true">' + esc(UI.initials(me.name)) + '</button>' + userMenu(me)
          : (active === 'auth' ? '' : '<a class="ui-btn ghost" href="#auth" data-go="auth">Sign in</a><a class="ui-btn primary" href="#auth/signup" data-go="auth/signup">Get started</a>')) +
        '</div></div>';
    },
    footer: function (me) {
      return '<div class="ui-footer-in"><div class="ui-footer-brand">' + brand() + '<p class="muted small">' + esc(UI.config.tagline) + '</p></div>' +
        '<div class="ui-footer-links">' +
        '<a href="#landing" data-go="landing">About</a>' +
        '<a href="#extension" data-go="extension">Extension</a>' +
        '<a href="https://prepsto.com/#f/6nb7x2q" target="_blank" rel="noopener" data-prepsto-open>Submit feedback</a>' +
        '<button type="button" data-lk-open="overview">Privacy &amp; Terms</button>' +
        '</div><p class="ui-footer-legal small muted">© ' + new Date().getFullYear() + ' ' + esc(UI.config.name) + '</p></div>';
    },
    tabbar: function (me, active) {
      var nav = UI.navPages();
      if (!me || nav.length < 2) return '';
      return nav.slice(0, 4).map(function (p) {
        return '<a href="#' + p.name + '" class="' + (p.name === active ? 'on' : '') + '">' + UI.icon(p.icon) + '<span>' + esc(p.nav) + '</span></a>';
      }).join('') + '<a href="#profile" class="' + (active === 'profile' ? 'on' : '') + '">' + UI.icon('user') + '<span>You</span></a>';
    },
    wire: function (root) {
      root.addEventListener('click', function (e) {
        var t = e.target.closest('[data-menu-toggle]');
        var menu = root.querySelector('[data-menu]');
        if (t && menu) { menu.hidden = !menu.hidden; t.setAttribute('aria-expanded', String(!menu.hidden)); return; }
        if (e.target.closest('[data-signout]')) { UI.auth('logout').then(function () { UI.toast('Signed out. See you soon!'); }); }
        if (menu && !menu.hidden && !e.target.closest('[data-menu] .ui-seg')) menu.hidden = true;
      });
      document.addEventListener('keydown', function (e) {
        var menu = root.querySelector('[data-menu]');
        if (e.key === 'Escape' && menu) menu.hidden = true;
      });
    },
    onTheme: function () {  // redraw the menu's Auto/Light/Dark buttons and keep the menu open
      var menu = document.querySelector('[data-menu]'), open = menu && !menu.hidden;
      UI.renderChrome();
      if (open) document.querySelector('[data-menu]').hidden = false;
    }
  };
})();


/* ===== _a_core.html ===== */
(function () {
  'use strict';
  var VB = window.VB = window.VB || {};
  var esc = UI.esc;

  /* ------------------------------------------------------------------ helpers */
  VB.clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  VB.lerp = function (a, b, k) { return a + (b - a) * k; };
  VB.ease = function (k) { k = VB.clamp(k, 0, 1); return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; };
  VB.uid = function (p) { return (p || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); };
  VB.fmtTime = function (s, tenths) {
    s = Math.max(0, s || 0);
    var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = Math.floor(s % 60);
    var out = (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
    return tenths ? out + '.' + Math.floor((s % 1) * 10) : out;
  };
  VB.fmtBytes = function (b) {
    b = b || 0;
    if (b < 1024 * 1024) return Math.max(1, Math.round(b / 1024)) + ' KB';
    if (b < 1024 * 1024 * 1024) return (b / 1048576).toFixed(b < 10485760 ? 1 : 0) + ' MB';
    return (b / 1073741824).toFixed(2) + ' GB';
  };
  VB.slug = function (s) { return String(s || 'video').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'video'; };
  VB.download = function (blob, name) {
    var a = document.createElement('a'), url = URL.createObjectURL(blob);
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  };
  VB.copy = function (text, what) {
    function ok() { UI.toast((what || 'Text') + ' copied', 'ok'); }
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(ok, fallback);
    return fallback();
    function fallback() {
      var t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); ok(); } catch (e) { UI.toast('Copy didn\'t work: select the text and press Ctrl+C.', 'error'); }
      t.remove(); return Promise.resolve();
    }
  };
  VB.debounce = function (fn, ms) {
    var t = null;
    var d = function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { t = null; fn.apply(self, a); }, ms); };
    d.flush = function () { if (t) { clearTimeout(t); t = null; fn(); } };
    d.pending = function () { return !!t; };
    d.cancel = function () { clearTimeout(t); t = null; };
    return d;
  };
  VB.isPhone = function () { return window.matchMedia && matchMedia('(max-width: 720px)').matches; };
  VB.canScreen = function () { return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) && !/Android|iPhone|iPad/i.test(navigator.userAgent); };
  VB.mix = function (hex, amt) {  // lighten (amt > 0) or darken (amt < 0) a #rrggbb colour
    var n = parseInt(String(hex || '#cc181e').slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    var t = amt > 0 ? 255 : 0, k = Math.abs(amt);
    return 'rgb(' + Math.round(r + (t - r) * k) + ',' + Math.round(g + (t - g) * k) + ',' + Math.round(b + (t - b) * k) + ')';
  };
  VB.rng = function (seed) {  // mulberry32: the same seed always gives the same numbers
    var a = 0; String(seed).split('').forEach(function (c) { a = (a * 31 + c.charCodeAt(0)) | 0; });
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  };

  /* ------------------------------------------------------------------ icons used across the app */
  var ICONS = {
    video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
    record: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>',
    film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
    scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.6 7.6 20 18M8.6 16.4 20 6"/>',
    play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>',
    pause: '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    flag: '<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>',
    zoom: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M11 8v6M8 11h6"/>',
    text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
    wand: '<path d="m4 20 11-11M14 4v3M18 6l-2 2M20 10h-3M12 8l4 4"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
    puzzle: '<path d="M10 3h4v3a2 2 0 1 0 4 0V3h3v7h-3a2 2 0 1 0 0 4h3v7h-7v-3a2 2 0 1 0-4 0v3H3v-7h3a2 2 0 1 0 0-4H3V3z"/>',
    layout: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M10 10v10"/>',
    music: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    kanban: '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="13" rx="1"/>',
    rocket: '<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2"/><path d="M9 15 6 12c1-4 4-8 13-9-1 9-5 12-9 13z"/><circle cx="15" cy="9" r="1.5"/>',
    scroll: '<path d="M6 3h11a2 2 0 0 1 2 2v12"/><path d="M6 3a2 2 0 0 0-2 2v2h4"/><path d="M8 5v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-2H12v2"/><path d="M11 8h5M11 12h5"/>',
    tag: '<path d="M3 12V3h9l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    split: '<path d="M12 3v18M5 8l-3 4 3 4M19 8l3 4-3 4"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
    keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    cursor: '<path d="M5 3l14 7-6 2-2 6z"/>',
    pen: '<path d="M4 20l4-1L19 8l-3-3L5 16z"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7L12 6.3"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    hdd: '<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M5 13 7.5 5h9L19 13M7 16.5h.01"/>',
    star2: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="currentColor"/>',
    phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    tv: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="m8 3 4 4 4-4"/>',
    volume: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
    mute: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="m17 9 5 6M22 9l-5 6"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
    flame: '<path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.5 2-5 .8 1.4 1.6 2 2.5 2-.5-2.5-.2-4.6.5-7z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    calendar2: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'
  };
  Object.keys(ICONS).forEach(function (k) { UI.ICONS[k] = ICONS[k]; });

  /* ------------------------------------------------------------------ constants */
  VB.KINDS = [
    { key: 'youtube', label: 'YouTube video', short: 'Video', emoji: '📺', aspect: '16:9', desc: 'Landscape, any length' },
    { key: 'short', label: 'YouTube Short', short: 'Short', emoji: '📱', aspect: '9:16', desc: 'Vertical, up to 3 minutes' },
    { key: 'reel', label: 'Reel', short: 'Reel', emoji: '🎞️', aspect: '9:16', desc: 'Instagram / Facebook, vertical' },
    { key: 'tutorial', label: 'Tutorial', short: 'Tutorial', emoji: '🎓', aspect: '16:9', desc: 'Step-by-step walkthrough' },
    { key: 'devlog', label: 'Devlog', short: 'Devlog', emoji: '🛠️', aspect: '16:9', desc: 'Behind the scenes of building' },
    { key: 'square', label: 'Square post', short: 'Square', emoji: '⬛', aspect: '1:1', desc: 'Feeds, LinkedIn, X' }
  ];
  VB.kind = function (k) { return VB.KINDS.filter(function (x) { return x.key === k; })[0] || VB.KINDS[0]; };
  VB.isVertical = function (k) { return VB.kind(k).aspect === '9:16'; };
  VB.STATUSES = [
    { key: 'idea', label: 'Idea', icon: 'bulb' }, { key: 'script', label: 'Script', icon: 'scroll' },
    { key: 'recorded', label: 'Recorded', icon: 'record' }, { key: 'edited', label: 'Edited', icon: 'scissors' },
    { key: 'published', label: 'Published', icon: 'tv' }
  ];
  VB.status = function (k) { return VB.STATUSES.filter(function (x) { return x.key === k; })[0] || VB.STATUSES[0]; };
  VB.statusChip = function (k) { return '<span class="vb-status ' + esc(k) + '">' + esc(VB.status(k).label) + '</span>'; };
  VB.BGS = {
    red: ['#e62117', '#7a0c10'], sunset: ['#ff8a3d', '#d6246e'], ocean: ['#1fa2ff', '#12558f'], mint: ['#5ee7b0', '#1c8a63'],
    grape: ['#a36bff', '#4b2a9b'], night: ['#2b2f3a', '#0c0d12'], paper: ['#fafafa', '#dedede'], blur: null
  };
  VB.BG_NAMES = { red: 'Classic red', sunset: 'Sunset', ocean: 'Ocean', mint: 'Mint', grape: 'Grape', night: 'Night', paper: 'Paper', blur: 'Blurred screen' };
  VB.LAYOUTS = {
    pip: ['Camera bubble', 'Screen with your face in a corner'], stack: ['Stacked', 'Screen on top, camera below (vertical)'],
    crop: ['Follow the action', 'Screen cropped to fill, panning to your clicks'], side: ['Side by side', 'Screen left, camera right'],
    screen: ['Screen only', 'Hide the camera'], cam: ['Camera only', 'Just you']
  };
  VB.ASPECTS = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080] };
  VB.dims = function (aspect, quality) {
    var d = VB.ASPECTS[aspect] || VB.ASPECTS['16:9'], k = quality === '720' ? 2 / 3 : 1;
    return [Math.round(d[0] * k / 2) * 2, Math.round(d[1] * k / 2) * 2];
  };
  VB.DEFAULT_EDIT = function (kind) {
    var a = VB.kind(kind).aspect, vert = a === '9:16';
    return { v: 1, aspect: a, layout: vert ? 'stack' : (a === '1:1' ? 'crop' : 'pip'), bg: 'red', pad: vert ? 0.03 : 0.05, radius: 14,
      cam: Object.assign({ pos: 'br', size: 0.24, shape: 'circle', border: true, hidden: false }, UI.store.get('rec.cam', {})), zoom: { auto: true, level: 1.7 },
      transition: 'fade', voice: 1, music: { vol: 0.25, name: '', duck: true, gen: '' }, watermark: '', progress: vert,
      sfx: { clicks: false, whoosh: false, vol: 0.6 }, voice_fx: 'off',
      captions: { on: false, style: vert ? 'bold' : 'karaoke', pos: vert ? 'middle' : 'bottom', size: 1, upper: false, color: '#ffde00' }, scenes: [] };
  };
  VB.fullEdit = function (e, kind) {  // fill in anything missing (old or empty edits)
    var d = VB.DEFAULT_EDIT(kind), out = {};
    e = e || {};
    Object.keys(d).forEach(function (k) { out[k] = e[k] != null ? e[k] : d[k]; });
    out.cam = Object.assign({}, d.cam, e.cam || {});
    out.zoom = Object.assign({}, d.zoom, e.zoom || {});
    out.music = Object.assign({}, d.music, e.music || {});
    out.sfx = Object.assign({}, d.sfx, e.sfx || {});
    out.captions = Object.assign({}, d.captions, e.captions || {});
    out.scenes = (e.scenes || []).map(function (s) { return JSON.parse(JSON.stringify(s)); });
    return out;
  };
  VB.sceneId = function () { return 's' + Math.random().toString(36).slice(2, 9); };
  VB.takeScene = function (t) {
    return { id: VB.sceneId(), type: 'take', take: t.id, 'in': 0, out: +(t.duration || 0).toFixed(2), cuts: [], speed: 1, layout: '', zooms: [], texts: [], boxes: [], mute: false };
  };
  VB.cardScene = function (style, title, sub, color, emoji) {
    return { id: VB.sceneId(), type: 'card', style: style || 'classic', title: title || '', sub: sub || '', dur: 3, color: color || '#cc181e', emoji: emoji || '' };
  };
  /* A first edit from the takes: intro card, every take (starred first), outro card. */
  VB.starterEdit = function (video, takes, product, handle) {
    var e = VB.fullEdit(video.edit && video.edit.scenes && video.edit.scenes.length ? video.edit : null, video.kind);
    if (e.scenes.length) return e;
    var p = product || {};
    if (p.color === '#2e9d5b' || p.color === '#1c8a63') e.bg = 'mint';
    e.watermark = handle || '';
    e.scenes.push(VB.cardScene(p.name ? 'app' : 'classic', p.name || video.title, p.name ? (p.tagline || video.title) : '', p.color, p.emoji));
    takes.slice().sort(function (a, b) { return (b.starred ? 1 : 0) - (a.starred ? 1 : 0); }).forEach(function (t) { e.scenes.push(VB.takeScene(t)); });
    e.scenes.push(VB.cardScene('subscribe', p.cta ? p.cta + (p.name ? ': ' + p.name : '') : 'Thanks for watching!', p.url ? p.url.replace(/^https?:\/\//, '') : (handle || 'Subscribe for more'), '#cc181e', p.emoji));
    return e;
  };

  /* Library card picture: the saved thumbnail, or a placeholder in the app's colour. */
  VB.thumbHtml = function (v, opts) {
    opts = opts || {};
    var p = v.product || {}, col = p.color || '#cc181e';
    var inner = v.thumb ? '<img src="' + esc(v.thumb) + '" alt="" loading="lazy">'
      : '<div class="ph" style="background:linear-gradient(135deg,' + esc(col) + ',' + esc(VB.mix(col, -0.45)) + ')"><div><b>' + esc(p.emoji || VB.kind(v.kind).emoji) + '</b>' + esc(v.title) + '</div></div>';
    return '<span class="vb-thumb">' + inner + (opts.status !== false ? '<span class="st">' + VB.statusChip(v.status) + '</span>' : '') +
      (v.duration ? '<span class="dur">' + VB.fmtTime(v.duration) + '</span>' : '') + '</span>';
  };
  VB.appChip = function (p) {
    if (!p) return '<span class="vb-app-chip"><i style="background:var(--c-line-2)"></i><span>No app</span></span>';
    return '<span class="vb-app-chip"><i style="background:' + esc(p.color) + '"></i><span>' + esc((p.emoji ? p.emoji + ' ' : '') + p.name) + '</span></span>';
  };

  /* ------------------------------------------------------------------ the vault: recordings in this browser (IndexedDB) */
  var dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error('This browser can\'t store recordings (no IndexedDB). Try Chrome, Edge or Firefox.'));
      var r = indexedDB.open('videoblogbuddy-vault', 1);
      r.onupgradeneeded = function () { var d = r.result; ['files', 'chunks', 'meta'].forEach(function (n) { if (!d.objectStoreNames.contains(n)) d.createObjectStore(n); }); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error || new Error('Couldn\'t open the recordings store.')); };
    });
    return dbp;
  }
  function req(store, mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var tx = d.transaction(store, mode), out;
        var r = fn(tx.objectStore(store));
        if (r) r.onsuccess = function () { out = r.result; };
        tx.oncomplete = function () { res(out); };
        tx.onerror = tx.onabort = function () { rej(tx.error || new Error('Storage error')); };
      });
    });
  }
  VB.vault = {
    id: function () {
      var id = UI.store.get('vault');
      if (!id) { id = 'b' + Math.random().toString(36).slice(2, 10); UI.store.set('vault', id); }
      return id;
    },
    put: function (key, blob, info) {
      var rec = Object.assign({ blob: blob, size: blob.size, type: blob.type, created: Date.now() }, info || {});
      return req('files', 'readwrite', function (s) { return s.put(rec, key); });
    },
    get: function (key) { return req('files', 'readonly', function (s) { return s.get(key); }).then(function (r) { return r || null; }); },
    has: function (key) { return req('files', 'readonly', function (s) { return s.count(key); }).then(function (n) { return n > 0; }, function () { return false; }); },
    del: function (key) { return req('files', 'readwrite', function (s) { return s['delete'](key); }); },
    keys: function () { return req('files', 'readonly', function (s) { return s.getAllKeys(); }).then(function (k) { return k || []; }, function () { return []; }); },
    list: function () {
      return db().then(function (d) {
        return new Promise(function (res) {
          var out = [], tx = d.transaction('files', 'readonly');
          tx.objectStore('files').openCursor().onsuccess = function (e) {
            var c = e.target.result;
            if (!c) return;
            out.push({ key: c.key, size: c.value.size || 0, type: c.value.type, created: c.value.created, name: c.value.name || '' });
            c['continue']();
          };
          tx.oncomplete = function () { res(out); };
          tx.onerror = function () { res(out); };
        });
      }, function () { return []; });
    },
    /* Removing a take's files: both tracks. */
    dropTake: function (key) { return Promise.all([VB.vault.del('take:' + key + ':main'), VB.vault.del('take:' + key + ':cam')]).catch(function () {}); },
    /* Recording safety net: every second of a recording is written here, so a crash loses at most a second. */
    chunk: function (rid, part, n, blob) {
      return req('chunks', 'readwrite', function (s) { return s.put(blob, rid + '|' + part + '|' + String(n).padStart(6, '0')); });
    },
    chunksFor: function (rid, part) {
      var lo = rid + '|' + part + '|', range = IDBKeyRange.bound(lo, lo + '￿');
      return req('chunks', 'readonly', function (s) { return s.getAll(range); }).then(function (r) { return r || []; });
    },
    dropChunks: function (rid) {
      var range = IDBKeyRange.bound(rid + '|', rid + '|￿');
      return req('chunks', 'readwrite', function (s) { return s['delete'](range); }).then(function () { return VB.vault.meta.del('rec:' + rid); });
    },
    meta: {
      get: function (k) { return req('meta', 'readonly', function (s) { return s.get(k); }).then(function (r) { return r == null ? null : r; }, function () { return null; }); },
      set: function (k, v) { return req('meta', 'readwrite', function (s) { return s.put(v, k); }).catch(function () {}); },
      del: function (k) { return req('meta', 'readwrite', function (s) { return s['delete'](k); }).catch(function () {}); }
    },
    /* Unfinished recordings (the tab crashed or closed mid-take): [{rid, info, size}] */
    orphans: function () {
      return db().then(function (d) {
        return new Promise(function (res) {
          var found = {}, tx = d.transaction(['chunks', 'meta'], 'readonly');
          tx.objectStore('chunks').openCursor().onsuccess = function (e) {
            var c = e.target.result;
            if (!c) return;
            var rid = String(c.key).split('|')[0];
            found[rid] = (found[rid] || 0) + (c.value && c.value.size || 0);
            c['continue']();
          };
          tx.oncomplete = function () {
            var rids = Object.keys(found).filter(function (r) { return !(VB.rec && VB.rec.rid === r); });
            Promise.all(rids.map(function (r) { return VB.vault.meta.get('rec:' + r).then(function (info) { return { rid: r, info: info || {}, size: found[r] }; }); })).then(res);
          };
          tx.onerror = function () { res([]); };
        });
      }, function () { return []; });
    },
    usage: function () {
      if (!(navigator.storage && navigator.storage.estimate)) return Promise.resolve(null);
      return Promise.all([navigator.storage.estimate(), navigator.storage.persisted ? navigator.storage.persisted() : Promise.resolve(false)])
        .then(function (r) { return { used: r[0].usage || 0, quota: r[0].quota || 0, persisted: !!r[1] }; }, function () { return null; });
    },
    persist: function () {
      if (!(navigator.storage && navigator.storage.persist)) return Promise.resolve(false);
      return navigator.storage.persist().catch(function () { return false; });
    }
  };
  /* Is a take's video in this browser? Samples always are. -> Promise of bool */
  VB.takeHere = function (t) { return t.sample ? Promise.resolve(true) : VB.vault.has('take:' + t.key + ':main'); };

  /* ------------------------------------------------------------------ the browser extension bridge */
  /* The extension's content script answers window messages {vbb:'app'} with {vbb:'ext'}. It only sends
     clicks and recording commands to a site you connected in the extension's popup (see /extension). */
  document.documentElement.setAttribute('data-vbb-app', '1');
  VB.ext = {
    state: { installed: false, paired: false, version: '' },
    _subs: [],
    on: function (fn) { VB.ext._subs.push(fn); return function () { VB.ext._subs = VB.ext._subs.filter(function (f) { return f !== fn; }); }; },
    send: function (type, data) { window.postMessage(Object.assign({ vbb: 'app', type: type }, data || {}), location.origin === 'null' ? '*' : location.origin); },
    ping: function (ms) {
      VB.ext.send('ping', { app: UI.config.name });
      return new Promise(function (res) { setTimeout(function () { res(VB.ext.state); }, ms || 400); });
    }
  };
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (e.source !== window || !d || d.vbb !== 'ext' || typeof d.type !== 'string') return;
    if (d.type === 'hello' || d.type === 'paired') {
      VB.ext.state = { installed: true, paired: !!d.paired, version: String(d.version || ''), opts: d.opts || {} };
    }
    /* The extension started a tab recording while the studio shows another page: go to the recorder first. */
    if (d.type === 'tab-stream' && UI.me && UI.current().name !== 'record') { VB.pendingTab = d; UI.go('record'); return; }
    VB.ext._subs.slice().forEach(function (fn) { try { fn(d); } catch (err) { console.error(err); } });
  });
  setTimeout(function () { VB.ext.ping(); }, 600);

  /* ------------------------------------------------------------------ sample recordings (drawn live, no files) */
  /* Keep clicks/markers in step with server_code/Sample.py. Times in seconds; x/y are 0..1 of the screen. */
  VB.SAMPLES = {
    garden: { dur: 40, speech: [[0.5, 5.4], [6.6, 11.6], [12.8, 17.6], [20.4, 26.8], [28.6, 31.4], [32.6, 39.2]],
      clicks: [[6.0, 0.578, 0.41], [12.2, 0.824, 0.778], [20.0, 0.914, 0.142], [21.2, 0.5, 0.472], [28.0, 0.578, 0.667], [32.0, 0.086, 0.285]],
      path: [[0, 900, 600], [2.5, 700, 430], [5.85, 740, 295], [7.6, 770, 330], [12.05, 1055, 560], [14, 1000, 520], [17, 900, 420],
        [19.85, 1170, 102], [21.05, 640, 340], [26.5, 690, 390], [27.85, 740, 480], [29.6, 620, 420], [31.85, 110, 205], [34, 420, 330], [40, 640, 430]] },
    hello: { dur: 9, speech: [[0.6, 3.4], [4.0, 8.2]] }
  };
  var syllCache = {};
  function syllables(name) {
    if (syllCache[name]) return syllCache[name];
    var S = VB.SAMPLES[name], r = VB.rng(name), out = [];
    S.speech.forEach(function (seg) {
      var t = seg[0];
      while (t < seg[1] - 0.1) {
        var len = 0.11 + r() * 0.11;
        out.push({ s: t, e: Math.min(seg[1], t + len), f: 150 + r() * 80, g: (r() - 0.5) * 60, a: 0.55 + r() * 0.45 });
        t += len + 0.025 + r() * 0.04 + (r() < 0.22 ? 0.12 : 0);
      }
    });
    syllCache[name] = out;
    return out;
  }
  /* Loudness 0..1 at time t (moves the cartoon's mouth). */
  VB.sampleLevel = function (name, t) {
    var list = syllables(name);
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (t >= s.s && t <= s.e) { var k = (t - s.s) / (s.e - s.s); return s.a * Math.sin(Math.PI * k); }
      if (s.s > t) break;
    }
    return 0;
  };
  var audioCache = {};
  /* The sample's "voice": soft pitched blips, like a cartoon talking. -> AudioBuffer */
  VB.sampleAudio = function (name, ac) {
    var key = name + ':' + ac.sampleRate;
    if (audioCache[key]) return audioCache[key];
    var S = VB.SAMPLES[name], sr = ac.sampleRate, buf = ac.createBuffer(1, Math.ceil(S.dur * sr), sr), d = buf.getChannelData(0);
    syllables(name).forEach(function (s) {
      var a = Math.floor(s.s * sr), b = Math.floor(s.e * sr), n = b - a, ph = 0;
      for (var i = 0; i < n; i++) {
        var k = i / n, f = s.f + s.g * k, env = Math.min(1, k / 0.12) * Math.min(1, (1 - k) / 0.3);
        ph += 2 * Math.PI * f / sr;
        d[a + i] += 0.16 * s.a * env * (Math.sin(ph) + 0.45 * Math.sin(2 * ph) + 0.2 * Math.sin(3 * ph) + 0.08 * Math.sin(5 * ph));
      }
    });
    audioCache[key] = buf;
    return buf;
  };

  function rr(g, x, y, w, h, r) { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); }
  VB.rr = rr;
  function txt(g, s, x, y, font, color, align) { g.font = font; g.fillStyle = color; g.textAlign = align || 'left'; g.textBaseline = 'middle'; g.fillText(s, x, y); }
  function emoji(g, e, x, y, size) { g.font = size + 'px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(e, x, y); }
  VB.drawEmoji = emoji;
  function pathAt(path, t) {
    for (var i = 0; i < path.length - 1; i++) {
      var a = path[i], b = path[i + 1];
      if (t <= b[0]) { var k = VB.ease((t - a[0]) / (b[0] - a[0])); return [VB.lerp(a[1], b[1], k), VB.lerp(a[2], b[2], k)]; }
    }
    var l = path[path.length - 1]; return [l[1], l[2]];
  }
  var GREEN = '#2e9d5b';
  function plantCard(g, x, y, e, name, note, warn, pop) {
    g.save();
    if (pop != null) { var k = VB.clamp(pop, 0, 1), sc = 0.6 + 0.4 * VB.ease(k) + Math.sin(k * Math.PI) * 0.06; g.globalAlpha = VB.clamp(k * 2, 0, 1); g.translate(x + 155, y + 105); g.scale(sc, sc); g.translate(-x - 155, -y - 105); }
    g.shadowColor = 'rgba(0,0,0,.08)'; g.shadowBlur = 14; g.shadowOffsetY = 3;
    rr(g, x, y, 310, 210, 14); g.fillStyle = '#fff'; g.fill(); g.shadowColor = 'transparent';
    rr(g, x + 20, y + 20, 72, 72, 36); g.fillStyle = '#e6f4ea'; g.fill();
    emoji(g, e, x + 56, y + 58, 40);
    txt(g, name, x + 20, y + 125, '700 24px Roboto, Arial', '#1d2b22');
    rr(g, x + 20, y + 152, warn ? 128 : 150, 32, 16); g.fillStyle = warn ? '#fde7e6' : '#eef3ef'; g.fill();
    txt(g, note, x + 34, y + 169, '500 15px Roboto, Arial', warn ? '#c0281f' : '#4c6b57');
    g.restore();
  }
  /* The fictional app tour, 1280x720, at time t. */
  VB.drawSampleScreen = function (g, t, W, H) {
    var S = VB.SAMPLES.garden;
    g.save(); g.scale(W / 1280, H / 720);
    g.fillStyle = '#dee1e6'; g.fillRect(0, 0, 1280, 74);
    rr(g, 12, 6, 250, 32, 9); g.fillStyle = '#fff'; g.fill(); g.fillRect(12, 26, 250, 12);
    emoji(g, '🌱', 34, 22, 15); txt(g, 'Pocket Garden', 52, 22, '500 14px Roboto, Arial', '#333');
    g.fillStyle = '#fff'; g.fillRect(0, 38, 1280, 36);
    ['#bbb', '#bbb', '#bbb'].forEach(function (c, i) { g.beginPath(); g.arc(24 + i * 30, 56, 8, 0, 7); g.strokeStyle = c; g.lineWidth = 2; g.stroke(); });
    rr(g, 120, 44, 980, 24, 12); g.fillStyle = '#f1f3f4'; g.fill();
    txt(g, '🔒 pocket-garden.example/' + (t >= 32.1 ? 'reminders' : 'garden'), 138, 56, '400 14px Roboto, Arial', '#555');
    g.fillStyle = '#f4f8f4'; g.fillRect(0, 74, 1280, 646);
    g.fillStyle = '#fff'; g.fillRect(0, 74, 1280, 56); g.fillStyle = '#e3ebe5'; g.fillRect(0, 129, 1280, 1);
    emoji(g, '🌱', 44, 102, 26); txt(g, 'Pocket Garden', 66, 102, '700 22px Roboto, Arial', GREEN);
    rr(g, 1090, 86, 160, 32, 16); g.fillStyle = GREEN; g.fill(); txt(g, '+  Add plant', 1170, 102, '700 15px Roboto, Arial', '#fff', 'center');
    g.fillStyle = '#fff'; g.fillRect(0, 130, 220, 590); g.fillStyle = '#e3ebe5'; g.fillRect(219, 130, 1, 590);
    var rem = t >= 32.1;
    [['🪴', 'My garden', 160], ['⏰', 'Reminders', 205], ['🏠', 'Household', 250], ['⚙️', 'Settings', 295]].forEach(function (it, i) {
      var on = (i === 0 && !rem) || (i === 1 && rem);
      if (on) { rr(g, 10, it[2] - 18, 200, 36, 8); g.fillStyle = '#e3f3e8'; g.fill(); }
      emoji(g, it[0], 36, it[2], 18); txt(g, it[1], 58, it[2], (on ? '700' : '500') + ' 16px Roboto, Arial', on ? GREEN : '#44544a');
    });
    if (!rem) {
      txt(g, 'My garden', 250, 162, '700 26px Roboto, Arial', '#1d2b22');
      var watered = t >= 12.25, added = t >= 28.1;
      txt(g, (added ? 5 : 4) + ' plants · ' + (watered ? 'all happy' : '1 needs water'), 390, 165, '400 16px Roboto, Arial', '#6a7d70');
      plantCard(g, 250, 190, '🪴', 'Monstera', 'Water in 2 days');
      plantCard(g, 585, 190, '🌿', 'Basil', watered ? 'Watered ✓' : 'Water today!', !watered);
      plantCard(g, 920, 190, '🌵', 'Cactus', 'Water in 9 days');
      plantCard(g, 250, 425, '🌱', 'Snake plant', 'Water in 4 days');
      if (added) plantCard(g, 585, 425, '🍋', 'Lemon tree', 'Water tomorrow', false, (t - 28.1) / 0.45);
    } else {
      var k = VB.ease((t - 32.1) / 0.4);
      g.globalAlpha = k;
      txt(g, 'This week', 250, 162, '700 26px Roboto, Arial', '#1d2b22');
      var days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], drops = { 0: 'Basil', 2: 'Lemon tree', 3: 'Monstera', 5: 'Basil', 6: 'Snake plant' };
      days.forEach(function (d, i) {
        var x = 250 + i * 143;
        rr(g, x, 195, 131, 400, 12); g.fillStyle = i === 4 ? '#e3f3e8' : '#fff'; g.fill();
        txt(g, d, x + 65, 222, '700 17px Roboto, Arial', '#44544a', 'center');
        if (drops[i]) {
          rr(g, x + 10, 255 + (i % 2) * 60, 111, 70, 10); g.fillStyle = '#e8f2fd'; g.fill();
          emoji(g, '💧', x + 66, 278 + (i % 2) * 60, 20); txt(g, drops[i], x + 66, 305 + (i % 2) * 60, '500 13px Roboto, Arial', '#2a5d8f', 'center');
        }
      });
      g.globalAlpha = 1;
    }
    if (t >= 6.25 && t < 16.8) {  // plant panel
      var open = VB.ease((t - 6.25) / 0.35) * (1 - VB.ease((t - 16.4) / 0.35)), px = 1280 - 450 * open;
      g.shadowColor = 'rgba(0,0,0,.15)'; g.shadowBlur = 30; g.fillStyle = '#fff'; g.fillRect(px, 130, 450, 590); g.shadowColor = 'transparent';
      emoji(g, '🌿', px + 60, 190, 44); txt(g, 'Basil', px + 100, 180, '700 28px Roboto, Arial', '#1d2b22'); txt(g, 'Kitchen window', px + 100, 208, '400 15px Roboto, Arial', '#6a7d70');
      [['Water every', '2 days'], ['Last watered', t >= 12.25 ? 'just now' : '3 days ago'], ['Sunlight', 'Bright, indirect']].forEach(function (r, i) {
        txt(g, r[0], px + 30, 268 + i * 44, '400 16px Roboto, Arial', '#6a7d70'); txt(g, r[1], px + 420, 268 + i * 44, '700 16px Roboto, Arial', '#1d2b22', 'right');
        g.fillStyle = '#eef3ef'; g.fillRect(px + 30, 288 + i * 44, 390, 1);
      });
      txt(g, 'Growth', px + 30, 420, '700 16px Roboto, Arial', '#1d2b22');
      [18, 24, 22, 31, 38, 36, 47, 55].forEach(function (h, i) { rr(g, px + 30 + i * 48, 500 - h, 30, h, 4); g.fillStyle = '#9fd6b4'; g.fill(); });
      var done = t >= 12.25;
      rr(g, px + 70, 535, 310, 50, 25); g.fillStyle = done ? '#fff' : '#1f88e5'; g.fill();
      if (done) { g.strokeStyle = GREEN; g.lineWidth = 2; g.stroke(); }
      txt(g, done ? '✓  Watered' : '💧  Water now', px + 225, 560, '700 18px Roboto, Arial', done ? GREEN : '#fff', 'center');
    }
    if (t >= 12.3 && t < 15.2) {  // toast
      var ta = Math.min(1, (t - 12.3) / 0.25, (15.2 - t) / 0.3);
      g.globalAlpha = ta; rr(g, 470, 650 - 20 * ta, 340, 46, 8); g.fillStyle = '#1d2b22'; g.fill();
      txt(g, '💧 Basil watered. See you in 2 days!', 640, 673 - 20 * ta, '500 16px Roboto, Arial', '#fff', 'center'); g.globalAlpha = 1;
    }
    if (t >= 20.15 && t < 28.35) {  // add-plant dialog
      var m = Math.min(1, (t - 20.15) / 0.25, (28.35 - t) / 0.25);
      g.globalAlpha = m; g.fillStyle = 'rgba(20,30,24,.35)'; g.fillRect(0, 74, 1280, 646);
      g.shadowColor = 'rgba(0,0,0,.2)'; g.shadowBlur = 30; rr(g, 420, 250, 440, 290, 16); g.fillStyle = '#fff'; g.fill(); g.shadowColor = 'transparent';
      txt(g, 'Add a plant', 450, 285, '700 22px Roboto, Arial', '#1d2b22');
      var typed = 'Lemon tree'.slice(0, Math.max(0, Math.floor((t - 22) / 0.4) + 1)), focus = t >= 21.25;
      if (t < 22) typed = '';
      rr(g, 450, 315, 380, 50, 10); g.fillStyle = '#fff'; g.fill(); g.strokeStyle = focus ? GREEN : '#cfd8d2'; g.lineWidth = focus ? 2.5 : 1.5; g.stroke();
      txt(g, typed || (focus ? '' : 'Plant name'), 466, 340, '400 18px Roboto, Arial', typed ? '#1d2b22' : '#9aa79f');
      if (focus && Math.floor(t * 2) % 2 === 0) { g.font = '400 18px Roboto, Arial'; var cw = g.measureText(typed).width; g.fillStyle = '#1d2b22'; g.fillRect(468 + cw, 327, 2, 26); }
      txt(g, 'Water every', 450, 398, '400 16px Roboto, Arial', '#6a7d70');
      rr(g, 600, 380, 230, 38, 8); g.fillStyle = '#f4f8f4'; g.fill(); txt(g, '3 days  ▾', 616, 399, '500 16px Roboto, Arial', '#1d2b22');
      txt(g, 'Cancel', 560, 480, '500 17px Roboto, Arial', '#6a7d70', 'center');
      rr(g, 690, 455, 100, 50, 25); g.fillStyle = GREEN; g.fill(); txt(g, 'Save', 740, 480, '700 17px Roboto, Arial', '#fff', 'center');
      g.globalAlpha = 1;
    }
    S.clicks.forEach(function (c) {  // click rings (what the extension draws on real pages)
      var dt = t - c[0];
      if (dt < 0 || dt > 0.6) return;
      var k = dt / 0.6;
      g.beginPath(); g.arc(c[1] * 1280, c[2] * 720, 12 + 34 * k, 0, 7); g.strokeStyle = 'rgba(230,33,23,' + (0.85 * (1 - k)) + ')'; g.lineWidth = 5; g.stroke();
    });
    var p = pathAt(S.path, t), press = S.clicks.some(function (c) { return t >= c[0] && t < c[0] + 0.15; });
    g.save(); g.translate(p[0], p[1]); if (press) g.scale(0.85, 0.85);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, 26); g.lineTo(7, 20); g.lineTo(12, 31); g.lineTo(17, 29); g.lineTo(12, 18); g.lineTo(21, 18); g.closePath();
    g.fillStyle = '#111'; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); g.restore();
    g.restore();
  };
  /* The cartoon presenter ("Sam"), 640x480, at time t; mouth follows the sample voice. */
  VB.drawSampleCam = function (g, t, W, H, name) {
    name = name || 'garden';
    g.save(); g.scale(W / 640, H / 480);
    var bg = g.createLinearGradient(0, 0, 0, 480); bg.addColorStop(0, '#f6e7d3'); bg.addColorStop(1, '#e7cfb2'); g.fillStyle = bg; g.fillRect(0, 0, 640, 480);
    g.fillStyle = '#c9a57e'; g.fillRect(380, 120, 230, 12);
    [['🪴', 420], ['📚', 490], ['🌵', 560]].forEach(function (o) { emoji(g, o[0], o[1], 96, 46); });
    rr(g, 50, 70, 120, 90, 6); g.fillStyle = '#fff'; g.fill(); g.fillStyle = '#cc181e'; rr(g, 62, 82, 96, 66, 4); g.fill(); emoji(g, '📺', 110, 115, 34);
    var bob = Math.sin(t * 2.1) * 3, tilt = Math.sin(t * 1.3) * 0.035, lvl = VB.sampleLevel(name, t);
    g.fillStyle = '#cc181e'; g.beginPath(); g.ellipse(320, 520, 210, 170, 0, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(290, 362); g.lineTo(320, 400); g.lineTo(350, 362); g.fill();
    g.fillStyle = '#f0bf98'; g.fillRect(295, 320, 50, 50);
    if (name === 'hello' && t > 0.5 && t < 2.8) {  // a wave
      var w = Math.sin((t - 0.5) * 9) * 0.35;
      g.save(); g.translate(470, 420); g.rotate(-0.5 + w); g.fillStyle = '#cc181e'; rr(g, -22, -150, 44, 150, 22); g.fill();
      g.fillStyle = '#f0bf98'; g.beginPath(); g.arc(0, -160, 30, 0, 7); g.fill(); g.restore();
    }
    g.save(); g.translate(320, 230 + bob); g.rotate(tilt);
    g.fillStyle = '#f2c4a0'; g.beginPath(); g.ellipse(0, 0, 100, 112, 0, 0, 7); g.fill();
    g.beginPath(); g.arc(-98, 8, 18, 0, 7); g.arc(98, 8, 18, 0, 7); g.fill();
    g.fillStyle = '#4a2f22'; g.beginPath(); g.ellipse(0, -78, 108, 60, 0, Math.PI, 0); g.fill();
    g.beginPath(); g.ellipse(-40, -70, 70, 34, 0.3, 0, 7); g.fill(); g.beginPath(); g.ellipse(50, -74, 60, 30, -0.4, 0, 7); g.fill();
    var blink = (t % 3.7) < 0.13;
    [-38, 38].forEach(function (x) {
      if (blink) { g.strokeStyle = '#3a2418'; g.lineWidth = 4; g.beginPath(); g.moveTo(x - 12, 0); g.lineTo(x + 12, 0); g.stroke(); return; }
      g.fillStyle = '#fff'; g.beginPath(); g.ellipse(x, 0, 15, 17, 0, 0, 7); g.fill();
      g.fillStyle = '#3a2418'; g.beginPath(); g.arc(x + 2, 2, 8, 0, 7); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(x + 5, -2, 2.6, 0, 7); g.fill();
    });
    g.strokeStyle = '#4a2f22'; g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-52, -30 - lvl * 5); g.lineTo(-24, -34 - lvl * 5); g.stroke(); g.beginPath(); g.moveTo(24, -34 - lvl * 5); g.lineTo(52, -30 - lvl * 5); g.stroke();
    g.fillStyle = 'rgba(230,120,110,.35)'; g.beginPath(); g.arc(-62, 34, 16, 0, 7); g.arc(62, 34, 16, 0, 7); g.fill();
    g.fillStyle = '#7a2c22'; g.beginPath(); g.ellipse(0, 52, 26 + lvl * 4, 5 + lvl * 20, 0, 0, Math.PI * 2); g.fill();
    if (lvl < 0.08) { g.strokeStyle = '#7a2c22'; g.lineWidth = 4; g.beginPath(); g.arc(0, 38, 24, 0.25 * Math.PI, 0.75 * Math.PI); g.stroke(); }
    g.restore();
    g.restore();
  };

  /* A take's small picture: the saved one, or one drawn from the sample. */
  var sampleThumbs = {};
  VB.takeThumb = function (t) {
    if (t.thumb) return t.thumb;
    if (!t.sample) return '';
    if (sampleThumbs[t.sample]) return sampleThumbs[t.sample];
    try {
      var c = document.createElement('canvas'); c.width = 320; c.height = 180; var g = c.getContext('2d');
      if (t.sample === 'hello') { g.save(); g.translate(0, -30); VB.drawSampleCam(g, 1.6, 320, 240, 'hello'); g.restore(); }
      else {
        VB.drawSampleScreen(g, 8, 320, 180);
        var cc = document.createElement('canvas'); cc.width = 160; cc.height = 120; VB.drawSampleCam(cc.getContext('2d'), 2, 160, 120, 'garden');
        g.save(); g.beginPath(); g.arc(282, 142, 30, 0, 7); g.clip(); g.drawImage(cc, 20, 0, 120, 120, 252, 112, 60, 60); g.restore();
        g.beginPath(); g.arc(282, 142, 30, 0, 7); g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke();
      }
      sampleThumbs[t.sample] = c.toDataURL('image/jpeg', 0.75);
    } catch (e) { sampleThumbs[t.sample] = ''; }
    return sampleThumbs[t.sample];
  };

  /* ------------------------------------------------------------------ confetti + badge pop */
  VB.confetti = function (n) {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var c = document.createElement('canvas'); c.className = 'vb-confetti'; c.width = innerWidth; c.height = innerHeight; document.body.appendChild(c);
    var g = c.getContext('2d'), cols = ['#e62117', '#ffffff', '#cc181e', '#ffd400', '#167ac6', '#222'], parts = [];
    for (var i = 0; i < (n || 140); i++) parts.push({ x: innerWidth / 2 + (Math.random() - 0.5) * 200, y: innerHeight * 0.35, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 13 - 4,
      r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4, w: 6 + Math.random() * 7, h: 4 + Math.random() * 5, c: cols[i % cols.length] });
    var t0 = performance.now();
    (function frame(now) {
      var dt = Math.min(2, (now - (frame.last || now)) / 16.7); frame.last = now;
      g.clearRect(0, 0, c.width, c.height);
      parts.forEach(function (p) {
        p.vy += 0.35 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt; p.vx *= 0.99;
        g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c; g.strokeStyle = 'rgba(0,0,0,.15)'; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h); g.restore();
      });
      if (now - t0 < 3200) requestAnimationFrame(frame); else c.remove();
    })(t0);
  };
  VB.badgePop = function (list) {
    if (!list || !list.length) return;
    VB.confetti();
    var b = list[0];
    UI.modal('<div class="vb-badge-pop"><div class="eyebrow">Achievement unlocked</div><div class="big">' + esc(b.emoji) + '</div><h2 style="padding:0">' + esc(b.name) + '</h2>' +
      '<p class="muted">' + esc(b.desc) + '</p>' + (list.length > 1 ? '<p class="small muted">+ ' + UI.plural(list.length - 1, 'more badge') + '</p>' : '') +
      '<button class="ui-btn primary" data-close>Nice!</button></div>');
  };
})();

/* ===== _b_engine.html ===== */
(function () {
  'use strict';
  var VB = window.VB, clamp = VB.clamp, rr = VB.rr;

  /* ------------------------------------------------------------------ video elements */
  function once(el, ev, ms) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { done(); res('timeout'); }, ms || 8000);
      function ok() { done(); res('ok'); }
      function bad() { done(); rej(new Error('This video can\'t be read by the browser.')); }
      function done() { clearTimeout(t); el.removeEventListener(ev, ok); el.removeEventListener('error', bad); }
      el.addEventListener(ev, ok); el.addEventListener('error', bad);
    });
  }
  VB.seek = function (v, t) {
    var d = isFinite(v.duration) ? v.duration : 1e9;
    t = clamp(t, 0, Math.max(0, d - 0.02));
    if (Math.abs(v.currentTime - t) < 0.01 && v.readyState >= 2 && !v.seeking) return Promise.resolve();
    var p = once(v, 'seeked', 6000);
    v.currentTime = t;
    return p;
  };
  function fixDuration(v) {
    if (isFinite(v.duration) && v.duration > 0) return Promise.resolve();
    // Browser-recorded WebM files don't say how long they are until we jump to the end.
    return new Promise(function (res) {
      var done = false;
      function fin() { if (done) return; done = true; v.removeEventListener('durationchange', on); v.currentTime = 0; once(v, 'seeked', 5000).then(res, res); }
      function on() { if (isFinite(v.duration) && v.duration > 0) fin(); }
      v.addEventListener('durationchange', on);
      v.currentTime = 1e7;
      setTimeout(fin, 10000);
    });
  }
  VB.videoEl = function (url) {
    var v = document.createElement('video');
    v.preload = 'auto'; v.playsInline = true; v.setAttribute('playsinline', ''); v.muted = false;
    v.src = url;
    return once(v, 'loadedmetadata', 20000).then(function (r) {
      if (r === 'timeout') throw new Error('This video took too long to open.');
      return fixDuration(v);
    }).then(function () { return v; });
  };

  /* ------------------------------------------------------------------ take sources */
  var cache = {};
  /* Open a take for playing/rendering. fresh: new elements (the exporter needs its own: an element can feed
     Web Audio only once). -> Promise of src ({missing: true} when this browser doesn't have the file). */
  VB.openTake = function (t, opts) {
    opts = opts || {};
    if (!opts.fresh && cache[t.id]) return cache[t.id];
    var p;
    if (t.sample) p = Promise.resolve(sampleSrc(t));
    else {
      p = Promise.all([VB.vault.get('take:' + t.key + ':main'), VB.vault.get('take:' + t.key + ':cam')]).then(function (r) {
        if (!r[0]) return { take: t, id: t.id, missing: true, duration: t.duration, frame: function () {}, release: function () {} };
        var urls = [URL.createObjectURL(r[0].blob)];
        if (r[1]) urls.push(URL.createObjectURL(r[1].blob));
        return Promise.all(urls.map(VB.videoEl)).then(function (els) {
          var m = els[0], c = els[1] || null;
          if (c) c.muted = true;
          var src = { take: t, id: t.id, kind: 'video', duration: m.duration || t.duration, offset: t.cam_offset || 0, blob: r[0].blob,
            main: { el: m, img: m, w: m.videoWidth || (t.main && t.main.w) || 1280, h: m.videoHeight || (t.main && t.main.h) || 720 },
            cam: c ? { el: c, img: c, w: c.videoWidth || 640, h: c.videoHeight || 480 } : null,
            hasAudio: !!(t.main && t.main.audio), frame: function () {},
            release: function () { els.forEach(function (e) { e.pause(); e.removeAttribute('src'); e.load(); }); urls.forEach(URL.revokeObjectURL); } };
          return src;
        });
      });
    }
    if (!opts.fresh) { cache[t.id] = p; p['catch'](function () { delete cache[t.id]; }); }
    return p;
  };
  VB.releaseSources = function () {
    Object.keys(cache).forEach(function (k) { cache[k].then(function (s) { s.release(); }, function () {}); delete cache[k]; });
  };
  VB.forgetSource = function (id) { if (cache[id]) { cache[id].then(function (s) { s.release(); }, function () {}); delete cache[id]; } };
  function sampleSrc(t) {
    var name = t.sample === 'hello' ? 'hello' : 'garden';
    var mw = name === 'garden' ? 1280 : 640, mh = name === 'garden' ? 720 : 480;
    var mc = document.createElement('canvas'); mc.width = mw; mc.height = mh;
    var cc = null;
    if (name === 'garden') { cc = document.createElement('canvas'); cc.width = 640; cc.height = 480; }
    var last = -1;
    return { take: t, id: t.id, kind: 'sample', sample: name, duration: VB.SAMPLES[name].dur, offset: 0, hasAudio: true,
      main: { img: mc, w: mw, h: mh }, cam: cc ? { img: cc, w: 640, h: 480 } : null,
      frame: function (time) {
        if (Math.abs(time - last) < 0.004) return;
        last = time;
        if (name === 'garden') { VB.drawSampleScreen(mc.getContext('2d'), time, mw, mh); VB.drawSampleCam(cc.getContext('2d'), time, 640, 480, 'garden'); }
        else VB.drawSampleCam(mc.getContext('2d'), time, mw, mh, 'hello');
      },
      release: function () {} };
  }

  /* ------------------------------------------------------------------ loudness, pauses */
  var RATE = 50;  // envelope values per second
  var envCache = {};
  function envelope(data, sr) {
    var hop = Math.round(sr / RATE), n = Math.floor(data.length / hop), out = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var s = 0, o = i * hop;
      for (var j = 0; j < hop; j++) { var x = data[o + j]; s += x * x; }
      out[i] = Math.max(-90, 10 * Math.log10(s / hop + 1e-10));
    }
    return out;
  }
  /* -> Promise of {env: Float32Array dB, rate} or null (no sound) */
  VB.analyze = function (src) {
    var t = src.take, key = t.sample ? 'sample-' + t.sample : t.key;
    if (envCache[key]) return envCache[key];
    var p;
    if (t.sample) {
      var oc = new OfflineAudioContext(1, 1, 8000);
      var buf = VB.sampleAudio(src.sample, oc);
      p = Promise.resolve({ env: envelope(buf.getChannelData(0), 8000), rate: RATE });
    } else if (!src.blob || !(t.main && t.main.audio)) {
      p = Promise.resolve(null);
    } else {
      p = VB.vault.meta.get('env:' + key).then(function (saved) {
        if (saved && saved.length) return { env: Float32Array.from(saved), rate: RATE };
        if (src.blob.size > 1.6e9) return null;
        return src.blob.arrayBuffer().then(function (ab) {
          var dur = src.duration || t.duration || 60;
          var oc2 = new OfflineAudioContext(1, Math.ceil((dur + 2) * 8000), 8000);
          return oc2.decodeAudioData(ab);
        }).then(function (buf2) {
          var env = envelope(buf2.getChannelData(0), buf2.sampleRate);
          VB.vault.meta.set('env:' + key, Array.from(env, function (v) { return Math.round(v * 10) / 10; }));
          return { env: env, rate: RATE };
        });
      })['catch'](function (e) { console.warn('no audio analysis', e); return null; });
    }
    envCache[key] = p;
    return p;
  };
  function pct(arr, q) { var a = Array.from(arr).sort(function (x, y) { return x - y; }); return a[Math.floor(clamp(q, 0, 1) * (a.length - 1))] || -90; }
  /* Cuts for the quiet stretches between in and out: [[a, b]...] (keeps `pad` seconds of air on both sides). */
  VB.silences = function (an, from, to, opts) {
    opts = opts || {};
    if (!an || !an.env.length) return [];
    var env = an.env, rate = an.rate, minGap = opts.minGap || 0.7, pad = opts.pad == null ? 0.18 : opts.pad;
    var floor = pct(env, 0.08), loud = pct(env, 0.9);
    var thr = Math.min(loud - 12, Math.max(floor + 10, -58));
    var out = [], i0 = Math.floor(from * rate), i1 = Math.min(env.length, Math.ceil(to * rate)), runStart = -1;
    for (var i = i0; i <= i1; i++) {
      var quiet = i < i1 && env[i] < thr;
      if (quiet && runStart < 0) runStart = i;
      if (!quiet && runStart >= 0) {
        var a = runStart / rate, b = i / rate;
        if (b - a >= minGap) {
          var ca = a === from ? a : a + pad, cb = i === i1 ? b : b - pad;
          if (cb - ca > 0.2) out.push([+ca.toFixed(2), +cb.toFixed(2)]);
        }
        runStart = -1;
      }
    }
    return out;
  };
  /* Join cut lists (sorted, merged, clipped to [lo, hi]). */
  VB.mergeCuts = function (cuts, lo, hi) {
    var list = cuts.map(function (c) { return [Math.max(lo, c[0]), Math.min(hi, c[1])]; }).filter(function (c) { return c[1] - c[0] >= 0.05; })
      .sort(function (a, b) { return a[0] - b[0]; }), out = [];
    list.forEach(function (c) { var l = out[out.length - 1]; if (l && c[0] <= l[1] + 0.02) l[1] = Math.max(l[1], c[1]); else out.push([c[0], c[1]]); });
    return out.map(function (c) { return [+c[0].toFixed(2), +c[1].toFixed(2)]; });
  };

  /* ------------------------------------------------------------------ zooms */
  /* Regions that zoom in on clicks; clicks close together share one region that pans between them. */
  VB.autoZooms = function (clicks, level) {
    var out = [];
    (clicks || []).slice().sort(function (a, b) { return a[0] - b[0]; }).forEach(function (c) {
      var l = out[out.length - 1];
      if (l && c[0] - 0.6 < l.e + 1.2) { l.e = c[0] + 2.4; l.pts.push([c[0], c[1], c[2]]); }
      else out.push({ s: Math.max(0, c[0] - 0.7), e: c[0] + 2.4, z: level || 1.7, pts: [[c[0], c[1], c[2]]], auto: true });
    });
    return out;
  };
  function centerAt(pts, t) {
    if (t <= pts[0][0]) return [pts[0][1], pts[0][2]];
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      if (t < b[0]) { var k = VB.ease((t - (b[0] - 0.7)) / 0.7); return [VB.lerp(a[1], b[1], k), VB.lerp(a[2], b[2], k)]; }
    }
    var l = pts[pts.length - 1]; return [l[1], l[2]];
  }
  VB.zoomAt = function (zooms, t) {
    for (var i = 0; i < (zooms || []).length; i++) {
      var r = zooms[i];
      if (t >= r.s && t <= r.e) {
        var k = Math.min(VB.ease((t - r.s) / 0.55), VB.ease((r.e - t) / 0.65));
        var c = centerAt(r.pts, t);
        return { z: 1 + (r.z - 1) * k, x: VB.lerp(0.5, c[0], k), y: VB.lerp(0.5, c[1], k), k: k };
      }
    }
    return { z: 1, x: 0.5, y: 0.5, k: 0 };
  };
  /* Where the action is (for the "follow the action" crop): the latest click, eased. */
  VB.focusAt = function (clicks, t) {
    var prev = null, next = null;
    (clicks || []).forEach(function (c) { if (c[0] <= t) prev = c; else if (!next) next = c; });
    if (!prev && !next) return [0.5, 0.5];
    if (!prev) return [next[1], next[2]];
    if (next && next[0] - t < 0.8) { var k = VB.ease(1 - (next[0] - t) / 0.8); return [VB.lerp(prev[1], next[1], k), VB.lerp(prev[2], next[2], k)]; }
    return [prev[1], prev[2]];
  };

  /* ------------------------------------------------------------------ the plan: edit -> timeline */
  VB.plan = function (edit, takes, srcs) {
    var byId = {}; (takes || []).forEach(function (t) { byId[t.id] = t; });
    var out = { edit: edit, scenes: [], outDur: 0 }, o = 0;
    (edit.scenes || []).forEach(function (sc, i) {
      if (sc.type === 'card') {
        out.scenes.push({ sc: sc, i: i, type: 'card', start: o, dur: sc.dur || 3, segs: [] });
        o += sc.dur || 3; return;
      }
      var t = byId[sc.take], src = srcs && srcs[sc.take];
      if (!t) return;
      var dur = t.duration || 0, a = clamp(sc['in'] || 0, 0, dur), b = clamp(sc.out || dur, a, dur), speed = sc.speed || 1;
      var keep = [[a, b]];
      VB.mergeCuts(sc.cuts || [], a, b).forEach(function (c) {
        var nk = [];
        keep.forEach(function (k) {
          if (c[1] <= k[0] || c[0] >= k[1]) { nk.push(k); return; }
          if (c[0] > k[0]) nk.push([k[0], c[0]]);
          if (c[1] < k[1]) nk.push([c[1], k[1]]);
        });
        keep = nk;
      });
      var segs = [], so = 0;
      keep.filter(function (k) { return k[1] - k[0] > 0.04; }).forEach(function (k) {
        var len = (k[1] - k[0]) / speed; segs.push({ a: k[0], b: k[1], o: so, len: len }); so += len;
      });
      if (!segs.length) return;
      var zooms = sc.zooms && sc.zooms.length ? sc.zooms : (edit.zoom && edit.zoom.auto && t.mode !== 'cam' ? VB.autoZooms(t.clicks, edit.zoom.level) : []);
      var ps = { sc: sc, i: i, type: 'take', take: t, src: src || null, start: o, dur: so, segs: segs, speed: speed, zooms: zooms };
      if (t.words && t.words.words && t.words.words.length) {
        ps.words = VB.keptWords(ps);
        if (edit.captions && edit.captions.on) ps.cues = VB.cues(ps.words, VB.cueOpts(edit));
      }
      out.scenes.push(ps);
      o += so;
    });
    out.outDur = o;
    out.sfx = VB.sfxEvents ? VB.sfxEvents(out) : [];
    return out;
  };
  VB.locate = function (plan, o) {
    var list = plan.scenes;
    if (!list.length) return null;
    o = clamp(o, 0, Math.max(0, plan.outDur - 1e-4));
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (o < s.start + s.dur || i === list.length - 1) {
        var local = clamp(o - s.start, 0, s.dur);
        if (s.type === 'card') return { s: s, si: i, local: local };
        for (var j = 0; j < s.segs.length; j++) {
          var g = s.segs[j];
          if (local < g.o + g.len || j === s.segs.length - 1) {
            return { s: s, si: i, local: local, seg: g, gi: j, srcT: clamp(g.a + (local - g.o) * s.speed, g.a, g.b) };
          }
        }
      }
    }
    return null;
  };
  /* Output time of a source moment in scene si (or -1 if it was cut). */
  VB.outOf = function (plan, si, srcT) {
    var s = plan.scenes[si];
    if (!s || s.type !== 'take') return -1;
    for (var j = 0; j < s.segs.length; j++) { var g = s.segs[j]; if (srcT >= g.a - 1e-3 && srcT <= g.b + 1e-3) return s.start + g.o + (srcT - g.a) / s.speed; }
    return -1;
  };
  /* YouTube chapters: start at 0:00, at least 3, each at least 10 s. -> [{t, label}] */
  VB.chapters = function (plan) {
    var raw = [];
    plan.scenes.forEach(function (s, si) {
      if (s.type === 'card') { if (s.sc.style !== 'subscribe' && s.sc.title) raw.push({ t: s.start, label: s.sc.title }); return; }
      var marks = (s.take.markers || []).filter(function (m) { return m[1] === 'chapter'; }), any = false;
      marks.forEach(function (m) { var o = VB.outOf(plan, si, m[0]); if (o >= 0) { raw.push({ t: o, label: m[2] || 'Chapter' }); any = true; } });
      if (!any) raw.push({ t: s.start, label: s.take.label || 'Part' });
    });
    raw.sort(function (a, b) { return a.t - b.t; });
    var out = [];
    raw.forEach(function (c) {
      var l = out[out.length - 1];
      if (!l) { out.push({ t: 0, label: c.t < 10 ? c.label : 'Intro' }); if (c.t >= 10) out.push(c); return; }
      if (c.t - l.t >= 10 && plan.outDur - c.t >= 10) out.push(c);
    });
    return out;
  };

  /* ------------------------------------------------------------------ drawing helpers */
  function fit(iw, ih, R) { var k = Math.min(R.w / iw, R.h / ih), w = iw * k, h = ih * k; return { x: R.x + (R.w - w) / 2, y: R.y + (R.h - h) / 2, w: w, h: h }; }
  function wrap(g, text, maxW) {
    var words = String(text).split(/\s+/), lines = [], cur = '';
    words.forEach(function (w) { var test = cur ? cur + ' ' + w : w; if (g.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test; });
    if (cur) lines.push(cur);
    return lines;
  }
  VB.wrap = wrap;
  function background(g, W, H, bg, blurImg) {
    if (bg === 'blur' && blurImg) {
      g.save(); g.filter = 'blur(' + Math.round(Math.min(W, H) / 30) + 'px) brightness(.55)';
      var iw = blurImg.w, ih = blurImg.h, k = Math.max(W / iw, H / ih) * 1.1;
      try { g.drawImage(blurImg.img, (W - iw * k) / 2, (H - ih * k) / 2, iw * k, ih * k); } catch (e) { /* not ready */ }
      g.restore(); return;
    }
    var c = VB.BGS[bg] || VB.BGS.red;
    var gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, c[0]); gr.addColorStop(1, c[1]);
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  }
  /* Draw img (iw x ih) into R. zoom {z, x, y}; cover: crop to fill R (else letterbox inside R). */
  function drawInto(g, src, R, zoom, radius, cover, shadow) {
    if (!src || !src.img) return;
    var iw = src.w, ih = src.h, Ra = R.w / R.h, cw, ch;
    if (cover) { if (iw / ih > Ra) { ch = ih; cw = ih * Ra; } else { cw = iw; ch = iw / Ra; } }
    else { cw = iw; ch = ih; }
    var z = zoom ? zoom.z : 1; cw /= z; ch /= z;
    var cx = (zoom ? zoom.x : 0.5) * iw, cy = (zoom ? zoom.y : 0.5) * ih;
    var sx = clamp(cx - cw / 2, 0, iw - cw), sy = clamp(cy - ch / 2, 0, ih - ch);
    var D = cover ? R : fit(cw, ch, R);
    g.save();
    if (shadow) { g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = shadow; g.shadowOffsetY = shadow / 4; rr(g, D.x, D.y, D.w, D.h, radius); g.fillStyle = '#000'; g.fill(); g.shadowColor = 'transparent'; }
    if (radius) { rr(g, D.x, D.y, D.w, D.h, radius); g.clip(); }
    try { g.drawImage(src.img, sx, sy, cw, ch, D.x, D.y, D.w, D.h); } catch (e) { g.fillStyle = '#111'; g.fillRect(D.x, D.y, D.w, D.h); }
    g.restore();
    return { x: D.x, y: D.y, w: D.w, h: D.h, sx: sx, sy: sy, cw: cw, ch: ch, iw: iw, ih: ih, r: radius };
  }

  /* ------------------------------------------------------------------ hide / highlight boxes (screen coordinates 0..1) */
  var tiny = null;
  function drawBoxes(g, src, map, boxes, t, W, H) {
    if (!map || !boxes || !boxes.length) return;
    var m = Math.min(W, H);
    boxes.forEach(function (b) {
      if (t < b.s || t > b.e) return;
      var k = Math.min(VB.ease((t - b.s) / 0.25), VB.ease((b.e - t) / 0.25));
      var px = b.x * map.iw, py = b.y * map.ih, pw = b.w * map.iw, ph = b.h * map.ih;
      var x = map.x + (px - map.sx) / map.cw * map.w, y = map.y + (py - map.sy) / map.ch * map.h, w = pw / map.cw * map.w, h = ph / map.ch * map.h;
      var x0 = Math.max(map.x, x), y0 = Math.max(map.y, y), x1 = Math.min(map.x + map.w, x + w), y1 = Math.min(map.y + map.h, y + h);
      g.save();
      if (b.kind === 'blur') {
        if (x1 - x0 < 1 || y1 - y0 < 1) { g.restore(); return; }
        // A mosaic hides the area completely the whole time (no fade, so nothing leaks for a frame).
        if (!tiny) tiny = document.createElement('canvas');
        var tw = Math.max(3, Math.round((x1 - x0) / Math.max(10, m * 0.018))), th = Math.max(2, Math.round(tw * (y1 - y0) / (x1 - x0)));
        tiny.width = tw; tiny.height = th;
        var tg = tiny.getContext('2d');
        var sx0 = map.sx + (x0 - map.x) / map.w * map.cw, sy0 = map.sy + (y0 - map.y) / map.h * map.ch;
        try { tg.drawImage(src.img, sx0, sy0, (x1 - x0) / map.w * map.cw, (y1 - y0) / map.h * map.ch, 0, 0, tw, th); } catch (e) { tg.fillStyle = '#777'; tg.fillRect(0, 0, tw, th); }
        rr(g, x0, y0, x1 - x0, y1 - y0, m * 0.008); g.clip();
        g.imageSmoothingEnabled = false; g.drawImage(tiny, 0, 0, tw, th, x0, y0, x1 - x0, y1 - y0); g.imageSmoothingEnabled = true;
        g.fillStyle = 'rgba(120,120,120,.18)'; g.fillRect(x0, y0, x1 - x0, y1 - y0);
      } else if (b.kind === 'spot') {
        g.beginPath(); g.rect(map.x, map.y, map.w, map.h); rr(g, x, y, w, h, m * 0.012);
        g.fillStyle = 'rgba(0,0,0,' + (0.58 * k).toFixed(3) + ')'; g.fill('evenodd');
        g.globalAlpha = k; rr(g, x, y, w, h, m * 0.012); g.lineWidth = Math.max(2, m * 0.004); g.strokeStyle = 'rgba(255,255,255,.9)'; g.stroke();
      } else {
        var sc = 1.12 - 0.12 * VB.ease((t - b.s) / 0.3), cx = x + w / 2, cy = y + h / 2;
        g.translate(cx, cy); g.scale(sc, sc); g.translate(-cx, -cy); g.globalAlpha = k;
        g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = m * 0.012;
        rr(g, x, y, w, h, m * 0.012); g.lineWidth = Math.max(3, m * 0.007); g.strokeStyle = '#e62117'; g.stroke();
      }
      g.restore();
    });
  }

  /* ------------------------------------------------------------------ captions */
  VB.CAPTION_STYLES = [['karaoke', 'Karaoke'], ['clean', 'Clean'], ['bold', 'Big & bold'], ['box', 'TV box']];
  function drawCaptions(g, W, H, e, s, t, progress) {
    var c = e.captions; if (!c || !c.on || !s.cues || !s.cues.length) return;
    var cue = null;
    for (var i = 0; i < s.cues.length; i++) { var q = s.cues[i]; if (t >= q.s - 0.04 && t <= q.hold) { cue = q; break; } if (q.s > t) break; }
    if (!cue) return;
    var m = Math.min(W, H), vert = H > W * 1.2, size = c.size || 1, style = c.style || 'karaoke', bold = style === 'bold';
    var fs = Math.round(m * (bold ? (vert ? 0.105 : 0.085) : (vert ? 0.062 : 0.05)) * size);
    var upper = bold || c.upper, hi = c.color || '#ffde00';
    g.save();
    g.font = (bold ? '400 ' + fs + 'px Anton, Impact, sans-serif' : style === 'box' ? '500 ' + fs + 'px Roboto, Arial' : '800 ' + fs + 'px Roboto, Arial');
    g.textBaseline = 'middle'; g.textAlign = 'left'; g.lineJoin = 'round';
    var space = g.measureText(' ').width, maxW = W * (vert ? 0.84 : 0.8), lines = [[]], lw = [0];
    var items = cue.words.map(function (w) { var txt = upper ? String(w[2]).toUpperCase() : String(w[2]); return { w: w, txt: txt, width: g.measureText(txt).width }; });
    items.forEach(function (it) {
      var L = lines.length - 1, add = (lines[L].length ? space : 0) + it.width;
      if (lines[L].length && lw[L] + add > maxW) { lines.push([it]); lw.push(it.width); } else { lines[L].push(it); lw[L] += add; }
    });
    var lh = fs * (bold ? 1.08 : 1.28), total = lines.length * lh;
    var y0 = c.pos === 'top' ? m * 0.1 + lh / 2 : c.pos === 'middle' ? H / 2 - total / 2 + lh / 2 : (vert ? H * 0.7 : H - m * 0.09 - (progress ? m * 0.012 : 0)) - total + lh / 2;
    var pop = bold ? 0.86 + 0.14 * VB.ease((t - cue.s) / 0.12) : 1;
    lines.forEach(function (line, li) {
      var y = y0 + li * lh, x = W / 2 - lw[li] / 2;
      if (style === 'box') {
        var padX = fs * 0.35; rr(g, x - padX, y - lh / 2 + fs * 0.06, lw[li] + padX * 2, lh - fs * 0.12, fs * 0.12); g.fillStyle = 'rgba(8,8,8,.78)'; g.fill();
      }
      line.forEach(function (it) {
        var now = t >= it.w[0] && t < it.w[1] + 0.02, said = t >= it.w[0];
        var fill = style === 'karaoke' ? (now ? hi : said ? '#fff' : 'rgba(255,255,255,.72)') : bold ? (now ? hi : '#fff') : '#fff';
        var sc = pop * (bold && now ? 1.08 : 1), cx = x + it.width / 2;
        g.save(); g.translate(cx, y); g.scale(sc, sc); g.translate(-cx, -y);
        if (style !== 'box') {
          g.lineWidth = fs * (bold ? 0.2 : 0.17); g.strokeStyle = 'rgba(0,0,0,.92)'; g.strokeText(it.txt, x, y);
          if (bold) { g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = fs * 0.12; g.shadowOffsetY = fs * 0.05; }
        }
        g.fillStyle = fill; g.fillText(it.txt, x, y);
        g.restore();
        x += it.width + space;
      });
    });
    g.restore();
  }
  VB.camBubbleRect = function (W, H, cam) {
    var m = Math.min(W, H), d = (cam.size || 0.24) * m * 1.15, mg = m * 0.035, pos = cam.pos || 'br';
    return { x: pos[1] === 'l' ? mg : W - mg - d, y: pos[0] === 't' ? mg : H - mg - d, w: d, h: d };
  };
  function bubble(g, src, W, H, cam) {
    if (!src || !src.img) return;
    var R = VB.camBubbleRect(W, H, cam), d = R.w, rad = cam.shape === 'circle' ? d / 2 : cam.shape === 'rounded' ? d * 0.2 : d * 0.03;
    g.save();
    g.shadowColor = 'rgba(0,0,0,.4)'; g.shadowBlur = d * 0.08; g.shadowOffsetY = d * 0.02;
    rr(g, R.x, R.y, d, d, rad); g.fillStyle = '#222'; g.fill(); g.shadowColor = 'transparent';
    rr(g, R.x, R.y, d, d, rad); g.clip();
    var iw = src.w, ih = src.h, s = Math.min(iw, ih), sx = (iw - s) / 2, sy = Math.max(0, (ih - s) / 2 - ih * 0.06);
    try { g.drawImage(src.img, sx, sy, s, s, R.x, R.y, d, d); } catch (e) { /* not ready */ }
    g.restore();
    if (cam.border !== false) { g.save(); rr(g, R.x, R.y, d, d, rad); g.lineWidth = Math.max(2, d * 0.032); g.strokeStyle = '#fff'; g.stroke(); g.restore(); }
  }
  function fontPx(W, H, k) { return Math.round(Math.min(W, H) * k); }

  /* ------------------------------------------------------------------ cards */
  function drawCard(g, W, H, sc, k, dur, opt) {
    var m = Math.min(W, H), col = sc.color || '#cc181e', inA = VB.ease(k / 0.45), title = sc.title || '', sub = sc.sub || '';
    var cx = W / 2;
    g.save();
    if (sc.style === 'classic') {
      g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
      g.fillStyle = col; g.fillRect(0, 0, m * 0.03, H); g.fillRect(0, H - m * 0.012, W * VB.ease(k / 0.8), m * 0.012);
      g.globalAlpha = inA; g.font = '700 ' + fontPx(W, H, 0.09) + 'px "Roboto Condensed", Roboto, Arial'; g.fillStyle = '#222'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      var lines = wrap(g, title, W * 0.8), lh = fontPx(W, H, 0.1), y0 = H / 2 - (lines.length - 1) * lh / 2 + (1 - inA) * m * 0.04;
      lines.forEach(function (l, i) { g.fillText(l, W * 0.1, y0 + i * lh); });
      g.font = '400 ' + fontPx(W, H, 0.04) + 'px Roboto, Arial'; g.fillStyle = '#626262';
      g.fillText(sub, W * 0.1, y0 + lines.length * lh - lh * 0.35);
      if (sc.emoji) { g.globalAlpha = inA; VB.drawEmoji(g, sc.emoji, W * 0.86, H * 0.2, fontPx(W, H, 0.1)); }
    } else if (sc.style === 'minimal') {
      g.fillStyle = '#0f0f0f'; g.fillRect(0, 0, W, H);
      g.globalAlpha = inA; g.font = '700 ' + fontPx(W, H, 0.08) + 'px "Roboto Condensed", Roboto, Arial'; g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      var ml = wrap(g, title, W * 0.84), mlh = fontPx(W, H, 0.09), my = H / 2 - (ml.length - 1) * mlh / 2 - m * 0.03;
      ml.forEach(function (l, i) { g.fillText(l, cx, my + i * mlh); });
      g.fillStyle = col === '#cc181e' ? '#e62117' : col; var bw = W * 0.18 * VB.ease((k - 0.2) / 0.6); g.fillRect(cx - bw / 2, my + ml.length * mlh - mlh * 0.2, bw, m * 0.008);
      g.font = '400 ' + fontPx(W, H, 0.035) + 'px Roboto, Arial'; g.fillStyle = '#bbb'; g.fillText(sub, cx, my + ml.length * mlh + m * 0.05);
    } else if (sc.style === 'endscreen') {
      // Room for YouTube's end screen: two video boxes and a subscribe circle (YouTube puts the real ones on top).
      var eg = g.createLinearGradient(0, 0, W, H); eg.addColorStop(0, '#1b1b1b'); eg.addColorStop(1, VB.mix(col, -0.55)); g.fillStyle = eg; g.fillRect(0, 0, W, H);
      g.globalAlpha = inA; g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '700 ' + fontPx(W, H, 0.07) + 'px "Roboto Condensed", Roboto, Arial'; g.fillText(title || 'Watch next', cx, H * 0.14);
      var vertE = H > W, bw3 = vertE ? W * 0.74 : W * 0.33, bh3 = bw3 * 9 / 16, gap = vertE ? H * 0.04 : W * 0.05;
      var boxes = vertE ? [[cx - bw3 / 2, H * 0.24], [cx - bw3 / 2, H * 0.24 + bh3 + gap]] : [[cx - bw3 - gap / 2, H * 0.27], [cx + gap / 2, H * 0.27]];
      boxes.forEach(function (p, j) {
        var lift = (1 - VB.ease((k - 0.15 * j) / 0.5)) * m * 0.05;
        g.save(); g.globalAlpha = inA * VB.ease((k - 0.15 * j) / 0.5);
        rr(g, p[0], p[1] + lift, bw3, bh3, m * 0.012); g.fillStyle = 'rgba(255,255,255,.07)'; g.fill();
        g.setLineDash([m * 0.018, m * 0.012]); g.lineWidth = Math.max(2, m * 0.004); g.strokeStyle = 'rgba(255,255,255,.55)'; g.stroke(); g.setLineDash([]);
        g.font = '500 ' + fontPx(W, H, 0.032) + 'px Roboto, Arial'; g.fillStyle = 'rgba(255,255,255,.7)'; g.fillText(j ? 'Best for viewer' : 'Your latest video', p[0] + bw3 / 2, p[1] + lift + bh3 / 2);
        g.restore();
      });
      var r3 = m * (vertE ? 0.11 : 0.09), cy3 = vertE ? H * 0.24 + bh3 * 2 + gap * 2 + r3 : H * 0.27 + bh3 + m * 0.07 + r3;
      g.globalAlpha = inA * VB.ease((k - 0.4) / 0.5);
      g.beginPath(); g.arc(cx, cy3, r3, 0, 7); g.fillStyle = col === '#cc181e' ? '#e62117' : col; g.fill();
      g.lineWidth = Math.max(2, m * 0.005); g.strokeStyle = '#fff'; g.stroke();
      g.fillStyle = '#fff'; g.font = '700 ' + fontPx(W, H, 0.03) + 'px Roboto, Arial'; g.fillText('SUBSCRIBE', cx, cy3);
      if (sub) { g.font = '400 ' + fontPx(W, H, 0.034) + 'px Roboto, Arial'; g.fillStyle = 'rgba(255,255,255,.8)'; g.fillText(sub, cx, cy3 + r3 + m * 0.05); }
    } else if (sc.style === 'subscribe') {
      var gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#e62117'); gr.addColorStop(1, '#a50f14'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
      g.globalAlpha = 0.08; g.fillStyle = '#fff';
      for (var i = -2; i < 12; i++) { g.save(); g.translate(i * W / 8 + (k * 40) % (W / 8), 0); g.rotate(0.35); g.fillRect(0, -H, W / 30, H * 3); g.restore(); }
      g.globalAlpha = inA; g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '700 ' + fontPx(W, H, 0.075) + 'px "Roboto Condensed", Roboto, Arial';
      var sl = wrap(g, title, W * 0.86), slh = fontPx(W, H, 0.085), sy = H * 0.36 - (sl.length - 1) * slh / 2;
      sl.forEach(function (l, j) { g.fillText(l, cx, sy + j * slh); });
      g.font = '400 ' + fontPx(W, H, 0.038) + 'px Roboto, Arial'; g.globalAlpha = inA * 0.9; g.fillText(sub, cx, sy + sl.length * slh);
      var pressed = k > dur * 0.55, bw2 = m * 0.42, bh = m * 0.1, bx = cx - bw2 / 2, by = H * 0.66;
      g.globalAlpha = VB.ease((k - 0.3) / 0.4);
      rr(g, bx, by, bw2, bh, m * 0.012); g.fillStyle = pressed ? '#e8e8e8' : '#fff'; g.fill();
      g.fillStyle = pressed ? '#606060' : '#cc181e'; g.font = '700 ' + fontPx(W, H, 0.042) + 'px Roboto, Arial';
      g.fillText(pressed ? 'SUBSCRIBED ✓' : 'SUBSCRIBE', cx, by + bh / 2 + 1);
      VB.drawEmoji(g, '🔔', bx + bw2 + m * 0.07, by + bh / 2, fontPx(W, H, 0.06) * (pressed ? 1 + Math.sin(k * 25) * 0.08 * Math.max(0, 1 - (k - dur * 0.55)) : 1));
      var cxp = VB.lerp(W * 0.8, cx + bw2 * 0.25, VB.ease((k - 0.4) / (dur * 0.55 - 0.4))), cyp = VB.lerp(H * 0.95, by + bh * 0.6, VB.ease((k - 0.4) / (dur * 0.55 - 0.4)));
      g.save(); g.translate(cxp, cyp); var s = m / 600; g.scale(s, s);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, 26); g.lineTo(7, 20); g.lineTo(12, 31); g.lineTo(17, 29); g.lineTo(12, 18); g.lineTo(21, 18); g.closePath();
      g.fillStyle = '#111'; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); g.restore();
    } else {  // bold + app
      var c2 = sc.style === 'app' ? col : '#cc181e';
      var gr2 = g.createLinearGradient(0, 0, W, H); gr2.addColorStop(0, VB.mix(c2, 0.12)); gr2.addColorStop(1, VB.mix(c2, -0.45)); g.fillStyle = gr2; g.fillRect(0, 0, W, H);
      g.globalAlpha = 0.1; g.fillStyle = '#fff'; g.beginPath(); g.arc(W * 0.85, H * 0.15, m * 0.5, 0, 7); g.fill(); g.beginPath(); g.arc(W * 0.1, H * 0.95, m * 0.35, 0, 7); g.fill();
      g.globalAlpha = inA;
      var top = H / 2;
      if (sc.emoji) {
        var es = m * 0.2, ey = H * 0.5 - m * 0.2 - (1 - inA) * m * 0.03;
        rr(g, cx - es / 2, ey - es / 2, es, es, es * 0.24); g.fillStyle = 'rgba(255,255,255,.95)'; g.fill();
        VB.drawEmoji(g, sc.emoji, cx, ey + es * 0.04, es * 0.62); top = ey + es / 2 + m * 0.1;
      }
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = (sc.style === 'bold' ? '400 ' + fontPx(W, H, 0.12) + 'px Anton, "Roboto Condensed", Impact' : '700 ' + fontPx(W, H, 0.09) + 'px "Roboto Condensed", Roboto, Arial');
      var bl = wrap(g, sc.style === 'bold' ? title.toUpperCase() : title, W * 0.86), blh = fontPx(W, H, sc.style === 'bold' ? 0.13 : 0.1);
      var by2 = sc.emoji ? top : H / 2 - (bl.length - 1) * blh / 2 - m * 0.03;
      g.shadowColor = 'rgba(0,0,0,.25)'; g.shadowBlur = m * 0.02;
      bl.forEach(function (l, j) { g.fillText(l, cx, by2 + j * blh + (1 - inA) * m * 0.03); });
      g.shadowColor = 'transparent'; g.font = '400 ' + fontPx(W, H, 0.04) + 'px Roboto, Arial'; g.globalAlpha = inA * 0.92;
      g.fillText(sub, cx, by2 + bl.length * blh - blh * 0.15);
    }
    g.restore();
  }

  /* ------------------------------------------------------------------ text overlays */
  function drawText(g, W, H, tx, k, dur) {
    var m = Math.min(W, H), inA = VB.ease(k / 0.35) * VB.ease((dur - k) / 0.3), pos = tx.pos || 'bl';
    if (inA <= 0) return;
    var mg = m * 0.05, title = tx.text || '', sub = tx.sub || '';
    g.save(); g.textBaseline = 'middle';
    if (tx.style === 'caption' || tx.style === 'title') {
      var big = tx.style === 'title';
      g.font = big ? '400 ' + fontPx(W, H, 0.1) + 'px Anton, Impact, sans-serif' : '700 ' + fontPx(W, H, 0.055) + 'px Roboto, Arial';
      var lines = wrap(g, big ? title.toUpperCase() : title, W * 0.86), lh = fontPx(W, H, big ? 0.11 : 0.065);
      var y = big ? H / 2 - (lines.length - 1) * lh / 2 : H - mg * 1.6 - (lines.length - 1) * lh;
      if (pos[0] === 't' && !big) y = mg * 1.6;
      g.textAlign = 'center'; g.globalAlpha = inA; g.lineJoin = 'round';
      lines.forEach(function (l, i) {
        var yy = y + i * lh + (big ? (1 - inA) * m * 0.03 : 0);
        g.lineWidth = m * (big ? 0.016 : 0.012); g.strokeStyle = '#000'; g.strokeText(l, W / 2, yy);
        g.fillStyle = big ? '#ffde00' : '#fff'; g.fillText(l, W / 2, yy);
      });
      g.restore(); return;
    }
    if (tx.style === 'lower') {
      var f1 = fontPx(W, H, 0.042), f2 = fontPx(W, H, 0.028);
      g.font = '700 ' + f1 + 'px "Roboto Condensed", Roboto, Arial'; var w1 = g.measureText(title).width;
      g.font = '400 ' + f2 + 'px Roboto, Arial'; var w2 = sub ? g.measureText(sub).width : 0;
      var bw = Math.max(w1, w2) + m * 0.06, bh = f1 * 1.5 + (sub ? f2 * 1.4 : 0), bx = pos[1] === 'r' ? W - mg - bw : mg, by = pos[0] === 't' ? mg : H - mg - bh;
      var slide = (1 - VB.ease(k / 0.4)) * (bw + mg) * (pos[1] === 'r' ? 1 : -1);
      g.translate(slide, 0); g.globalAlpha = Math.min(1, inA * 1.5);
      g.fillStyle = '#e62117'; g.fillRect(bx - m * 0.012, by, m * 0.012, bh);
      g.fillStyle = 'rgba(255,255,255,.96)'; g.fillRect(bx, by, bw, bh);
      g.textAlign = 'left'; g.fillStyle = '#222'; g.font = '700 ' + f1 + 'px "Roboto Condensed", Roboto, Arial'; g.fillText(title, bx + m * 0.03, by + f1 * 0.8);
      if (sub) { g.fillStyle = '#cc181e'; g.font = '500 ' + f2 + 'px Roboto, Arial'; g.fillText(sub, bx + m * 0.03, by + f1 * 1.5 + f2 * 0.55); }
      g.restore(); return;
    }
    // callout + sticky note ("arrow")
    var note = tx.style === 'arrow', fs = fontPx(W, H, 0.036);
    g.font = '700 ' + fs + 'px Roboto, Arial';
    var cl = wrap(g, (note ? '➜ ' : '') + title, W * 0.42), cw = 0;
    cl.forEach(function (l) { cw = Math.max(cw, g.measureText(l).width); });
    var pad = m * 0.025, w = cw + pad * 2 + (note ? 0 : m * 0.012), h = cl.length * fs * 1.3 + pad * 1.6 + (sub ? fs : 0);
    var x = pos[1] === 'l' ? mg : pos[1] === 'r' ? W - mg - w : (W - w) / 2, y2 = pos[0] === 't' ? mg : pos[0] === 'b' ? H - mg - h : (H - h) / 2;
    var sc = 0.7 + 0.3 * VB.ease(k / 0.3) + Math.sin(clamp(k / 0.3, 0, 1) * Math.PI) * 0.05;
    g.translate(x + w / 2, y2 + h / 2); g.scale(sc, sc); if (note) g.rotate(-0.025); g.translate(-x - w / 2, -y2 - h / 2);
    g.globalAlpha = inA; g.shadowColor = 'rgba(0,0,0,.3)'; g.shadowBlur = m * 0.02; g.shadowOffsetY = m * 0.005;
    rr(g, x, y2, w, h, note ? m * 0.004 : m * 0.012); g.fillStyle = note ? '#ffe45c' : '#fff'; g.fill(); g.shadowColor = 'transparent';
    if (!note) { g.fillStyle = '#e62117'; rr(g, x, y2, m * 0.012, h, [m * 0.012, 0, 0, m * 0.012]); g.fill(); }
    g.fillStyle = '#222'; g.textAlign = 'left';
    cl.forEach(function (l, i) { g.fillText(l, x + pad + (note ? 0 : m * 0.012), y2 + pad + fs * 0.6 + i * fs * 1.3); });
    if (sub) { g.font = '400 ' + Math.round(fs * 0.75) + 'px Roboto, Arial'; g.fillStyle = '#555'; g.fillText(sub, x + pad + (note ? 0 : m * 0.012), y2 + pad + fs * 0.6 + cl.length * fs * 1.3 - fs * 0.2); }
    g.restore();
  }

  /* ------------------------------------------------------------------ one frame */
  function layoutOf(plan, s) {
    var e = plan.edit, t = s.take, cam = Object.assign({}, e.cam, s.sc.cam || {}), has = !!(s.src && s.src.cam) && !cam.hidden;
    var lay = s.sc.layout || e.layout;
    if (t.mode === 'cam') return { lay: 'full', cam: cam, has: false };
    if (!has && (lay === 'stack' || lay === 'side' || lay === 'cam' || lay === 'pip')) lay = lay === 'cam' ? 'full' : 'screen';
    if (lay === 'cam') return { lay: 'camfull', cam: cam, has: has };
    return { lay: lay, cam: cam, has: has };
  }
  function drawTake(g, W, H, plan, L) {
    var e = plan.edit, s = L.s, src = s.src, m = Math.min(W, H);
    if (!src || src.missing) {
      g.fillStyle = '#181818'; g.fillRect(0, 0, W, H); g.fillStyle = '#aaa'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '500 ' + fontPx(W, H, 0.04) + 'px Roboto, Arial';
      g.fillText(src && src.missing ? '“' + (s.take.label || 'Take') + '” is on another computer' : 'Loading…', W / 2, H / 2);
      return;
    }
    src.frame(L.srcT);
    var Lo = layoutOf(plan, s), pad = (e.pad || 0) * m, rad = (e.pad > 0.004 ? e.radius || 0 : 0) * m / 1080, zoom = VB.zoomAt(s.zooms, L.srcT);
    var main = src.main, cam = src.cam;
    var bx = s.sc.boxes, t = L.srcT;
    if (Lo.lay === 'full' || Lo.lay === 'camfull') {
      var img = Lo.lay === 'full' ? main : cam;
      background(g, W, H, e.bg, img);
      var R = { x: pad, y: pad, w: W - 2 * pad, h: H - 2 * pad };
      var mf = drawInto(g, img, R, null, rad, true, pad ? m * 0.03 : 0);
      if (Lo.lay === 'full') drawBoxes(g, img, mf, bx, t, W, H);
      return;
    }
    background(g, W, H, e.bg, main);
    if (Lo.lay === 'stack') {
      var sh = (W - 2 * pad) * main.h / main.w, top = { x: pad, y: pad, w: W - 2 * pad, h: Math.min(sh, H * 0.55) };
      drawBoxes(g, main, drawInto(g, main, top, zoom, rad, false, pad ? m * 0.03 : 0), bx, t, W, H);
      var bot = { x: pad, y: top.y + top.h + pad, w: W - 2 * pad, h: H - top.h - 3 * pad };
      if (Lo.has) drawInto(g, cam, bot, null, rad, true, pad ? m * 0.03 : 0);
      return;
    }
    if (Lo.lay === 'side') {
      var lw = (W - 3 * pad) * 0.7, left = { x: pad, y: pad, w: lw, h: H - 2 * pad };
      drawBoxes(g, main, drawInto(g, main, left, zoom, rad, false, pad ? m * 0.03 : 0), bx, t, W, H);
      var right = { x: pad * 2 + lw, y: pad + (H - 2 * pad) * 0.12, w: W - 3 * pad - lw, h: (H - 2 * pad) * 0.76 };
      if (Lo.has) drawInto(g, cam, right, null, rad || m * 0.02, true, m * 0.03);
      return;
    }
    if (Lo.lay === 'crop') {
      var f = s.take.clicks && s.take.clicks.length ? VB.focusAt(s.take.clicks, L.srcT) : [0.5, 0.5];
      var cz = zoom.k > 0 ? zoom : { z: 1, x: f[0], y: f[1] };
      drawBoxes(g, main, drawInto(g, main, { x: 0, y: 0, w: W, h: H }, cz, 0, true, 0), bx, t, W, H);
      if (Lo.has) bubble(g, cam, W, H, Lo.cam);
      return;
    }
    var area = { x: pad, y: pad, w: W - 2 * pad, h: H - 2 * pad };
    drawBoxes(g, main, drawInto(g, main, area, zoom, rad, false, pad ? m * 0.03 : 0), bx, t, W, H);
    if (Lo.lay === 'pip' && Lo.has) bubble(g, cam, W, H, Lo.cam);
  }
  /* Draw output time o. opt: {product, noTransitions, hideTextId} */
  VB.render = function (g, W, H, plan, o, opt) {
    opt = opt || {};
    g.save();
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    var L = VB.locate(plan, o), e = plan.edit;
    if (!L) {
      g.fillStyle = '#181818'; g.fillRect(0, 0, W, H); g.fillStyle = '#9a9a9a'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '500 ' + fontPx(W, H, 0.04) + 'px Roboto, Arial'; g.fillText('Add a take or a title card to start', W / 2, H / 2);
      g.restore(); return null;
    }
    if (L.s.type === 'card') drawCard(g, W, H, L.s.sc, L.local, L.s.dur, opt);
    else {
      drawTake(g, W, H, plan, L);
      (L.s.sc.texts || []).forEach(function (tx) {
        if (L.srcT >= tx.s && L.srcT <= tx.e && tx.id !== opt.hideTextId) drawText(g, W, H, tx, (L.srcT - tx.s) / L.s.speed, (tx.e - tx.s) / L.s.speed);
      });
      if (!opt.noCaptions) drawCaptions(g, W, H, e, L.s, L.srcT, e.progress);
    }
    var m = Math.min(W, H);
    if (e.watermark && L.s.type !== 'card') {
      var cpos = (L.s.sc.cam && L.s.sc.cam.pos) || e.cam.pos || 'br', left = cpos === 'br';
      var wx = left ? m * 0.03 : W - m * 0.03, wy = H - m * 0.03 - (e.progress ? m * 0.012 : 0);
      g.globalAlpha = 0.75; g.font = '700 ' + fontPx(W, H, 0.026) + 'px Roboto, Arial'; g.textAlign = left ? 'left' : 'right'; g.textBaseline = 'alphabetic';
      g.lineWidth = m * 0.005; g.strokeStyle = 'rgba(0,0,0,.5)'; g.strokeText(e.watermark, wx, wy);
      g.fillStyle = '#fff'; g.fillText(e.watermark, wx, wy); g.globalAlpha = 1;
    }
    if (e.progress && plan.outDur > 0) {
      var ph = Math.max(3, m * 0.008);
      g.fillStyle = 'rgba(255,255,255,.3)'; g.fillRect(0, H - ph, W, ph);
      g.fillStyle = '#e62117'; g.fillRect(0, H - ph, W * clamp(o / plan.outDur, 0, 1), ph);
    }
    if (!opt.noTransitions && e.transition !== 'cut') {
      var s = L.s, d = Math.min(o - s.start, s.start + s.dur - o), first = L.si === 0, last = L.si === plan.scenes.length - 1;
      var edgeIn = o - s.start, edgeOut = s.start + s.dur - o, a = 0, T = 0.28;
      if (edgeIn < T && (!first || e.transition === 'fade')) a = Math.max(a, 1 - edgeIn / T);
      if (edgeOut < T && (!last || e.transition === 'fade')) a = Math.max(a, 1 - edgeOut / T);
      if (a > 0 && d >= 0) { g.globalAlpha = VB.ease(a); g.fillStyle = e.transition === 'dip' ? '#fff' : '#000'; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
    }
    g.restore();
    return L;
  };
  /* Audio level for transitions (0..1) at output time o. */
  VB.audioEnv = function (plan, o) {
    var e = plan.edit, L = VB.locate(plan, o);
    if (!L || e.transition === 'cut') return 1;
    var s = L.s, edgeIn = o - s.start, edgeOut = s.start + s.dur - o, T = 0.22;
    return clamp(Math.min(edgeIn / T + (L.si === 0 ? 1 : 0), edgeOut / T + (L.si === plan.scenes.length - 1 ? 1 : 0), 1), 0, 1);
  };

  /* ------------------------------------------------------------------ preview player */
  VB.previewDims = function (aspect) { return aspect === '9:16' ? [540, 960] : aspect === '1:1' ? [720, 720] : [960, 540]; };
  VB.Player = function (canvas, opts) {
    opts = opts || {};
    var self = { o: 0, playing: false, plan: null, opt: {} }, g = canvas.getContext('2d');
    var active = null, last = 0, raf = 0, ac = null, sampleNode = null, sampleKey = null, seekTok = 0, dead = false, music = null, musicUrl = null;
    function W() { return canvas.width; } function H() { return canvas.height; }
    function els(plan) {
      var out = [];
      (plan ? plan.scenes : []).forEach(function (s) { if (s.src && s.src.kind === 'video') { out.push(s.src.main.el); if (s.src.cam) out.push(s.src.cam.el); } });
      return out;
    }
    function pauseAll(except) { els(self.plan).forEach(function (el) { if (except.indexOf(el) < 0 && !el.paused) el.pause(); }); }
    function stopSample() { if (sampleNode) { try { sampleNode.stop(); } catch (e) { /* done */ } sampleNode = null; } sampleKey = null; }
    function draw() { if (self.plan && !dead) VB.render(g, W(), H(), self.plan, self.o, Object.assign({ noTransitions: !self.playing }, self.opt)); if (opts.onTime) opts.onTime(self.o); }
    self.draw = draw;
    self.setPlan = function (plan, keep) {
      self.plan = plan;
      var d = VB.previewDims(plan.edit.aspect);
      if (canvas.width !== d[0] || canvas.height !== d[1]) { canvas.width = d[0]; canvas.height = d[1]; }
      if (!keep) self.o = clamp(self.o, 0, plan.outDur);
      active = null;
      if (self.playing) { stopSample(); } else self.seek(self.o);
    };
    /* Put the video elements on the frame for o, then draw. */
    self.seek = function (o) {
      self.o = clamp(o, 0, self.plan ? self.plan.outDur : 0);
      if (self.playing) { active = null; stopSample(); syncMusic(); return Promise.resolve(); }
      var L = self.plan && VB.locate(self.plan, self.o), tok = ++seekTok;
      if (!L || L.s.type === 'card' || !L.s.src || L.s.src.kind !== 'video') { draw(); return Promise.resolve(); }
      var src = L.s.src, ps = [VB.seek(src.main.el, L.srcT)];
      if (src.cam) ps.push(VB.seek(src.cam.el, L.srcT - src.offset));
      draw();
      return Promise.all(ps).then(function () { if (tok === seekTok) draw(); }, function () { draw(); });
    };
    function ensureAc() {
      if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; } }
      if (ac && ac.state === 'suspended') ac.resume();
      return ac;
    }
    function syncMusic() {
      if (!music) return;
      music.volume = clamp((self.plan && self.plan.edit.music.vol) || 0, 0, 1);
      if (isFinite(music.duration) && music.duration > 0) music.currentTime = self.o % music.duration;
      if (self.playing) music.play()['catch'](function () {}); else music.pause();
    }
    self.setMusic = function (blob) {
      if (music) { music.pause(); URL.revokeObjectURL(musicUrl); music = null; }
      if (blob) { musicUrl = URL.createObjectURL(blob); music = new Audio(musicUrl); music.loop = true; syncMusic(); }
    };
    function step(now) {
      var plan = self.plan, L = VB.locate(plan, self.o);
      if (!L) return finish();
      var s = L.s, key = L.si + ':' + (L.gi || 0), dt = Math.min(0.1, (now - last) / 1000); last = now;
      var voice = clamp(plan.edit.voice == null ? 1 : plan.edit.voice, 0, 1) * VB.audioEnv(plan, self.o);
      if (s.type === 'take' && s.src && s.src.kind === 'video') {
        stopSample();
        var el = s.src.main.el, cam = s.src.cam && s.src.cam.el;
        if (active !== key) {
          pauseAll([el, cam]);
          el.playbackRate = s.speed; if (cam) cam.playbackRate = s.speed;
          if (Math.abs(el.currentTime - L.srcT) > 0.08) el.currentTime = L.srcT;
          if (cam && Math.abs(cam.currentTime - (L.srcT - s.src.offset)) > 0.08) cam.currentTime = Math.max(0, L.srcT - s.src.offset);
          el.play()['catch'](function () {}); if (cam) cam.play()['catch'](function () {});
          active = key; return;
        }
        el.muted = !!s.sc.mute; el.volume = voice;
        if (el.seeking || el.readyState < 2) return;
        var t = el.currentTime;
        if (t >= L.seg.b - 0.025 || el.ended) { self.o = s.start + L.seg.o + L.seg.len + 0.0005; active = null; if (self.o >= plan.outDur - 0.001) finish(); return; }
        if (t < L.seg.a - 0.3) return;  // still seeking into place
        self.o = s.start + L.seg.o + (t - L.seg.a) / s.speed;
        if (cam) { var ct = t - s.src.offset; if (cam.paused) cam.play()['catch'](function () {}); if (Math.abs(cam.currentTime - ct) > 0.25) cam.currentTime = Math.max(0, ct); }
        return;
      }
      if (active !== key) { pauseAll([]); active = key; stopSample(); }
      if (s.type === 'take' && s.src && s.src.kind === 'sample' && !s.sc.mute) {
        var a2 = ensureAc();
        if (a2 && sampleKey !== key) {
          stopSample();
          var n = a2.createBufferSource(), gn = a2.createGain(); n.buffer = VB.sampleAudio(s.src.sample, a2); n.playbackRate.value = s.speed;
          gn.gain.value = voice; n.connect(gn); gn.connect(a2.destination);
          n.start(0, L.srcT, Math.max(0.01, L.seg.b - L.srcT)); sampleNode = n; sampleNode._g = gn; sampleKey = key;
        } else if (sampleNode && sampleNode._g) sampleNode._g.gain.value = voice;
      }
      self.o += dt;
      if (self.o >= plan.outDur) finish();
    }
    function finish() { self.o = self.plan.outDur; self.pause(); if (opts.onEnd) opts.onEnd(); }
    function loop(now) {
      if (!self.playing || dead) return;
      var before = self.o;
      step(now);
      if (self.plan && self.plan.sfx && self.plan.sfx.length && self.playing) {
        VB.fireSfx(self.plan, before, self.o, function (ev) { var a = ensureAc(); if (a) VB.playSfx(a, a.destination, ev.kind, self.plan.edit.sfx && self.plan.edit.sfx.vol); });
      }
      draw();
      raf = requestAnimationFrame(loop);
    }
    self.play = function () {
      if (!self.plan || !self.plan.outDur) return;
      if (self.o >= self.plan.outDur - 0.05) self.o = 0;
      self.playing = true; active = null; last = performance.now(); ensureAc(); syncMusic();
      if (opts.onState) opts.onState(true);
      cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
    };
    self.pause = function () {
      self.playing = false; cancelAnimationFrame(raf); pauseAll([]); stopSample(); active = null; if (music) music.pause();
      if (opts.onState) opts.onState(false);
      draw();
    };
    self.toggle = function () { if (self.playing) self.pause(); else self.play(); };
    self.destroy = function () { dead = true; self.pause(); self.setMusic(null); if (ac) ac.close(); };
    return self;
  };

  /* ------------------------------------------------------------------ export */
  VB.recorderType = function (videoOnly) {
    if (!window.MediaRecorder) return null;
    var list = videoOnly ? ['video/mp4;codecs=avc1.42E01F', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      : ['video/mp4;codecs=avc1.42E01F,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    for (var i = 0; i < list.length; i++) if (MediaRecorder.isTypeSupported(list[i])) return list[i];
    return null;
  };
  VB.canExport = function () { return !!(VB.recorderType() && HTMLCanvasElement.prototype.captureStream && window.AudioContext); };
  function nextFrame() {
    return new Promise(function (res) {
      if (document.hidden) setTimeout(res, 33); else requestAnimationFrame(function () { res(); });
    });
  }
  /* opts: {quality: '720'|'1080', music: Blob, onProgress(fraction, canvas), signal: {aborted}} */
  VB.exportVideo = async function (plan, opts) {
    opts = opts || {};
    var mime = VB.recorderType();
    if (!mime || !VB.canExport()) throw new Error('This browser can\'t make videos. Use Chrome, Edge or Safari on a computer.');
    if (!plan.outDur) throw new Error('The video is empty: add a take or a card first.');
    var d = VB.dims(plan.edit.aspect, opts.quality), W = d[0], H = d[1];
    var canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    var g = canvas.getContext('2d'), cleanup = [];
    var srcs = {}, takes = {};
    plan.scenes.forEach(function (s) { if (s.type === 'take') takes[s.take.id] = s.take; });
    try {
      for (var id in takes) {
        var src = await VB.openTake(takes[id], { fresh: true });
        if (src.missing) throw new Error('“' + (takes[id].label || 'A take') + '” isn\'t on this computer. Re-link its file, or remove it from the edit.');
        srcs[id] = src; cleanup.push(src.release);
      }
      var p2 = VB.plan(plan.edit, Object.keys(takes).map(function (k) { return takes[k]; }), srcs);
      var ac = new (window.AudioContext || window.webkitAudioContext)(); cleanup.push(function () { ac.close(); });
      await ac.resume();
      var dest = ac.createMediaStreamDestination(), voice = ac.createGain(), voiceOut = voice;
      if (plan.edit.voice_fx === 'clean') {
        // "Clean voice": cut the rumble, a little presence, even out the level.
        var hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 85; hp.Q.value = 0.7;
        var pk = ac.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 3200; pk.Q.value = 0.9; pk.gain.value = 3;
        var lo = ac.createBiquadFilter(); lo.type = 'lowshelf'; lo.frequency.value = 180; lo.gain.value = -2;
        var cp = ac.createDynamicsCompressor(); cp.threshold.value = -26; cp.ratio.value = 3.5; cp.attack.value = 0.008; cp.release.value = 0.2; cp.knee.value = 8;
        var mk = ac.createGain(); mk.gain.value = 1.45;
        voice.connect(hp); hp.connect(lo); lo.connect(pk); pk.connect(cp); cp.connect(mk); voiceOut = mk;
      }
      voiceOut.connect(dest);
      var an = ac.createAnalyser(); an.fftSize = 512; voiceOut.connect(an);
      var sfxOut = ac.createGain(); sfxOut.gain.value = 1; sfxOut.connect(dest);
      var elGain = {};
      Object.keys(srcs).forEach(function (k) {
        var s = srcs[k];
        if (s.kind === 'video') { var n = ac.createMediaElementSource(s.main.el), gn = ac.createGain(); n.connect(gn); gn.connect(voice); elGain[k] = gn; s.main.el.muted = false; s.main.el.volume = 1; }
      });
      var music = null, mg = null;
      if (opts.music) {
        var mu = URL.createObjectURL(opts.music); music = new Audio(mu); music.loop = true; cleanup.push(function () { music.pause(); URL.revokeObjectURL(mu); });
        mg = ac.createGain(); mg.gain.value = plan.edit.music.vol; ac.createMediaElementSource(music).connect(mg); mg.connect(dest);
      }
      var vt = canvas.captureStream(30).getVideoTracks()[0];
      var stream = new MediaStream([vt].concat(dest.stream.getAudioTracks()));
      var rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: W * H > 1.2e6 ? 8e6 : 4.5e6, audioBitsPerSecond: 160000 });
      var chunks = []; rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      var stopped = new Promise(function (res, rej) { rec.onstop = res; rec.onerror = function (e) { rej(e.error || new Error('Recording failed.')); }; });
      var buf = new Float32Array(512), duckV = 1, lastO = 0;
      function frame(o) {
        if (opts.signal && opts.signal.aborted) throw Object.assign(new Error('Export cancelled.'), { cancelled: true });
        VB.render(g, W, H, p2, o, { product: opts.product, noCaptions: opts.noCaptions });
        VB.fireSfx(p2, lastO, o, function (ev) { VB.playSfx(ac, sfxOut, ev.kind, p2.edit.sfx && p2.edit.sfx.vol); });
        lastO = o;
        var env = VB.audioEnv(p2, o), now = ac.currentTime;
        voice.gain.setTargetAtTime(clamp(p2.edit.voice == null ? 1 : p2.edit.voice, 0, 2) * env, now, 0.02);
        if (mg) {
          an.getFloatTimeDomainData(buf); var s = 0; for (var i = 0; i < buf.length; i++) s += buf[i] * buf[i];
          var talking = Math.sqrt(s / buf.length) > 0.02; duckV = p2.edit.music.duck && talking ? 0.4 : 1;
          var fadeOut = clamp((p2.outDur - o) / 1.5, 0, 1);
          mg.gain.setTargetAtTime(p2.edit.music.vol * duckV * fadeOut, now, 0.15);
        }
        if (opts.onProgress) opts.onProgress(clamp(o / p2.outDur, 0, 1), canvas);
      }
      async function clockRun(o0, len) {
        var t0 = performance.now();
        for (;;) {
          var e = (performance.now() - t0) / 1000;
          if (e >= len) break;
          frame(o0 + e);
          await nextFrame();
        }
      }
      frame(0);
      rec.start(1000);
      if (music) music.play()['catch'](function () {});
      for (var si = 0; si < p2.scenes.length; si++) {
        var s = p2.scenes[si];
        if (s.type === 'card') { await clockRun(s.start, s.dur); continue; }
        var src2 = s.src;
        for (var gi = 0; gi < s.segs.length; gi++) {
          var seg = s.segs[gi];
          if (src2.kind === 'video') {
            var el = src2.main.el, cam = src2.cam && src2.cam.el;
            rec.pause(); if (music) music.pause();
            await VB.seek(el, seg.a); if (cam) await VB.seek(cam, Math.max(0, seg.a - src2.offset));
            elGain[s.take.id].gain.value = s.sc.mute ? 0 : 1;
            el.playbackRate = s.speed; if (cam) cam.playbackRate = s.speed;
            frame(s.start + seg.o);
            rec.resume(); if (music) music.play()['catch'](function () {});
            await el.play(); if (cam) cam.play()['catch'](function () {});
            var guard = performance.now();
            for (;;) {
              var t = el.currentTime;
              if (t >= seg.b - 0.02 || el.ended) break;
              if (performance.now() - guard > (seg.len + 20) * 1000) break;
              frame(s.start + seg.o + Math.max(0, t - seg.a) / s.speed);
              if (cam) { var ct = t - src2.offset; if (Math.abs(cam.currentTime - ct) > 0.3) cam.currentTime = Math.max(0, ct); }
              await nextFrame();
            }
            el.pause(); if (cam) cam.pause();
          } else {
            var node = ac.createBufferSource(), gn = ac.createGain(); node.buffer = VB.sampleAudio(src2.sample, ac); node.playbackRate.value = s.speed;
            gn.gain.value = s.sc.mute ? 0 : 1; node.connect(gn); gn.connect(voice);
            node.start(0, seg.a, seg.b - seg.a);
            await clockRun(s.start + seg.o, seg.len);
            try { node.stop(); } catch (e) { /* ended */ }
          }
        }
      }
      frame(p2.outDur - 0.001);
      await new Promise(function (r) { setTimeout(r, 150); });
      rec.stop();
      await stopped;
      var blob = new Blob(chunks, { type: mime.split(';')[0] });
      return { blob: blob, mime: mime, ext: /mp4/.test(mime) ? 'mp4' : 'webm', seconds: +p2.outDur.toFixed(1), width: W, height: H };
    } finally {
      cleanup.forEach(function (f) { try { f(); } catch (e) { /* closing */ } });
    }
  };

  /* ------------------------------------------------------------------ frames + thumbnails */
  /* A still of a take at t: {screen: canvas, face: canvas|null} */
  VB.grabFrame = async function (take, t) {
    var src = await VB.openTake(take, { fresh: true });
    try {
      if (src.missing) return null;
      t = clamp(t || 0, 0, Math.max(0, (src.duration || take.duration || 1) - 0.05));
      if (src.kind === 'video') { await VB.seek(src.main.el, t); if (src.cam) await VB.seek(src.cam.el, Math.max(0, t - src.offset)); }
      else src.frame(t);
      function copy(s) { if (!s) return null; var c = document.createElement('canvas'); c.width = s.w; c.height = s.h; c.getContext('2d').drawImage(s.img, 0, 0, s.w, s.h); return c; }
      var screen = copy(src.main), face = copy(src.cam);
      if (take.mode === 'cam') { face = screen; }
      return { screen: screen, face: face };
    } finally { src.release(); }
  };
  VB.THUMB_TPLS = [['bold', 'Bold'], ['split', 'Split'], ['emoji', 'Big emoji'], ['minimal', 'Minimal'], ['news', 'Breaking']];
  function cover(g, img, x, y, w, h, fx) {
    if (!img) return;
    var iw = img.width, ih = img.height, k = Math.max(w / iw, h / ih), sw = w / k, sh = h / k;
    var sx = clamp((fx == null ? 0.5 : fx) * iw - sw / 2, 0, iw - sw), sy = (ih - sh) / 2;
    g.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }
  function strokeText(g, s, x, y, fill, line, lw) { g.lineJoin = 'round'; g.lineWidth = lw; g.strokeStyle = line; g.strokeText(s, x, y); g.fillStyle = fill; g.fillText(s, x, y); }
  /* design: {tpl, text, text2, color, bg, emoji, face, arrow}; frames: {screen, face} canvases */
  VB.drawThumb = function (g, W, H, design, frames, product) {
    var d = design || {}, tpl = d.tpl || 'bold', screen = frames && frames.screen, face = frames && frames.face && d.face !== false ? frames.face : null;
    var t1 = (d.text || '').toUpperCase(), t2 = (d.text2 || '').toUpperCase(), col = d.color || '#ffde00', bg = d.bg || '#cc181e', m = H;
    g.save(); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    function faceCircle(cx, cy, r) {
      if (!face) return;
      g.save(); g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = r * 0.15; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fillStyle = '#fff'; g.fill(); g.shadowColor = 'transparent';
      g.beginPath(); g.arc(cx, cy, r * 0.94, 0, 7); g.clip(); var s = Math.min(face.width, face.height);
      g.drawImage(face, (face.width - s) / 2, Math.max(0, (face.height - s) / 2 - face.height * 0.05), s, s, cx - r, cy - r, r * 2, r * 2); g.restore();
    }
    function bigText(lines, x, y, size, align, maxW) {
      g.font = '400 ' + size + 'px Anton, Impact, sans-serif'; g.textAlign = align; g.textBaseline = 'alphabetic';
      var all = []; lines.forEach(function (l, i) { if (l) wrap(g, l, maxW).forEach(function (w) { all.push([w, i]); }); });
      var lh = size * 1.02;
      all.forEach(function (l, i) { strokeText(g, l[0], x, y + i * lh, l[1] === 0 ? col : '#fff', '#000', size * 0.12); });
      return all.length * lh;
    }
    if (tpl === 'split') {
      if (screen) cover(g, screen, W * 0.45, 0, W * 0.55, H, 0.5);
      g.fillStyle = bg; g.beginPath(); g.moveTo(0, 0); g.lineTo(W * 0.52, 0); g.lineTo(W * 0.44, H); g.lineTo(0, H); g.fill();
      bigText([t1, t2], W * 0.04, H * 0.3, m * 0.17, 'left', W * 0.4);
      faceCircle(W * 0.47, H * 0.72, m * 0.24);
    } else if (tpl === 'emoji') {
      if (screen) { g.filter = 'blur(' + Math.round(m / 60) + 'px) brightness(.6)'; cover(g, screen, -20, -20, W + 40, H + 40); g.filter = 'none'; }
      VB.drawEmoji(g, d.emoji || (product && product.emoji) || '🚀', W * 0.3, H * 0.45, m * 0.5);
      bigText([t1, t2], W * 0.72, H * 0.35, m * 0.16, 'center', W * 0.48);
      faceCircle(W * 0.86, H * 0.8, m * 0.17);
    } else if (tpl === 'minimal') {
      if (screen) cover(g, screen, 0, 0, W, H);
      var gr = g.createLinearGradient(0, H * 0.35, 0, H); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.85)'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
      g.font = '700 ' + Math.round(m * 0.12) + 'px "Roboto Condensed", Roboto, Arial'; g.textAlign = 'left'; g.fillStyle = '#fff';
      wrap(g, d.text || '', W * 0.7).forEach(function (l, i, a) { g.fillText(l, W * 0.05, H * 0.88 - (a.length - 1 - i) * m * 0.13); });
      if (product) { g.font = '700 ' + Math.round(m * 0.05) + 'px Roboto, Arial'; var pw = g.measureText((product.emoji || '') + ' ' + product.name).width + m * 0.06;
        rr(g, W * 0.05, H * 0.06, pw, m * 0.09, m * 0.012); g.fillStyle = product.color || bg; g.fill(); g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText((product.emoji || '') + ' ' + product.name, W * 0.05 + m * 0.03, H * 0.06 + m * 0.047); }
      faceCircle(W * 0.85, H * 0.72, m * 0.2);
    } else if (tpl === 'news') {
      if (screen) cover(g, screen, 0, 0, W, H);
      g.fillStyle = 'rgba(0,0,0,.15)'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff'; g.fillRect(0, H * 0.7, W, H * 0.3); g.fillStyle = bg; g.fillRect(0, H * 0.7, W, H * 0.025);
      rr(g, W * 0.04, H * 0.07, m * 0.36, m * 0.12, 4); g.fillStyle = bg; g.fill();
      g.font = '400 ' + Math.round(m * 0.085) + 'px Anton, Impact'; g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(d.text2 ? t2 : 'NEW', W * 0.04 + m * 0.18, H * 0.07 + m * 0.065);
      g.font = '400 ' + Math.round(m * 0.13) + 'px Anton, Impact'; g.fillStyle = '#111'; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText(wrap(g, t1, W * 0.66)[0] || '', W * 0.04, H * 0.86);
      faceCircle(W * 0.84, H * 0.62, m * 0.24);
    } else {  // bold
      if (screen) cover(g, screen, 0, 0, W, H);
      var gr2 = g.createLinearGradient(0, 0, W * 0.75, 0); gr2.addColorStop(0, 'rgba(0,0,0,.82)'); gr2.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr2; g.fillRect(0, 0, W, H);
      g.fillStyle = bg; g.fillRect(0, 0, m * 0.03, H);
      bigText([t1, t2], W * 0.05, H * 0.32, m * 0.19, 'left', W * 0.56);
      faceCircle(W * 0.8, H * 0.62, m * 0.3);
      if (d.emoji) VB.drawEmoji(g, d.emoji, W * 0.62, H * 0.2, m * 0.2);
    }
    if (d.arrow) {
      g.save(); g.translate(W * 0.6, H * 0.62); g.rotate(-0.5); g.fillStyle = '#e62117'; g.strokeStyle = '#fff'; g.lineWidth = m * 0.012;
      g.beginPath(); g.moveTo(-m * 0.2, -m * 0.035); g.lineTo(m * 0.05, -m * 0.035); g.lineTo(m * 0.05, -m * 0.09); g.lineTo(m * 0.17, 0); g.lineTo(m * 0.05, m * 0.09); g.lineTo(m * 0.05, m * 0.035); g.lineTo(-m * 0.2, m * 0.035); g.closePath();
      g.fill(); g.stroke(); g.restore();
    }
    g.restore();
  };
  /* A small JPEG data URL of a canvas (library cards). */
  VB.smallJpeg = function (canvas, w, q) {
    w = w || 320; var h = Math.round(w * canvas.height / canvas.width), c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(canvas, 0, 0, w, h);
    return c.toDataURL('image/jpeg', q || 0.72);
  };
})();

/* ===== _c_recorder.html ===== */
(function () {
  'use strict';
  var VB = window.VB, clamp = VB.clamp, esc = UI.esc;

  /* ------------------------------------------------------------------ script text */
  /* "# Heading" lines, "[SHOW: ...]" stage directions (not read out), "(pause)" beats. */
  VB.parseScript = function (text) {
    var out = [];
    String(text || '').split(/\n/).forEach(function (raw) {
      var l = raw.trim();
      if (!l) return;
      if (/^#+\s*/.test(l)) out.push({ k: 'h', text: l.replace(/^#+\s*/, '') });
      else if (/^\[.*\]$/.test(l)) out.push({ k: 'show', text: l.replace(/^\[\s*(show:)?\s*/i, '').replace(/\]$/, '') });
      else out.push({ k: 'line', text: l });
    });
    return out;
  };
  VB.scriptStats = function (text) {
    var lines = VB.parseScript(text), words = 0, pauses = 0;
    lines.forEach(function (l) {
      if (l.k !== 'line') return;
      pauses += (l.text.match(/\(pause\)/gi) || []).length;
      words += l.text.replace(/\(pause\)/gi, ' ').split(/\s+/).filter(Boolean).length;
    });
    return { words: words, seconds: Math.round(words / 150 * 60 + pauses * 1.2), sections: lines.filter(function (l) { return l.k === 'h'; }).length };
  };

  /* ------------------------------------------------------------------ teleprompter */
  VB.Prompter = function (el, text, opts) {
    opts = opts || {};
    var win = el.ownerDocument.defaultView, self = { speed: opts.speed || 40, running: false, y: 0 }, raf = 0, last = 0;
    el.classList.add('vb-prompter');
    if (opts.fontSize) el.style.fontSize = opts.fontSize + 'px';
    var lines = VB.parseScript(text);
    el.innerHTML = lines.length ? '<div class="guide"></div><div class="roll">' + lines.map(function (l) {
      var t = esc(l.text).replace(/\(pause\)/gi, '<span class="pz">⏸ pause</span>');
      return '<p class="ln ' + l.k + '">' + (l.k === 'show' ? '▸ ' : '') + t + '</p>';
    }).join('') + '</div>' : '<div class="empty">No script yet. Write one in the video\'s Script tab, or just talk naturally.</div>';
    var roll = el.querySelector('.roll');
    function apply() { if (roll) roll.style.transform = 'translateY(' + (-self.y) + 'px)' + (self.mirror ? ' scaleX(-1)' : ''); }
    function frame(now) {
      if (!self.running) return;
      var dt = Math.min(0.1, (now - last) / 1000); last = now;
      self.y += self.speed * dt;
      if (roll) { var max = roll.scrollHeight - el.clientHeight * 0.4; if (self.y > max) { self.y = max; } }
      apply();
      raf = win.requestAnimationFrame(frame);
    }
    self.start = function () { if (self.running || !roll) return; self.running = true; last = win.performance.now(); raf = win.requestAnimationFrame(frame); };
    self.pause = function () { self.running = false; win.cancelAnimationFrame(raf); };
    self.toggle = function () { if (self.running) self.pause(); else self.start(); return self.running; };
    self.reset = function () { self.y = 0; apply(); };
    self.nudge = function (px) { self.y = Math.max(0, self.y + px); apply(); };
    self.setSpeed = function (s) { self.speed = clamp(s, 5, 200); };
    self.setMirror = function (m) { self.mirror = !!m; apply(); };
    self.setFont = function (px) { el.style.fontSize = clamp(px, 10, 90) + 'px'; };
    self.destroy = function () { self.pause(); };
    el.addEventListener('wheel', function (e) { e.preventDefault(); self.nudge(e.deltaY * 0.6); }, { passive: false });
    apply();
    return self;
  };

  /* ------------------------------------------------------------------ devices */
  VB.devices = function () {
    if (!(navigator.mediaDevices && navigator.mediaDevices.enumerateDevices)) return Promise.resolve({ cams: [], mics: [], labels: false });
    return navigator.mediaDevices.enumerateDevices().then(function (list) {
      var cams = list.filter(function (d) { return d.kind === 'videoinput'; }), mics = list.filter(function (d) { return d.kind === 'audioinput'; });
      return { cams: cams, mics: mics, labels: list.some(function (d) { return !!d.label; }) };
    }, function () { return { cams: [], mics: [], labels: false }; });
  };
  function recType(audio) {
    if (!window.MediaRecorder) return '';
    var list = audio ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4']
      : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1', 'video/mp4'];
    for (var i = 0; i < list.length; i++) if (MediaRecorder.isTypeSupported(list[i])) return list[i];
    return '';
  }
  VB.canRecord = function () { return !!(window.MediaRecorder && navigator.mediaDevices && recType(true)); };

  /* ------------------------------------------------------------------ the recorder */
  /* opts: {mode: 'screen_cam'|'screen'|'cam', camId, micId ('' = no mic), quality: '720'|'1080', systemAudio: bool,
            onEnded() (sharing stopped from the browser bar)} */
  VB.Recorder = function (opts) {
    var R = { opts: opts, state: 'idle', display: null, cam: null, mic: null, markers: [], clicks: [], t0: 0, paused: 0, pausedAt: 0, wall0: 0, pauses: [] };
    var ac = null, analyser = null, dest = null, mainRec = null, camRec = null, chunks = { main: [], cam: [] }, n = { main: 0, cam: 0 }, starts = {};
    var levelBuf = null;
    function stopTracks(s) { if (s) s.getTracks().forEach(function (t) { t.stop(); }); }
    R.needsScreen = function () { return R.opts.mode !== 'cam'; };
    R.needsCam = function () { return R.opts.mode !== 'screen'; };
    /* Ask for the screen (the browser's picker), or open a tab stream handed over by the extension. */
    R.getDisplay = function (tabStreamId) {
      if (R.display && R.display.getVideoTracks()[0] && R.display.getVideoTracks()[0].readyState === 'live') return Promise.resolve(R.display);
      var hi = R.opts.quality === '1080';
      var p;
      if (tabStreamId) {
        var m = { chromeMediaSource: 'tab', chromeMediaSourceId: tabStreamId };
        p = navigator.mediaDevices.getUserMedia({ audio: { mandatory: m }, video: { mandatory: Object.assign({ maxWidth: hi ? 1920 : 1280, maxHeight: hi ? 1080 : 720, maxFrameRate: 30 }, m) } })
          .then(function (s) { s._tab = true; return s; });
      } else {
        if (!VB.canScreen()) return Promise.reject(new Error('Screen recording needs Chrome, Edge or Firefox on a computer.'));
        p = navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 30, max: 30 }, width: { ideal: hi ? 1920 : 1280 }, height: { ideal: hi ? 1080 : 720 } },
          audio: !!R.opts.systemAudio, selfBrowserSurface: 'exclude', surfaceSwitching: 'include', systemAudio: 'include', preferCurrentTab: false
        });
      }
      return p.then(function (s) {
        R.display = s;
        s.getVideoTracks()[0].addEventListener('ended', function () { if (R.opts.onEnded) R.opts.onEnded(); });
        return s;
      });
    };
    R.getCam = function () {
      if (R.cam && R.cam.getVideoTracks()[0] && R.cam.getVideoTracks()[0].readyState === 'live') return Promise.resolve(R.cam);
      var v = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
      if (R.opts.camId) v.deviceId = { exact: R.opts.camId };
      return navigator.mediaDevices.getUserMedia({ video: v }).then(function (s) { R.cam = s; return s; });
    };
    R.getMic = function () {
      if (R.opts.micId === '') return Promise.resolve(null);
      if (R.mic && R.mic.getAudioTracks()[0] && R.mic.getAudioTracks()[0].readyState === 'live') return Promise.resolve(R.mic);
      var a = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
      if (R.opts.micId) a.deviceId = { exact: R.opts.micId };
      return navigator.mediaDevices.getUserMedia({ audio: a }).then(function (s) { R.mic = s; setupAudio(); return s; });
    };
    function setupAudio() {
      if (!ac) { ac = new (window.AudioContext || window.webkitAudioContext)(); dest = ac.createMediaStreamDestination(); }
      if (R.mic && !R.mic._wired) {
        var src = ac.createMediaStreamSource(R.mic); analyser = ac.createAnalyser(); analyser.fftSize = 1024; levelBuf = new Float32Array(1024);
        src.connect(analyser); src.connect(dest); R.mic._wired = true;
      }
      if (R.display && R.display.getAudioTracks().length && !R.display._wired) {
        var ds = ac.createMediaStreamSource(R.display); ds.connect(dest);
        if (R.display._tab) ds.connect(ac.destination);  // a captured tab goes quiet: play it back so you still hear it
        R.display._wired = true;
      }
    }
    R.level = function () {
      if (!analyser) return 0;
      analyser.getFloatTimeDomainData(levelBuf);
      var s = 0; for (var i = 0; i < levelBuf.length; i++) s += levelBuf[i] * levelBuf[i];
      return clamp(Math.sqrt(s / levelBuf.length) * 4.5, 0, 1);
    };
    /* Everything this mode needs. screen: also ask for the screen now (else it waits for start). */
    R.prepare = function (withScreen, tabStreamId) {
      var ps = [];
      if (R.needsCam()) ps.push(R.getCam());
      ps.push(R.getMic());
      return Promise.all(ps).then(function () { return withScreen && R.needsScreen() ? R.getDisplay(tabStreamId) : null; })
        .then(function () { setupAudio(); return R; });
    };
    R.t = function () {
      if (!R.t0) return 0;
      var now = performance.now();
      return Math.max(0, (now - R.t0 - R.paused - (R.state === 'paused' ? now - R.pausedAt : 0)) / 1000);
    };
    function persistMeta() {
      VB.vault.meta.set('rec:' + R.rid, { rid: R.rid, key: R.key, videoId: R.videoId, mode: R.opts.mode, started: R.startedWall, t: R.t(),
        markers: R.markers, clicks: R.clicks, mainType: R.mainType, camType: R.camType, offset: R.offset || 0, source: R.source });
    }
    /* Start recording now (the page did the countdown). */
    R.start = function (videoId, source) {
      if (R.state === 'recording' || R.state === 'paused') return;
      if (ac && ac.state === 'suspended') ac.resume();
      setupAudio();
      var mode = R.opts.mode, vt = mode === 'cam' ? R.cam.getVideoTracks()[0] : R.display.getVideoTracks()[0];
      var hasAudio = !!(dest && ((R.mic && R.mic.getAudioTracks().length) || (R.display && R.display.getAudioTracks().length)));
      var tracks = [vt].concat(hasAudio ? dest.stream.getAudioTracks() : []);
      R.mainType = recType(hasAudio); R.camType = recType(false); R.hasAudio = hasAudio;
      R.rid = VB.uid('r'); R.key = VB.uid('k'); R.videoId = videoId; R.source = source || 'recorder';
      R.markers = []; R.clicks = []; R.pauses = []; chunks = { main: [], cam: [] }; n = { main: 0, cam: 0 }; starts = {};
      var hi = R.opts.quality === '1080';
      mainRec = new MediaRecorder(new MediaStream(tracks), { mimeType: R.mainType, videoBitsPerSecond: mode === 'cam' ? 3.5e6 : (hi ? 6e6 : 3.5e6), audioBitsPerSecond: 128000 });
      if (mode === 'screen_cam' && R.cam) camRec = new MediaRecorder(new MediaStream([R.cam.getVideoTracks()[0]]), { mimeType: R.camType, videoBitsPerSecond: 1.8e6 });
      else camRec = null;
      function wire(rec, part) {
        rec.ondataavailable = function (e) {
          if (!e.data || !e.data.size) return;
          chunks[part].push(e.data);
          VB.vault.chunk(R.rid, part, n[part]++, e.data)['catch'](function () { /* storage full: still in memory */ });
          if (part === 'main') persistMeta();
        };
        rec.onstart = function () { starts[part] = performance.now(); };
      }
      wire(mainRec, 'main'); if (camRec) wire(camRec, 'cam');
      R.t0 = performance.now(); R.paused = 0; R.startedWall = Date.now(); R.state = 'recording';
      mainRec.start(1000); if (camRec) camRec.start(1000);
      persistMeta();
    };
    R.pause = function () {
      if (R.state !== 'recording') return;
      mainRec.pause(); if (camRec) camRec.pause();
      R.pausedAt = performance.now(); R.pauseWall = Date.now(); R.state = 'paused';
    };
    R.resume = function () {
      if (R.state !== 'paused') return;
      mainRec.resume(); if (camRec) camRec.resume();
      R.paused += performance.now() - R.pausedAt; R.pauses.push([R.pauseWall, Date.now()]); R.state = 'recording';
    };
    R.mark = function (kind, label) {
      if (R.state !== 'recording' && R.state !== 'paused') return null;
      var t = +R.t().toFixed(2), m = [t, kind || 'chapter', label || (kind === 'highlight' ? 'Highlight' : 'Chapter ' + (R.markers.filter(function (x) { return x[1] === 'chapter'; }).length + 1))];
      R.markers.push(m); persistMeta();
      return m;
    };
    /* A click from the extension: wall-clock ms + position (0..1) in the recorded tab. */
    R.addClick = function (ts, x, y) {
      if (R.state !== 'recording') return;
      var paused = 0;
      R.pauses.forEach(function (p) { if (ts > p[1]) paused += p[1] - p[0]; });
      var t = (ts - R.startedWall - paused) / 1000;
      if (t < 0 || t > R.t() + 1) return;
      R.clicks.push([+t.toFixed(2), +clamp(x, 0, 1).toFixed(4), +clamp(y, 0, 1).toFixed(4)]);
    };
    function stopRec(rec) { return new Promise(function (res) { if (!rec || rec.state === 'inactive') return res(); rec.addEventListener('stop', function () { res(); }, { once: true }); rec.stop(); }); }
    /* Stop and save the files in this browser. -> Promise of the take facts (+ blobs). Streams stay open for another take. */
    R.stop = function () {
      if (R.state !== 'recording' && R.state !== 'paused') return Promise.reject(new Error('Not recording.'));
      var dur = R.t();
      R.state = 'saving';
      return Promise.all([stopRec(mainRec), stopRec(camRec)]).then(function () {
        var main = new Blob(chunks.main, { type: R.mainType.split(';')[0] }), cam = camRec ? new Blob(chunks.cam, { type: R.camType.split(';')[0] }) : null;
        var vt = (R.opts.mode === 'cam' ? R.cam : R.display).getVideoTracks()[0], st = vt.getSettings ? vt.getSettings() : {};
        var ct = R.cam && R.cam.getVideoTracks()[0], cs = ct && ct.getSettings ? ct.getSettings() : {};
        var surface = R.opts.mode === 'cam' ? 'camera' : (R.display && R.display._tab ? 'browser' : (st.displaySurface || ''));
        var info = { key: R.key, mode: R.opts.mode, duration: +dur.toFixed(2), source: R.source,
          main: { w: st.width || 1280, h: st.height || 720, type: main.type, surface: surface, audio: R.hasAudio },
          cam: cam ? { w: cs.width || 1280, h: cs.height || 720, type: cam.type, surface: 'camera', audio: false } : null,
          cam_offset: cam && starts.cam && starts.main ? +((starts.cam - starts.main) / 1000).toFixed(3) : 0,
          markers: R.markers.slice(), clicks: surface === 'browser' ? R.clicks.slice() : [], bytes: main.size + (cam ? cam.size : 0),
          device: VB.vault.id(), mainBlob: main, camBlob: cam };
        var saves = [VB.vault.put('take:' + R.key + ':main', main, { name: 'main' })];
        if (cam) saves.push(VB.vault.put('take:' + R.key + ':cam', cam, { name: 'cam' }));
        return Promise.all(saves).then(function () { return VB.vault.dropChunks(R.rid); }).then(function () {
          R.state = 'stopped'; R.t0 = 0; mainRec = camRec = null; R.rid = null;
          return info;
        }, function (e) {
          R.state = 'stopped'; R.t0 = 0;
          e.message = 'Couldn\'t save the recording in this browser (' + (e.message || 'storage') + '). Download it now so it isn\'t lost.';
          e.info = info; throw e;
        });
      });
    };
    R.release = function () {
      [mainRec, camRec].forEach(function (r) { if (r && r.state !== 'inactive') try { r.stop(); } catch (e) { /* stopped */ } });
      stopTracks(R.display); stopTracks(R.cam); stopTracks(R.mic); R.display = R.cam = R.mic = null;
      if (ac) { ac.close(); ac = null; analyser = null; dest = null; }
      R.state = 'idle';
    };
    return R;
  };

  /* Put an unfinished recording back together. -> Promise of take info (like R.stop) or null */
  VB.rescue = function (o) {
    var info = o.info || {};
    return Promise.all([VB.vault.chunksFor(o.rid, 'main'), VB.vault.chunksFor(o.rid, 'cam')]).then(function (r) {
      if (!r[0].length) { VB.vault.dropChunks(o.rid); return null; }
      var key = info.key || VB.uid('k'), main = new Blob(r[0], { type: (info.mainType || 'video/webm').split(';')[0] }), cam = r[1].length ? new Blob(r[1], { type: (info.camType || 'video/webm').split(';')[0] }) : null;
      var saves = [VB.vault.put('take:' + key + ':main', main, { name: 'main' })];
      if (cam) saves.push(VB.vault.put('take:' + key + ':cam', cam, { name: 'cam' }));
      return Promise.all(saves).then(function () { return VB.vault.dropChunks(o.rid); }).then(function () {
        return { key: key, videoId: info.videoId, mode: info.mode || 'screen', duration: Math.max(1, +(info.t || r[0].length).toFixed(1)), source: info.source || 'recorder',
          main: { w: 1280, h: 720, type: main.type, surface: '', audio: true }, cam: cam ? { w: 1280, h: 720, type: cam.type, surface: 'camera', audio: false } : null,
          cam_offset: info.offset || 0, markers: info.markers || [], clicks: info.clicks || [], bytes: main.size + (cam ? cam.size : 0), device: VB.vault.id(), label: 'Rescued take' };
      });
    });
  };

  /* A small picture of a finished take (library card). From the live streams' video elements. */
  VB.liveThumb = function (screenEl, camEl, mode) {
    try {
      var c = document.createElement('canvas'); c.width = 320; c.height = 180; var g = c.getContext('2d');
      g.fillStyle = '#111'; g.fillRect(0, 0, 320, 180);
      var main = mode === 'cam' ? camEl : screenEl;
      if (main && main.videoWidth) {
        var k = Math.min(320 / main.videoWidth, 180 / main.videoHeight), w = main.videoWidth * k, h = main.videoHeight * k;
        if (mode === 'cam') { k = Math.max(320 / main.videoWidth, 180 / main.videoHeight); w = main.videoWidth * k; h = main.videoHeight * k; }
        g.drawImage(main, (320 - w) / 2, (180 - h) / 2, w, h);
      }
      if (mode === 'screen_cam' && camEl && camEl.videoWidth) {
        var s = Math.min(camEl.videoWidth, camEl.videoHeight); g.save(); g.beginPath(); g.arc(282, 142, 30, 0, 7); g.clip();
        g.drawImage(camEl, (camEl.videoWidth - s) / 2, (camEl.videoHeight - s) / 2, s, s, 252, 112, 60, 60); g.restore();
        g.beginPath(); g.arc(282, 142, 30, 0, 7); g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke();
      }
      return c.toDataURL('image/jpeg', 0.7);
    } catch (e) { return ''; }
  };

  /* ------------------------------------------------------------------ the floating control window */
  var PIP_CSS = 'html,body{margin:0;height:100%;background:#0f0f0f;color:#fff;font:14px/1.4 Roboto,Arial,sans-serif;overflow:hidden}' +
    '.w{display:flex;flex-direction:column;height:100%}.top{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#1e1e1e;border-bottom:1px solid #333}' +
    '.dot{width:12px;height:12px;border-radius:50%;background:#e62117;box-shadow:0 0 0 0 rgba(230,33,23,.6);animation:p 1.4s infinite}.paused .dot{background:#888;animation:none}' +
    '@keyframes p{70%{box-shadow:0 0 0 8px rgba(230,33,23,0)}}.time{font:700 18px/1 Roboto,Arial;font-variant-numeric:tabular-nums;flex:1}' +
    'button{font:600 12px/1 Roboto,Arial;border:1px solid #444;background:#2a2a2a;color:#fff;border-radius:3px;padding:7px 9px;cursor:pointer}button:hover{background:#353535}' +
    'button.stop{background:#e62117;border-color:#e62117}.cam{position:relative;flex:none;display:flex;justify-content:center;padding:8px 0;background:#141414}' +
    '.cam video{width:120px;height:120px;border-radius:50%;object-fit:cover;border:3px solid #fff;transform:scaleX(-1);background:#222}' +
    '.cd{position:absolute;inset:0;display:grid;place-items:center;font:900 64px/1 Roboto,Arial;color:#fff;text-shadow:0 2px 12px #000}' +
    '.pr{flex:1;min-height:60px;font-size:13px}.hint{font-size:11px;color:#999;padding:6px 10px;border-top:1px solid #262626}' +
    '.msg{padding:14px;color:#ccc;text-align:center}.vb-prompter{position:relative;overflow:hidden;background:#111;color:#fff;height:100%}' +
    '.vb-prompter .roll{position:absolute;left:0;right:0;top:0;padding:30% 8% 60%}.vb-prompter .ln{font:600 1.35em/1.35 Roboto,Arial;margin:0 0 .5em}' +
    '.vb-prompter .ln.h{font:700 .7em/1.2 Roboto,Arial;text-transform:uppercase;letter-spacing:.12em;color:#ff6b63}.vb-prompter .ln.show{font:italic 400 .8em/1.3 Roboto,Arial;color:#999}' +
    '.vb-prompter .pz{color:#ffd34d;font-size:.7em}.vb-prompter .guide{position:absolute;left:0;right:0;top:28%;height:2.2em;background:rgba(255,255,255,.05)}.vb-prompter .empty{padding:12px;color:#888}';
  VB.pip = {
    win: null,
    supported: function () { return !!window.documentPictureInPicture; },
    /* opts: {cam: MediaStream|null, script, onAction(name)} -> Promise of the window (or null). Call it straight from a click. */
    open: function (opts) {
      if (!VB.pip.supported()) return Promise.resolve(null);
      if (VB.pip.win && !VB.pip.win.closed) { VB.pip.fill(opts); return Promise.resolve(VB.pip.win); }
      return window.documentPictureInPicture.requestWindow({ width: 300, height: opts.script ? 430 : 250 }).then(function (w) {
        VB.pip.win = w;
        var st = w.document.createElement('style'); st.textContent = PIP_CSS; w.document.head.appendChild(st);
        w.document.title = 'VideoBlog Buddy';
        w.addEventListener('pagehide', function () { if (VB.pip.prompter) VB.pip.prompter.destroy(); VB.pip.win = null; VB.pip.prompter = null; if (VB.pip.onClose) VB.pip.onClose(); });
        VB.pip.fill(opts);
        return w;
      }, function () { return null; });
    },
    fill: function (opts) {
      var w = VB.pip.win; if (!w) return;
      VB.pip.onAction = opts.onAction; VB.pip.onClose = opts.onClose;
      var d = w.document;
      d.body.innerHTML = '<div class="w"><div class="top"><span class="dot"></span><span class="time">0:00</span>' +
        '<button data-a="pause" title="Pause (P)">❚❚</button><button data-a="mark" title="Chapter marker (M)">⚑</button><button class="stop" data-a="stop" title="Stop (S)">■ Stop</button></div>' +
        (opts.cam ? '<div class="cam"><video autoplay muted playsinline></video><div class="cd" hidden></div></div>' : '<div class="cam" style="min-height:70px"><div class="cd" hidden></div></div>') +
        '<div class="pr" ' + (opts.script ? '' : 'hidden') + '></div><div class="msg" data-msg hidden></div>' +
        '<div class="hint">P pause · M marker · S stop · ↑↓ prompter</div></div>';
      if (opts.cam) { var v = d.querySelector('video'); v.srcObject = opts.cam; v.play()['catch'](function () {}); }
      if (opts.script) VB.pip.prompter = VB.Prompter(d.querySelector('.pr'), opts.script, { speed: opts.speed || 32, fontSize: 13 });
      d.body.onclick = function (e) { var b = e.target.closest('[data-a]'); if (b && VB.pip.onAction) VB.pip.onAction(b.getAttribute('data-a')); };
      d.onkeydown = function (e) {
        var k = e.key.toLowerCase();
        if (k === 'p' && VB.pip.onAction) VB.pip.onAction('pause');
        if (k === 'm' && VB.pip.onAction) VB.pip.onAction('mark');
        if (k === 's' && VB.pip.onAction) VB.pip.onAction('stop');
        if (VB.pip.prompter && (k === 'arrowup' || k === 'arrowdown')) VB.pip.prompter.nudge(k === 'arrowup' ? -40 : 40);
      };
    },
    update: function (s) {  // {time, paused, countdown, message}
      var w = VB.pip.win; if (!w) return;
      var d = w.document, el;
      if (s.time != null && (el = d.querySelector('.time'))) el.textContent = s.time;
      var wrap = d.querySelector('.w'); if (wrap) wrap.classList.toggle('paused', !!s.paused);
      var pb = d.querySelector('[data-a=pause]'); if (pb) pb.textContent = s.paused ? '▶' : '❚❚';
      var cd = d.querySelector('.cd'); if (cd) { cd.hidden = !s.countdown; cd.textContent = s.countdown || ''; }
      var msg = d.querySelector('[data-msg]'); if (msg) { msg.hidden = !s.message; msg.textContent = s.message || ''; }
      if (VB.pip.prompter && s.prompt != null) { if (s.prompt) VB.pip.prompter.start(); else VB.pip.prompter.pause(); }
    },
    close: function () { if (VB.pip.win) { try { VB.pip.win.close(); } catch (e) { /* closed */ } VB.pip.win = null; } }
  };
})();

/* ===== _d_kit.html ===== */
(function () {
  'use strict';
  var VB = window.VB;

  VB.TEMPLATES = [
    { key: 'tour60', name: '60-second app tour', emoji: '⏱️', kind: 'short', blurb: 'Hook, three features, call to action. Perfect first Short.',
      body: '# Hook\nThis is {app}, and it does one thing really well: {tagline}.\n\n# Feature 1\n[SHOW: {feature1}]\nFirst, {feature1}.\n\n# Feature 2\n[SHOW: {feature2}]\nThen, {feature2}.\n\n# Feature 3\n[SHOW: {feature3}]\nAnd my favourite: {feature3}.\n\n# Call to action\n{cta}. Link in the description. {handle}' },
    { key: 'spotlight', name: 'Feature spotlight', emoji: '🔦', kind: 'reel', blurb: 'One feature, start to finish, in under 30 seconds.',
      body: '# Hook\nStop doing this by hand.\n[SHOW: the old, slow way]\n\n# The feature\nIn {app}, {feature1}.\n[SHOW: one click, the result appears]\n\n# Why it matters\nThat\'s minutes back every day for {audience}.\n\n# Call to action\n{cta}. {url}' },
    { key: 'built', name: 'I built this app', emoji: '🛠️', kind: 'devlog', blurb: 'The story: the problem, the build, the result. Great for your channel.',
      body: '# The problem\nI kept running into the same problem: (pause) so I built {app}.\n\n# What it does\n[SHOW: the home screen]\n{tagline}.\n\n# How I built it\n[SHOW: the code or the editor]\nHere\'s how it works under the hood.\n\n# Demo\n[SHOW: {feature1}]\nLet me show you {feature1}.\n[SHOW: {feature2}]\nAnd {feature2}.\n\n# What\'s next\nNext I\'m adding {feature3}. Tell me what you\'d like to see.\n\n# Call to action\nIf you\'re one of the {audience}, {cta}. Subscribe to follow the build. {handle}' },
    { key: 'problem', name: 'Problem, then solution', emoji: '💡', kind: 'reel', blurb: 'The classic reel hook: show the pain, then the fix.',
      body: '# Pain\n[SHOW: the messy way]\nIf you\'re {audience}, you know this feeling.\n\n# Twist\nThere\'s a better way.\n\n# Solution\n[SHOW: {app}]\n{app}: {tagline}.\n\n# Proof\n[SHOW: {feature1}]\n{feature1}. Done.\n\n# Call to action\n{cta}. {handle}' },
    { key: 'walkthrough', name: 'Full walkthrough', emoji: '🎓', kind: 'tutorial', blurb: 'A step-by-step tutorial with chapters. Long-form YouTube.',
      body: '# Intro\nIn this video I\'ll show you everything {app} can do, step by step.\n\n# Getting started\n[SHOW: sign up and the first screen]\nFirst, create your account. It takes a few seconds.\n\n# {feature1}\n[SHOW: {feature1}]\nLet\'s start with {feature1}.\n\n# {feature2}\n[SHOW: {feature2}]\nNext, {feature2}.\n\n# {feature3}\n[SHOW: {feature3}]\nFinally, {feature3}.\n\n# Tips\nTwo tips before you go. (pause)\n\n# Wrap up\nThat\'s {app}. {cta} at {url}, and subscribe for more tutorials.' },
    { key: 'update', name: 'What\'s new', emoji: '✨', kind: 'youtube', blurb: 'Release notes as a video. Keep your users in the loop.',
      body: '# Hook\nBig update to {app} this week.\n\n# New\n[SHOW: the new feature]\nNew: {feature1}.\n\n# Improved\n[SHOW: the improvement]\nImproved: {feature2}.\n\n# Fixed\nAnd a few fixes you asked for.\n\n# Thanks\nThanks to everyone who sent feedback. {cta}. {handle}' },
    { key: 'tips3', name: '3 quick tips', emoji: '3️⃣', kind: 'short', blurb: 'Three tips for your audience, one of them uses your app.',
      body: '# Hook\nThree tips for {audience}.\n\n# Tip 1\nOne. Keep it simple.\n\n# Tip 2\nTwo. Make it a habit.\n\n# Tip 3\n[SHOW: {app}]\nThree. Let {app} do the remembering: {feature1}.\n\n# Call to action\nFollow for more. {handle}' },
    { key: 'behind', name: 'Behind the code', emoji: '👩‍💻', kind: 'devlog', blurb: 'Show one interesting piece of how the app works.',
      body: '# Hook\nHere\'s a part of {app} nobody sees.\n\n# The challenge\n[SHOW: the feature in the app]\n{feature2} sounds simple. It wasn\'t.\n\n# The code\n[SHOW: the code]\nThe trick was this. (pause)\n\n# Result\n[SHOW: it working]\nAnd now it just works.\n\n# Call to action\nBuilding in public: subscribe to follow along. {handle}' }
  ];

  VB.fill = function (body, p, handle) {
    p = p || {};
    var f = String(p.features || '').split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    var lower = function (s) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; };
    var map = { app: p.name || 'my app', tagline: lower(p.tagline) || 'it makes life easier', audience: p.audience || 'people like you',
      feature1: lower(f[0]) || 'the main feature', feature2: lower(f[1]) || 'the second feature', feature3: lower(f[2]) || 'one more thing',
      cta: p.cta || 'Try it free', url: p.url || 'the link below', handle: handle || '' };
    return String(body || '').replace(/\{(\w+)\}/g, function (m, k) { return map[k] != null ? map[k] : m; }).replace(/[ \t]+$/gm, '');
  };

  /* Video ideas for one app -> [{title, kind, tpl}] */
  VB.ideasFor = function (p) {
    p = p || {};
    var name = p.name || 'your app', f = String(p.features || '').split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    var aud = p.audience || 'beginners', f1 = f[0] || 'the main feature', f2 = f[1] || 'a hidden feature';
    return [
      { title: name + ' in 60 seconds', kind: 'short', tpl: 'tour60' },
      { title: 'How I built ' + name, kind: 'devlog', tpl: 'built' },
      { title: f1 + ' (30-second demo)', kind: 'reel', tpl: 'spotlight' },
      { title: '3 tips for ' + aud, kind: 'short', tpl: 'tips3' },
      { title: name + ': full walkthrough', kind: 'tutorial', tpl: 'walkthrough' },
      { title: 'What\'s new in ' + name, kind: 'youtube', tpl: 'update' },
      { title: 'The problem ' + name + ' solves', kind: 'reel', tpl: 'problem' },
      { title: 'Behind the code: ' + f2, kind: 'devlog', tpl: 'behind' }
    ].map(function (i) { i.title = i.title.charAt(0).toUpperCase() + i.title.slice(1); return i; });
  };

  var STOP = ('a an and are as at be but by for from has have i in is it its of on or so that the this to was we with you your our my ' +
    'never ever every one all any can do does just more most no not only out up very what when how why who again forget get make made like use way time').split(' ');
  function words(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(function (w) { return w.length > 2 && STOP.indexOf(w) < 0; }); }
  function tagify(s) { return '#' + String(s || '').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/).map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(''); }

  /* -> {titles, title, description, tags, hashtags, pinned, caption} */
  VB.publishKit = function (o) {
    var v = o.video || {}, p = o.product || {}, chapters = o.chapters || [], handle = o.handle || '', secs = Math.round(o.outDur || v.duration || 0);
    var name = p.name || '', tag = p.tagline || '', vertical = VB.isVertical(v.kind), feats = String(p.features || '').split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    var titles = [];
    function add(t) { t = String(t || '').trim(); if (t && t.length <= 100 && titles.indexOf(t) < 0) titles.push(t); }
    add(v.title);
    if (name && tag) add(name + ': ' + tag);
    if (name && secs && secs <= 120) add(name + ' in ' + secs + ' seconds');
    if (name && p.audience) add('I built ' + name + ' for ' + p.audience);
    if (name && feats[0]) add(feats[0] + ' with ' + name);
    if (vertical && name) add(name + ' 🤯 #shorts');
    var hashtags = [];
    if (name) hashtags.push(tagify(name));
    hashtags.push(v.kind === 'devlog' ? '#BuildInPublic' : v.kind === 'tutorial' ? '#Tutorial' : '#AppDemo');
    hashtags.push('#IndieDev');
    if (v.kind === 'short') hashtags.unshift('#Shorts');
    if (v.kind === 'reel') hashtags.push('#Reels');
    var desc = [];
    desc.push(tag ? (tag.charAt(0).toUpperCase() + tag.slice(1) + (/[.!?]$/.test(tag) ? '' : '.')) : (v.title || ''));
    desc.push('');
    if (name) desc.push(name + (tag ? ' helps ' + (p.audience || 'you') + ': ' + tag.charAt(0).toLowerCase() + tag.slice(1) : '') + (/[.!?]$/.test(tag) ? '' : '.'));
    if (feats.length) { desc.push(''); desc.push('In this video:'); feats.slice(0, 5).forEach(function (f) { desc.push('• ' + f); }); }
    if (p.url || p.cta) { desc.push(''); desc.push('👉 ' + (p.cta || 'Try it') + (p.url ? ': ' + p.url : '')); }
    if (!vertical && chapters.length >= 3) {
      desc.push(''); desc.push('Chapters:');
      chapters.forEach(function (c) { desc.push(VB.fmtTime(c.t) + ' ' + c.label); });
    }
    desc.push('');
    desc.push((handle ? handle + ' · ' : '') + 'Subscribe for more videos about the apps I\'m building.');
    desc.push('');
    desc.push(hashtags.slice(0, 3).join(' '));
    var tagList = [], seen = {};
    function addTag(t) { t = String(t || '').trim().toLowerCase(); if (t && !seen[t]) { seen[t] = 1; tagList.push(t); } }
    if (name) { addTag(name); addTag(name + ' app'); addTag(name + ' demo'); }
    words(tag).slice(0, 5).forEach(addTag);
    if (p.audience) addTag(p.audience);
    feats.slice(0, 3).forEach(function (f) { addTag(words(f).slice(0, 3).join(' ')); });
    ({ devlog: ['devlog', 'build in public', 'indie hacker'], tutorial: ['tutorial', 'how to', 'step by step'], short: ['shorts', 'app demo'], reel: ['app demo', 'productivity'] }[v.kind] || ['app demo', 'web app'])
      .forEach(addTag);
    addTag('indie dev'); addTag('side project');
    var tags = '';
    tagList.forEach(function (t) { if ((tags + (tags ? ', ' : '') + t).length <= 480) tags += (tags ? ', ' : '') + t; });
    var hook = tag ? tag.charAt(0).toUpperCase() + tag.slice(1) : v.title;
    var caption = hook + (/[.!?]$/.test(hook) ? '' : '.') + (name ? ' ' + (p.emoji || '✨') + ' ' + name : '') + '\n\n' +
      (p.cta ? p.cta + (p.url ? ' → link in bio' : '') + '\n\n' : '') + hashtags.concat(['#BuildInPublic']).filter(function (h, i, a) { return a.indexOf(h) === i; }).slice(0, 6).join(' ');
    return { titles: titles.slice(0, 5), title: titles[0] || '', description: desc.join('\n').replace(/\n{3,}/g, '\n\n').trim(), tags: tags,
      hashtags: hashtags.slice(0, 5).join(' '), pinned: 'What should I build next' + (name ? ' for ' + name : '') + '? Tell me below 👇', caption: caption };
  };

  /* The upload checklist. auto(ctx) -> true/false when it can tell; manual items return null. */
  VB.checklist = function (v) {
    var vertical = VB.isVertical(v.kind);
    var items = [
      { key: 'title', label: 'Title is set and under 100 characters', auto: function (c) { var t = (c.publish && c.publish.title) || ''; return t.length > 0 && t.length <= 100; } },
      { key: 'link', label: 'Description has your link', auto: function (c) { return /https?:\/\//.test((c.publish && c.publish.description) || ''); } },
      { key: 'thumb', label: 'Custom thumbnail made (1280×720)', auto: function (c) { return !!(c.video.thumb_design && c.video.thumb_design.text); } },
      { key: 'exported', label: 'Video exported', auto: function (c) { return c.video.status === 'edited' || c.video.status === 'published'; } }
    ];
    if (!vertical) items.splice(2, 0, { key: 'chapters', label: 'Chapters start at 0:00 (at least 3, 10 s apart)', auto: function (c) { return /(^|\n)0:00 /.test((c.publish && c.publish.description) || ''); } });
    else items.push({ key: 'vertical', label: 'Vertical 9:16 and 3 minutes or less', auto: function (c) { return (c.video.edit && c.video.edit.aspect) === '9:16' && (c.video.duration || 0) <= 180; } });
    return items.concat([
      { key: 'endscreen', label: vertical ? 'Pinned the call to action in a comment' : 'End screen + cards added in YouTube Studio' },
      { key: 'captions', label: 'Checked the auto-captions' },
      { key: 'playlist', label: 'Added to a playlist for this app' },
      { key: 'share', label: 'Shared it where your users are' }
    ]);
  };
})();

/* ===== _e_words.html ===== */
(function () {
  'use strict';
  var VB = window.VB, clamp = VB.clamp;

  /* ------------------------------------------------------------------ words helpers */
  /* Spread a sentence over s..e, longer words taking longer. -> [[s, e, w], ...] */
  VB.spread = function (text, s, e) {
    var ws = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (!ws.length) return [];
    var tot = ws.reduce(function (a, w) { return a + w.length + 2; }, 0), t = s, out = [];
    ws.forEach(function (w) { var d = (e - s) * (w.length + 2) / tot; out.push([+t.toFixed(2), +(t + d * 0.92).toFixed(2), w.slice(0, 40)]); t += d; });
    return out;
  };
  VB.wordsOf = function (take) { return take && take.words && take.words.words || []; };
  VB.plainWord = function (w) { return String(w || '').toLowerCase().replace(/[^\p{L}\p{N}']+/gu, ''); };
  VB.FILLERS = ['um', 'umm', 'uh', 'uhh', 'uhm', 'er', 'erm', 'ah', 'ahh', 'hmm', 'mm', 'mhm'];
  VB.isFiller = function (w) { return VB.FILLERS.indexOf(VB.plainWord(w)) >= 0; };

  /* The sample takes' words, matching VB.SAMPLES speech and the sample script. */
  var SAMPLE_TEXT = {
    hello: ['Hi, I\'m Sam.', 'I kept killing my plants, so I built Pocket Garden.'],
    garden: ['Every plant gets its own card, with the next watering on it.', 'Tap a plant to see its schedule. Basil needs water tomorrow.',
      'One tap logs the watering. Done.', 'Um, adding a plant takes, uh, five seconds. Lemon tree, saved.', 'So easy.',
      'And the reminders page tells you what needs water this week.']
  };
  VB.sampleWords = function (name) {
    var S = VB.SAMPLES[name] || VB.SAMPLES.garden, lines = SAMPLE_TEXT[name] || SAMPLE_TEXT.garden, out = [];
    S.speech.forEach(function (seg, i) { if (lines[i]) out = out.concat(VB.spread(lines[i], seg[0] + 0.05, seg[1] - 0.05)); });
    return out;
  };

  /* ------------------------------------------------------------------ on-device transcription (Whisper) */
  /* transformers.js in a module worker. The model (~40-150 MB) downloads once from Hugging Face and the
     browser keeps it; the sound is decoded and transcribed here and never sent anywhere. */
  var WORKER = [
    "import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2';",
    "env.allowLocalModels = false;",
    "const cache = {};",
    "self.onmessage = async (e) => {",
    "  const { id, audio, model, language } = e.data;",
    "  try {",
    "    if (!cache[model]) cache[model] = await pipeline('automatic-speech-recognition', model, { progress_callback: (p) => self.postMessage({ id, type: 'load', p }) });",
    "    const asr = cache[model];",
    "    self.postMessage({ id, type: 'run' });",
    "    const extra = language ? { language, task: 'transcribe' } : {};",
    "    let out, level = 'word';",
    "    try { out = await asr(audio, Object.assign({ return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 }, extra)); }",
    "    catch (err) { level = 'segment'; out = await asr(audio, Object.assign({ return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 }, extra)); }",
    "    self.postMessage({ id, type: 'done', level, chunks: out.chunks || [], text: out.text || '' });",
    "  } catch (err) { self.postMessage({ id, type: 'error', error: String(err && err.message || err) }); }",
    "};"].join('\n');
  var worker = null, jobs = {}, jobSeq = 0;
  function getWorker() {
    if (worker) return worker;
    worker = new Worker(URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' })), { type: 'module' });
    worker.onmessage = function (e) { var j = jobs[e.data.id]; if (j) j(e.data); };
    worker.onerror = function (e) { Object.keys(jobs).forEach(function (k) { jobs[k]({ type: 'error', error: e.message || 'The caption helper couldn\'t start.' }); }); worker = null; };
    return worker;
  }
  VB.MODELS = {
    en: { id: 'onnx-community/whisper-tiny.en', label: 'English, fast (40 MB download)' },
    en_base: { id: 'onnx-community/whisper-base.en', label: 'English, more accurate (150 MB)' },
    multi: { id: 'onnx-community/whisper-tiny', label: 'Any language (40 MB)' }
  };
  function decodeMono(blob, rate) {
    if (blob.size > 1.6e9) return Promise.reject(new Error('This take is too big to read the sound from.'));
    return blob.arrayBuffer().then(function (buf) {
      var ac = new OfflineAudioContext(1, rate, rate);
      return new Promise(function (res, rej) { ac.decodeAudioData(buf, res, rej); });
    }).then(function (ab) {
      if (ab.numberOfChannels === 1) return ab.getChannelData(0);
      var out = new Float32Array(ab.length), n = ab.numberOfChannels;
      for (var ch = 0; ch < n; ch++) { var d = ab.getChannelData(ch); for (var i = 0; i < d.length; i++) out[i] += d[i] / n; }
      return out;
    });
  }
  /* For tests: replace with a function (audio Float32Array 16 kHz, model, language) -> Promise of {level, chunks}. */
  VB._asr = null;
  function runAsr(audio, model, language, prog) {
    if (VB._asr) return VB._asr(audio, model, language);
    return new Promise(function (res, rej) {
      var id = ++jobSeq;
      jobs[id] = function (msg) {
        if (msg.type === 'load') { if (msg.p && msg.p.status === 'progress' && msg.p.total) prog(0.08 + 0.4 * (msg.p.loaded / msg.p.total), 'Downloading the speech model (only the first time)…'); }
        else if (msg.type === 'run') prog(0.52, 'Listening and writing it down…');
        else if (msg.type === 'done') { delete jobs[id]; res(msg); }
        else if (msg.type === 'error') { delete jobs[id]; rej(new Error('Speech-to-text didn\'t work in this browser: ' + msg.error)); }
      };
      try { getWorker().postMessage({ id: id, audio: audio, model: model, language: language }, [audio.buffer]); }
      catch (e) { delete jobs[id]; rej(e); }
    });
  }
  /* src = an opened take (VB.openTake). -> Promise of {src, lang, words} ready for take_update. */
  VB.transcribe = function (src, lang, onProgress) {
    var prog = onProgress || function () {}, t = src.take;
    if (t.sample) { prog(1, 'Done'); return Promise.resolve({ src: 'sample', lang: 'en', words: VB.sampleWords(src.sample) }); }
    if (!src.blob) return Promise.reject(new Error('This take isn\'t on this computer.'));
    if (!(t.main && t.main.audio)) return Promise.reject(new Error('This take has no sound to write down.'));
    var m = VB.MODELS[lang] || VB.MODELS.en;
    prog(0.03, 'Reading the sound…');
    return decodeMono(src.blob, 16000).then(function (audio) {
      return runAsr(audio, m.id, null, prog);  // English-only models refuse a language; the multilingual one detects it
    }).then(function (msg) {
      var words = [];
      (msg.chunks || []).forEach(function (c) {
        var ts = c.timestamp || [], cs = ts[0] || 0, ce = ts[1] == null ? cs + 0.4 : ts[1], txt = String(c.text || '').trim();
        if (!txt) return;
        if (msg.level === 'word' && txt.indexOf(' ') < 0) words.push([+cs.toFixed(2), +Math.max(cs + 0.05, ce).toFixed(2), txt.slice(0, 40)]);
        else words = words.concat(VB.spread(txt, cs, Math.max(cs + 0.3, ce)));
      });
      words.sort(function (a, b) { return a[0] - b[0]; });
      prog(1, 'Done');
      return { src: 'whisper', lang: lang === 'multi' ? 'auto' : 'en', words: words };
    });
  };

  /* ------------------------------------------------------------------ captions from the script (no download) */
  /* The script's spoken lines, spread over the parts of a..b where there's sound. Approximate, instant. */
  VB.alignScript = function (script, an, a, b) {
    var text = VB.parseScript(script).filter(function (l) { return l.k === 'line'; }).map(function (l) { return l.text.replace(/\(pause\)/gi, ' '); }).join(' ');
    var ws = text.split(/\s+/).filter(Boolean);
    if (!ws.length) return [];
    var gaps = an ? VB.silences(an, a, b, { minGap: 0.4, pad: 0.04 }) : [], runs = [], t = a;
    gaps.forEach(function (g) { if (g[0] - t > 0.12) runs.push([t, g[0]]); t = g[1]; });
    if (b - t > 0.12) runs.push([t, b]);
    if (!runs.length) runs = [[a, b]];
    var talk = runs.reduce(function (s, r) { return s + r[1] - r[0]; }, 0);
    var tot = ws.reduce(function (s, w) { return s + w.length + 2; }, 0), pos = 0, out = [];
    function at(p) {  // talking time -> take time
      for (var i = 0; i < runs.length; i++) { var len = runs[i][1] - runs[i][0]; if (p <= len || i === runs.length - 1) return { t: runs[i][0] + Math.min(p, len), run: runs[i] }; p -= len; }
    }
    ws.forEach(function (w) {
      var d = talk * (w.length + 2) / tot, s0 = at(pos + 0.001), e0 = Math.min(s0.t + d * 0.92, s0.run[1]);
      out.push([+s0.t.toFixed(2), +Math.max(s0.t + 0.05, e0).toFixed(2), w.slice(0, 40)]);
      pos += d;
    });
    return out;
  };

  /* ------------------------------------------------------------------ caption lines */
  /* opts: {max: characters per line, maxWords}. -> [{s, e, hold, words, text}] (take seconds) */
  VB.cues = function (words, opts) {
    opts = opts || {};
    var max = opts.max || 42, maxWords = opts.maxWords || 9, out = [], cur = null;
    (words || []).forEach(function (w) {
      var txt = String(w[2]);
      if (cur) {
        var lastW = cur.words[cur.words.length - 1][2];
        if (w[0] - cur.e > 0.7 || cur.text.length + 1 + txt.length > max || cur.words.length >= maxWords || w[1] - cur.s > 3.6 ||
          (/[.!?]$/.test(lastW) && cur.words.length >= 2)) { out.push(cur); cur = null; }
      }
      if (!cur) cur = { s: w[0], e: w[1], words: [], text: '' };
      cur.words.push(w); cur.e = w[1]; cur.text = cur.text ? cur.text + ' ' + txt : txt;
    });
    if (cur) out.push(cur);
    out.forEach(function (c, i) { var n = out[i + 1]; c.hold = Math.min(n ? n.s : c.e + 0.7, c.e + 0.7); });
    return out;
  };
  VB.cueOpts = function (edit) {
    var c = edit.captions || {}, vert = edit.aspect === '9:16';
    if (c.style === 'bold') return { max: vert ? 16 : 20, maxWords: 3 };
    return vert ? { max: 24, maxWords: 6 } : { max: 40, maxWords: 9 };
  };
  /* Words of a plan scene that survive its cuts (VB.plan sets s.words). */
  VB.keptWords = function (s) {
    return VB.wordsOf(s.take).filter(function (w) {
      var mid = (w[0] + w[1]) / 2;
      return s.segs.some(function (g) { return mid >= g.a && mid <= g.b; });
    });
  };
  /* Subtitles on the output timeline: [{s, e, text}] */
  VB.planCues = function (plan) {
    var out = [];
    plan.scenes.forEach(function (s, si) {
      if (s.type !== 'take' || !s.words || !s.words.length) return;
      VB.cues(s.words, { max: 42, maxWords: 10 }).forEach(function (c) {
        var os = VB.outOf(plan, si, c.s), oe = VB.outOf(plan, si, c.hold);
        if (os < 0) return;
        if (oe < os) oe = VB.outOf(plan, si, c.e);
        if (oe < os) oe = os + (c.e - c.s) / s.speed;
        out.push({ s: os, e: Math.min(oe, s.start + s.dur), text: c.text });
      });
    });
    return out;
  };
  function stamp(t, sep) {
    t = Math.max(0, t);
    var h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = Math.floor(t % 60), ms = Math.round((t - Math.floor(t)) * 1000);
    if (ms === 1000) { ms = 999; }
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + sep + String(ms).padStart(3, '0');
  }
  VB.toSRT = function (cues) {
    return cues.map(function (c, i) { return (i + 1) + '\n' + stamp(c.s, ',') + ' --> ' + stamp(c.e, ',') + '\n' + c.text; }).join('\n\n') + '\n';
  };
  VB.toVTT = function (cues) {
    return 'WEBVTT\n\n' + cues.map(function (c) { return stamp(c.s, '.') + ' --> ' + stamp(c.e, '.') + '\n' + c.text; }).join('\n\n') + '\n';
  };
  VB.transcriptText = function (plan) {
    return plan.scenes.filter(function (s) { return s.words && s.words.length; }).map(function (s) { return s.words.map(function (w) { return w[2]; }).join(' '); }).join('\n\n');
  };

  /* ------------------------------------------------------------------ editing by words */
  /* Cuts that remove every filler word ("um", "uh"...) between a and b. */
  VB.fillerCuts = function (words, a, b) {
    var out = [];
    (words || []).forEach(function (w, i) {
      if (!VB.isFiller(w[2]) || w[0] < a || w[1] > b) return;
      var prev = words[i - 1], next = words[i + 1];
      var s = Math.max(prev ? prev[1] : a, w[0] - 0.06), e = Math.min(next ? next[0] : b, w[1] + 0.06);
      if (e - s >= 0.05) out.push([+s.toFixed(2), +e.toFixed(2)]);
    });
    return out;
  };
  /* The cut that removes words i..j, eating into the gaps on both sides but never the neighbours. */
  VB.wordCut = function (words, i, j) {
    var a = words[i], b = words[j], prev = words[i - 1], next = words[j + 1];
    var s = prev ? Math.max(prev[1], a[0] - 0.12) : a[0] - 0.08, e = next ? Math.min(next[0], b[1] + 0.12) : b[1] + 0.12;
    return [+Math.max(0, s).toFixed(2), +e.toFixed(2)];
  };
})();

/* ===== _f_youtube.html ===== */
(function () {
  'use strict';
  var VB = window.VB;
  var cfgP = null;
  VB.getConfig = function (fresh) {
    if (!cfgP || fresh) cfgP = UI.apiQuiet('public_config').then(function (c) { VB.config = c || {}; return VB.config; }, function () { cfgP = null; return VB.config || {}; });
    return cfgP;
  };
  VB.config = { google_client_id: '', extension_store_url: '' };
  VB.lastExport = {};

  var UPLOAD = 'https://www.googleapis.com/auth/youtube.upload', CAPS = 'https://www.googleapis.com/auth/youtube.force-ssl';
  var gis = null, tok = null;
  function loadGis() {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
    if (gis) return gis;
    gis = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = function () { res(); }; s.onerror = function () { gis = null; rej(new Error('Couldn\'t reach Google sign-in. Check your connection or ad blocker.')); };
      document.head.appendChild(s);
    });
    return gis;
  }
  VB.yt = {
    CATEGORIES: [['28', 'Science & Technology'], ['27', 'Education'], ['22', 'People & Blogs'], ['26', 'Howto & Style'], ['24', 'Entertainment'], ['20', 'Gaming']],
    connected: function (withCaptions) { return !!(tok && tok.exp > Date.now() + 60000 && (!withCaptions || tok.caps)); },
    /* Ask Google for a token (a popup the first time; quick after that). */
    connect: function (withCaptions) {
      if (VB.yt.connected(withCaptions)) return Promise.resolve(tok.value);
      if (VB.yt._fake) return VB.yt._fake.connect(withCaptions).then(function (v) { tok = { value: v, exp: Date.now() + 3e6, caps: !!withCaptions }; return v; });
      var cid = VB.config.google_client_id;
      if (!cid) return Promise.reject(new Error('YouTube upload isn\'t set up yet. An admin adds the Google client ID in Admin → Settings.'));
      return loadGis().then(function () {
        return new Promise(function (res, rej) {
          var scope = UPLOAD + (withCaptions ? ' ' + CAPS : '');
          var client = window.google.accounts.oauth2.initTokenClient({
            client_id: cid, scope: scope, include_granted_scopes: true,
            callback: function (r) {
              if (r.error) { rej(new Error(r.error === 'access_denied' ? 'Google sign-in was cancelled.' : 'Google said: ' + r.error)); return; }
              var caps = window.google.accounts.oauth2.hasGrantedAllScopes(r, CAPS);
              tok = { value: r.access_token, exp: Date.now() + (r.expires_in || 3600) * 1000, caps: caps };
              res(tok.value);
            },
            error_callback: function (e) { rej(new Error(e && e.type === 'popup_closed' ? 'The Google window was closed.' : 'Google sign-in didn\'t open (allow pop-ups for this site).')); }
          });
          client.requestAccessToken({ prompt: '' });
        });
      });
    },
    disconnect: function () {
      if (tok && window.google && window.google.accounts && window.google.accounts.oauth2) { try { window.google.accounts.oauth2.revoke(tok.value, function () {}); } catch (e) { /* gone */ } }
      tok = null;
    },
    /* YouTube refuses < and > in titles and descriptions; titles max 100, description 5000, tags 500 in total. */
    clean: function (meta) {
      function nolt(s) { return String(s || '').replace(/[<>]/g, ''); }
      var tags = [], len = 0;
      String(meta.tags || '').split(',').map(function (t) { return nolt(t).trim(); }).filter(Boolean).forEach(function (t) {
        var add = t.length + (t.indexOf(' ') >= 0 ? 2 : 0) + (tags.length ? 1 : 0); if (len + add <= 500) { tags.push(t); len += add; } });
      var desc = nolt(meta.description).slice(0, 5000);
      if (meta.vertical && !/#shorts/i.test(desc + ' ' + meta.title)) desc = (desc + '\n\n#Shorts').trim().slice(0, 5000);
      var body = { snippet: { title: nolt(meta.title).trim().slice(0, 100) || 'Untitled video', description: desc, tags: tags, categoryId: meta.category || '28' },
        status: { privacyStatus: meta.publishAt ? 'private' : (meta.privacy || 'private'), selfDeclaredMadeForKids: !!meta.kids, embeddable: true } };
      if (meta.publishAt) body.status.publishAt = meta.publishAt;
      if (meta.language) { body.snippet.defaultLanguage = meta.language; body.snippet.defaultAudioLanguage = meta.language; }
      return body;
    },
    /* Resumable upload with progress. -> Promise of the YouTube video resource ({id, ...}) */
    upload: function (blob, meta, onProgress, signal) {
      var body = VB.yt.clean(meta), type = blob.type || 'video/mp4';
      if (VB.yt._fake) return VB.yt._fake.upload(blob, body, onProgress);
      return VB.yt.connect(meta.captions).then(function (token) {
        return fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
          method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(blob.size), 'X-Upload-Content-Type': type },
          body: JSON.stringify(body)
        }).then(function (r) {
          if (!r.ok) return r.json().then(function (j) { throw new Error(ytError(j, r.status)); }, function () { throw new Error('YouTube said no (' + r.status + ').'); });
          var where = r.headers.get('Location');
          if (!where) throw new Error('YouTube didn\'t give an upload address.');
          return new Promise(function (res, rej) {
            var x = new XMLHttpRequest(); x.open('PUT', where); x.setRequestHeader('Content-Type', type);
            x.upload.onprogress = function (e) { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
            x.onload = function () {
              var j = null; try { j = JSON.parse(x.responseText); } catch (e) { /* not json */ }
              if (x.status >= 200 && x.status < 300 && j && j.id) res(j); else rej(new Error(ytError(j, x.status)));
            };
            x.onerror = function () { rej(new Error('The upload stopped (network). Try again.')); };
            x.onabort = function () { rej(Object.assign(new Error('Upload cancelled.'), { cancelled: true })); };
            if (signal) signal.abort = function () { x.abort(); };
            x.send(blob);
          });
        });
      });
    },
    thumbnail: function (id, jpeg) {
      if (VB.yt._fake) return VB.yt._fake.thumbnail(id, jpeg);
      return VB.yt.connect().then(function (token) {
        return fetch('https://www.googleapis.com/upload/youtube/v3/thumbnails/set?uploadType=media&videoId=' + encodeURIComponent(id), {
          method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'image/jpeg' }, body: jpeg });
      }).then(function (r) { if (!r.ok) return r.json().then(function (j) { throw new Error(ytError(j, r.status)); }, function () { throw new Error('The thumbnail wasn\'t accepted (' + r.status + ').'); }); return true; });
    },
    captions: function (id, srt, lang) {
      if (VB.yt._fake) return VB.yt._fake.captions(id, srt, lang);
      return VB.yt.connect(true).then(function (token) {
        var b = 'vbb' + Math.random().toString(36).slice(2), meta = { snippet: { videoId: id, language: lang || 'en', name: 'Captions', isDraft: false } };
        var body = '--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n--' + b + '\r\nContent-Type: application/octet-stream\r\n\r\n' + srt + '\r\n--' + b + '--';
        return fetch('https://www.googleapis.com/upload/youtube/v3/captions?uploadType=multipart&part=snippet', {
          method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'multipart/related; boundary=' + b }, body: body });
      }).then(function (r) { if (!r.ok) return r.json().then(function (j) { throw new Error(ytError(j, r.status)); }, function () { throw new Error('The captions weren\'t accepted (' + r.status + ').'); }); return true; });
    },
    _fake: null   // tests: {connect, upload, thumbnail, captions}
  };
  function ytError(j, status) {
    var e = j && j.error, reason = e && e.errors && e.errors[0] && e.errors[0].reason;
    if (reason === 'quotaExceeded') return 'YouTube\'s daily upload allowance for this app is used up. Try again tomorrow, or upload in YouTube Studio.';
    if (reason === 'uploadLimitExceeded') return 'Your channel has hit YouTube\'s upload limit for today.';
    if (reason === 'youtubeSignupRequired') return 'That Google account has no YouTube channel yet. Create one at youtube.com first.';
    if (reason === 'forbidden' || status === 403) return 'YouTube refused this (' + ((e && e.message) || 'forbidden') + '). For custom thumbnails, verify your phone number at youtube.com/verify.';
    if (status === 401) { tok = null; return 'Your Google sign-in ran out. Press Upload again.'; }
    return 'YouTube said: ' + ((e && e.message) || 'error ' + status);
  }
})();

/* ===== _g_write.html ===== */
(function () {
  'use strict';
  var VB = window.VB;
  function lower(s) { s = String(s || '').trim(); return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
  function upper(s) { s = String(s || '').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function feats(p) { return String(p && p.features || '').split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean); }

  /* ------------------------------------------------------------------ hooks */
  VB.hooks = function (p) {
    p = p || {};
    var app = p.name || 'my app', tag = lower(p.tagline) || 'get it done faster', aud = p.audience || 'people like you', f = feats(p);
    var f1 = lower(f[0]) || 'the main feature', f2 = lower(f[1]) || 'a hidden feature';
    return [
      ['Pain', 'Stop doing this by hand. ' + app + ' does it for you.'],
      ['Story', 'I got tired of doing it the slow way, so I built ' + app + '.'],
      ['Audience', 'If you\'re one of the ' + aud + ', you need to see this.'],
      ['Speed', 'This used to take me ten minutes. Now it takes ten seconds.'],
      ['Demo', 'Watch me ' + f1.replace(/^(you can |it |lets you )/i, '') + ' in under 30 seconds.'],
      ['Promise', 'Here\'s the easiest way to ' + tag.replace(/^(it |to )/i, '') + '.'],
      ['Secret', 'Nobody talks about this part of ' + app + ': ' + f2 + '.'],
      ['List', '3 things ' + app + ' does that ' + aud + ' will love.'],
      ['Question', 'What if you never had to think about it again?'],
      ['Proof', 'One click. That\'s it. Here\'s ' + app + '.'],
      ['POV', 'POV: you\'re one of the ' + aud + ' and you just found ' + app + '.'],
      ['Build', 'I built ' + app + ' on my own. Here\'s what it does, and how.']
    ].map(function (h) { return { kind: h[0], text: h[1] }; });
  };

  /* ------------------------------------------------------------------ script doctor */
  var TARGETS = { short: [15, 60, 180], reel: [15, 45, 90], square: [15, 60, 120], youtube: [90, 480, 1200], tutorial: [180, 720, 2400], devlog: [180, 600, 1800] };
  var WEAK = ['basically', 'actually', 'literally', 'really', 'very', 'just', 'kind of', 'sort of', 'you know', 'i mean', 'super', 'pretty much'];
  VB.doctor = function (text, kind) {
    var lines = VB.parseScript(text), spoken = lines.filter(function (l) { return l.k === 'line'; }).map(function (l) { return l.text.replace(/\(pause\)/gi, ' ').trim(); });
    var st = VB.scriptStats(text), all = spoken.join(' '), items = [], tg = TARGETS[kind] || TARGETS.youtube;
    function add(state, title, tip) { items.push({ state: state, title: title, tip: tip || '' }); }
    if (!spoken.length) return { score: 0, items: [{ state: 'bad', title: 'Nothing to say yet', tip: 'Write a line, pick a template, or try the Hook lab.' }], stats: st };
    var first = spoken[0], fw = first.split(/\s+/).length;
    if (/^(hi|hey|hello)\b|in this video|today i('|’)?m going|welcome (back )?to/i.test(first)) add('warn', 'The first line warms up instead of hooking', 'Skip "Hi" and "In this video". Open with the payoff or the problem, then say hello.');
    else if (fw > 20) add('warn', 'Your hook is ' + fw + ' words long', 'Get to the point in under 20 words: viewers decide in the first 3 seconds.');
    else add('ok', 'Strong, short first line', '“' + first.slice(0, 70) + (first.length > 70 ? '…' : '') + '”');
    var sec = st.seconds;
    if (sec < tg[0]) add('warn', 'Very short: about ' + VB.fmtTime(sec), 'That\'s fine for a teaser; add a demo beat or a reason to care.');
    else if (sec > tg[2]) add('bad', 'Too long for a ' + VB.kind(kind).label + ': about ' + VB.fmtTime(sec), (kind === 'short' ? 'Shorts can be at most 3 minutes. ' : '') + 'Aim for about ' + VB.fmtTime(tg[1]) + '. Try "Trim to a Short" or cut a section.');
    else if (sec > tg[1] * 1.25) add('warn', 'A bit long: about ' + VB.fmtTime(sec), 'The sweet spot for this format is about ' + VB.fmtTime(tg[1]) + '.');
    else add('ok', 'Good length: about ' + VB.fmtTime(sec), 'Spoken at a relaxed 150 words a minute.');
    var cta = /\b(try|link|subscribe|follow|sign up|download|comment|check (it )?out|visit|join|get it|free)\b/i;
    if (cta.test(spoken.slice(-3).join(' '))) add('ok', 'Ends with a call to action', 'People know what to do next.');
    else if (cta.test(all)) add('warn', 'The call to action isn\'t at the end', 'Put "try it / link below / subscribe" in the last lines too.');
    else add('bad', 'No call to action', 'Tell viewers what to do: try the app, click the link, subscribe.');
    var sentences = all.split(/(?<=[.!?])\s+/).filter(function (s) { return s.split(/\s+/).length > 25; });
    if (sentences.length) add('warn', UI.plural(sentences.length, 'long sentence'), 'Split it: “' + sentences[0].split(/\s+/).slice(0, 12).join(' ') + '…”');
    else add('ok', 'Easy to say out loud', 'No sentence is longer than 25 words.');
    var low = ' ' + all.toLowerCase().replace(/[^a-z' ]+/g, ' ') + ' ', weak = [];
    WEAK.forEach(function (w) { var n = low.split(' ' + w + ' ').length - 1; if (n) weak.push(w + (n > 1 ? ' ×' + n : '')); });
    var weakN = weak.reduce(function (a, w) { var m = w.match(/×(\d+)/); return a + (m ? +m[1] : 1); }, 0);
    if (weakN > Math.max(2, st.words / 60)) add('warn', 'Filler words: ' + weak.slice(0, 5).join(', '), 'Cut most of them: the script gets shorter and sounds more sure.');
    else add('ok', 'Few filler words', weak.length ? 'Only ' + weak.join(', ') + '.' : 'Crisp.');
    var you = (low.match(/ (you|your|you're|yours) /g) || []).length, me = (low.match(/ (i|me|my|i'm|i've|mine) /g) || []).length;
    if (you >= me * 0.6 || st.words < 40) add('ok', 'Talks to the viewer', 'You: ' + you + ' · I: ' + me);
    else add('warn', 'More about you than the viewer', 'Turn some "I built…" into "you can…" (you: ' + you + ', I: ' + me + ').');
    var shows = lines.filter(function (l) { return l.k === 'show'; }).length, heads = lines.filter(function (l) { return l.k === 'h'; }).length;
    if (!shows && spoken.length > 3) add('warn', 'No [SHOW: …] notes', 'Add what\'s on screen for each part, so recording is easy.');
    if (!VB.isVertical(kind) && kind !== 'square') {
      if (heads >= 3) add('ok', UI.plural(heads, 'section') + ': chapters ready', 'Each # heading can become a YouTube chapter.');
      else add('warn', 'Only ' + UI.plural(heads, 'section'), 'Long videos with 3+ chapters keep viewers longer. Add # headings.');
    }
    var pts = items.reduce(function (a, it) { return a + (it.state === 'ok' ? 1 : it.state === 'warn' ? 0.5 : 0); }, 0);
    return { score: Math.round(pts / items.length * 100), items: items, stats: st };
  };

  /* ------------------------------------------------------------------ prompts for any AI chat */
  VB.AI_TASKS = [
    ['script', 'Write the whole script', '📝'], ['hook', '10 better hooks', '🪝'], ['tighten', 'Tighten my script', '✂️'],
    ['short', 'Turn it into a Short', '📱'], ['titles', 'Titles + thumbnail words', '🏷️'], ['ideas', '10 video ideas', '💡']
  ];
  VB.aiPrompt = function (task, c) {
    c = c || {};
    var p = c.product || {}, v = c.video || {}, k = VB.kind(v.kind), script = String(c.script || '').trim(), f = feats(p);
    var about = p.name ? ['The app: ' + p.name + (p.tagline ? ' — ' + p.tagline : ''), p.audience ? 'Made for: ' + p.audience : '', f.length ? 'Features:\n' + f.map(function (x) { return '- ' + x; }).join('\n') : '',
      p.url ? 'Link: ' + p.url : '', p.cta ? 'Call to action: ' + p.cta : ''].filter(Boolean).join('\n') : 'The app: (describe it here)';
    var fmt = 'Format the script like this: a line starting with "# " for each section, a line "[SHOW: what is on screen]" before each part of the screen recording, short spoken lines, and "(pause)" for a beat. Write in plain, friendly spoken English, talking to "you". Reply with only the script.';
    var target = { short: '45 seconds (about 110 words), vertical', reel: '30 seconds (about 75 words), vertical', square: '45 seconds', youtube: '4 minutes (about 600 words)', tutorial: '8 minutes with clear steps', devlog: '6 minutes, personal and honest' }[v.kind] || '3 minutes';
    var out;
    if (task === 'hook') out = 'I make videos about the apps I build. Give me 10 opening lines (hooks) for a ' + k.label + ' about my app. Each under 15 words, no "Hi" or "In this video". Mix styles: a pain, a surprising fact, a quick result, a question, a story.\n\n' + about + (script ? '\n\nMy current first lines:\n' + script.split('\n').slice(0, 6).join('\n') : '');
    else if (task === 'tighten') out = 'Tighten this video script for a ' + k.label + ' to about ' + target + '. Keep my voice, keep the sections, cut filler words and repetition, make every sentence easy to say out loud, and end with a clear call to action. ' + fmt + '\n\n' + about + '\n\nScript:\n' + (script || '(paste the script)');
    else if (task === 'short') out = 'Turn this script into a 45-second vertical Short (YouTube Shorts / Instagram Reels). Hook in the first 2 seconds, one idea, fast pace, a call to action at the end. ' + fmt + '\n\n' + about + '\n\nScript:\n' + (script || '(paste the script)');
    else if (task === 'titles') out = 'Give me 10 YouTube titles for this video (under 60 characters, honest, curiosity without clickbait) and, for each, 2-4 big words for the thumbnail.\n\nVideo: ' + (v.title || '') + ' (' + k.label + ')\n' + about + (script ? '\n\nScript:\n' + script : '');
    else if (task === 'ideas') out = 'I build apps and make YouTube videos and Shorts about them. Give me 10 video ideas for this app: a title, the format (Short, tutorial, devlog...), and the hook line for each. Make them useful for the audience, not just ads.\n\n' + about;
    else out = 'Write a script for a ' + k.label + ' about my app, about ' + target + ' long. Start with a strong hook (no "Hi, in this video"), show the app in action, and end with a call to action. ' + fmt + '\n\nVideo title: ' + (v.title || '(untitled)') + '\n' + about + (c.handle ? '\nMy channel: ' + c.handle : '') + (script ? '\n\nWhat I have so far:\n' + script : '');
    return out;
  };

  /* ------------------------------------------------------------------ release notes -> "What's new" script */
  VB.parseNotes = function (text) {
    var out = { added: [], improved: [], fixed: [] };
    String(text || '').split(/\n/).forEach(function (raw) {
      var l = raw.trim();
      if (!l || /^#{1,6}\s/.test(l)) return;  // headings like "## v1.4"
      l = l.replace(/^[-*•+]\s*/, '').replace(/^[0-9a-f]{7,40}\s+/i, '').replace(/^\d+[.)]\s+/, '').replace(/\s*\(#\d+\)\s*$/, '').replace(/\s*#\d+\s*$/, '');
      var m = l.match(/^(\w+)(\([^)]*\))?!?:\s*(.+)$/), kind = null;
      if (m) { var k = m[1].toLowerCase(); l = m[3]; kind = /^(fix|bug|hotfix)/.test(k) ? 'fixed' : /^(perf|refactor|improve|style|polish|tweak)/.test(k) ? 'improved' : /^(feat|add|new)/.test(k) ? 'added' : /^(chore|docs?|test|ci|build|bump|merge|wip|release|revert)/.test(k) ? 'skip' : null; }
      if (/^(merge (branch|pull)|bump version|update readme|wip\b)/i.test(l) || kind === 'skip') return;
      if (/^#{1,6}\s/.test(l)) return;
      if (!kind) kind = /\b(fix(ed|es)?|bug|crash|error|broken|typo)\b/i.test(l) ? 'fixed' : /\b(improv|faster|better|speed|polish|clean|tweak|updat|smoother|redesign)/i.test(l) ? 'improved' : 'added';
      l = upper(l.replace(/\.$/, '')).slice(0, 140);
      if (l.length > 2) out[kind].push(l);
    });
    return out;
  };
  VB.fromNotes = function (text, p, handle) {
    var n = VB.parseNotes(text), app = (p && p.name) || 'the app', total = n.added.length + n.improved.length + n.fixed.length;
    if (!total) return '';
    var s = ['# Hook', app + ' just got ' + (total === 1 ? 'an upgrade' : total + ' upgrades') + '. Here\'s what\'s new.', ''];
    n.added.slice(0, 5).forEach(function (a, i) { s.push('# New: ' + a.slice(0, 60)); s.push('[SHOW: ' + a + ']'); s.push((i ? 'Also new: ' : 'First, ') + lower(a) + '.'); s.push(''); });
    if (n.added.length > 5) { s.push('# More new things'); s.push('Plus ' + (n.added.length - 5) + ' more: ' + n.added.slice(5, 8).map(lower).join(', ') + '.'); s.push(''); }
    if (n.improved.length) { s.push('# Improved'); s.push('[SHOW: ' + n.improved[0] + ']'); n.improved.slice(0, 4).forEach(function (a) { s.push(upper(a) + '.'); }); s.push(''); }
    if (n.fixed.length) { s.push('# Fixed'); s.push(n.fixed.length === 1 ? 'And one fix: ' + lower(n.fixed[0]) + '.' : 'And ' + n.fixed.length + ' fixes, including ' + lower(n.fixed[0]) + '.'); s.push(''); }
    s.push('# Thanks'); s.push('Thanks for all the feedback. ' + ((p && p.cta) || 'Try it') + ((p && p.url) ? ': ' + p.url : '') + '. ' + (handle ? 'Subscribe ' + handle + ' for the next update.' : 'Subscribe for the next update.'));
    return s.join('\n');
  };

  /* ------------------------------------------------------------------ a ~1 minute version */
  VB.shortVersion = function (text) {
    var secs = [], cur = null;
    VB.parseScript(text).forEach(function (l) { if (l.k === 'h' || !cur) { cur = { h: l.k === 'h' ? l.text : '', show: [], lines: [] }; secs.push(cur); if (l.k === 'h') return; } if (l.k === 'show') cur.show.push(l.text); else cur.lines.push(l.text); });
    if (!secs.length) return '';
    function wc(s) { return s.split(/\s+/).filter(Boolean).length; }
    var first = secs[0], last = secs.length > 1 ? secs[secs.length - 1] : null, mid = secs.slice(1, last ? -1 : undefined);
    var keep = [{ h: first.h || 'Hook', show: first.show.slice(0, 1), lines: first.lines.slice(0, 2) }];
    mid.forEach(function (s) { if (s.lines.length || s.show.length) keep.push({ h: s.h, show: s.show.slice(0, 1), lines: s.lines.slice(0, 1).map(function (l) { return l.split(/(?<=[.!?])\s+/)[0]; }) }); });
    if (last) keep.push({ h: last.h, show: last.show.slice(0, 1), lines: last.lines.slice(0, 2) });
    var total = function () { return keep.reduce(function (a, s) { return a + s.lines.reduce(function (b, l) { return b + wc(l); }, 0); }, 0); };
    while (total() > 140 && keep.length > 3) keep.splice(keep.length - 2, 1);
    return keep.map(function (s) { return ['# ' + (s.h || 'Part')].concat(s.show.map(function (x) { return '[SHOW: ' + x + ']'; }), s.lines).join('\n'); }).join('\n\n');
  };
})();

/* ===== _h_sound.html ===== */
(function () {
  'use strict';
  var VB = window.VB;

  VB.BEATS = [
    { key: 'lofi', name: 'Lo-fi desk', emoji: '☕', bpm: 80, blurb: 'Dusty drums, warm chords. Tutorials and devlogs.' },
    { key: 'upbeat', name: 'Launch day', emoji: '🚀', bpm: 116, blurb: 'Bright and bouncy. App tours and Shorts.' },
    { key: 'chill', name: 'Sunday build', emoji: '🌤️', bpm: 92, blurb: 'Soft and calm. Talking over a demo.' },
    { key: 'techno', name: 'Rave 1996', emoji: '💿', bpm: 132, blurb: 'Four on the floor, acid bass. Fast cuts.' }
  ];
  VB.beatInfo = function (k) { return VB.BEATS.filter(function (b) { return b.key === k; })[0] || null; };

  var N = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function hz(note, oct) { return 440 * Math.pow(2, (N[note[0]] + (note[1] === '#' ? 1 : note[1] === 'b' ? -1 : 0) + (oct + 1) * 12 - 69) / 12); }
  /* chord = [root, intervals...] in semitones above the root note */
  var SONGS = {
    lofi: { bars: 8, swing: 0.16, chords: [['A', 2, [0, 3, 7, 10]], ['D', 2, [0, 3, 7, 10]], ['G', 2, [0, 4, 7, 10]], ['C', 3, [0, 4, 7, 11]]],
      kick: [0, 1.75, 2.5], snare: [1, 3], hats: 8, pad: 'triangle', bass: 'sine', lead: null, crackle: 0.012, cut: 1400 },
    upbeat: { bars: 8, swing: 0, chords: [['C', 3, [0, 4, 7]], ['G', 2, [0, 4, 7]], ['A', 2, [0, 3, 7]], ['F', 2, [0, 4, 7]]],
      kick: [0, 1, 2, 3], snare: [1, 3], hats: 8, pad: 'sawtooth', bass: 'triangle', lead: 'square', crackle: 0, cut: 2600 },
    chill: { bars: 8, swing: 0.08, chords: [['F', 2, [0, 4, 7, 11]], ['E', 2, [0, 3, 7, 10]], ['D', 2, [0, 3, 7, 10]], ['C', 3, [0, 4, 7, 11]]],
      kick: [0, 2.5], snare: [2], hats: 4, pad: 'sine', bass: 'sine', lead: 'triangle', crackle: 0, cut: 1800 },
    techno: { bars: 8, swing: 0, chords: [['A', 2, [0, 7, 12]], ['A', 2, [0, 7, 12]], ['F', 2, [0, 7, 12]], ['G', 2, [0, 7, 12]]],
      kick: [0, 1, 2, 3], snare: [1, 3], hats: 16, offhat: true, pad: 'sawtooth', bass: 'sawtooth', lead: 'sawtooth', acid: true, crackle: 0, cut: 3200 }
  };
  var cache = {};
  /* -> Promise of a WAV Blob that loops seamlessly. */
  VB.beat = function (name) {
    if (!SONGS[name]) return Promise.resolve(null);
    if (cache[name]) return cache[name];
    var info = VB.beatInfo(name), S = SONGS[name], spb = 60 / info.bpm, bar = spb * 4, len = S.bars * bar, rate = 44100;
    var oc = new OfflineAudioContext(2, Math.ceil(len * rate), rate), rnd = VB.rng(name.length * 977 + 13);
    var noise = oc.createBuffer(1, rate, rate), nd = noise.getChannelData(0);
    for (var i = 0; i < nd.length; i++) nd[i] = rnd() * 2 - 1;
    var comp = oc.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4;
    var master = oc.createGain(); master.gain.value = 0.55; master.connect(comp); comp.connect(oc.destination);
    function env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
    function kick(t) {
      var o = oc.createOscillator(), g = oc.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
      env(g, t, 0.004, name === 'techno' ? 1 : 0.8, 0.32); o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.4);
    }
    function noiseHit(t, type, f, peak, d) {
      var n = oc.createBufferSource(), fl = oc.createBiquadFilter(), g = oc.createGain();
      n.buffer = noise; fl.type = type; fl.frequency.value = f; fl.Q.value = type === 'bandpass' ? 0.8 : 0.5;
      env(g, t, 0.002, peak, d); n.connect(fl); fl.connect(g); g.connect(master); n.start(t, rnd() * 0.5); n.stop(t + d + 0.05);
    }
    function tone(t, f, type, peak, a, d, cut, pan) {
      var o = oc.createOscillator(), fl = oc.createBiquadFilter(), g = oc.createGain(), p = oc.createStereoPanner ? oc.createStereoPanner() : null;
      o.type = type; o.frequency.value = f; fl.type = 'lowpass'; fl.frequency.value = cut || S.cut; env(g, t, a, peak, d);
      o.connect(fl); fl.connect(g); if (p) { p.pan.value = pan || 0; g.connect(p); p.connect(master); } else g.connect(master);
      o.start(t); o.stop(t + a + d + 0.05);
      return fl;
    }
    for (var b = 0; b < S.bars; b++) {
      var t0 = b * bar, ch = S.chords[b % S.chords.length], root = hz(ch[0], ch[1]);
      S.kick.forEach(function (k) { kick(t0 + k * spb); });
      S.snare.forEach(function (k) { noiseHit(t0 + k * spb, 'bandpass', name === 'techno' ? 1500 : 1900, name === 'chill' ? 0.18 : 0.42, name === 'lofi' ? 0.16 : 0.12); });
      for (var h = 0; h < S.hats; h++) {
        var step = 4 / S.hats, ht = t0 + h * step * spb + (h % 2 ? S.swing * spb * step : 0);
        if (S.offhat && h % 4 !== 2) { if (h % 2) noiseHit(ht, 'highpass', 8000, 0.05, 0.03); continue; }
        noiseHit(ht, 'highpass', 7000, h % 2 ? 0.06 : 0.1, 0.045);
      }
      // chords: a pad on bar start (lofi + chill), stabs on the off-beats (upbeat + techno)
      ch[2].forEach(function (iv, k) {
        var f = root * Math.pow(2, (iv + 12) / 12);
        if (name === 'lofi' || name === 'chill') tone(t0 + k * 0.012, f, S.pad, 0.07, 0.08, bar * 0.95, S.cut, (k % 2 ? -0.3 : 0.3));
        else [0.5, 1.5, 2.5, 3.5].forEach(function (q) { tone(t0 + q * spb, f, S.pad, name === 'techno' ? 0.05 : 0.06, 0.005, spb * 0.35, S.cut, (k % 2 ? -0.25 : 0.25)); });
      });
      // bass: roots on the beat
      (name === 'techno' ? [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5] : name === 'upbeat' ? [0, 1, 1.5, 2, 3, 3.5] : [0, 2, 2.75]).forEach(function (q, k) {
        var fl = tone(t0 + q * spb, root / 2 * (name === 'techno' && k % 4 === 3 ? 2 : 1), S.bass, name === 'techno' ? 0.2 : 0.28, 0.006, spb * (name === 'techno' ? 0.4 : 0.9), name === 'techno' ? 600 : 500);
        if (S.acid) { fl.Q.value = 9; fl.frequency.setValueAtTime(380, t0 + q * spb); fl.frequency.exponentialRampToValueAtTime(1800 + 900 * Math.sin(b + k), t0 + q * spb + 0.05); fl.frequency.exponentialRampToValueAtTime(300, t0 + q * spb + spb * 0.38); }
      });
      // a little melody / arpeggio
      if (S.lead && b % 2 === 1) {
        var notes = name === 'chill' ? [0, 2, 4] : [0, 1, 2, 3, 2, 1, 0, 2];
        notes.forEach(function (n, k) {
          var iv = ch[2][n % ch[2].length] + 24 + (n >= ch[2].length ? 12 : 0), st = name === 'chill' ? 1.2 : 0.5;
          tone(t0 + k * st * spb, root * Math.pow(2, iv / 12) / 2, S.lead, name === 'techno' ? 0.035 : 0.045, 0.01, spb * st * 0.8, name === 'techno' ? 2400 : 3000, 0.2);
        });
      }
    }
    if (S.crackle) { for (var c = 0; c < len * 6; c++) noiseHit(rnd() * len, 'highpass', 3000, S.crackle * (0.5 + rnd()), 0.01); }
    cache[name] = oc.startRendering().then(function (buf) { return wav(buf); });
    cache[name]['catch'](function () { delete cache[name]; });
    return cache[name];
  };
  function wav(buf) {
    var ch = buf.numberOfChannels, n = buf.length, rate = buf.sampleRate, out = new DataView(new ArrayBuffer(44 + n * ch * 2));
    function str(o, s) { for (var i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); }
    str(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true);
    out.setUint16(22, ch, true); out.setUint32(24, rate, true); out.setUint32(28, rate * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true);
    str(36, 'data'); out.setUint32(40, n * ch * 2, true);
    var data = []; for (var c = 0; c < ch; c++) data.push(buf.getChannelData(c));
    var o = 44;
    for (var i = 0; i < n; i++) for (var c2 = 0; c2 < ch; c2++) { var v = Math.max(-1, Math.min(1, data[c2][i])); out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
    return new Blob([out], { type: 'audio/wav' });
  }

  /* ------------------------------------------------------------------ sound effects */
  var sfxCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  VB.sfx = function (ac, kind) {
    var per = sfxCache && sfxCache.get(ac);
    if (!per) { per = {}; if (sfxCache) sfxCache.set(ac, per); }
    if (per[kind]) return per[kind];
    var rate = ac.sampleRate, rnd = VB.rng(kind === 'click' ? 7 : 11), T = kind === 'click' ? 0.06 : 0.55, n = Math.ceil(T * rate);
    var buf = ac.createBuffer(1, n, rate), d = buf.getChannelData(0), lp = 0, lp2 = 0;
    for (var i = 0; i < n; i++) {
      var t = i / rate, x = rnd() * 2 - 1;
      if (kind === 'click') d[i] = x * Math.exp(-t * 900) * 0.5 + Math.sin(2 * Math.PI * 2100 * t) * Math.exp(-t * 170) * 0.32 + Math.sin(2 * Math.PI * 700 * t) * Math.exp(-t * 120) * 0.18;
      else {
        var k = t / T, a = 0.02 + 0.25 * Math.sin(Math.PI * k);  // the band sweeps up and back down
        lp += a * (x - lp); lp2 += a * 0.35 * (lp - lp2);
        d[i] = (lp - lp2) * Math.pow(Math.sin(Math.PI * k), 2) * 1.4;
      }
    }
    per[kind] = buf;
    return buf;
  };
  VB.playSfx = function (ac, dest, kind, vol) {
    var n = ac.createBufferSource(), g = ac.createGain();
    n.buffer = VB.sfx(ac, kind); g.gain.value = (vol == null ? 0.6 : vol) * (kind === 'click' ? 0.9 : 0.7);
    n.connect(g); g.connect(dest); n.start();
  };
  /* Sound effect moments on the output timeline: [{t, kind}] */
  VB.sfxEvents = function (plan) {
    var fx = plan.edit.sfx || {}, out = [];
    if (!fx.clicks && !fx.whoosh) return out;
    plan.scenes.forEach(function (s, si) {
      if (fx.whoosh && si > 0) out.push({ t: Math.max(0, s.start - 0.22), kind: 'whoosh' });
      if (fx.clicks && s.type === 'take') (s.take.clicks || []).forEach(function (c) { var o = VB.outOf(plan, si, c[0]); if (o >= 0) out.push({ t: o, kind: 'click' }); });
    });
    return out.sort(function (a, b) { return a.t - b.t; });
  };
  /* Fire the events between two moments (lo, hi], skipping big jumps (seeks). */
  VB.fireSfx = function (plan, lo, hi, fn) {
    if (!plan || !plan.sfx || !plan.sfx.length || hi <= lo || hi - lo > 0.6) return;
    plan.sfx.forEach(function (e) { if (e.t > lo && e.t <= hi) fn(e); });
  };
})();

/* ===== admin.html ===== */
(function () {
  var esc = UI.esc;
  var TABS = [['overview', 'Overview', 'grid'], ['templates', 'Templates', 'scroll'], ['settings', 'Settings', 'settings'], ['feedback', 'Feedback', 'inbox'], ['users', 'Users', 'users'], ['demo', 'Demo data', 'database']];

  UI.page('admin', { title: 'Admin', auth: 'admin' }, function (view, ctx) {
    var tab = TABS.some(function (t) { return t[0] === ctx.args[0]; }) ? ctx.args[0] : 'overview';
    var fbFilter = 'new';
    view.innerHTML = '<div class="ui-wrap"><div class="ui-page-head"><div><h1>Admin</h1><p class="muted">Only admins see this page.</p></div></div>' +
      '<nav class="ui-tabs">' + TABS.map(function (t) {
        return '<a href="#admin/' + t[0] + '" class="' + (t[0] === tab ? 'on' : '') + '">' + UI.icon(t[2]) + t[1] + '</a>';
      }).join('') + '</nav><div data-body><div class="ui-skel"></div></div></div>';
    var body = view.querySelector('[data-body]');

    function overview() {
      return UI.api('admin_overview').then(function (d) {
        var stat = function (n, label, go) { return '<a class="ui-card ui-stat" href="#admin/' + go + '" style="text-decoration:none;color:inherit;padding:16px"><b>' + n + '</b><span>' + label + '</span></a>'; };
        var max = Math.max(1, Math.max.apply(null, d.days.map(function (x) { return Math.max(x.takes, x.exports); })));
        body.innerHTML = '<div class="ad-stats">' + stat(d.users, 'people signed up', 'users') + stat(d.active_week, 'active this week', 'users') +
          stat(d.videos, 'videos', 'overview') + stat(d.published, 'published', 'overview') + stat(d.takes, 'takes recorded', 'overview') +
          stat(d.minutes, 'minutes recorded', 'overview') + stat(d.exports, 'exports', 'overview') + stat(d.vertical, 'vertical exports', 'overview') +
          stat(d.products, 'apps added', 'overview') + stat(d.extension_takes, 'takes via extension', 'overview') + stat(d.templates, 'script templates', 'templates') +
          stat(d.transcribed || 0, 'takes with captions', 'overview') + stat(d.uploads || 0, 'uploaded to YouTube', 'settings') +
          stat(d.feedback_new, 'new feedback', 'feedback') + '</div>' +
          '<div class="ui-card" style="margin-top:16px"><h3 style="font-size:1rem">Last 14 days</h3><div class="ad-chart">' + d.days.map(function (x) {
            return '<div class="d" title="' + esc(x.day) + ': ' + x.takes + ' takes, ' + x.exports + ' exports"><i class="t" style="height:' + (x.takes / max * 100) + '%"></i><i class="x" style="height:' + (x.exports / max * 100) + '%"></i></div>';
          }).join('') + '</div><div class="ad-days">' + d.days.map(function (x, i) { return '<span>' + (i % 2 ? '' : esc(x.day.slice(5))) + '</span>'; }).join('') + '</div>' +
          '<div class="ad-key"><span><i style="background:var(--c-brand)"></i>Takes recorded</span><span><i style="background:var(--c-link)"></i>Exports</span></div></div>' +
          '<p class="muted small" style="margin-top:18px">Recordings themselves never reach the server: these numbers come from the facts the browser reports. Demo data is <b>' + esc(d.demo.state) + '</b> (' + d.demo.counts.users + ' demo people).</p>';
      });
    }

    var tpls = [];
    function templates() {
      return UI.api('admin_templates').then(function (d) {
        tpls = d.templates;
        body.innerHTML = '<div class="ui-row between" style="margin-bottom:12px"><p class="muted" style="margin:0;max-width:560px">Script templates everyone sees next to the built-in ones. Placeholders: {app} {tagline} {audience} {feature1} {feature2} {feature3} {cta} {url} {handle}.</p>' +
          '<button class="ui-btn primary" data-tnew>' + UI.icon('plus') + 'New template</button></div>' +
          (tpls.length ? '<div class="ad-tpl">' + tpls.map(function (t) {
            return '<div class="ui-item" data-tid="' + esc(t.id) + '"><span class="em">' + esc(t.emoji || '📝') + '</span><div class="grow"><h3>' + esc(t.name) +
              (t.featured ? ' <span class="ui-badge brand">Featured</span>' : '') + (t.hidden ? ' <span class="ui-badge">Hidden</span>' : '') + (t.demo ? ' <span class="ui-badge">Demo</span>' : '') + '</h3>' +
              '<p class="small muted">' + esc(VB.kind(t.kind).label) + ' · by ' + esc(t.by) + ' · used ' + UI.plural(t.uses, 'time') + (t.blurb ? ' · ' + esc(t.blurb) : '') + '</p></div>' +
              '<button class="ui-btn sm" data-tedit>' + UI.icon('edit') + 'Edit</button><button class="ui-btn ghost icon" data-tdel aria-label="Delete">' + UI.icon('trash') + '</button></div>';
          }).join('') + '</div>' : '<div class="ui-empty">' + UI.icon('scroll') + '<h3>No templates yet</h3><p>The eight built-in templates are always there. Add your own here.</p></div>');
      });
    }
    function editTemplate(t) {
      t = t || { kind: 'youtube', body: '# Hook\n\n# Demo\n[SHOW: ]\n\n# Call to action\n{cta}. {url}' };
      var m = UI.modal('<h2>' + (t.id ? 'Edit template' : 'New template') + '</h2><form class="ui-stack" data-tf>' +
        '<div class="ui-grid two" style="grid-template-columns:80px 1fr"><label class="ui-field"><span>Emoji</span><input type="text" name="emoji" maxlength="8" value="' + esc(t.emoji || '') + '"></label>' +
        '<label class="ui-field"><span>Name</span><input type="text" name="name" maxlength="60" required value="' + esc(t.name || '') + '"></label></div>' +
        '<label class="ui-field"><span>Format</span><select name="kind">' + VB.KINDS.map(function (k) { return '<option value="' + k.key + '"' + (t.kind === k.key ? ' selected' : '') + '>' + esc(k.label) + '</option>'; }).join('') + '</select></label>' +
        '<label class="ui-field"><span>One line about it</span><input type="text" name="blurb" maxlength="160" value="' + esc(t.blurb || '') + '"></label>' +
        '<label class="ui-field"><span>Script</span><textarea name="body" rows="12" maxlength="8000">' + esc(t.body || '') + '</textarea></label>' +
        '<label class="ui-check"><input type="checkbox" name="featured"' + (t.featured ? ' checked' : '') + '><span>Featured (shown first)</span></label>' +
        '<label class="ui-check"><input type="checkbox" name="hidden"' + (t.hidden ? ' checked' : '') + '><span>Hidden</span></label>' +
        '<div class="ui-row end"><button type="button" class="ui-btn ghost" data-close>Cancel</button><button class="ui-btn primary" type="submit">Save</button></div></form>', { wide: true });
      var f = m.el.querySelector('[data-tf]');
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        var v = UI.formData(f); if (t.id) v.id = t.id;
        UI.busy(f.querySelector('[type=submit]'), UI.api('admin_template_save', v)).then(function () { m.close(); UI.toast('Saved', 'ok'); templates(); });
      });
    }

    function feedback() {
      return UI.api('list_feedback', null).then(function (d) {
        var items = d.items.filter(function (i) { return fbFilter === 'all' || i.status === fbFilter; });
        body.innerHTML = '<div class="ui-row" style="margin-bottom:16px"><div class="ui-seg">' + [['new', 'New'], ['read', 'Read'], ['done', 'Done'], ['all', 'All']].map(function (f) {
          var n = f[0] === 'all' ? d.items.length : d.counts[f[0]];
          return '<button data-filter="' + f[0] + '" class="' + (fbFilter === f[0] ? 'on' : '') + '">' + f[1] + ' (' + n + ')</button>';
        }).join('') + '</div></div>' +
          (items.length ? '<div class="ad-fb">' + items.map(function (i) {
            var c = i.context || {};
            return '<div class="ui-item" data-id="' + esc(i.id) + '"><div class="meta"><span class="ui-badge ' + (i.kind === 'bug' ? 'bad' : i.kind === 'idea' ? 'brand' : '') + '">' + esc(i.kind_label) + '</span>' +
              '<b>' + esc(i.name) + '</b>' + (i.email ? '<a href="mailto:' + esc(i.email) + '">' + esc(i.email) + '</a>' : '') + '<span>' + esc(UI.fmtDateTime(i.created)) + '</span></div>' +
              '<p class="msg">' + esc(i.message) + '</p>' +
              '<div class="ctx">' + esc([c.page, c.screen, c.theme, c.browser].filter(Boolean).join(' · ')) + '</div>' +
              '<textarea data-note placeholder="Private note (only admins see it)">' + esc(i.note) + '</textarea>' +
              '<div class="ui-row" style="margin-top:10px">' + ['new', 'read', 'done'].map(function (s) {
                return '<button class="ui-btn sm' + (i.status === s ? ' primary' : '') + '" data-status="' + s + '">' + s[0].toUpperCase() + s.slice(1) + '</button>';
              }).join('') + '<span class="ui-spacer"></span><button class="ui-btn sm danger" data-del-fb>' + UI.icon('trash') + 'Delete</button></div></div>';
          }).join('') + '</div>'
            : '<div class="ui-empty">' + UI.icon('inbox') + '<h3>No ' + (fbFilter === 'all' ? '' : fbFilter + ' ') + 'messages</h3><p>New feedback goes to Prepsto (prepsto.com). Older messages and requests from the app show up here.</p></div>');
      });
    }

    function users(query) {
      return UI.api('list_users', query || null).then(function (d) {
        body.innerHTML = '<form class="ui-row" data-search style="margin-bottom:14px"><input type="search" name="q" placeholder="Search by name or email" value="' + esc(query || '') + '" style="max-width:360px">' +
          '<button class="ui-btn" type="submit">' + UI.icon('search') + 'Search</button><span class="muted small">' + UI.plural(d.total, 'person', 'people') + '</span></form>' +
          '<table class="ad-users"><thead><tr><th>Name</th><th>Email</th><th>Joined</th><th>Admin</th><th>Active</th></tr></thead><tbody>' +
          d.users.map(function (u) {
            return '<tr data-id="' + esc(u.id) + '"><td><b>' + esc(u.name) + '</b></td><td class="email">' + esc(u.email) + '</td><td class="joined muted">' + esc(UI.fmtDate(u.joined)) + '</td>' +
              '<td><label class="ui-check"><input type="checkbox" data-admin' + (u.is_admin ? ' checked' : '') + '> Admin</label></td>' +
              '<td><label class="ui-check"><input type="checkbox" data-enabled' + (u.enabled ? ' checked' : '') + '> Active</label></td></tr>';
          }).join('') + '</tbody></table>';
      });
    }

    function demo() {
      return UI.api('admin_overview').then(function (d) {
        var c = d.demo.counts;
        body.innerHTML = '<div class="ui-card ui-narrow" style="margin:0"><h3>Demo data</h3>' +
          '<p class="muted">Example people and content, so the app never looks empty for the first visitors. Demo rows are flagged, so removing them never touches real data. Once removed, it stays removed until you load it again.</p>' +
          '<p>Status: <b>' + esc(d.demo.state) + '</b> · ' + Object.keys(c).map(function (k) { return c[k] + ' ' + esc(k); }).join(', ') + '</p>' +
          '<div class="ui-row"><button class="ui-btn primary" data-demo="load">' + UI.icon('refresh') + (d.demo.state === 'loaded' ? 'Reload demo data' : 'Load demo data') + '</button>' +
          '<button class="ui-btn danger" data-demo="remove">' + UI.icon('trash') + 'Remove demo data</button></div></div>';
      });
    }

    function settings() {
      return UI.api('admin_settings_get').then(function (s) {
        var origin = location.origin;
        body.innerHTML = '<form class="ad-set" data-settings><div class="ui-card" style="padding:18px"><h2 style="font-size:1.2rem">' + UI.icon('upload') + ' YouTube upload</h2>' +
          '<p class="muted small">With a Google OAuth client ID, members upload straight from the publish kit: video, thumbnail and captions. Each person signs in with their own Google account in a popup; the video goes from their browser to YouTube, never through this app.</p>' +
          '<label class="ui-field"><span>Google OAuth client ID</span><input type="text" name="google_client_id" placeholder="1234567890-abc123.apps.googleusercontent.com" value="' + esc(s.google_client_id) + '"></label>' +
          (s.google_client_id ? '<p class="small" style="margin:8px 0 0"><span class="ui-badge good">' + UI.icon('check') + 'Switched on</span></p>' : '') +
          '<h3 style="font-size:1rem;margin-top:18px">Set it up (about 5 minutes)</h3><ol>' +
          '<li>Open <a class="vb-link" href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener">Google Cloud console</a> and create a project, e.g. “VideoBlog Buddy”.</li>' +
          '<li>APIs &amp; Services → Library → <b>YouTube Data API v3</b> → <b>Enable</b>.</li>' +
          '<li>Google Auth Platform (OAuth consent screen): app name, your email, audience <b>External</b>. While it\'s in <b>Testing</b>, add each person who will upload as a <b>test user</b>.</li>' +
          '<li>Clients → Create client → <b>Web application</b>. Under <b>Authorized JavaScript origins</b> add <code>' + esc(origin) + '</code> (and any other address the app runs on).</li>' +
          '<li>Copy the <b>Client ID</b> (not the secret) into the box above and save.</li></ol>' +
          '<p class="small muted" style="margin-top:12px">Good to know: until Google audits the project, YouTube keeps videos uploaded through the API <b>private</b>; switch them to public in YouTube Studio (or ask for an audit with Google\'s YouTube API audit form). Custom thumbnails need a verified channel (youtube.com/verify). Each project gets about 6 uploads a day on the free quota.</p></div>' +
          '<div class="ui-card" style="padding:18px"><h2 style="font-size:1.2rem">' + UI.icon('puzzle') + ' Chrome Web Store</h2>' +
          '<p class="muted small">Once the extension is published, paste its store page here: the app then shows an <b>Add to Chrome</b> button instead of the zip download.</p>' +
          '<label class="ui-field"><span>Store page</span><input type="url" name="extension_store_url" placeholder="https://chromewebstore.google.com/detail/videoblog-buddy/…" value="' + esc(s.extension_store_url) + '"></label>' +
          '<p class="small muted" style="margin-top:12px">The listing text, the permission answers, the images and a store-ready zip are in the project folder: <code>extension/store/</code> (see <code>PUBLISH.md</code>).</p>' +
          '<div class="ui-row end" style="margin-top:16px"><button class="ui-btn primary" type="submit">' + UI.icon('check') + 'Save settings</button></div></div></form>';
      });
    }
    var DRAW = { overview: overview, templates: templates, settings: settings, feedback: feedback, users: users, demo: demo };

    view.addEventListener('click', function (e) {
      if (e.target.closest('[data-tnew]')) { editTemplate(null); return; }
      var te = e.target.closest('[data-tedit]');
      if (te) { var tid = te.closest('[data-tid]').getAttribute('data-tid'); editTemplate(tpls.filter(function (x) { return x.id === tid; })[0]); return; }
      var td = e.target.closest('[data-tdel]');
      if (td) {
        UI.confirm({ title: 'Delete this template?', ok: 'Delete', danger: true }).then(function (yes) {
          if (yes) UI.api('admin_template_delete', td.closest('[data-tid]').getAttribute('data-tid')).then(templates);
        });
        return;
      }
      var f = e.target.closest('[data-filter]');
      if (f) { fbFilter = f.getAttribute('data-filter'); feedback(); return; }
      var st = e.target.closest('[data-status]');
      if (st) {
        var card = st.closest('[data-id]');
        UI.api('set_feedback_status', card.getAttribute('data-id'), st.getAttribute('data-status'), card.querySelector('[data-note]').value).then(function () { UI.toast('Saved', 'ok'); feedback(); });
        return;
      }
      var del = e.target.closest('[data-del-fb]');
      if (del) {
        UI.confirm({ title: 'Delete this message?', ok: 'Delete', danger: true }).then(function (yes) {
          if (yes) UI.api('delete_feedback', del.closest('[data-id]').getAttribute('data-id')).then(feedback);
        });
        return;
      }
      var dm = e.target.closest('[data-demo]');
      if (dm) {
        var load = dm.getAttribute('data-demo') === 'load';
        UI.confirm({ title: load ? 'Load the demo data?' : 'Remove the demo data?', text: load ? 'Demo people and content are added (any old demo rows are replaced).' : 'Every demo row is deleted. Real data stays.', ok: load ? 'Load' : 'Remove', danger: !load })
          .then(function (yes) { if (yes) UI.busy(dm, UI.api(load ? 'demo_load' : 'demo_remove')).then(function () { UI.toast('Done', 'ok'); demo(); }); });
      }
    });
    view.addEventListener('change', function (e) {
      var row = e.target.closest('tr[data-id]');
      if (!row) return;
      var id = row.getAttribute('data-id'), box = e.target;
      var fn = box.hasAttribute('data-admin') ? 'set_admin' : box.hasAttribute('data-enabled') ? 'set_enabled' : null;
      if (fn) UI.api(fn, id, box.checked).then(function () { UI.toast('Saved', 'ok'); }, function (err) { box.checked = !box.checked; UI.toast(err.message, 'error'); });
    });
    view.addEventListener('submit', function (e) {
      if (e.target.matches('[data-settings]')) {
        e.preventDefault();
        UI.busy(e.target.querySelector('[type=submit]'), UI.api('admin_settings_save', UI.formData(e.target))).then(function () { UI.toast('Settings saved', 'ok'); VB.getConfig(true); settings(); });
        return;
      }
      if (e.target.matches('[data-search]')) { e.preventDefault(); users(UI.formData(e.target).q); }
    });
    return DRAW[tab]();
  });
})();

/* ===== apps.html ===== */
(function () {
  var esc = UI.esc;
  var COLORS = ['#cc181e', '#ff8a3d', '#e6a700', '#2e9d5b', '#1fa2a2', '#167ac6', '#5b4ccf', '#a83279', '#444444'];

  VB.editProduct = function (p, done) {
    p = p || { color: COLORS[Math.floor(Math.random() * COLORS.length)] };
    var m = UI.modal('<h2>' + (p.id ? 'Edit ' + esc(p.name) : 'Add an app') + '</h2><form class="ui-stack" data-pf>' +
      '<div class="ui-grid two" style="grid-template-columns:90px 1fr"><label class="ui-field"><span>Emoji</span><input type="text" name="emoji" maxlength="8" value="' + esc(p.emoji || '') + '" placeholder="🚀" style="text-align:center;font-size:1.4rem"></label>' +
      '<label class="ui-field"><span>Name</span><input type="text" name="name" maxlength="60" required value="' + esc(p.name || '') + '" placeholder="Pocket Garden"></label></div>' +
      '<div class="ui-field"><span>Colour</span><div class="ap-colors">' + COLORS.map(function (c) { return '<button type="button" data-col="' + c + '" class="' + (p.color === c ? 'on' : '') + '" style="background:' + c + '" aria-label="' + c + '"></button>'; }).join('') +
        '<input type="color" name="color" value="' + esc(p.color || '#cc181e') + '" style="width:44px;height:32px;padding:2px;border:1px solid var(--c-line-2);border-radius:2px"></div></div>' +
      '<label class="ui-field"><span>Link</span><input type="url" name="url" maxlength="300" value="' + esc(p.url || '') + '" placeholder="https://myapp.com"></label>' +
      '<label class="ui-field"><span>What it does, in one line</span><input type="text" name="tagline" maxlength="140" value="' + esc(p.tagline || '') + '" placeholder="Never forget to water a plant again"></label>' +
      '<label class="ui-field"><span>Who it\'s for</span><input type="text" name="audience" maxlength="100" value="' + esc(p.audience || '') + '" placeholder="busy plant parents"></label>' +
      '<label class="ui-field"><span>Best features <em>(one per line)</em></span><textarea name="features" rows="4" maxlength="1200" placeholder="Watering reminders for every plant&#10;Log growth with a photo a week">' + esc(p.features || '') + '</textarea></label>' +
      '<label class="ui-field"><span>Call to action</span><input type="text" name="cta" maxlength="80" value="' + esc(p.cta || '') + '" placeholder="Try it free"></label>' +
      '<label class="ui-field"><span>Notes <em>(just for you)</em></span><textarea name="notes" rows="2" maxlength="2000">' + esc(p.notes || '') + '</textarea></label>' +
      '<div class="ui-row end"><button type="button" class="ui-btn ghost" data-close>Cancel</button><button class="ui-btn primary" type="submit">' + UI.icon('check') + 'Save</button></div></form>');
    var f = m.el.querySelector('[data-pf]');
    f.addEventListener('click', function (e) { var b = e.target.closest('[data-col]'); if (!b) return; f.color.value = b.getAttribute('data-col'); f.querySelectorAll('[data-col]').forEach(function (x) { x.classList.toggle('on', x === b); }); });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = UI.formData(f); if (p.id) v.id = p.id;
      UI.busy(f.querySelector('[type=submit]'), UI.api('product_save', v)).then(function (r) { m.close(); UI.toast('Saved', 'ok'); if (done) done(r.product); });
    });
  };

  UI.page('apps', { title: 'Your apps', nav: 'Apps', icon: 'grid', auth: 'user', order: 40 }, function (view, ctx) {
    var D = null, pid = ctx.args[0];
    view.innerHTML = '<div class="ui-wrap"><div class="ui-skel" style="height:300px"></div></div>';
    function count(p, status) { return D.videos.filter(function (v) { return v.product && v.product.id === p.id && (!status || v.status === status); }).length; }
    function drawList() {
      view.innerHTML = '<div class="ui-wrap"><div class="ui-page-head"><div><h1>Your apps</h1><p class="muted">What you\'re building. Each app\'s details fill in scripts, title cards, ideas and YouTube descriptions.</p></div>' +
        '<button class="ui-btn primary" data-addapp>' + UI.icon('plus') + 'Add an app</button></div><div class="ap-grid">' +
        D.products.map(function (p) {
          return '<a class="ap-card" href="#apps/' + esc(p.id) + '"><div class="ap-band" style="background:linear-gradient(135deg,' + esc(p.color) + ',' + esc(VB.mix(p.color, -0.4)) + ')"><span class="ap-emo">' + esc(p.emoji || '📦') + '</span></div>' +
            '<div class="ap-body"><h3>' + esc(p.name) + '</h3><p>' + esc(p.tagline || 'Add a one-line pitch') + '</p>' +
            '<div class="ap-stats"><span><b>' + count(p) + '</b> videos</span><span><b>' + count(p, 'published') + '</b> published</span>' + (p.url ? '<span>' + esc(p.url.replace(/^https?:\/\//, '').replace(/\/$/, '')) + '</span>' : '') + '</div></div></a>';
        }).join('') + '<button class="ap-new" data-addapp>' + UI.icon('plus') + '<span>Add an app</span></button></div></div>';
    }
    function drawOne(p) {
      var vids = D.videos.filter(function (v) { return v.product && v.product.id === p.id; });
      var feats = String(p.features || '').split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean);
      view.innerHTML = '<div class="ui-wrap"><a class="ui-btn ghost sm" href="#apps" style="margin-bottom:10px">' + UI.icon('back') + 'All apps</a>' +
        '<div class="ap-hero" style="background:linear-gradient(135deg,' + esc(p.color) + ',' + esc(VB.mix(p.color, -0.45)) + ')"><span class="ap-emo">' + esc(p.emoji || '📦') + '</span>' +
        '<div style="flex:1;min-width:200px"><h1>' + esc(p.name) + '</h1><p>' + esc(p.tagline) + '</p>' + (p.url ? '<p style="margin-top:6px"><a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.url) + '</a></p>' : '') + '</div>' +
        '<div class="ui-row"><button class="ui-btn" data-editapp>' + UI.icon('edit') + 'Edit</button><button class="ui-btn primary" data-newvid>' + UI.icon('plus') + 'New video</button></div></div>' +
        '<div class="ap-detail"><section><h2 style="font-size:1.25rem">Videos (' + vids.length + ')</h2>' +
          (vids.length ? '<div class="ap-vids">' + vids.map(function (v) { return '<a href="#video/' + esc(v.id) + '">' + VB.thumbHtml(v) + '<span class="t">' + esc(v.title) + '</span></a>'; }).join('') + '</div>'
            : '<div class="ui-empty">' + UI.icon('video') + '<h3>No videos about ' + esc(p.name) + ' yet</h3><p>Start with an idea below.</p></div>') +
          '<h2 style="font-size:1.25rem;margin-top:24px">💡 Ideas for ' + esc(p.name) + '</h2><div class="pl-idea-grid" data-ideas></div></section>' +
        '<aside class="ui-stack"><div class="ui-card"><h3 style="font-size:1rem">Pitch</h3><p class="small"><b>For:</b> ' + esc(p.audience || '—') + '</p>' +
          (feats.length ? '<ul class="ap-feats small">' + feats.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>' : '<p class="small muted">No features listed yet.</p>') +
          '<p class="small"><b>Call to action:</b> ' + esc(p.cta || '—') + '</p>' + (p.notes ? '<p class="small muted">' + esc(p.notes) + '</p>' : '') + '</div>' +
          '<button class="ui-btn danger sm" data-delapp>' + UI.icon('trash') + 'Delete this app</button></aside></div></div>';
      var have = D.videos.map(function (v) { return v.title.toLowerCase(); });
      view.querySelector('[data-ideas]').innerHTML = VB.ideasFor(p).map(function (i, n) {
        var done = have.indexOf(i.title.toLowerCase()) >= 0;
        return '<div class="pl-idea"><span class="k">' + esc(VB.kind(i.kind).emoji + ' ' + VB.kind(i.kind).label) + '</span><b>' + esc(i.title) + '</b>' +
          (done ? '<span class="ui-badge good">' + UI.icon('check') + 'Planned</span>' : '<button class="ui-btn sm" data-idea="' + n + '">' + UI.icon('plus') + 'Plan it</button>') + '</div>';
      }).join('');
    }
    function draw() {
      if (pid) {
        var p = D.products.filter(function (x) { return x.id === pid; })[0];
        if (p) { document.title = p.name + ' · ' + UI.config.name; return drawOne(p); }
        UI.toast('That app wasn\'t found.'); pid = null;
      }
      drawList();
    }
    view.addEventListener('click', function (e) {
      var t = e.target, b, p = pid && D.products.filter(function (x) { return x.id === pid; })[0];
      if (t.closest('[data-addapp]')) { VB.editProduct(null, function (np) { UI.go('apps', np.id); }); return; }
      if (t.closest('[data-editapp]')) { VB.editProduct(p, function () { load(); }); return; }
      if (t.closest('[data-newvid]')) { VB.newVideo({ products: D.products, product_id: p.id, handle: D.handle }); return; }
      if (t.closest('[data-delapp]')) {
        UI.confirm({ title: 'Delete ' + p.name + '?', text: 'Its videos stay in your library, without an app.', ok: 'Delete', danger: true }).then(function (yes) {
          if (yes) UI.api('product_delete', p.id).then(function () { UI.toast('Deleted', 'ok'); UI.go('apps'); });
        });
        return;
      }
      if ((b = t.closest('[data-idea]'))) {
        var idea = VB.ideasFor(p)[+b.getAttribute('data-idea')], tpl = VB.TEMPLATES.filter(function (x) { return x.key === idea.tpl; })[0];
        UI.busy(b, UI.api('video_create', { title: idea.title, kind: idea.kind, product_id: p.id, status: 'script', script: tpl ? VB.fill(tpl.body, p, D.handle) : '' })).then(function (r) {
          UI.toast('Planned with a script ready', 'ok'); D.videos.unshift(r.video); draw();
        });
      }
    });
    function load() { return UI.api('planner_get').then(function (d) { D = d; draw(); }); }
    return load();
  });
})();

/* ===== auth.html ===== */
(function () {
  var esc = UI.esc;
  var GOOGLE_G = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>' +
    '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>' +
    '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>' +
    '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
  function pw(name, auto) {
    return '<div class="au-pw"><input type="password" name="' + name + '" autocomplete="' + auto + '" required minlength="8">' +
      '<button type="button" data-show>Show</button></div>';
  }
  UI.page('auth', { title: 'Sign in', auth: 'guest' }, function (view, ctx) {
    var mode = ['signup', 'reset'].indexOf(ctx.args[0]) >= 0 ? ctx.args[0] : 'login';
    function draw(msg, isErr) {
      var heading = { login: 'Welcome back', signup: 'Create your account', reset: 'Reset your password' }[mode];
      var sub = { login: 'Sign in to continue to ' + esc(UI.config.name) + '.', signup: 'It\'s free and takes a few seconds.',
        reset: 'We\'ll email you a link to choose a new password.' }[mode];
      view.innerHTML = '<div class="au-wrap"><div class="ui-card au-card">' +
        '<h1>' + heading + '</h1><p class="muted">' + sub + '</p>' +
        (mode !== 'reset' ? '<div class="ui-seg" role="tablist"><button type="button" data-mode="login" class="' + (mode === 'login' ? 'on' : '') + '">Sign in</button>' +
          '<button type="button" data-mode="signup" class="' + (mode === 'signup' ? 'on' : '') + '">Create account</button></div>' : '<div style="height:14px"></div>') +
        '<form class="ui-stack" data-form="' + mode + '" novalidate>' +
        (mode === 'signup' ? '<label class="ui-field"><span>Your name</span><input type="text" name="name" autocomplete="name" required maxlength="60"></label>' : '') +
        '<label class="ui-field"><span>Email</span><input type="email" name="email" autocomplete="email" required></label>' +
        (mode === 'login' ? '<label class="ui-field"><span>Password</span>' + pw('password', 'current-password') + '</label>' : '') +
        (mode === 'signup' ? '<label class="ui-field"><span>Password <em>(at least 8 characters)</em></span>' + pw('password', 'new-password') + '</label>' +
          (window.LegalKit ? '<div>' + LegalKit.consentField() + '</div>' : '') : '') +
        '<div data-msg role="alert"' + (msg ? ' class="' + (isErr ? 'ui-error' : 'ui-note') + '">' + esc(msg) : ' hidden>') + '</div>' +
        '<button class="ui-btn primary block" type="submit">' + { login: 'Sign in', signup: 'Create account', reset: 'Send the link' }[mode] + '</button></form>' +
        (mode !== 'reset' ? '<div class="au-or">or</div><button type="button" class="ui-btn block au-google" data-google>' + GOOGLE_G + 'Continue with Google</button>' : '') +
        '<div class="au-links">' + (mode === 'login' ? '<a data-mode="reset">Forgot your password?</a>' : '<a data-mode="login">' + UI.icon('back') + ' Back to sign in</a>') +
        '<a href="#landing" data-go="landing">About ' + esc(UI.config.name) + '</a></div></div></div>';
      var first = view.querySelector('input');
      if (first && !msg) first.focus();
    }
    view.addEventListener('click', function (e) {
      var m = e.target.closest('[data-mode]');
      if (m) { e.preventDefault(); mode = m.getAttribute('data-mode'); history.replaceState(null, '', '#auth' + (mode === 'login' ? '' : '/' + mode)); draw(); return; }
      var g = e.target.closest('[data-google]');
      if (g) { google(g); return; }
      var s = e.target.closest('[data-show]');
      if (s) { var i = s.parentNode.querySelector('input'); i.type = i.type === 'password' ? 'text' : 'password'; s.textContent = i.type === 'password' ? 'Show' : 'Hide'; }
    });
    view.addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.target, v = UI.formData(form);
      var problem = !/^\S+@\S+\.\S+$/.test(v.email || '') ? 'Please enter a valid email address.'
        : mode !== 'reset' && (v.password || '').length < (mode === 'signup' ? 8 : 1) ? (mode === 'signup' ? 'Please choose a password of at least 8 characters.' : 'Please enter your password.')
        : mode === 'signup' && (v.name || '').trim().length < 2 ? 'Please tell us your name.' : null;
      if (problem) { say(problem, true); return; }
      if (mode === 'signup' && window.LegalKit && !LegalKit.consentChecked(form)) return;  // the kit shows its own message
      UI.busy(form.querySelector('[type=submit]'), UI.auth(mode, v)).then(function (r) {
        if (mode === 'reset' || (r && !r.me)) { mode = 'login'; draw(r && r.message, false); restore({ email: v.email }); }
        else UI.toast(mode === 'signup' ? 'Welcome to ' + UI.config.name + '!' : 'Welcome back!', 'ok');
      }, function (err) { say(err.message, true); });
    });
    // Sign-up asks for the Privacy & Terms tick here too (ticking it is remembered for the new account).
    function google(btn) {
      var form = view.querySelector('form'), v = mode === 'signup' ? UI.formData(form) : {};
      if (mode === 'signup' && window.LegalKit && !LegalKit.consentChecked(form)) return;
      UI.busy(btn, UI.auth('google', { name: (v.name || '').trim() })).then(function () {
        UI.toast(mode === 'signup' ? 'Welcome to ' + UI.config.name + '!' : 'Welcome back!', 'ok');
      }, function (err) { say(err.message, true); });
    }
    function say(msg, isErr) {
      var box = view.querySelector('[data-msg]');
      box.className = isErr ? 'ui-error' : 'ui-note'; box.textContent = msg; box.hidden = false;
    }
    function restore(v) {
      ['name', 'email'].forEach(function (k) { var i = view.querySelector('[name=' + k + ']'); if (i && v[k]) i.value = v[k]; });
    }
    draw();
  });
})();

/* ===== edit.html ===== */
(function () {
  var esc = UI.esc, clamp = VB.clamp;
  var CARD_STYLES = [['app', 'App'], ['classic', 'Classic'], ['bold', 'Bold'], ['minimal', 'Minimal'], ['subscribe', 'Subscribe'], ['endscreen', 'End screen']];
  var BOX_KINDS = [['blur', '🔒 Blur (hide)'], ['spot', '🔦 Spotlight'], ['box', '🟥 Red box']];
  var TEXT_STYLES = [['lower', 'Name tag'], ['callout', 'Callout'], ['caption', 'Subtitle'], ['title', 'Big title'], ['arrow', 'Sticky note']];
  var POS = [['tl', '↖'], ['tc', '↑'], ['tr', '↗'], ['c', '•'], ['bl', '↙'], ['bc', '↓'], ['br', '↘']];

  UI.page('edit', { title: 'Editor', auth: 'user' }, function (view, ctx) {
    var id = ctx.args[0], D = null, E = null, plan = null, srcs = {}, player = null, bar = null, sel = 0, tab = 'scene', dead = false;
    var hist = [], fut = [], dirty = false, saving = false, envs = {}, trackSel = null, cutSel = null, zoomSel = -1, music = null, fileMusic = null;
    var asr = null, wsel = null, lastNow = -1;
    view.innerHTML = '<div class="ui-wrap"><div class="ui-skel" style="height:460px"></div></div>';
    function q(s) { return view.querySelector(s); }
    function takeById(tid) { return D.takes.filter(function (t) { return t.id === tid; })[0]; }
    function scene() { return E.scenes[sel]; }
    function snap() { return JSON.stringify(E); }

    /* ---------------- load */
    function load() {
      return UI.api('video_get', id).then(function (r) {
        D = r; E = VB.starterEdit(r.video, r.takes, r.product, r.handle);
        if (!(r.video.edit && r.video.edit.scenes && r.video.edit.scenes.length)) dirty = true;
        document.title = 'Edit: ' + r.video.title + ' · ' + UI.config.name;
        return Promise.all(r.takes.map(function (t) { return VB.openTake(t).then(function (s) { srcs[t.id] = s; }, function () { /* unreadable */ }); }));
      }).then(function () {
        return VB.vault.get('music:' + id).then(function (m) { fileMusic = music = m; });
      }).then(function () {
        if (E.music.gen) return VB.beat(E.music.gen).then(function (b) { if (b) music = { blob: b, name: E.music.name, gen: E.music.gen }; }, function () { /* no beat */ });
      }).then(function () { draw(); if (dirty) save(); VB.getConfig(); });
    }

    /* ---------------- frame */
    function draw() {
      view.innerHTML = '<div class="ui-wrap ed-wrap"><div class="ed-top"><a class="ui-btn ghost sm" href="#video/' + esc(id) + '">' + UI.icon('back') + 'Video</a>' +
        '<h1>' + esc(D.video.title) + '</h1><span class="ed-save" data-save></span>' +
        '<button class="ui-btn sm" data-undo title="Undo (Ctrl+Z)">' + UI.icon('undo') + '</button><button class="ui-btn sm" data-redo title="Redo (Ctrl+Shift+Z)">' + UI.icon('redo') + '</button>' +
        '<button class="ui-btn primary" data-export>' + UI.icon('download') + 'Export</button></div>' +
        '<div class="ed-main"><div><div class="ed-stage"><div class="cv"><canvas data-cv width="960" height="540"></canvas></div><div data-pbar></div></div></div>' +
        '<div class="ui-card ed-insp"><nav class="ui-tabs">' + [['scene', 'Scene'], ['style', 'Style'], ['text', 'Text'], ['words', 'Words'], ['audio', 'Audio']].map(function (t) {
          return '<button data-tab="' + t[0] + '" class="' + (tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</nav><div class="ed-pane" data-pane></div></div></div>' +
        '<div class="ui-card ed-tl"><div class="ed-tools"><button class="ui-btn sm" data-addtake>' + UI.icon('film') + '<span class="lbl">Add take</span></button>' +
          '<button class="ui-btn sm" data-addcard>' + UI.icon('text') + '<span class="lbl">Title card</span></button><span class="sep"></span>' +
          '<button class="ui-btn sm" data-split title="Split the scene at the playhead (S)">' + UI.icon('split') + '<span class="lbl">Split</span></button>' +
          '<button class="ui-btn sm" data-pauses title="Cut the quiet parts of this take">' + UI.icon('scissors') + '<span class="lbl">Remove pauses</span></button>' +
          '<button class="ui-btn sm" data-zoomhere>' + UI.icon('zoom') + '<span class="lbl">Zoom here</span></button>' +
          '<button class="ui-btn sm" data-texthere>' + UI.icon('plus') + '<span class="lbl">Text here</span></button>' +
          '<span class="ui-spacer"></span><span class="small muted" data-total></span></div>' +
          '<div class="ed-strip" data-strip></div><div class="ed-track-wrap" data-trackwrap></div></div></div>';
      var cv = q('[data-cv]');
      player = VB.Player(cv, { onTime: function (o) { if (bar) bar.update(o); drawTrack(); wordsNow(); }, onState: function (p) { if (bar) bar.state(p); } });
      bar = VB.playerBar(player, { full: true, canvas: cv }); q('[data-pbar]').appendChild(bar.el);
      cv.addEventListener('click', function () { player.toggle(); });
      if (music) player.setMusic(music.blob);
      rebuild(true);
      player.seek(Math.min(0.9, plan.outDur));
      setSave();
    }
    function rebuild(first) {
      plan = VB.plan(E, D.takes, srcs);
      if (player) player.setPlan(plan, !first);
      if (bar) { bar.update(player.o); bar.marks(VB.chapters(plan)); }
      sel = clamp(sel, 0, Math.max(0, E.scenes.length - 1));
      drawStrip(); drawPane(); drawTrackWrap();
      var tot = q('[data-total]'); if (tot) tot.textContent = UI.plural(E.scenes.length, 'scene') + ' · ' + VB.fmtTime(plan.outDur);
    }
    /* Every change goes through here: undo history, redraw, autosave. */
    function change(fn, opts) {
      opts = opts || {};
      var before = snap();
      fn();
      if (snap() === before) return;
      var now = Date.now(), merge = opts.light && change.lastLight && now - change.lastLight < 1500;
      change.lastLight = opts.light ? now : 0;
      if (!merge) { hist.push(before); if (hist.length > 80) hist.shift(); }
      fut = [];
      dirty = true; setSave();
      if (opts.light) { plan = VB.plan(E, D.takes, srcs); player.setPlan(plan, true); drawTrack(); drawStrip(); var tot = q('[data-total]'); if (tot) tot.textContent = UI.plural(E.scenes.length, 'scene') + ' · ' + VB.fmtTime(plan.outDur); }
      else rebuild();
      saveSoon();
    }
    function undo() { if (!hist.length) return; fut.push(snap()); E = JSON.parse(hist.pop()); dirty = true; rebuild(); saveSoon(); setSave(); }
    function redo() { if (!fut.length) return; hist.push(snap()); E = JSON.parse(fut.pop()); dirty = true; rebuild(); saveSoon(); setSave(); }
    function save() {
      if (!dirty || saving) return Promise.resolve();
      saving = true; dirty = false; setSave();
      return UI.apiQuiet('video_update', id, { edit: E, duration: +plan.outDur.toFixed(1) }).then(function (r) { D.video = r.video; },
        function (e) { dirty = true; UI.toast(e.message || 'Couldn\'t save the edit.', 'error'); }).then(function () { saving = false; setSave(); if (dirty) saveSoon(); });
    }
    var saveSoon = VB.debounce(save, 1200);
    function setSave() {
      var el = q('[data-save]'); if (!el) return;
      el.textContent = saving ? 'Saving…' : dirty ? 'Unsaved' : 'Saved ✓';
      var u = q('[data-undo]'), r = q('[data-redo]'); if (u) u.disabled = !hist.length; if (r) r.disabled = !fut.length;
    }

    /* ---------------- scenes strip */
    function drawStrip() {
      var box = q('[data-strip]'); if (!box) return;
      var px = Math.max(1.6, Math.min(8, 900 / Math.max(10, plan.outDur)));
      box.innerHTML = E.scenes.map(function (s, i) {
        var ps = plan.scenes.filter(function (x) { return x.i === i; })[0], dur = ps ? ps.dur : 0, w = Math.max(76, Math.min(320, dur * px));
        if (s.type === 'card') return '<div class="ed-sc' + (i === sel ? ' on' : '') + '" draggable="true" data-sc="' + i + '" style="width:' + w + 'px;background:' + esc(s.style === 'subscribe' || s.style === 'bold' ? '#cc181e' : s.style === 'minimal' ? '#111' : s.style === 'classic' ? '#f4f4f4' : s.color) + ';color:' + (s.style === 'classic' ? '#222' : '#fff') + '">' +
          '<span style="background:none">' + esc((s.emoji ? s.emoji + ' ' : '') + (s.title || 'Title card')) + '</span><b class="d">' + VB.fmtTime(dur) + '</b></div>';
        var t = takeById(s.take), missing = srcs[s.take] && srcs[s.take].missing;
        return '<div class="ed-sc' + (i === sel ? ' on' : '') + (missing ? ' missing' : '') + '" draggable="true" data-sc="' + i + '" style="width:' + w + 'px">' + (t && VB.takeThumb(t) ? '<img src="' + esc(VB.takeThumb(t)) + '" alt="">' : '') +
          '<span>' + esc(t ? t.label : 'Missing take') + '</span><b class="d">' + VB.fmtTime(dur) + '</b></div>';
      }).join('') + (E.scenes.length ? '' : '<p class="ed-empty">No scenes. Add a take or a title card.</p>');
    }

    /* ---------------- the take track */
    function drawTrackWrap() {
      var box = q('[data-trackwrap]'); if (!box) return;
      var s = scene();
      if (!s || s.type !== 'take') { box.innerHTML = s ? '<p class="ed-empty">A title card: edit it in the Scene tab. Select a take in the strip to trim, cut and zoom it.</p>' : ''; return; }
      box.innerHTML = '<canvas class="ed-track" data-track></canvas><div class="ed-tinfo" data-tinfo></div>';
      var src = srcs[s.take];
      if (src && !src.missing && !envs[s.take]) VB.analyze(src).then(function (an) { envs[s.take] = an || { none: true }; drawTrack(); });
      bindTrack(q('[data-track]'));
      drawTrack(); tinfo();
    }
    function tinfo() {
      var box = q('[data-tinfo]'), s = scene(); if (!box || !s || s.type !== 'take') return;
      if (trackSel && trackSel.b - trackSel.a >= 0.15) {
        box.innerHTML = '<b style="color:var(--c-ink)">Selected ' + VB.fmtTime(trackSel.a, true) + '–' + VB.fmtTime(trackSel.b, true) + '</b>' +
          '<button class="ui-btn sm primary" data-sel="cut">' + UI.icon('scissors') + 'Cut it out</button><button class="ui-btn sm" data-sel="keep">Keep only this</button>' +
          '<button class="ui-btn sm" data-sel="zoom">' + UI.icon('zoom') + 'Zoom</button><button class="ui-btn sm" data-sel="text">' + UI.icon('text') + 'Text</button><button class="ui-btn sm ghost" data-sel="clear">Clear</button>';
      } else if (cutSel) {
        box.innerHTML = '<b style="color:var(--c-ink)">Cut ' + VB.fmtTime(cutSel[0], true) + '–' + VB.fmtTime(cutSel[1], true) + '</b><button class="ui-btn sm" data-restore>' + UI.icon('undo') + 'Restore this part</button><button class="ui-btn sm ghost" data-sel="clear">Close</button>';
      } else {
        box.innerHTML = '<span class="ed-legend"><span><i style="background:#9aa3ad"></i>sound</span><span><i style="background:repeating-linear-gradient(45deg,#e62117 0 3px,transparent 3px 6px)"></i>cut</span>' +
          '<span><i style="background:#3ea6ff"></i>zoom</span><span><i style="background:#ffc400"></i>text</span><span><i style="background:#a36bff"></i>blur/spotlight</span><span><i style="background:#e62117;border-radius:50%"></i>click</span><span>⚑ marker</span></span>' +
          '<span>Drag across the track to select a part. Drag the white edges to trim.</span>';
      }
    }
    function sceneZooms(si) { var ps = plan.scenes.filter(function (x) { return x.i === si; })[0]; return ps ? ps.zooms : []; }
    function drawTrack() {
      var c = q('[data-track]'), s = scene(); if (!c || !s || s.type !== 'take') return;
      var t = takeById(s.take); if (!t) return;
      var dpr = window.devicePixelRatio || 1, W = c.clientWidth, H = 132;
      if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
      var g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      var dur = Math.max(0.1, t.duration), X = function (x) { return x / dur * W; };
      var dark = document.documentElement.classList.contains('ui-dark');
      g.fillStyle = dark ? '#1a1a1a' : '#fafafa'; g.fillRect(0, 0, W, H);
      var an = envs[s.take], wy = 40, wh = 64;
      if (an && an.env) {
        var env = an.env, n = Math.floor(W / 2);
        for (var i = 0; i < n; i++) {
          var a = Math.floor(i / n * env.length), b = Math.max(a + 1, Math.floor((i + 1) / n * env.length)), mx = -90;
          for (var j = a; j < b && j < env.length; j++) mx = Math.max(mx, env[j]);
          var h = clamp((mx + 62) / 58, 0.02, 1) * wh;
          g.fillStyle = dark ? '#6c737a' : '#9aa3ad'; g.fillRect(i * 2, wy + (wh - h) / 2, 1.4, h);
        }
      } else {
        g.fillStyle = dark ? '#555' : '#bbb'; g.font = '12px Roboto, Arial'; g.textAlign = 'center';
        g.fillText(an && an.none ? 'No sound in this take' : srcs[s.take] && srcs[s.take].missing ? 'This take is on another computer' : 'Reading the sound…', W / 2, wy + wh / 2 + 4);
      }
      g.fillStyle = 'rgba(0,0,0,' + (dark ? 0.55 : 0.35) + ')';
      g.fillRect(0, 0, X(s['in']), H); g.fillRect(X(s.out), 0, W - X(s.out), H);
      (s.cuts || []).forEach(function (cu) {
        var x0 = X(cu[0]), x1 = X(cu[1]);
        g.save(); g.beginPath(); g.rect(x0, 18, x1 - x0, H - 30); g.clip();
        g.fillStyle = 'rgba(230,33,23,.14)'; g.fillRect(x0, 18, x1 - x0, H - 30);
        g.strokeStyle = 'rgba(230,33,23,.55)'; g.lineWidth = 2;
        for (var k = x0 - H; k < x1; k += 8) { g.beginPath(); g.moveTo(k, H); g.lineTo(k + H, 0); g.stroke(); }
        g.restore();
        if (cutSel && cutSel[0] === cu[0]) { g.strokeStyle = '#e62117'; g.lineWidth = 2; g.strokeRect(x0, 18, x1 - x0, H - 30); }
      });
      sceneZooms(sel).forEach(function (z, zi) { g.fillStyle = zi === zoomSel ? '#167ac6' : '#3ea6ff'; VB.rr(g, X(z.s), 4, Math.max(3, X(z.e) - X(z.s)), 6, 2); g.fill(); });
      (s.texts || []).forEach(function (tx) { g.fillStyle = '#ffc400'; VB.rr(g, X(tx.s), 11, Math.max(3, X(tx.e) - X(tx.s)), 5, 2); g.fill(); });
      (s.boxes || []).forEach(function (bx) { g.fillStyle = '#a36bff'; VB.rr(g, X(bx.s), H - 17, Math.max(3, X(bx.e) - X(bx.s)), 4, 2); g.fill(); });
      VB.wordsOf(t).forEach(function (w) { g.fillStyle = VB.isFiller(w[2]) ? '#e6a700' : (dark ? '#4d6f8f' : '#a8c4dd'); g.fillRect(X(w[0]), wy + wh + 2, Math.max(1, X(w[1]) - X(w[0]) - 1), 2); });
      (t.clicks || []).forEach(function (ck) { g.fillStyle = '#e62117'; g.beginPath(); g.arc(X(ck[0]), H - 7, 3, 0, 7); g.fill(); });
      (t.markers || []).forEach(function (m) {
        var x = X(m[0]); g.strokeStyle = m[1] === 'highlight' ? '#e6a700' : '#e62117'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, 18); g.lineTo(x, H - 14); g.stroke();
        g.fillStyle = g.strokeStyle; g.beginPath(); g.moveTo(x, 18); g.lineTo(x + 9, 22); g.lineTo(x, 26); g.fill();
        g.font = '600 10px Roboto, Arial'; g.textAlign = 'left'; g.fillStyle = dark ? '#ddd' : '#333'; g.fillText(m[2] || '', x + 11, 26);
      });
      g.fillStyle = '#fff'; g.strokeStyle = '#555'; g.lineWidth = 1;
      [s['in'], s.out].forEach(function (v2, k2) { var x = X(v2) + (k2 ? -6 : 0); VB.rr(g, x, 26, 6, H - 50, 2); g.fill(); g.stroke(); });
      if (trackSel) { g.fillStyle = 'rgba(22,122,198,.22)'; g.fillRect(X(trackSel.a), 0, X(trackSel.b) - X(trackSel.a), H); g.strokeStyle = '#167ac6'; g.strokeRect(X(trackSel.a), 0.5, X(trackSel.b) - X(trackSel.a), H - 1); }
      var L = plan && VB.locate(plan, player ? player.o : 0);
      if (L && L.s.i === sel && L.srcT != null) { var px = X(L.srcT); g.fillStyle = '#e62117'; g.fillRect(px - 1, 0, 2, H); g.beginPath(); g.moveTo(px - 6, 0); g.lineTo(px + 6, 0); g.lineTo(px, 8); g.fill(); }
      g.fillStyle = dark ? '#aaa' : '#666'; g.font = '10px Roboto, Arial'; g.textAlign = 'left';
      var step = dur > 600 ? 60 : dur > 120 ? 15 : dur > 40 ? 5 : 2;
      for (var tt = 0; tt <= dur; tt += step) { g.fillText(VB.fmtTime(tt), X(tt) + 2, H - 1); }
    }
    function bindTrack(c) {
      var drag = null;
      function tAt(e) { var r = c.getBoundingClientRect(), t = takeById(scene().take); return clamp((e.clientX - r.left) / r.width, 0, 1) * t.duration; }
      function near(e, v) { var r = c.getBoundingClientRect(), t = takeById(scene().take); return Math.abs(e.clientX - r.left - v / t.duration * r.width) < 8; }
      c.addEventListener('pointerdown', function (e) {
        var s = scene(); if (!s || s.type !== 'take') return;
        try { c.setPointerCapture(e.pointerId); } catch (x) { /* synthetic */ }
        if (near(e, s['in'])) drag = { k: 'in', before: snap() };
        else if (near(e, s.out)) drag = { k: 'out', before: snap() };
        else { var t0 = tAt(e); drag = { k: 'sel', a: t0 }; trackSel = { a: t0, b: t0 }; cutSel = null; }
      });
      c.addEventListener('pointermove', function (e) {
        if (!drag) { var s = scene(); c.style.cursor = s && s.type === 'take' && (near(e, s['in']) || near(e, s.out)) ? 'ew-resize' : 'crosshair'; return; }
        var t = tAt(e), s2 = scene();
        if (drag.k === 'in') { s2['in'] = +clamp(t, 0, s2.out - 0.3).toFixed(2); drag.moved = true; drawTrack(); }
        else if (drag.k === 'out') { s2.out = +clamp(t, s2['in'] + 0.3, takeById(s2.take).duration).toFixed(2); drag.moved = true; drawTrack(); }
        else { trackSel = { a: Math.min(drag.a, t), b: Math.max(drag.a, t) }; drawTrack(); }
      });
      c.addEventListener('pointerup', function (e) {
        if (!drag) return;
        var d = drag; drag = null;
        if (d.k === 'in' || d.k === 'out') {
          if (d.moved) { var after = snap(); E = JSON.parse(d.before); change(function () { E = JSON.parse(after); }); }
          return;
        }
        if (!trackSel || trackSel.b - trackSel.a < 0.15) {
          var t = tAt(e), s = scene();
          trackSel = null;
          cutSel = (s.cuts || []).filter(function (cu) { return t >= cu[0] && t <= cu[1]; })[0] || null;
          if (!cutSel) seekSrc(t);
          drawTrack(); tinfo();
          return;
        }
        trackSel.a = +trackSel.a.toFixed(2); trackSel.b = +trackSel.b.toFixed(2);
        tinfo();
      });
    }
    function seekSrc(t) {
      var si = plan.scenes.map(function (x) { return x.i; }).indexOf(sel); if (si < 0) return;
      var o = VB.outOf(plan, si, t);
      if (o < 0) { var ps = plan.scenes[si], best = ps.segs.filter(function (g) { return g.a >= t; })[0] || ps.segs[ps.segs.length - 1]; o = ps.start + best.o; }
      player.seek(o);
    }
    function playheadSrc() {
      var L = VB.locate(plan, player.o);
      if (L && L.s.i === sel && L.srcT != null) return L.srcT;
      var s = scene(); return s && s.type === 'take' ? s['in'] : 0;
    }
    function selectScene(i, seek) {
      sel = i; trackSel = null; cutSel = null; zoomSel = -1; wsel = null; lastNow = -1;
      drawStrip(); drawPane(); drawTrackWrap();
      if (seek) { var ps = plan.scenes.filter(function (x) { return x.i === i; })[0]; if (ps) player.seek(ps.start + 0.01); }
    }

    /* ---------------- inspector */
    function drawPane() {
      var box = q('[data-pane]'); if (!box) return;
      view.querySelectorAll('[data-tab]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === tab); });
      box.innerHTML = ({ scene: paneScene, style: paneStyle, text: paneText, words: paneWords, audio: paneAudio })[tab]();
      if (tab === 'scene') focusThumbs();
      if (tab === 'text') boxThumbs();
      if (tab === 'words') { lastNow = -1; wordsNow(); }
    }
    function seg(name, list, cur) { return '<div class="ui-seg">' + list.map(function (o) { return '<button data-set="' + name + '" data-v="' + esc(o[0]) + '" class="' + (String(cur) === String(o[0]) ? 'on' : '') + '">' + o[1] + '</button>'; }).join('') + '</div>'; }
    function chips(name, list, cur) { return '<div class="ed-chips">' + list.map(function (o) { return '<button data-set="' + name + '" data-v="' + esc(o[0]) + '" class="' + (String(cur) === String(o[0]) ? 'on' : '') + '">' + o[1] + '</button>'; }).join('') + '</div>'; }
    function moveBtns() {
      return '<div class="ui-row"><button class="ui-btn sm" data-move="-1"' + (sel === 0 ? ' disabled' : '') + '>◀ Earlier</button><button class="ui-btn sm" data-move="1"' + (sel >= E.scenes.length - 1 ? ' disabled' : '') + '>Later ▶</button>' +
        '<button class="ui-btn sm" data-dup>' + UI.icon('copy') + 'Duplicate</button><button class="ui-btn sm danger" data-delsc>' + UI.icon('trash') + '</button></div>';
    }
    function paneScene() {
      var s = scene();
      if (!s) return '<p class="ed-empty">Add a take or a title card from the toolbar under the preview.</p>';
      if (s.type === 'card') {
        return '<div><h4>Title card</h4>' + chips('card.style', CARD_STYLES, s.style) + '</div>' +
          '<label class="ui-field"><span>Title</span><input type="text" data-f="card.title" maxlength="90" value="' + esc(s.title) + '"></label>' +
          '<label class="ui-field"><span>Second line</span><input type="text" data-f="card.sub" maxlength="140" value="' + esc(s.sub) + '"></label>' +
          '<div class="ed-2"><label class="ui-field"><span>Emoji</span><input type="text" data-f="card.emoji" maxlength="8" value="' + esc(s.emoji) + '"></label>' +
          '<label class="ui-field"><span>Colour</span><input type="color" data-f="card.color" value="' + esc(s.color) + '" style="width:100%;height:36px;padding:2px"></label></div>' +
          '<label class="ui-field"><span>Length: ' + s.dur + ' s</span><input type="range" min="1" max="' + (s.style === 'endscreen' ? 20 : 10) + '" step="0.5" data-f="card.dur" value="' + s.dur + '"></label>' +
          (s.style === 'endscreen' ? '<p class="small muted" style="margin:0">YouTube end screens run 5 to 20 seconds. In YouTube Studio, put your end screen videos and the subscribe button over the boxes.</p>' : '') + moveBtns();
      }
      var t = takeById(s.take) || { duration: 0, label: '?', clicks: [] }, zs = sceneZooms(sel), manual = s.zooms && s.zooms.length;
      var cutTotal = (s.cuts || []).reduce(function (a, c) { return a + (c[1] - c[0]); }, 0);
      return '<div><h4>' + esc(t.label) + '</h4><div class="ed-2"><label class="ui-field"><span>Starts at</span><input type="number" step="0.1" min="0" data-f="sc.in" value="' + s['in'] + '"></label>' +
        '<label class="ui-field"><span>Ends at</span><input type="number" step="0.1" min="0" data-f="sc.out" value="' + s.out + '"></label></div>' +
        '<p class="small muted" style="margin:6px 0 0">' + UI.plural((s.cuts || []).length, 'cut') + (cutTotal ? ' (' + cutTotal.toFixed(1) + ' s removed)' : '') +
          ((s.cuts || []).length ? ' · <button class="vb-link" style="background:none;border:0;padding:0;cursor:pointer;font:inherit" data-clearcuts>restore all</button>' : '') + '</p></div>' +
        '<div class="ed-2"><label class="ui-field"><span>Speed</span><select data-f="sc.speed">' + [0.5, 0.75, 1, 1.25, 1.5, 2].map(function (v) { return '<option value="' + v + '"' + (s.speed === v ? ' selected' : '') + '>' + v + '×</option>'; }).join('') + '</select></label>' +
        '<label class="ui-field"><span>Layout</span><select data-f="sc.layout"><option value="">Same as video</option>' + Object.keys(VB.LAYOUTS).map(function (k) { return '<option value="' + k + '"' + (s.layout === k ? ' selected' : '') + '>' + VB.LAYOUTS[k][0] + '</option>'; }).join('') + '</select></label></div>' +
        (t.mode === 'screen_cam' ? '<div><h4>Camera in this scene</h4>' + seg('sc.cam', [['', 'Default'], ['hide', 'Hide'], ['tl', '↖'], ['tr', '↗'], ['bl', '↙'], ['br', '↘']], s.cam ? (s.cam.hidden ? 'hide' : s.cam.pos || '') : '') + '</div>' : '') +
        '<label class="ui-check"><input type="checkbox" data-f="sc.mute"' + (s.mute ? ' checked' : '') + '><span>Mute this scene</span></label>' +
        (t.mode !== 'cam' ? '<div><h4>Zooms</h4>' + (manual ? '' : '<p class="small muted" style="margin:0 0 8px">' + (E.zoom.auto ? (zs.length ? UI.plural(zs.length, 'zoom') + ' made from your ' + UI.plural(t.clicks.length, 'click') + '.' : 'No clicks recorded, so no automatic zooms.') : 'Automatic zooms are off (Style tab).') + '</p>') +
          zs.map(function (z, zi) {
            return '<div class="ed-zoom' + (zi === zoomSel ? ' sel' : '') + '" data-zi="' + zi + '"><div class="ui-row between"><b class="small">' + (manual ? 'Zoom ' + (zi + 1) : 'Auto zoom ' + (zi + 1)) + ' · ' + VB.fmtTime(z.s, true) + '–' + VB.fmtTime(z.e, true) + '</b>' +
              (manual ? '<button class="ui-btn ghost sm" data-zdel aria-label="Delete zoom">' + UI.icon('trash') + '</button>' : '<button class="ui-btn ghost sm" data-zgo>' + UI.icon('play') + '</button>') + '</div>' +
              (manual ? '<label class="ui-field"><span>Zoom ' + z.z.toFixed(1) + '×</span><input type="range" min="1.2" max="3" step="0.1" data-zz value="' + z.z + '"></label>' +
                '<div class="ed-2"><label class="ui-field"><span>From</span><input type="number" step="0.1" data-zs value="' + z.s + '"></label><label class="ui-field"><span>To</span><input type="number" step="0.1" data-ze value="' + z.e + '"></label></div>' +
                '<div class="ed-focus" data-focus><canvas width="320" height="180"></canvas><b></b><i></i></div><p class="small muted" style="margin:0">Click the picture to choose where to zoom.</p>' : '') + '</div>';
          }).join('') +
          '<div class="ui-row" style="margin-top:8px">' + (manual ? '<button class="ui-btn sm" data-zauto>Back to automatic</button>' : (zs.length ? '<button class="ui-btn sm" data-zmanual>' + UI.icon('edit') + 'Adjust them</button>' : '')) +
          '<button class="ui-btn sm" data-zoomhere>' + UI.icon('zoom') + 'Add zoom at playhead</button></div></div>' : '') +
        moveBtns();
    }
    function focusThumbs() {
      var s = scene(); if (!s || s.type !== 'take' || !s.zooms || !s.zooms.length) return;
      var src = srcs[s.take];
      view.querySelectorAll('[data-zi]').forEach(function (el) {
        var zi = +el.getAttribute('data-zi'), z = s.zooms[zi], f = el.querySelector('[data-focus]'); if (!f || !z) return;
        var c = f.querySelector('canvas'), g = c.getContext('2d');
        g.fillStyle = '#222'; g.fillRect(0, 0, 320, 180);
        if (src && !src.missing) {
          if (src.kind === 'sample') { src.frame((z.s + z.e) / 2); }
          try { var img = src.main.img, k = Math.min(320 / src.main.w, 180 / src.main.h); g.drawImage(img, (320 - src.main.w * k) / 2, (180 - src.main.h * k) / 2, src.main.w * k, src.main.h * k); } catch (e) { /* not ready */ }
        }
        var p = z.pts[0], dot = f.querySelector('i'), box = f.querySelector('b');
        dot.style.left = (p[1] * 100) + '%'; dot.style.top = (p[2] * 100) + '%';
        var w = 100 / z.z, h = 100 / z.z;
        box.style.width = w + '%'; box.style.height = h + '%';
        box.style.left = clamp(p[1] * 100 - w / 2, 0, 100 - w) + '%'; box.style.top = clamp(p[2] * 100 - h / 2, 0, 100 - h) + '%';
      });
    }
    function paneStyle() {
      var c = E.cam;
      return '<div><h4>Size</h4>' + seg('aspect', [['16:9', '16:9 YouTube'], ['9:16', '9:16 Shorts/Reels'], ['1:1', '1:1 Square']], E.aspect) + '</div>' +
        '<label class="ui-field"><span>Layout</span><select data-f="layout">' + Object.keys(VB.LAYOUTS).map(function (k) { return '<option value="' + k + '"' + (E.layout === k ? ' selected' : '') + '>' + VB.LAYOUTS[k][0] + ': ' + VB.LAYOUTS[k][1] + '</option>'; }).join('') + '</select></label>' +
        '<div><h4>Background</h4><div class="ed-bgs">' + Object.keys(VB.BGS).map(function (k) {
          var b = VB.BGS[k], bg = b ? 'linear-gradient(135deg,' + b[0] + ',' + b[1] + ')' : 'repeating-linear-gradient(45deg,#666 0 4px,#999 4px 8px)';
          return '<button data-set="bg" data-v="' + k + '" class="' + (E.bg === k ? 'on' : '') + '" style="background:' + bg + '" title="' + esc(VB.BG_NAMES[k]) + '" aria-label="' + esc(VB.BG_NAMES[k]) + '"></button>'; }).join('') + '</div></div>' +
        '<div class="ed-2"><label class="ui-field"><span>Padding</span><input type="range" min="0" max="0.16" step="0.01" data-f="pad" value="' + E.pad + '"></label>' +
        '<label class="ui-field"><span>Rounded corners</span><input type="range" min="0" max="40" step="1" data-f="radius" value="' + E.radius + '"></label></div>' +
        '<div><h4>Camera bubble</h4>' + seg('cam.shape', [['circle', 'Circle'], ['rounded', 'Rounded'], ['square', 'Square']], c.shape) +
          '<div class="ed-2" style="margin-top:8px">' + seg('cam.pos', [['tl', '↖'], ['tr', '↗'], ['bl', '↙'], ['br', '↘']], c.pos) +
          '<label class="ui-check"><input type="checkbox" data-f="cam.hidden"' + (c.hidden ? ' checked' : '') + '><span>Hide everywhere</span></label></div>' +
          '<label class="ui-field" style="margin-top:8px"><span>Size</span><input type="range" min="0.12" max="0.45" step="0.01" data-f="cam.size" value="' + c.size + '"></label>' +
          '<label class="ui-check"><input type="checkbox" data-f="cam.border"' + (c.border !== false ? ' checked' : '') + '><span>White border</span></label></div>' +
        '<div><h4>Zoom on clicks</h4><label class="ui-check"><input type="checkbox" data-f="zoom.auto"' + (E.zoom.auto ? ' checked' : '') + '><span>Zoom in where you clicked (needs the extension while recording a tab)</span></label>' +
          '<label class="ui-field"><span>How close: ' + E.zoom.level.toFixed(1) + '×</span><input type="range" min="1.2" max="3" step="0.1" data-f="zoom.level" value="' + E.zoom.level + '"></label></div>' +
        '<div><h4>Between scenes</h4>' + seg('transition', [['cut', 'Cut'], ['fade', 'Fade'], ['dip', 'Flash']], E.transition) + '</div>' +
        '<label class="ui-field"><span>Watermark</span><input type="text" data-f="watermark" maxlength="40" placeholder="' + esc(D.handle || '@yourchannel') + '" value="' + esc(E.watermark) + '"></label>' +
        '<label class="ui-check"><input type="checkbox" data-f="progress"' + (E.progress ? ' checked' : '') + '><span>Red progress bar at the bottom (great for Shorts)</span></label>';
    }
    function paneText() {
      var s = scene();
      if (!s || s.type !== 'take') return '<p class="ed-empty">Text goes on takes. Select a take in the strip (title cards have their own text in the Scene tab).</p>';
      var list = s.texts || [], boxes = s.boxes || [], tk = takeById(s.take) || {};
      var boxHtml = '<div><h4>Hide or highlight a spot</h4>' + chips('newbox', BOX_KINDS, '') + '<p class="small muted" style="margin:6px 0 0">Blur passwords, emails and API keys before you publish. A spotlight dims everything else; a red box points at a button.</p></div>' +
        boxes.map(function (bx, i) {
          var src = srcs[s.take], ar = src && src.main ? src.main.w / src.main.h : 16 / 9;
          return '<div class="ed-txt" data-bi="' + i + '"><div class="ui-row between"><b class="small">' + esc(BOX_KINDS.filter(function (k) { return k[0] === bx.kind; })[0][1]) + ' · ' + VB.fmtTime(bx.s, true) + '–' + VB.fmtTime(bx.e, true) + '</b>' +
            '<span><button class="ui-btn ghost sm" data-bwhole title="From the start to the end of this scene">Whole scene</button><button class="ui-btn ghost sm" data-bdel aria-label="Delete">' + UI.icon('trash') + '</button></span></div>' +
            '<div class="ed-focus ed-boxpick" data-boxpick style="aspect-ratio:' + ar.toFixed(4) + '"><canvas width="320" height="' + Math.round(320 / ar) + '"></canvas><b></b></div>' +
            '<p class="small muted" style="margin:0">Drag on the picture to draw the area.</p>' + seg('box.kind:' + i, BOX_KINDS.map(function (k) { return [k[0], k[1].split(' ')[0]]; }), bx.kind) +
            '<div class="ed-2"><label class="ui-field"><span>From</span><input type="number" step="0.1" data-bf="s" value="' + bx.s + '"></label><label class="ui-field"><span>To</span><input type="number" step="0.1" data-bf="e" value="' + bx.e + '"></label></div></div>';
        }).join('') + (tk.mode === 'cam' ? '' : '');
      return boxHtml + '<div><h4>Add text at the playhead</h4>' + chips('newtext', TEXT_STYLES, '') + '<p class="small muted" style="margin:6px 0 0">Name tags introduce you; callouts point at features; subtitles say it in words.</p></div>' +
        (list.length ? list.map(function (tx, i) {
          return '<div class="ed-txt" data-ti="' + i + '"><div class="ui-row between"><b class="small">' + esc(TEXT_STYLES.filter(function (x) { return x[0] === tx.style; })[0][1]) + ' · ' + VB.fmtTime(tx.s, true) + '–' + VB.fmtTime(tx.e, true) + '</b>' +
            '<span><button class="ui-btn ghost sm" data-tgo aria-label="Play from here">' + UI.icon('play') + '</button><button class="ui-btn ghost sm" data-tdel aria-label="Delete">' + UI.icon('trash') + '</button></span></div>' +
            '<input type="text" data-tf="text" maxlength="140" value="' + esc(tx.text) + '">' +
            (tx.style === 'lower' || tx.style === 'callout' ? '<input type="text" data-tf="sub" maxlength="140" placeholder="Second line (optional)" value="' + esc(tx.sub) + '">' : '') +
            '<div class="ed-2"><label class="ui-field"><span>From</span><input type="number" step="0.1" data-tf="s" value="' + tx.s + '"></label><label class="ui-field"><span>To</span><input type="number" step="0.1" data-tf="e" value="' + tx.e + '"></label></div>' +
            (tx.style !== 'title' ? '<div class="ed-chips">' + POS.map(function (p) { return '<button data-tpos="' + p[0] + '" class="' + (tx.pos === p[0] ? 'on' : '') + '">' + p[1] + '</button>'; }).join('') + '</div>' : '') + '</div>';
        }).join('') : '<p class="ed-empty">No text on this take yet.</p>');
    }
    function paneAudio() {
      var gen = E.music.gen || '';
      return '<div><h4>Voice</h4><label class="ui-field"><span>Voice volume: ' + Math.round((E.voice == null ? 1 : E.voice) * 100) + '%</span><input type="range" min="0" max="2" step="0.05" data-f="voice" value="' + (E.voice == null ? 1 : E.voice) + '"></label>' +
          '<label class="ui-check"><input type="checkbox" data-f="voice_fx"' + (E.voice_fx === 'clean' ? ' checked' : '') + '><span>Clean voice: less rumble, clearer, more even (in the export)</span></label></div>' +
        '<div><h4>Background music</h4><div class="ed-beats"><button data-beat="" class="' + (!gen && !fileMusic ? 'on' : '') + '">🔇 No music<small>Just your voice</small></button>' +
          VB.BEATS.map(function (b) { return '<button data-beat="' + b.key + '" class="' + (gen === b.key ? 'on' : '') + '">' + b.emoji + ' ' + esc(b.name) + '<small>' + esc(b.blurb) + '</small></button>'; }).join('') + '</div>' +
          '<p class="small muted" style="margin:8px 0">Buddy beats are made by the app, free to use anywhere. Or use your own track:</p>' +
          (music && !gen ? '<p class="small" style="margin:0 0 8px">' + UI.icon('music') + ' ' + esc(music.name || E.music.name || 'music') + '</p>' : '') +
          '<div class="ui-row"><label class="ui-btn sm" style="cursor:pointer">' + UI.icon('upload') + (fileMusic ? 'Change file' : 'Choose a music file') + '<input type="file" accept="audio/*" data-music hidden></label>' + (music ? '<button class="ui-btn sm ghost" data-nomusic>Remove music</button>' : '') + '</div>' +
          '<label class="ui-field" style="margin-top:8px"><span>Music volume: ' + Math.round(E.music.vol * 100) + '%</span><input type="range" min="0" max="1" step="0.05" data-f="music.vol" value="' + E.music.vol + '"></label>' +
          '<label class="ui-check"><input type="checkbox" data-f="music.duck"' + (E.music.duck ? ' checked' : '') + '><span>Quieter while you talk (in the export)</span></label></div>' +
        '<div><h4>Sound effects</h4><label class="ui-check"><input type="checkbox" data-f="sfx.clicks"' + (E.sfx.clicks ? ' checked' : '') + '><span>A soft click sound on every recorded click</span></label>' +
          '<label class="ui-check"><input type="checkbox" data-f="sfx.whoosh"' + (E.sfx.whoosh ? ' checked' : '') + '><span>A whoosh between scenes</span></label>' +
          '<label class="ui-field" style="margin-top:6px"><span>Effects volume: ' + Math.round(E.sfx.vol * 100) + '%</span><input type="range" min="0" max="1" step="0.05" data-f="sfx.vol" value="' + E.sfx.vol + '"></label></div>' +
        '<div><h4>Remove pauses everywhere</h4><p class="small muted" style="margin:0 0 8px">Cuts every silence longer than this from all takes, keeping a little air around your words.</p>' +
          '<label class="ui-field"><span>Pauses longer than <b data-gapv>' + (UI.store.get('ed.gap', 0.8)).toFixed(1) + '</b> s</span><input type="range" min="0.4" max="2.5" step="0.1" data-gap value="' + UI.store.get('ed.gap', 0.8) + '"></label>' +
          '<button class="ui-btn sm" data-pausesall>' + UI.icon('scissors') + 'Remove pauses in every take</button></div>';
    }

    /* ---------------- words: captions + transcript */
    function wordState(s, w) {
      var mid = (w[0] + w[1]) / 2;
      if (mid < s['in'] || mid > s.out) return 'cut';
      return (s.cuts || []).some(function (c) { return mid >= c[0] && mid <= c[1]; }) ? 'cut' : '';
    }
    function paneWords() {
      var c = E.captions, s = scene();
      var caps = '<div><h4>Captions on the video</h4><label class="ui-check"><input type="checkbox" data-f="captions.on"' + (c.on ? ' checked' : '') + '><span>Show captions (drawn into the exported video)</span></label>' +
        (c.on ? '<div style="margin-top:8px">' + chips('captions.style', VB.CAPTION_STYLES, c.style) + '</div><div style="margin-top:8px">' + seg('captions.pos', [['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']], c.pos) + '</div>' +
          '<div class="ed-2" style="margin-top:8px"><label class="ui-field"><span>Size</span><input type="range" min="0.6" max="1.8" step="0.05" data-f="captions.size" value="' + c.size + '"></label>' +
          '<label class="ui-field"><span>Highlight</span><input type="color" data-f="captions.color" value="' + esc(c.color) + '" style="width:100%;height:36px;padding:2px"></label></div>' +
          '<label class="ui-check"><input type="checkbox" data-f="captions.upper"' + (c.upper ? ' checked' : '') + '><span>ALL CAPS</span></label>' : '') + '</div>';
      if (!s || s.type !== 'take') return caps + '<p class="ed-empty">Select a take in the strip to see and edit its words.</p>';
      var t = takeById(s.take) || {}, ws = VB.wordsOf(t), src = srcs[s.take];
      if (asr && asr.tid === t.id) {
        return caps + '<div class="ed-asr"><h4>Writing down “' + esc(t.label) + '”…</h4><div class="ed-prog" data-asrp><i style="width:' + (asr.f * 100).toFixed(1) + '%"></i></div><p class="small muted" data-asrm style="margin:0">' + esc(asr.msg) + '</p></div>';
      }
      if (!ws.length) {
        var models = Object.keys(VB.MODELS).map(function (k) { return '<option value="' + k + '"' + (UI.store.get('ed.asr', 'en') === k ? ' selected' : '') + '>' + esc(VB.MODELS[k].label) + '</option>'; }).join('');
        return caps + '<div class="ed-asr"><h4>Words in “' + esc(t.label) + '”</h4><p class="small" style="margin:0">Write down what you said, right here on your computer. Then cut by deleting words, remove the “um”s, and show captions.</p>' +
          (t.sample ? '' : '<label class="ui-field"><span>Speech model</span><select data-asrmodel>' + models + '</select></label>') +
          '<div class="ui-row"><button class="ui-btn primary sm" data-asr' + (src && src.missing ? ' disabled' : '') + '>' + UI.icon('text') + 'Write captions</button>' +
          (D.video.script && !t.sample ? '<button class="ui-btn sm" data-align title="Quick and approximate: spreads your script over the parts where you speak">Use my script instead</button>' : '') + '</div>' +
          (t.sample ? '' : '<p class="small muted" style="margin:0">The first time, your browser downloads the speech model (once, from Hugging Face). Your recording never leaves this computer.</p>') + '</div>';
      }
      var fillers = VB.fillerCuts(ws, s['in'], s.out).filter(function (cu) { return !(s.cuts || []).some(function (x) { return cu[0] >= x[0] - 0.01 && cu[1] <= x[1] + 0.01; }); }).length;
      var html = '', prevEnd = null;
      ws.forEach(function (w, i) {
        if (prevEnd != null && w[0] - prevEnd > 1.3) html += '<br><br>';
        var cls = [wordState(s, w), VB.isFiller(w[2]) ? 'fill' : '', wsel && i >= wsel.a && i <= wsel.b ? 'sel' : ''].filter(Boolean).join(' ');
        html += '<span data-w="' + i + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(w[2]) + '</span> ';
        prevEnd = w[1];
      });
      return caps + '<div><div class="ui-row between"><h4 style="margin:0">Words in “' + esc(t.label) + '”</h4><span class="small muted">' + UI.plural(ws.length, 'word') + (t.words.src === 'script' ? ' · from the script' : '') + '</span></div>' +
        '<div class="ed-words" data-words style="margin-top:6px">' + html + '</div>' +
        '<div class="ed-wbar" data-wbar style="margin-top:6px">' + wbar(ws) + '</div>' +
        '<div class="ui-row" style="margin-top:6px"><button class="ui-btn sm" data-fillers' + (fillers ? '' : ' disabled') + '>' + UI.icon('scissors') + 'Remove filler words' + (fillers ? ' (' + fillers + ')' : '') + '</button>' +
          '<button class="ui-btn sm" data-srt title="Subtitles for YouTube (matches this edit)">' + UI.icon('download') + '.srt</button>' +
          '<button class="ui-btn sm ghost" data-asr>' + UI.icon('undo') + 'Write again</button><button class="ui-btn sm ghost danger" data-wdel aria-label="Delete the words">' + UI.icon('trash') + '</button></div></div>';
    }
    function wbar(ws) {
      if (!wsel) return '<span class="small muted">Click a word to jump there. Shift-click another to select the words between, then cut them (or press Delete).</span>';
      var n = wsel.b - wsel.a + 1;
      return '<b>' + UI.plural(n, 'word') + ' selected</b><button class="ui-btn sm primary" data-wcut>' + UI.icon('scissors') + 'Cut</button><button class="ui-btn sm" data-wkeep>' + UI.icon('undo') + 'Restore</button>' +
        '<button class="ui-btn sm" data-wfix>' + UI.icon('edit') + 'Fix the words</button><button class="ui-btn sm ghost" data-wclear aria-label="Clear the selection">✕</button>';
    }
    function wordsNow() {
      if (tab !== 'words') return;
      var box = q('[data-words]'); if (!box) return;
      var s = scene(), L = plan && player && VB.locate(plan, player.o), i = -1;
      if (L && s && L.s.i === sel && L.srcT != null) { var ws = VB.wordsOf(takeById(s.take)); for (var k = 0; k < ws.length; k++) { if (L.srcT >= ws[k][0] && L.srcT < ws[k][1] + 0.05) { i = k; break; } if (ws[k][0] > L.srcT) break; } }
      if (i === lastNow) return;
      var old = box.querySelector('.now'); if (old) old.classList.remove('now');
      var el = i >= 0 && box.querySelector('[data-w="' + i + '"]');
      if (el) { el.classList.add('now'); if (player.playing && (el.offsetTop < box.scrollTop || el.offsetTop > box.scrollTop + box.clientHeight - 30)) box.scrollTop = el.offsetTop - 40; }
      lastNow = i;
    }
    function saveWords(t, words) {
      return UI.api('take_update', t.id, { words: words }).then(function (r) { Object.assign(t, r.take); return t; });
    }
    function writeWords(t, how) {
      var src = srcs[t.id];
      if (!src || src.missing) { UI.toast('This take is on another computer: re-link its file first.', 'error'); return; }
      asr = { tid: t.id, f: 0.02, msg: 'Starting…' }; wsel = null; drawPane();
      var job = how === 'script'
        ? VB.analyze(src).then(function (an) { var w = VB.alignScript(D.video.script, an, 0, t.duration); if (!w.length) throw new Error('The script has no spoken lines yet.'); return { src: 'script', lang: 'en', words: w }; })
        : VB.transcribe(src, UI.store.get('ed.asr', 'en'), function (f, msg) {
          if (!asr || asr.tid !== t.id) return; asr.f = f; asr.msg = msg;
          var p = q('[data-asrp] i'), m2 = q('[data-asrm]'); if (p) p.style.width = (f * 100).toFixed(1) + '%'; if (m2) m2.textContent = msg;
        });
      job.then(function (wd) {
        if (!wd.words.length) throw new Error('No speech found in this take.');
        return saveWords(t, wd);
      }).then(function () {
        asr = null;
        var turnOn = !E.captions.on;
        if (turnOn) change(function () { E.captions.on = true; }); else { rebuild(); }
        UI.toast('Wrote ' + UI.plural(VB.wordsOf(t).length, 'word') + (turnOn ? '. Captions are on.' : ''), 'ok');
      }, function (err) { asr = null; if (!dead) drawPane(); UI.toast(err.message || 'Couldn\'t write the captions.', 'error'); });
    }
    function downloadSrt() {
      var cues = VB.planCues(plan);
      if (!cues.length) { UI.toast('No words in this edit yet. Write captions for a take first.'); return; }
      VB.download(new Blob([VB.toSRT(cues)], { type: 'application/x-subrip' }), VB.slug(D.video.title) + '.srt');
    }
    function boxThumbs() {
      var s = scene(); if (!s || s.type !== 'take' || !s.boxes || !s.boxes.length) return;
      var src = srcs[s.take];
      view.querySelectorAll('[data-bi]').forEach(function (el) {
        var bx = s.boxes[+el.getAttribute('data-bi')], f = el.querySelector('[data-boxpick]'); if (!f || !bx) return;
        var c = f.querySelector('canvas'), g = c.getContext('2d');
        g.fillStyle = '#222'; g.fillRect(0, 0, c.width, c.height);
        if (src && !src.missing) {
          if (src.kind === 'sample') src.frame((bx.s + bx.e) / 2);
          try { g.drawImage(src.main.img, 0, 0, c.width, c.height); } catch (e) { /* not ready */ }
        }
        var b = f.querySelector('b'); b.style.left = bx.x * 100 + '%'; b.style.top = bx.y * 100 + '%'; b.style.width = bx.w * 100 + '%'; b.style.height = bx.h * 100 + '%';
      });
    }
    function addBox(kind) {
      var s = scene(); if (!s || s.type !== 'take') { UI.toast('Select a take first.'); return; }
      var t = playheadSrc(), dur = takeById(s.take).duration;
      change(function () {
        s.boxes = s.boxes || [];
        s.boxes.push({ id: VB.uid('b').slice(0, 20), s: +Math.max(0, t).toFixed(2), e: +Math.min(dur, t + (kind === 'blur' ? 6 : 3.5)).toFixed(2), x: 0.35, y: 0.35, w: 0.3, h: 0.2, kind: kind });
      });
      tab = 'text'; drawPane();
    }
    function bindBoxPick() {
      var drag = null;
      view.addEventListener('pointerdown', function (e) {
        var f = e.target.closest && e.target.closest('[data-boxpick]'); if (!f) return;
        var r = f.getBoundingClientRect(), bi = +f.closest('[data-bi]').getAttribute('data-bi');
        try { f.setPointerCapture(e.pointerId); } catch (x) { /* synthetic */ }
        drag = { f: f, r: r, bi: bi, x0: clamp((e.clientX - r.left) / r.width, 0, 1), y0: clamp((e.clientY - r.top) / r.height, 0, 1) };
        drag.box = { x: drag.x0, y: drag.y0, w: 0, h: 0 };
        e.preventDefault();
      });
      view.addEventListener('pointermove', function (e) {
        if (!drag) return;
        var x = clamp((e.clientX - drag.r.left) / drag.r.width, 0, 1), y = clamp((e.clientY - drag.r.top) / drag.r.height, 0, 1);
        drag.box = { x: Math.min(x, drag.x0), y: Math.min(y, drag.y0), w: Math.abs(x - drag.x0), h: Math.abs(y - drag.y0) };
        var b = drag.f.querySelector('b'); b.style.left = drag.box.x * 100 + '%'; b.style.top = drag.box.y * 100 + '%'; b.style.width = drag.box.w * 100 + '%'; b.style.height = drag.box.h * 100 + '%';
      });
      view.addEventListener('pointerup', function () {
        if (!drag) return;
        var d = drag; drag = null;
        if (d.box.w < 0.02 || d.box.h < 0.02) { boxThumbs(); return; }
        change(function () { var bx = scene().boxes[d.bi]; bx.x = +d.box.x.toFixed(4); bx.y = +d.box.y.toFixed(4); bx.w = +d.box.w.toFixed(4); bx.h = +d.box.h.toFixed(4); });
        boxThumbs();
        if (!player.playing) { var bx2 = scene().boxes[d.bi]; seekSrc(clamp(playheadSrc(), bx2.s, bx2.e)); }
      });
    }
    bindBoxPick();
    function setBeat(key) {
      if (!key) {
        music = fileMusic; player.setMusic(music && music.blob);
        change(function () { E.music.gen = ''; E.music.name = fileMusic ? (fileMusic.name || '').slice(0, 120) : ''; }); drawPane(); return;
      }
      var info = VB.beatInfo(key);
      UI.toast('Making “' + info.name + '”…');
      VB.beat(key).then(function (blob) {
        if (dead) return;
        music = { blob: blob, name: info.name, gen: key }; player.setMusic(blob);
        change(function () { E.music.gen = key; E.music.name = ('Buddy beat: ' + info.name).slice(0, 120); if (E.music.vol < 0.05) E.music.vol = 0.25; });
        drawPane(); UI.toast('🎵 ' + info.name + ' is on. Press play to hear it.', 'ok');
      }, function () { UI.toast('This browser couldn\'t make the music.', 'error'); });
    }

    /* ---------------- actions */
    function setPath(path, v) {
      var parts = path.split('.'), o = E;
      if (parts[0] === 'sc' || parts[0] === 'card') { o = scene(); parts.shift(); }
      for (var i = 0; i < parts.length - 1; i++) o = o[parts[i]];
      o[parts[parts.length - 1]] = v;
    }
    function removePauses(si) {
      var s = E.scenes[si], src = s && srcs[s.take];
      if (!s || s.type !== 'take' || !src || src.missing) return Promise.resolve(0);
      return VB.analyze(src).then(function (an) {
        if (!an) return -1;
        envs[s.take] = an;
        var gaps = VB.silences(an, s['in'], s.out, { minGap: UI.store.get('ed.gap', 0.8) });
        var before = (s.cuts || []).length;
        s.cuts = VB.mergeCuts((s.cuts || []).concat(gaps), s['in'], s.out);
        return Math.max(0, s.cuts.length - before);
      });
    }
    function addZoomAt(t) {
      var s = scene(); if (!s || s.type !== 'take') return;
      change(function () {
        if (!s.zooms || !s.zooms.length) s.zooms = sceneZooms(sel).map(function (z) { return JSON.parse(JSON.stringify(z)); });
        var last = (takeById(s.take).clicks || []).filter(function (c) { return c[0] <= t; }).pop();
        s.zooms.push({ s: +Math.max(0, t - 0.3).toFixed(2), e: +(t + 3).toFixed(2), z: E.zoom.level, pts: [[t, last ? last[1] : 0.5, last ? last[2] : 0.5]], auto: false });
        s.zooms.sort(function (a, b) { return a.s - b.s; });
        zoomSel = s.zooms.findIndex(function (z) { return Math.abs(z.s - Math.max(0, t - 0.3)) < 0.01; });
      });
      tab = 'scene'; drawPane();
    }
    function addTextAt(style, a, b) {
      var s = scene(); if (!s || s.type !== 'take') { UI.toast('Select a take first.'); return; }
      var t = a != null ? a : playheadSrc(), e2 = b != null ? b : t + 3.5;
      var dflt = { lower: [ctx.me.name, D.product ? 'Maker of ' + D.product.name : (D.handle || 'App maker')], callout: ['Look at this!', ''], caption: ['Say it in words here', ''], title: [D.product ? D.product.name : 'Big moment', ''], arrow: ['Tap here', ''] }[style];
      change(function () {
        s.texts = s.texts || [];
        s.texts.push({ id: VB.uid('t').slice(0, 20), s: +t.toFixed(2), e: +Math.min(e2, takeById(s.take).duration).toFixed(2), text: dflt[0], sub: dflt[1], style: style, pos: style === 'callout' ? 'tr' : style === 'caption' ? 'bc' : style === 'arrow' ? 'tl' : 'bl' });
      });
      tab = 'text'; drawPane();
      var inputs = view.querySelectorAll('[data-ti] [data-tf=text]'); var last = inputs[inputs.length - 1]; if (last) { last.focus(); last.select(); }
    }
    function split() {
      var s = scene(); if (!s || s.type !== 'take') { UI.toast('Select a take to split.'); return; }
      var t = playheadSrc();
      if (t <= s['in'] + 0.3 || t >= s.out - 0.3) { UI.toast('Move the playhead inside this take first.'); return; }
      change(function () {
        var b = JSON.parse(JSON.stringify(s)); b.id = VB.sceneId();
        s.out = +t.toFixed(2); b['in'] = +t.toFixed(2);
        s.cuts = (s.cuts || []).filter(function (c) { return c[0] < t; }).map(function (c) { return [c[0], Math.min(c[1], t)]; });
        b.cuts = (b.cuts || []).filter(function (c) { return c[1] > t; }).map(function (c) { return [Math.max(c[0], t), c[1]]; });
        s.texts = (s.texts || []).filter(function (x) { return x.s < t; }); b.texts = (b.texts || []).filter(function (x) { return x.s >= t; });
        E.scenes.splice(sel + 1, 0, b);
      });
      UI.toast('Split into two scenes', 'ok');
    }
    function exportDialog() {
      if (!VB.canExport()) { UI.toast('This browser can\'t make video files. Use Chrome, Edge or Safari on a computer.', 'error'); return; }
      if (!plan.outDur) { UI.toast('Add a take or a card first.', 'error'); return; }
      var mime = VB.recorderType(), mp4 = /mp4/.test(mime), Q = UI.store.get('ed.q', '1080'), abort = { aborted: false }, running = false;
      var m = UI.modal('<h2>Export video</h2><div data-x1><p class="muted">' + VB.fmtTime(plan.outDur) + ' · ' + E.aspect + ' · ' + (mp4 ? 'MP4 (plays everywhere, uploads to YouTube and Instagram)' : 'WebM (YouTube accepts it; convert for Instagram)') + '</p>' +
        '<div class="ui-field"><span>Quality</span>' + '<div class="ui-seg"><button data-q="1080" class="' + (Q === '1080' ? 'on' : '') + '">1080p</button><button data-q="720" class="' + (Q === '720' ? 'on' : '') + '">720p (faster upload)</button></div></div>' +
        '<p class="small muted">The video is made right here in your browser, in real time: it takes about ' + VB.fmtTime(plan.outDur) + '. Keep this tab open and in front.</p>' +
        '<div class="ui-row end"><button class="ui-btn ghost" data-close>Cancel</button><button class="ui-btn primary" data-go-export>' + UI.icon('download') + 'Make the video</button></div></div>' +
        '<div data-x2 hidden><canvas data-xc style="width:100%;max-height:300px;object-fit:contain;background:#000;border-radius:3px;display:block"></canvas><div class="ed-prog" style="margin:12px 0 6px"><i data-xp></i></div>' +
        '<div class="ui-row between"><span class="small muted" data-xt>Starting…</span><button class="ui-btn sm" data-xcancel>Cancel</button></div></div>' +
        '<div data-x3 hidden></div>', { wide: true, onclose: function () { if (running) abort.aborted = true; } });
      m.el.addEventListener('click', function (e) {
        var b = e.target.closest('[data-q]'); if (b) { Q = b.getAttribute('data-q'); UI.store.set('ed.q', Q); m.el.querySelectorAll('[data-q]').forEach(function (x) { x.classList.toggle('on', x === b); }); return; }
        if (e.target.closest('[data-xcancel]')) { abort.aborted = true; return; }
        if (!e.target.closest('[data-go-export]')) return;
        player.pause(); save();
        m.el.querySelector('[data-x1]').hidden = true; m.el.querySelector('[data-x2]').hidden = false;
        var xc = m.el.querySelector('[data-xc]'), xg = null, t0 = performance.now();
        running = true;
        VB.exportVideo(plan, { quality: Q, music: music ? music.blob : null, signal: abort, onProgress: function (f, canvas) {
          if (!xg) { xc.width = Math.round(canvas.width / 3); xc.height = Math.round(canvas.height / 3); xg = xc.getContext('2d'); }
          xg.drawImage(canvas, 0, 0, xc.width, xc.height);
          m.el.querySelector('[data-xp]').style.width = (f * 100).toFixed(1) + '%';
          var el = (performance.now() - t0) / 1000;
          m.el.querySelector('[data-xt]').textContent = Math.round(f * 100) + '% · ' + (f > 0.03 ? 'about ' + VB.fmtTime(el / f - el) + ' left' : 'starting…');
        } }).then(function (out) {
          running = false;
          var name = VB.slug(D.video.title) + (E.aspect === '9:16' ? '-vertical' : '') + '.' + out.ext;
          VB.download(out.blob, name);
          VB.lastExport[id] = { blob: out.blob, name: name, ext: out.ext, aspect: E.aspect, seconds: out.seconds, at: Date.now() };
          var url = URL.createObjectURL(out.blob), hasWords = VB.planCues(plan).length > 0;
          m.el.querySelector('[data-x2]').hidden = true;
          var x3 = m.el.querySelector('[data-x3]'); x3.hidden = false;
          x3.innerHTML = '<video class="ed-expv" controls playsinline src="' + url + '"></video><p style="margin:12px 0"><b>' + esc(name) + '</b> · ' + VB.fmtBytes(out.blob.size) + ' · ' + out.width + '×' + out.height + '. It\'s in your Downloads.</p>' +
            '<div class="ui-row"><a class="ui-btn primary" href="#video/' + esc(id) + '/publish">' + UI.icon('upload') + 'Publish kit + upload to YouTube</a>' +
            '<a class="ui-btn" href="#video/' + esc(id) + '/thumbnail">' + UI.icon('image') + 'Make the thumbnail</a>' +
            '<button class="ui-btn" data-again>' + UI.icon('download') + 'Download again</button>' + (hasWords ? '<button class="ui-btn" data-srtx>' + UI.icon('download') + 'Captions (.srt)</button>' : '') + '</div>';
          x3.querySelector('[data-again]').onclick = function () { VB.download(out.blob, name); };
          if (hasWords) x3.querySelector('[data-srtx]').onclick = downloadSrt;
          return UI.apiQuiet('export_logged', id, { seconds: out.seconds, aspect: E.aspect, format: out.ext, quality: Q }).then(function (r) {
            if (r.video) D.video.status = r.video.status;
            if (r.new_badges && r.new_badges.length) VB.badgePop(r.new_badges); else VB.confetti(60);
          });
        }, function (err) {
          running = false;
          if (err && err.cancelled) { m.close(); UI.toast('Export cancelled'); return; }
          m.el.querySelector('[data-x2]').hidden = true; var x3 = m.el.querySelector('[data-x3]'); x3.hidden = false;
          x3.innerHTML = '<div class="ui-error">' + esc(err && err.message || 'The export failed.') + '</div><div class="ui-row end" style="margin-top:12px"><button class="ui-btn" data-close>Close</button></div>';
        });
      });
    }
    function addTakeMenu(btn) {
      if (!D.takes.length) { UI.toast('This video has no takes yet. Record one first.'); return; }
      var m = UI.modal('<h2>Add a take</h2><div class="ui-list">' + D.takes.map(function (t) {
        return '<button class="ui-item" style="cursor:pointer;text-align:left;align-items:center" data-pick="' + esc(t.id) + '">' + (VB.takeThumb(t) ? '<img src="' + esc(VB.takeThumb(t)) + '" alt="" style="width:96px;border-radius:2px">' : '') +
          '<div class="grow"><b>' + esc(t.label) + '</b><div class="small muted">' + VB.fmtTime(t.duration) + '</div></div>' + UI.icon('plus') + '</button>';
      }).join('') + '</div><p class="small muted" style="margin-top:10px">You can add the same take more than once, trimmed differently.</p>');
      m.el.addEventListener('click', function (e) {
        var b = e.target.closest('[data-pick]'); if (!b) return;
        var t = takeById(b.getAttribute('data-pick'));
        change(function () { E.scenes.splice(sel + 1, 0, VB.takeScene(t)); sel = Math.min(sel + 1, E.scenes.length - 1); });
        m.close();
      });
    }

    /* ---------------- events */
    view.addEventListener('click', function (e) {
      var t = e.target, b;
      if ((b = t.closest('[data-sc]'))) { selectScene(+b.getAttribute('data-sc'), true); return; }
      if ((b = t.closest('[data-tab]'))) { tab = b.getAttribute('data-tab'); drawPane(); return; }
      if (t.closest('[data-undo]')) { undo(); return; }
      if (t.closest('[data-redo]')) { redo(); return; }
      if (t.closest('[data-export]')) { exportDialog(); return; }
      if ((b = t.closest('[data-addtake]'))) { addTakeMenu(b); return; }
      if (t.closest('[data-addcard]')) { var p = D.product || {}; change(function () { E.scenes.splice(sel + 1, 0, VB.cardScene(p.name ? 'app' : 'classic', 'New section', '', p.color, p.emoji)); sel++; }); tab = 'scene'; drawPane(); return; }
      if (t.closest('[data-split]')) { split(); return; }
      if (t.closest('[data-pauses]')) {
        var before = snap(), si = sel;
        removePauses(si).then(function (n) {
          if (n < 0) { UI.toast('This take has no sound to find pauses in.'); return; }
          var after = snap(); if (after === before) { UI.toast('No long pauses found.'); return; }
          E = JSON.parse(before); change(function () { E = JSON.parse(after); });
          UI.toast('Removed ' + UI.plural(n, 'pause'), 'ok');
        });
        return;
      }
      if (t.closest('[data-pausesall]')) {
        var b4 = snap(), jobs = E.scenes.map(function (s, i) { return s.type === 'take' ? removePauses(i) : Promise.resolve(0); });
        Promise.all(jobs).then(function (r) {
          var n = r.reduce(function (a, x) { return a + Math.max(0, x); }, 0), aft = snap();
          if (aft === b4) { UI.toast('No long pauses found.'); return; }
          E = JSON.parse(b4); change(function () { E = JSON.parse(aft); }); UI.toast('Removed ' + UI.plural(n, 'pause'), 'ok');
        });
        return;
      }
      if (t.closest('[data-zoomhere]')) { addZoomAt(trackSel ? trackSel.a + 0.3 : playheadSrc()); return; }
      if (t.closest('[data-texthere]')) { addTextAt('callout'); return; }
      if ((b = t.closest('[data-w]'))) {
        var wi = +b.getAttribute('data-w'), sw = scene(), wsl = VB.wordsOf(takeById(sw.take));
        if (e.shiftKey && wsel) wsel = { a: Math.min(wsel.a, wi), b: Math.max(wsel.b, wi), anchor: wsel.anchor };
        else { wsel = { a: wi, b: wi, anchor: wi }; seekSrc(Math.max(sw['in'], wsl[wi][0] - 0.05)); }
        view.querySelectorAll('[data-w].sel').forEach(function (x) { x.classList.remove('sel'); });
        for (var wk = wsel.a; wk <= wsel.b; wk++) { var se = q('[data-w="' + wk + '"]'); if (se) se.classList.add('sel'); }
        var wb = q('[data-wbar]'); if (wb) wb.innerHTML = wbar(wsl);
        return;
      }
      if (t.closest('[data-wclear]')) { wsel = null; drawPane(); return; }
      if (t.closest('[data-wcut]') || t.closest('[data-wkeep]')) {
        var sc2 = scene(), wl = VB.wordsOf(takeById(sc2.take)), cutR = VB.wordCut(wl, wsel.a, wsel.b), keepIt = !!t.closest('[data-wkeep]');
        change(function () {
          if (keepIt) {
            var nk = [];
            (sc2.cuts || []).forEach(function (c) { if (c[1] <= cutR[0] || c[0] >= cutR[1]) nk.push(c); else { if (c[0] < cutR[0]) nk.push([c[0], cutR[0]]); if (c[1] > cutR[1]) nk.push([cutR[1], c[1]]); } });
            sc2.cuts = VB.mergeCuts(nk, sc2['in'], sc2.out);
          } else sc2.cuts = VB.mergeCuts((sc2.cuts || []).concat([cutR]), sc2['in'], sc2.out);
        });
        wsel = null; drawPane();
        return;
      }
      if (t.closest('[data-wfix]')) {
        var tk6 = takeById(scene().take), wl2 = VB.wordsOf(tk6), a6 = wsel.a, b6 = wsel.b;
        var cur6 = wl2.slice(a6, b6 + 1).map(function (w) { return w[2]; }).join(' ');
        var m6 = UI.modal('<h2>Fix the words</h2><p class="muted small">Type what you really said. Captions and the .srt file use this.</p><textarea data-fixtxt rows="3" style="width:100%">' + esc(cur6) + '</textarea>' +
          '<div class="ui-row end" style="margin-top:12px"><button class="ui-btn ghost" data-close>Cancel</button><button class="ui-btn primary" data-fixok>Save</button></div>');
        var ta6 = m6.el.querySelector('[data-fixtxt]'); ta6.focus(); ta6.select();
        m6.el.querySelector('[data-fixok]').onclick = function () {
          var parts = ta6.value.trim().split(/\s+/).filter(Boolean), old = wl2.slice(a6, b6 + 1), fresh;
          fresh = parts.length === old.length ? old.map(function (w, k) { return [w[0], w[1], parts[k].slice(0, 40)]; }) : VB.spread(parts.join(' '), old[0][0], old[old.length - 1][1]);
          var all = wl2.slice(0, a6).concat(fresh, wl2.slice(b6 + 1));
          UI.busy(this, saveWords(tk6, Object.assign({}, tk6.words, { words: all }))).then(function () { m6.close(); wsel = null; rebuild(); UI.toast('Words fixed', 'ok'); });
        };
        return;
      }
      if (t.closest('[data-fillers]')) {
        var sc3 = scene(), fc = VB.fillerCuts(VB.wordsOf(takeById(sc3.take)), sc3['in'], sc3.out);
        change(function () { sc3.cuts = VB.mergeCuts((sc3.cuts || []).concat(fc), sc3['in'], sc3.out); });
        UI.toast('Cut ' + UI.plural(fc.length, 'filler word'), 'ok');
        return;
      }
      if (t.closest('[data-srt]')) { downloadSrt(); return; }
      if (t.closest('[data-asr]')) { writeWords(takeById(scene().take), 'asr'); return; }
      if (t.closest('[data-align]')) { writeWords(takeById(scene().take), 'script'); return; }
      if (t.closest('[data-wdel]')) {
        var tk7 = takeById(scene().take);
        UI.confirm({ title: 'Delete the words of “' + tk7.label + '”?', text: 'The captions for this take go too. Cuts you made stay.', ok: 'Delete', danger: true }).then(function (y) {
          if (y) saveWords(tk7, null).then(function () { wsel = null; rebuild(); });
        });
        return;
      }
      if ((b = t.closest('[data-beat]'))) { setBeat(b.getAttribute('data-beat')); return; }
      if ((b = t.closest('[data-bdel]'))) { var bi = +b.closest('[data-bi]').getAttribute('data-bi'); change(function () { scene().boxes.splice(bi, 1); }); return; }
      if ((b = t.closest('[data-bwhole]'))) { var bi2 = +b.closest('[data-bi]').getAttribute('data-bi'); change(function () { var sc4 = scene(), bx = sc4.boxes[bi2]; bx.s = sc4['in']; bx.e = sc4.out; }); return; }
      if ((b = t.closest('[data-sel]'))) {
        var k = b.getAttribute('data-sel'), s = scene(), r2 = trackSel;
        if (k === 'clear') { trackSel = null; cutSel = null; drawTrack(); tinfo(); return; }
        if (!r2) return;
        if (k === 'cut') change(function () { s.cuts = VB.mergeCuts((s.cuts || []).concat([[r2.a, r2.b]]), s['in'], s.out); });
        if (k === 'keep') change(function () { s['in'] = r2.a; s.out = r2.b; s.cuts = VB.mergeCuts(s.cuts || [], r2.a, r2.b); });
        if (k === 'zoom') { trackSel = null; addZoomAt(r2.a + 0.3); var zs = scene().zooms; if (zs && zs[zoomSel]) { change(function () { zs[zoomSel].s = r2.a; zs[zoomSel].e = r2.b; }); } }
        if (k === 'text') { trackSel = null; addTextAt('callout', r2.a, r2.b); }
        trackSel = null; drawTrack(); tinfo();
        return;
      }
      if (t.closest('[data-restore]')) { var cs = cutSel; change(function () { scene().cuts = scene().cuts.filter(function (c) { return c[0] !== cs[0]; }); }); cutSel = null; tinfo(); return; }
      if (t.closest('[data-clearcuts]')) { change(function () { scene().cuts = []; }); return; }
      if ((b = t.closest('[data-move]'))) { var d = +b.getAttribute('data-move'); change(function () { var x = E.scenes.splice(sel, 1)[0]; sel = clamp(sel + d, 0, E.scenes.length); E.scenes.splice(sel, 0, x); }); return; }
      if (t.closest('[data-dup]')) { change(function () { var x = JSON.parse(JSON.stringify(scene())); x.id = VB.sceneId(); E.scenes.splice(sel + 1, 0, x); sel++; }); return; }
      if (t.closest('[data-delsc]')) { change(function () { E.scenes.splice(sel, 1); sel = Math.max(0, sel - 1); }); return; }
      if ((b = t.closest('[data-set]'))) {
        var name = b.getAttribute('data-set'), v = b.getAttribute('data-v');
        if (name === 'newtext') { addTextAt(v); return; }
        if (name === 'newbox') { addBox(v); return; }
        if (name.indexOf('box.kind:') === 0) { var bk = +name.split(':')[1]; change(function () { scene().boxes[bk].kind = v; }); return; }
        change(function () {
          if (name === 'sc.cam') { var s2 = scene(); s2.cam = v === '' ? null : v === 'hide' ? { hidden: true } : { pos: v, hidden: false }; if (!s2.cam) delete s2.cam; return; }
          if (name === 'aspect') { E.aspect = v; if (v === '9:16' && (E.layout === 'pip' || E.layout === 'side')) E.layout = 'stack'; if (v === '16:9' && E.layout === 'stack') E.layout = 'pip'; E.progress = v === '9:16' ? true : E.progress; return; }
          setPath(name, v);
        });
        return;
      }
      if ((b = t.closest('[data-zdel]'))) { var zi = +b.closest('[data-zi]').getAttribute('data-zi'); change(function () { scene().zooms.splice(zi, 1); }); return; }
      if ((b = t.closest('[data-zgo]'))) { var z = sceneZooms(sel)[+b.closest('[data-zi]').getAttribute('data-zi')]; seekSrc(Math.max(0, z.s - 0.5)); player.play(); return; }
      if (t.closest('[data-zmanual]')) { change(function () { scene().zooms = sceneZooms(sel).map(function (z2) { var c = JSON.parse(JSON.stringify(z2)); c.auto = false; return c; }); }); return; }
      if (t.closest('[data-zauto]')) { change(function () { scene().zooms = []; E.zoom.auto = true; }); return; }
      if ((b = t.closest('[data-focus]'))) {
        var zi2 = +b.closest('[data-zi]').getAttribute('data-zi'), r = b.getBoundingClientRect();
        var fx = clamp((e.clientX - r.left) / r.width, 0, 1), fy = clamp((e.clientY - r.top) / r.height, 0, 1);
        change(function () { var zz = scene().zooms[zi2]; zz.pts = [[zz.s + 0.3, +fx.toFixed(3), +fy.toFixed(3)]]; }, { light: true });
        focusThumbs(); seekSrc(scene().zooms[zi2].s + 0.9);
        return;
      }
      if ((b = t.closest('[data-tdel]'))) { var ti = +b.closest('[data-ti]').getAttribute('data-ti'); change(function () { scene().texts.splice(ti, 1); }); return; }
      if ((b = t.closest('[data-tgo]'))) { var tx = scene().texts[+b.closest('[data-ti]').getAttribute('data-ti')]; seekSrc(Math.max(0, tx.s - 0.3)); player.play(); return; }
      if ((b = t.closest('[data-tpos]'))) { var ti2 = +b.closest('[data-ti]').getAttribute('data-ti'); change(function () { scene().texts[ti2].pos = b.getAttribute('data-tpos'); }); return; }
      if (t.closest('[data-nomusic]')) { VB.vault.del('music:' + id); music = null; fileMusic = null; player.setMusic(null); change(function () { E.music.name = ''; E.music.gen = ''; }); drawPane(); }
    });
    function readVal(el) { return el.type === 'checkbox' ? el.checked : el.type === 'range' || el.type === 'number' || el.tagName === 'SELECT' && /speed/.test(el.getAttribute('data-f') || '') ? +el.value : el.value; }
    view.addEventListener('input', function (e) {
      var t = e.target;
      if (t.matches('[data-f]') && (t.type === 'range' || t.type === 'text' || t.type === 'color')) {
        var path = t.getAttribute('data-f'), v = readVal(t);
        change(function () { setPath(path, v); }, { light: true });
        var lbl = t.closest('.ui-field') && t.closest('.ui-field').querySelector('span');
        if (lbl && t.type === 'range') {
          if (path === 'card.dur') lbl.textContent = 'Length: ' + v + ' s';
          if (path === 'voice') lbl.textContent = 'Voice volume: ' + Math.round(v * 100) + '%';
          if (path === 'music.vol') lbl.textContent = 'Music volume: ' + Math.round(v * 100) + '%';
          if (path === 'zoom.level') lbl.textContent = 'How close: ' + (+v).toFixed(1) + '×';
          if (path === 'sfx.vol') lbl.textContent = 'Effects volume: ' + Math.round(v * 100) + '%';
        }
        if (!player.playing) player.seek(player.o);
        return;
      }
      if (t.matches('[data-zz]')) { var zi = +t.closest('[data-zi]').getAttribute('data-zi'); change(function () { scene().zooms[zi].z = +t.value; }, { light: true }); t.closest('.ui-field').querySelector('span').textContent = 'Zoom ' + (+t.value).toFixed(1) + '×'; focusThumbs(); if (!player.playing) player.seek(player.o); return; }
      if (t.matches('[data-tf=text], [data-tf=sub]')) { var ti = +t.closest('[data-ti]').getAttribute('data-ti'), k = t.getAttribute('data-tf'); change(function () { scene().texts[ti][k] = t.value; }, { light: true }); if (!player.playing) player.seek(player.o); return; }
      if (t.matches('[data-gap]')) { UI.store.set('ed.gap', +t.value); var gv = q('[data-gapv]'); if (gv) gv.textContent = (+t.value).toFixed(1); }
    });
    view.addEventListener('change', function (e) {
      var t = e.target;
      if (t.matches('[data-asrmodel]')) { UI.store.set('ed.asr', t.value); return; }
      if (t.matches('[data-bf]')) {
        var bi3 = +t.closest('[data-bi]').getAttribute('data-bi'), bk3 = t.getAttribute('data-bf');
        change(function () { var x = scene().boxes[bi3]; x[bk3] = Math.max(0, +t.value || 0); if (x.e - x.s < 0.3) x.e = x.s + 0.3; });
        return;
      }
      if (t.matches('[data-f]') && !(t.type === 'range' || t.type === 'text' || t.type === 'color')) {
        var path = t.getAttribute('data-f'), v = readVal(t);
        if (path === 'voice_fx') v = t.checked ? 'clean' : 'off';
        if (path === 'captions.on' || path === 'captions.upper') { change(function () { setPath(path, v); }); drawPane(); return; }
        if (path === 'sc.in' || path === 'sc.out') { var s = scene(), td = takeById(s.take).duration; v = clamp(+v || 0, 0, td); if (path === 'sc.in') v = Math.min(v, s.out - 0.3); else v = Math.max(v, s['in'] + 0.3); v = +v.toFixed(2); }
        change(function () { setPath(path, v); });
        return;
      }
      if (t.matches('[data-f]') && (t.type === 'range' || t.type === 'text' || t.type === 'color')) { drawPane(); return; }
      if (t.matches('[data-zs], [data-ze]')) {
        var zi = +t.closest('[data-zi]').getAttribute('data-zi'), key = t.matches('[data-zs]') ? 's' : 'e';
        change(function () { var z = scene().zooms[zi]; z[key] = Math.max(0, +t.value || 0); if (z.e - z.s < 0.4) z.e = z.s + 0.4; });
        return;
      }
      if (t.matches('[data-tf=s], [data-tf=e]')) {
        var ti = +t.closest('[data-ti]').getAttribute('data-ti'), k2 = t.getAttribute('data-tf');
        change(function () { var x = scene().texts[ti]; x[k2] = Math.max(0, +t.value || 0); if (x.e - x.s < 0.3) x.e = x.s + 0.3; });
        return;
      }
      if (t.matches('[data-music]')) {
        var f = t.files[0]; if (!f) return;
        VB.vault.put('music:' + id, f, { name: f.name }).then(function () { fileMusic = music = { blob: f, name: f.name }; player.setMusic(f); change(function () { E.music.name = f.name.slice(0, 120); E.music.gen = ''; }); drawPane(); UI.toast('Music added', 'ok'); });
      }
    });
    /* Reorder scenes by dragging them in the strip. */
    var dragFrom = -1;
    view.addEventListener('dragstart', function (e) { var b = e.target.closest && e.target.closest('[data-sc]'); if (!b) return; dragFrom = +b.getAttribute('data-sc'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(dragFrom)); } catch (x) { /* old browsers */ } });
    view.addEventListener('dragover', function (e) { var b = e.target.closest && e.target.closest('[data-sc]'); if (!b || dragFrom < 0) return; e.preventDefault(); view.querySelectorAll('.ed-sc.drop').forEach(function (x) { x.classList.remove('drop'); }); b.classList.add('drop'); });
    view.addEventListener('drop', function (e) {
      var b = e.target.closest && e.target.closest('[data-sc]'); if (!b || dragFrom < 0) return; e.preventDefault();
      var to = +b.getAttribute('data-sc'), from = dragFrom; dragFrom = -1;
      if (to !== from) change(function () { var x = E.scenes.splice(from, 1)[0]; E.scenes.splice(to, 0, x); sel = to; });
    });
    view.addEventListener('dragend', function () { dragFrom = -1; view.querySelectorAll('.ed-sc.drop').forEach(function (x) { x.classList.remove('drop'); }); });
    function onKey(e) {
      if (document.querySelector('.ui-modal-wrap')) return;
      var tag = (e.target.tagName || ''), typing = /INPUT|TEXTAREA|SELECT/.test(tag) && e.target.type !== 'range' && e.target.type !== 'checkbox';
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { if (typing) return; e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { if (typing) return; e.preventDefault(); redo(); return; }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && wsel && tab === 'words') { e.preventDefault(); var wc = q('[data-wcut]'); if (wc) wc.click(); return; }
      if (e.key === ' ') { e.preventDefault(); player.toggle(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); player.seek(Math.max(0, player.o - (e.shiftKey ? 5 : 1))); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); player.seek(player.o + (e.shiftKey ? 5 : 1)); }
      else if (e.key.toLowerCase() === 's') split();
    }
    document.addEventListener('keydown', onKey);
    function onResize() { drawTrack(); }
    window.addEventListener('resize', onResize);
    VB._editPage = { plan: function () { return plan; }, edit: function () { return E; }, player: function () { return player; }, select: selectScene, save: save,
      tab: function (k) { tab = k; drawPane(); }, takes: function () { return D.takes; }, music: function () { return music; } };
    return {
      ready: load(),
      destroy: function () {
        dead = true; document.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize);
        if (dirty) save();
        if (player) player.destroy(); VB.releaseSources(); VB._editPage = null;
      }
    };
  });
})();

/* ===== extension.html ===== */
(function () {
  var esc = UI.esc;
  var ZIP = '_/theme/videoblog-buddy-extension.zip';
  UI.page('extension', { title: 'Browser extension', nav: 'Extension', icon: 'puzzle', order: 50, when: function () { return !VB.isPhone(); } }, function (view, ctx) {
    var unsub = null;
    function status() {
      var s = VB.ext.state, box = view.querySelector('[data-status]'); if (!box) return;
      box.innerHTML = s.paired ? '<span class="ui-badge good">' + UI.icon('check') + 'Connected' + (s.version ? ' · v' + esc(s.version) : '') + '</span><button class="ui-btn sm" data-test>Test the connection</button>'
        : s.installed ? '<span class="ui-badge warn">Installed, not connected</span><span class="small muted">Click the VideoBlog Buddy icon in your toolbar (on this page) and press <b>Connect this site</b>.</span>'
          : '<span class="ui-badge">Not found in this browser</span><span class="small muted">Install it below, then reload this page.</span>';
    }
    var shownStore = null;
    function draw(store) {
    shownStore = store || '';
    view.innerHTML = '<div class="ui-wrap">' +
      '<div class="ex-hero"><span class="pz">' + UI.icon('puzzle') + '</span><div><h1>VideoBlog Buddy for Chrome</h1><p>Optional. The app records fine without it. With it, your demos look a lot more pro.</p>' +
        '<div class="ex-status" data-status></div></div>' +
        (store ? '<div class="ui-stack" style="gap:6px;justify-items:end"><a class="ui-btn primary lg" href="' + esc(store) + '" target="_blank" rel="noopener" data-store>' + UI.icon('puzzle') + 'Add to Chrome: it\'s free</a>' +
            '<a class="small muted" href="' + ZIP + '" download="videoblog-buddy-extension.zip">or download the zip</a></div>'
          : '<a class="ui-btn primary lg" href="' + ZIP + '" download="videoblog-buddy-extension.zip">' + UI.icon('download') + 'Download the extension</a>') + '</div>' +
      '<div class="ex-feats">' +
        feat('record', 'One-click tab recording', 'On the tab you want to show, click the extension and press Record this tab. No picker, no hunting for the right tab.') +
        feat('zoom', 'Your clicks become zooms', 'Every click in the recorded tab is saved with its position, and the editor zooms in on it smoothly, like the pros do.') +
        feat('cursor', 'Click rings + key badges', 'A red ring where you click and a badge for shortcuts like Ctrl+K, right on the page, so viewers can follow.') +
        feat('pen', 'Draw on the page', 'Alt+Shift+D, then drag to circle things on any website. The ink fades after a few seconds.') +
        feat('keyboard', 'Shortcuts from any tab', 'Alt+Shift+R stops, Alt+Shift+P pauses, Alt+Shift+M drops a chapter marker, without switching tabs.') +
        feat('lock', 'Private by design', 'It only talks to this site after you connect it, only while you record, and never sends what you type.') + '</div>' +
      '<div class="ex-cols"><div class="ui-card"><h2 style="font-size:1.3rem">Install (Chrome, Edge, Brave, Arc, Opera)</h2><ol class="ex-steps">' +
        (store ? '<li>Press <b>Add to Chrome</b> above, then <b>Add extension</b> in the Chrome Web Store.</li>' +
          '<li>Pin it: click the puzzle piece in the toolbar, then the pin next to VideoBlog Buddy.</li>' +
          '<li>Come back to this page, click the red VideoBlog Buddy icon and press <b>Connect this site</b>.</li>'
        : '<li><b>Download</b> the extension (button above) and <b>unzip</b> it. You get a folder called <code>videoblog-buddy-extension</code>.</li>' +
        '<li>Open <code>chrome://extensions</code> (Edge: <code>edge://extensions</code>) and switch on <b>Developer mode</b> (top right).</li>' +
        '<li>Click <b>Load unpacked</b> and choose the unzipped folder.</li>' +
        '<li>Pin it: click the puzzle piece in the toolbar, then the pin next to VideoBlog Buddy.</li>' +
        '<li>Come back to this page, click the red VideoBlog Buddy icon and press <b>Connect this site</b>.</li>') + '</ol>' +
        '<p class="small muted" style="margin:14px 0 0">Firefox and Safari: the app records without the extension (choose a tab in the browser\'s share dialog). Click zooms and one-click recording need a Chromium browser.</p></div>' +
      '<div class="ui-stack"><div class="ui-card"><h3>Keyboard shortcuts</h3><div class="ex-keys">' +
        '<div><span>Stop recording</span><span><span class="vb-kbd">Alt</span>+<span class="vb-kbd">Shift</span>+<span class="vb-kbd">R</span></span></div>' +
        '<div><span>Pause / resume</span><span><span class="vb-kbd">Alt</span>+<span class="vb-kbd">Shift</span>+<span class="vb-kbd">P</span></span></div>' +
        '<div><span>Chapter marker</span><span><span class="vb-kbd">Alt</span>+<span class="vb-kbd">Shift</span>+<span class="vb-kbd">M</span></span></div>' +
        '<div><span>Draw on the page</span><span><span class="vb-kbd">Alt</span>+<span class="vb-kbd">Shift</span>+<span class="vb-kbd">D</span></span></div></div>' +
        '<p class="small muted" style="margin:10px 0 0">Change them at <code>chrome://extensions/shortcuts</code>.</p></div>' +
      '<div class="ui-card"><h3>What it can see</h3><p class="small">It runs on the pages you visit so it can draw click rings there. While you record, it sends this site the <b>position</b> of each click (not what you clicked on), and shows shortcut keys on the page. It never reads or sends the letters you type, page content, or your history. Nothing goes anywhere but this site, and only after you connect it.</p></div></div></div></div>';
    status();
    }
    function feat(icon, title, text) { return '<div class="ex-feat">' + UI.icon(icon) + '<h3>' + esc(title) + '</h3><p>' + esc(text) + '</p></div>'; }
    draw(VB.config && VB.config.extension_store_url);
    unsub = VB.ext.on(function (m) {
      if (m.type === 'hello' || m.type === 'paired') status();
      if (m.type === 'test-ok') UI.toast('The extension answered: all good (v' + (m.version || '?') + ')', 'ok');
    });
    view.addEventListener('click', function (e) { if (e.target.closest('[data-test]')) VB.ext.send('test'); });
    return { ready: Promise.all([VB.ext.ping(450), VB.getConfig()]).then(function (r) { if ((r[1].extension_store_url || '') !== shownStore) draw(r[1].extension_store_url); else status(); }), destroy: function () { if (unsub) unsub(); } };
  });
})();

/* ===== home.html ===== */
(function () {
  var esc = UI.esc;
  var FILTERS = [['all', 'All videos'], ['todo', 'Ideas & scripts'], ['wip', 'In progress'], ['published', 'Published']];

  /* New video form (also used from the planner and the apps page). opts: {products, product_id, kind, status, title, script, go} */
  VB.newVideo = function (opts) {
    opts = opts || {};
    var products = opts.products || [];
    var tpls = VB.TEMPLATES;
    var m = UI.modal('<h2>New video</h2><form class="ui-stack" data-nv>' +
      '<label class="ui-field"><span>Title</span><input type="text" name="title" maxlength="100" required placeholder="e.g. Pocket Garden in 60 seconds" value="' + esc(opts.title || '') + '"></label>' +
      '<label class="ui-field"><span>About which app?</span><select name="product_id"><option value="">No app</option>' +
        products.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === opts.product_id ? ' selected' : '') + '>' + esc((p.emoji ? p.emoji + ' ' : '') + p.name) + '</option>'; }).join('') + '</select></label>' +
      '<div class="ui-field"><span>Format</span><div class="ui-choices">' + VB.KINDS.map(function (k) {
        return '<label class="ui-choice"><input type="radio" name="kind" value="' + k.key + '"' + ((opts.kind || 'youtube') === k.key ? ' checked' : '') + '><span>' + k.emoji + ' ' + esc(k.short) + '</span></label>';
      }).join('') + '</div></div>' +
      '<div class="ui-grid two"><label class="ui-field"><span>Publish by <em>(optional)</em></span><input type="date" name="due" value="' + esc(opts.due || '') + '"></label>' +
      '<label class="ui-field"><span>Start the script from</span><select name="tpl"><option value="">A blank page</option>' +
        tpls.map(function (t) { return '<option value="' + t.key + '">' + esc(t.emoji + ' ' + t.name) + '</option>'; }).join('') + '</select></label></div>' +
      '<div class="ui-row end"><button type="button" class="ui-btn ghost" data-close>Cancel</button><button class="ui-btn primary" type="submit">' + UI.icon('plus') + 'Create</button></div></form>');
    var f = m.el.querySelector('[data-nv]');
    if (opts.tpl) f.tpl.value = opts.tpl;
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = UI.formData(f), p = products.filter(function (x) { return x.id === v.product_id; })[0];
      var tpl = tpls.filter(function (t) { return t.key === v.tpl; })[0];
      var fields = { title: v.title, kind: v.kind, product_id: v.product_id || null, due: v.due || null, status: opts.status || (tpl ? 'script' : 'idea') };
      if (tpl) fields.script = VB.fill(tpl.body, p, opts.handle);
      else if (opts.script) fields.script = opts.script;
      UI.busy(f.querySelector('[type=submit]'), UI.api('video_create', fields)).then(function (r) {
        m.close(); UI.toast('Video created', 'ok');
        if (opts.onCreated) opts.onCreated(r.video); else UI.go('video', r.video.id);
      });
    });
    return m;
  };

  /* The "⋯" actions on a video card. */
  VB.videoMenu = function (btn, v, after) {
    var old = document.querySelector('.st-menu'); if (old) { var same = old.parentNode === btn.parentNode; old.remove(); if (same) return; }
    var menu = document.createElement('div'); menu.className = 'st-menu';
    menu.innerHTML = '<a href="#video/' + esc(v.id) + '">' + UI.icon('eye') + 'Open</a>' +
      '<a href="#record/' + esc(v.id) + '">' + UI.icon('record') + 'Record a take</a>' +
      '<a href="#edit/' + esc(v.id) + '">' + UI.icon('scissors') + 'Edit video</a>' +
      (VB.isVertical(v.kind) ? '<button data-remix="youtube">' + UI.icon('tv') + 'Make a 16:9 version</button>'
        : '<button data-remix="short">' + UI.icon('phone') + 'Make a Short version</button><button data-remix="reel">' + UI.icon('film') + 'Make a Reel version</button>' +
          '<button data-clips>' + UI.icon('scissors') + 'Shorts from chapters</button>') +
      '<button class="danger" data-del>' + UI.icon('trash') + 'Delete</button>';
    btn.parentNode.appendChild(menu);
    function close(e) { if (!menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) { menu.remove(); document.removeEventListener('click', close, true); } }
    setTimeout(function () { document.addEventListener('click', close, true); });
    menu.addEventListener('click', function (e) {
      if (e.target.closest('[data-clips]')) { menu.remove(); VB.clipsDialog(v, after); return; }
      var r = e.target.closest('[data-remix]');
      if (r) {
        menu.remove();
        UI.api('video_remix', v.id, r.getAttribute('data-remix')).then(function (x) { UI.toast('Made “' + x.video.title + '”', 'ok'); UI.go('edit', x.video.id); });
        return;
      }
      if (e.target.closest('[data-del]')) {
        menu.remove();
        VB.deleteVideo(v).then(function (yes) { if (yes && after) after(); });
      }
    });
  };
  /* One vertical Short per chapter marker of a video's takes. */
  VB.clipsDialog = function (v, after) {
    return UI.api('video_get', v.id).then(function (r) {
      var clips = [];
      r.takes.forEach(function (t) {
        var marks = (t.markers || []).filter(function (m) { return m[1] === 'chapter' || m[1] === 'highlight'; }).sort(function (a, b) { return a[0] - b[0]; });
        marks.forEach(function (m, i) {
          var a = m[0], b = i + 1 < marks.length ? marks[i + 1][0] : t.duration;
          b = Math.min(b, a + 90);  // a Short that holds attention: 90 s at most
          if (b - a >= 4) clips.push({ take: t.id, 'in': +a.toFixed(2), out: +b.toFixed(2), title: (m[2] || 'Clip ' + (clips.length + 1)) + ' · ' + (r.product ? r.product.name : v.title).slice(0, 60), label: m[2] || 'Clip', from: t.label });
        });
      });
      if (!clips.length) { UI.toast('No chapter markers yet. Press M while recording (or add markers) to mark the best moments.'); return; }
      var m = UI.modal('<h2>Shorts from chapters</h2><p class="muted">Each chapter marker becomes its own vertical Short (up to 90 seconds), sharing the same recording.</p>' +
        '<div class="st-clips">' + clips.map(function (c, i) {
          return '<label><input type="checkbox" data-ci="' + i + '" checked><span style="flex:1"><b>' + esc(c.label) + '</b><span class="small muted"> · ' + esc(c.from) + ' · ' + VB.fmtTime(c['in']) + '–' + VB.fmtTime(c.out) + ' (' + VB.fmtTime(c.out - c['in']) + ')</span></span></label>';
        }).join('') + '</div><div class="ui-row end" style="margin-top:14px"><button class="ui-btn ghost" data-close>Cancel</button><button class="ui-btn primary" data-mk>' + UI.icon('phone') + 'Make the Shorts</button></div>', { wide: true });
      m.el.querySelector('[data-mk]').addEventListener('click', function () {
        var pick = clips.filter(function (c, i) { return m.el.querySelector('[data-ci="' + i + '"]').checked; }), btn = this, made = 0;
        if (!pick.length) return;
        var chain = Promise.resolve();
        pick.forEach(function (c) { chain = chain.then(function () { return UI.api('video_remix', v.id, 'short', { take: c.take, 'in': c['in'], out: c.out, title: c.title }).then(function () { made++; }); }); });
        UI.busy(btn, chain).then(function () { m.close(); UI.toast('Made ' + UI.plural(made, 'Short') + '. They\'re on your planner.', 'ok'); if (after) after(); }, function () { if (after) after(); });
      });
    });
  };
  VB.deleteVideo = function (v) {
    return UI.confirm({ title: 'Delete “' + v.title + '”?', text: 'Its plan, script and edit are deleted. Recordings only this video uses are removed from this computer too.', ok: 'Delete', danger: true })
      .then(function (yes) {
        if (!yes) return false;
        return UI.api('video_delete', v.id).then(function (r) {
          (r.free_keys || []).forEach(function (k) { VB.vault.dropTake(k); });
          UI.toast('Deleted', 'ok'); return true;
        });
      });
  };

  function card(v) {
    return '<article class="st-card" data-id="' + esc(v.id) + '"><a class="th" href="#video/' + esc(v.id) + '">' + VB.thumbHtml(v) + '</a>' +
      '<div class="meta"><a class="t" href="#video/' + esc(v.id) + '">' + esc(v.title) + '</a>' +
      '<div class="sub">' + VB.appChip(v.product) + '<span>· ' + esc(VB.kind(v.kind).short) + '</span></div>' +
      '<div class="sub">' + (v.status === 'published' && v.published_at ? 'Published ' + esc(UI.ago(v.published_at)) : 'Updated ' + esc(UI.ago(v.updated))) +
        (v.takes ? ' · ' + UI.plural(v.takes, 'take') : '') + (v.sample ? ' · <span class="ui-badge" style="padding:1px 5px">Sample</span>' : '') + '</div></div>' +
      '<button class="ui-btn ghost icon sm" data-more aria-label="More actions">' + UI.icon('more') + '</button></article>';
  }

  UI.page('home', { title: 'Studio', nav: 'Studio', icon: 'tv', auth: 'user', order: 10 }, function (view, ctx) {
    var data = null, filter = UI.store.get('st.filter', 'all'), app = '', query = '';
    view.innerHTML = '<div class="st-banner"></div><div class="ui-wrap"><div class="ui-skel" style="height:260px;margin-top:20px"></div></div>';

    function shown() {
      return data.videos.filter(function (v) {
        if (filter === 'todo' && ['idea', 'script'].indexOf(v.status) < 0) return false;
        if (filter === 'wip' && ['recorded', 'edited'].indexOf(v.status) < 0) return false;
        if (filter === 'published' && v.status !== 'published') return false;
        if (app && (!v.product || v.product.id !== app)) return false;
        if (query && (v.title + ' ' + (v.product ? v.product.name : '')).toLowerCase().indexOf(query.toLowerCase()) < 0) return false;
        return true;
      });
    }
    function drawGrid() {
      var list = shown(), box = view.querySelector('[data-grid]');
      if (!box) return;
      box.innerHTML = list.length ? '<div class="st-grid">' + list.map(card).join('') + '</div>'
        : (data.videos.length ? '<div class="ui-empty">' + UI.icon('search') + '<h3>No videos here</h3><p>Try another filter.</p></div>'
          : '<div class="ui-empty st-hero-empty">' + UI.icon('video') + '<h3>Your channel starts here</h3><p>Record your screen and camera, or plan your first video.</p>' +
            '<div class="ui-row" style="justify-content:center"><a class="ui-btn primary" href="#record" data-go="record"><i class="rec-dot"></i>Record</a>' +
            '<button class="ui-btn" data-sample>' + UI.icon('sparkle') + 'Add the sample project</button></div></div>');
      view.querySelectorAll('.st-bar [data-filter]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-filter') === filter); });
    }
    function side() {
      var st = data.stats;
      var goal = st.goal || 0, week = st.week || 0, k = goal ? Math.min(1, week / goal) : 0, R = 26, C2 = 2 * Math.PI * R;
      return '<aside class="st-side">' +
        '<div class="ui-card" data-goal><h3>🎯 Weekly goal</h3>' + (goal ? '<div class="st-goal"><svg width="68" height="68" viewBox="0 0 68 68" aria-hidden="true"><circle cx="34" cy="34" r="' + R + '" fill="none" stroke="var(--c-line)" stroke-width="7"/>' +
          '<circle cx="34" cy="34" r="' + R + '" fill="none" stroke="' + (k >= 1 ? '#2e9d5b' : 'var(--c-brand)') + '" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + (C2 * k).toFixed(1) + ' ' + C2.toFixed(1) + '" transform="rotate(-90 34 34)"/>' +
          '<text x="34" y="39" text-anchor="middle" font-size="15" font-weight="700" fill="currentColor">' + week + '/' + goal + '</text></svg>' +
          '<div><b>' + (k >= 1 ? 'Goal reached! 🎉' : UI.plural(goal - week, 'more video') + ' this week') + '</b><div class="small muted">' + UI.plural(week, 'video') + ' published since Monday</div></div></div>'
          : '<p class="small muted" style="margin:0 0 8px">Publishing on a rhythm grows a channel. How many videos a week?</p>') +
          '<div class="ui-seg" style="margin-top:10px">' + [[1, '1'], [2, '2'], [3, '3'], [5, '5'], [0, 'Off']].map(function (o) { return '<button data-setgoal="' + o[0] + '" class="' + (goal === o[0] ? 'on' : '') + '">' + o[1] + '</button>'; }).join('') + '</div></div>' +
        '<div class="ui-card"><h3>' + UI.icon('star') + 'Achievements</h3><div class="st-badges">' + data.badges.map(function (b) {
          return '<div class="st-badge ' + (b.got ? 'on' : 'off') + '" title="' + esc(b.name + ': ' + b.desc) + '"><span>' + esc(b.emoji) + '</span><small>' + esc(b.name) + '</small></div>';
        }).join('') + '</div><p class="small muted" style="margin:10px 0 0">' + data.badges.filter(function (b) { return b.got; }).length + ' of ' + data.badges.length + ' earned' +
        (st.streak ? ' · 🔥 ' + UI.plural(st.streak, 'week') + ' in a row' : '') + '</p></div>' +
        '<div class="ui-card" data-storage><h3>' + UI.icon('hdd') + 'On this computer</h3><p class="small muted" style="margin:0">Checking…</p></div>' +
        '<div class="ui-card" data-extcard><h3>' + UI.icon('puzzle') + 'Browser extension</h3><p class="small muted" style="margin:0">Looking for it…</p></div>' +
        '<div class="ui-card"><h3>' + UI.icon('grid') + 'Your apps</h3>' + (data.products.length ? '<div class="st-apps">' + data.products.slice(0, 8).map(function (p) {
          var n = data.videos.filter(function (v) { return v.product && v.product.id === p.id; }).length;
          return '<a href="#apps/' + esc(p.id) + '"><i style="background:' + esc(p.color) + '22">' + esc(p.emoji || '•') + '</i><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(p.name) + '</span><span class="small muted">' + n + '</span></a>';
        }).join('') + '</div>' : '<p class="small muted">Add the apps you\'re building: scripts and descriptions fill themselves in.</p>') +
        '<a class="ui-btn sm" style="margin-top:10px" href="#apps" data-go="apps">' + UI.icon('plus') + 'Manage apps</a></div></aside>';
    }
    function draw() {
      var me = ctx.me, st = data.stats;
      view.innerHTML = '<div class="st-banner"><b>' + esc(me.name.split(' ')[0]) + '\'s studio<small>Broadcast the apps you build</small></b></div>' +
        '<div class="ui-wrap st-wrap"><div class="st-chan"><div class="st-ava">' + esc(UI.initials(me.name)) + '</div>' +
        '<div class="st-who"><h1>' + esc(me.name) + '</h1><button class="st-handle" data-handle>' + esc(data.handle || 'Set your @handle') + '</button>' +
        '<div class="st-stats"><span><b>' + st.videos + '</b> videos</span><span><b>' + st.published + '</b> published</span><span><b>' + st.minutes + '</b> min recorded</span><span><b>' + st.exports + '</b> exports</span></div></div>' +
        '<div class="st-actions"><a class="ui-btn primary" href="#record" data-go="record"><i class="rec-dot"></i>Record</a><button class="ui-btn" data-new>' + UI.icon('plus') + 'New video</button></div></div>' +
        '<div data-rescue></div>' +
        '<div class="st-layout"><section><div class="st-tabsline"><div class="st-bar"><nav class="ui-tabs">' + FILTERS.map(function (f) {
          return '<button data-filter="' + f[0] + '">' + f[1] + '</button>';
        }).join('') + '</nav>' +
        (data.products.length ? '<select data-app aria-label="Filter by app"><option value="">All apps</option>' + data.products.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'; }).join('') + '</select>' : '') +
        '<input type="search" data-q placeholder="Search videos" aria-label="Search videos"></div></div><div data-grid></div></section>' + side() + '</div></div>';
      drawGrid(); storage(); extCard(); rescue();
    }
    function storage() {
      VB.vault.usage().then(function (u) {
        var box = view.querySelector('[data-storage]'); if (!box) return;
        VB.vault.list().then(function (files) {
          var size = files.reduce(function (a, f) { return a + (f.size || 0); }, 0);
          box.innerHTML = '<h3>' + UI.icon('hdd') + 'On this computer</h3>' +
            '<p class="small" style="margin:0 0 8px">' + (size ? '<b>' + VB.fmtBytes(size) + '</b> of recordings' : 'No recordings yet') + (u && u.quota ? ' · ' + VB.fmtBytes(Math.max(0, u.quota - u.used)) + ' free for more' : '') + '</p>' +
            (u && u.quota ? '<div class="vb-meter" style="margin-bottom:10px"><i style="width:' + Math.max(1.5, Math.min(100, u.used / u.quota * 100)).toFixed(1) + '%"></i></div>' : '') +
            '<p class="small muted" style="margin:0 0 10px">Your recordings stay in this browser and are never uploaded. Download finished videos to keep them.</p>' +
            '<div class="ui-row">' + (u && !u.persisted ? '<button class="ui-btn sm" data-persist>' + UI.icon('lock') + 'Keep them safe</button>' : '<span class="ui-badge good">' + UI.icon('check') + 'Protected</span>') +
            (files.length ? '<button class="ui-btn sm ghost" data-files>Manage files</button>' : '') + '</div>';
        });
      });
    }
    function extCard() {
      Promise.all([VB.ext.ping(500), VB.getConfig()]).then(function (r) {
        var s = r[0];
        var box = view.querySelector('[data-extcard]'); if (!box) return;
        box.innerHTML = '<h3>' + UI.icon('puzzle') + 'Browser extension</h3>' +
          (s.paired ? '<p class="small" style="margin:0 0 10px"><span class="ui-badge good">' + UI.icon('check') + 'Connected</span> Clicks are recorded for auto-zoom, and you can record any tab from the toolbar.</p>'
            : s.installed ? '<p class="small" style="margin:0 0 10px"><span class="ui-badge warn">Installed, not connected</span> Open its popup on this page and press <b>Connect</b>.</p>'
              : '<p class="small muted" style="margin:0 0 10px">One-click tab recording, click rings and auto-zoom on your clicks.</p>') +
          (!s.installed && VB.config.extension_store_url ? '<a class="ui-btn sm primary" href="' + esc(VB.config.extension_store_url) + '" target="_blank" rel="noopener">' + UI.icon('puzzle') + 'Add to Chrome</a> ' : '') +
          '<a class="ui-btn sm" href="#extension" data-go="extension">' + (s.installed ? 'Extension settings' : VB.config.extension_store_url ? 'What it does' : UI.icon('download') + 'Get the extension') + '</a>';
      });
    }
    function rescue() {
      VB.vault.orphans().then(function (list) {
        var box = view.querySelector('[data-rescue]'); if (!box || !list.length) return;
        box.innerHTML = list.map(function (o) {
          return '<div class="st-rescue" data-rid="' + esc(o.rid) + '">' + UI.icon('info') + '<p><b>An unfinished recording was saved.</b> ' +
            (o.info.t ? 'About ' + VB.fmtTime(o.info.t) + ', ' : '') + VB.fmtBytes(o.size) + (o.info.started ? ', started ' + esc(UI.fmtDateTime(new Date(o.info.started).toISOString())) : '') + '. The tab probably closed while recording.</p>' +
            '<button class="ui-btn sm primary" data-rescue-it>Rescue it</button><button class="ui-btn sm ghost" data-rescue-drop>Delete</button></div>';
        }).join('');
      });
    }
    function rescueIt(rid) {
      return VB.vault.orphans().then(function (list) {
        var o = list.filter(function (x) { return x.rid === rid; })[0];
        if (!o) return;
        return VB.rescue(o).then(function (info) {
          if (!info) { UI.toast('That recording was empty.'); return; }
          var target = info.videoId && data.videos.some(function (v) { return v.id === info.videoId; }) ? Promise.resolve(info.videoId)
            : UI.api('video_create', { title: 'Rescued recording', status: 'recorded' }).then(function (r) { return r.video.id; });
          return target.then(function (vid) {
            var meta = Object.assign({}, info); delete meta.videoId;
            return UI.api('take_add', vid, meta).then(function () { UI.toast('Recording rescued', 'ok'); UI.go('video', vid); });
          });
        });
      });
    }
    function manageFiles() {
      VB.vault.list().then(function (files) {
        var groups = {};
        files.forEach(function (f) { var k = String(f.key).split(':')[1] || f.key; (groups[k] = groups[k] || []).push(f); });
        var m = UI.modal('<h2>Recordings on this computer</h2><p class="muted small">Each recording is a screen (or camera) file, plus the camera file when the bubble was on. Deleting a file here doesn\'t delete the video from your library; it just isn\'t playable on this computer any more.</p>' +
          '<div class="ui-list">' + Object.keys(groups).map(function (k) {
            var g = groups[k], size = g.reduce(function (a, f) { return a + f.size; }, 0), when = g[0].created ? new Date(g[0].created).toISOString() : null;
            return '<div class="ui-item" style="padding:10px 12px;align-items:center" data-key="' + esc(k) + '"><div class="grow"><b class="small">' + esc(k) + '</b><div class="small muted">' + g.length + ' file' + (g.length > 1 ? 's' : '') + ' · ' + VB.fmtBytes(size) + (when ? ' · ' + esc(UI.fmtDate(when)) : '') + '</div></div>' +
              '<button class="ui-btn sm danger" data-drop-key>' + UI.icon('trash') + '</button></div>';
          }).join('') + '</div>', { wide: true });
        m.el.addEventListener('click', function (e) {
          var b = e.target.closest('[data-drop-key]'); if (!b) return;
          var row = b.closest('[data-key]');
          UI.confirm({ title: 'Delete these files?', text: 'The take stays in your library, but it won\'t play on this computer.', ok: 'Delete', danger: true }).then(function (yes) {
            if (yes) VB.vault.dropTake(row.getAttribute('data-key')).then(function () { row.remove(); storage(); });
          });
        });
      });
    }
    view.addEventListener('click', function (e) {
      var t = e.target;
      var f = t.closest('[data-filter]'); if (f) { filter = f.getAttribute('data-filter'); UI.store.set('st.filter', filter); drawGrid(); return; }
      if (t.closest('[data-new]')) { VB.newVideo({ products: data.products, handle: data.handle }); return; }
      if (t.closest('[data-sample]')) { UI.api('sample_create').then(function (r) { UI.toast('Sample added', 'ok'); UI.go('video', r.video.id); }); return; }
      var more = t.closest('[data-more]');
      if (more) { var id = more.closest('[data-id]').getAttribute('data-id'); VB.videoMenu(more, data.videos.filter(function (v) { return v.id === id; })[0], load); return; }
      if (t.closest('[data-handle]')) {
        var m = UI.modal('<h2>Your channel handle</h2><p class="muted">Shown as a watermark on your videos and in descriptions.</p><form class="ui-stack" data-hf><input type="text" name="h" maxlength="40" placeholder="@yourchannel" value="' + esc(data.handle) + '"><div class="ui-row end"><button class="ui-btn primary" type="submit">Save</button></div></form>');
        m.el.querySelector('form').addEventListener('submit', function (ev) {
          ev.preventDefault();
          UI.api('set_handle', m.el.querySelector('[name=h]').value).then(function (r) { data.handle = r.handle; m.close(); draw(); });
        });
        return;
      }
      if (t.closest('[data-persist]')) { VB.vault.persist().then(function (ok) { UI.toast(ok ? 'Recordings are protected from automatic clean-up' : 'The browser said no. It may ask again after you use the app more.', ok ? 'ok' : null); storage(); }); return; }
      if (t.closest('[data-files]')) { manageFiles(); return; }
      var sg = t.closest('[data-setgoal]');
      if (sg) {
        UI.api('set_goal', +sg.getAttribute('data-setgoal')).then(function (r) {
          data.stats = r.stats; data.badges = r.badges; draw();
          if (r.new_badges && r.new_badges.length) VB.badgePop(r.new_badges); else UI.toast(r.stats.goal ? 'Goal: ' + UI.plural(r.stats.goal, 'video') + ' a week' : 'Weekly goal off', 'ok');
        });
        return;
      }
      var ri = t.closest('[data-rescue-it]'); if (ri) { UI.busy(ri, rescueIt(ri.closest('[data-rid]').getAttribute('data-rid'))); return; }
      var rd = t.closest('[data-rescue-drop]');
      if (rd) {
        var rid = rd.closest('[data-rid]').getAttribute('data-rid');
        UI.confirm({ title: 'Delete the unfinished recording?', ok: 'Delete', danger: true }).then(function (yes) { if (yes) VB.vault.dropChunks(rid).then(function () { rd.closest('[data-rid]').remove(); }); });
      }
    });
    view.addEventListener('input', function (e) { if (e.target.matches('[data-q]')) { query = e.target.value; drawGrid(); } });
    view.addEventListener('change', function (e) { if (e.target.matches('[data-app]')) { app = e.target.value; drawGrid(); } });
    function load() { return UI.api('studio_home').then(function (d) { data = d; draw(); }); }
    return load();
  });
})();

/* ===== landing.html ===== */
// Watch section: swap the video's cover for YouTube's player (privacy-enhanced) only when it's pressed.
  if (!window.__ytFilm) {
    window.__ytFilm = true;
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-yt-film]') : null;
      if (!b) return;
      var f = document.createElement('iframe');
      f.src = 'https://www.youtube-nocookie.com/embed/' + b.getAttribute('data-yt-film') + '?autoplay=1&rel=0&playsinline=1';
      f.title = b.getAttribute('data-yt-title') || 'Video';
      f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      f.allowFullscreen = true;
      f.referrerPolicy = 'strict-origin-when-cross-origin';
      b.parentNode.replaceChild(f, b);
    });
  }
(function () {
  var COPY = {
    eyebrow: 'For people who build apps',
    title: 'Record it. Edit it. <em>Broadcast</em> it.',
    lead: 'VideoBlog Buddy records your screen and camera in the browser, turns your takes into YouTube videos and vertical Shorts and Reels, and writes the title, description and chapters for you. Show the world what you\'re building.',
    cta: 'Start your channel, free',
    proof: ['Free', 'Nothing to install', 'Recordings never leave your computer'],
    steps: [
      ['Record', 'Your screen with your face in a bubble, or just the camera.', ['Teleprompter that scrolls as you talk', 'Chapter markers with one key', 'Pause, retake, keep the best']],
      ['Edit', 'Trim, cut the pauses, zoom where you clicked, edit by deleting words.', ['Captions written on your computer', 'One click from 16:9 to 9:16', 'Free music made by the app']],
      ['Publish', 'Export an MP4, then upload it to YouTube from here.', ['Thumbnail maker, 1280×720', 'Description with chapters, tags, hashtags', 'A planner with a weekly goal']]
    ],
    features: [
      ['record', 'Screen + camera bubble', 'Record a tab, a window or the whole screen with your face in the corner. The camera is saved separately, so you can move or hide the bubble later.'],
      ['scroll', 'Teleprompter', 'Write the script once. It scrolls in the recorder and in a floating window that stays on top of the tab you\'re showing.'],
      ['zoom', 'Zooms on your clicks', 'With the browser extension, every click is remembered and the editor zooms in on it smoothly. Demos people can actually read.'],
      ['scissors', 'Remove pauses', 'One button finds the silences and cuts them, with a little air left around your words. Undo is always there.'],
      ['text', 'Captions + edit by words', 'Speech-to-text runs on your computer. Cut a sentence by selecting its words, remove every “um” in one click, download the .srt.'],
      ['upload', 'Straight to YouTube', 'Upload the video, thumbnail and captions to your channel from the publish kit: private, unlisted, public or scheduled.'],
      ['wand', 'A writing partner', 'Hook lab, a script check-up, release notes turned into a script, and ready prompts for your favourite AI chat.'],
      ['phone', 'Shorts and Reels too', 'Make a vertical version of any video: screen on top, you below, red progress bar. Same takes, no re-recording.'],
      ['image', 'Thumbnail maker', 'Big words, your face, a frame from the video. Five layouts, sized and compressed for YouTube.'],
      ['rocket', 'Publish kit', 'Title ideas, a description with chapters from your markers, tags, hashtags, a pinned comment and an upload checklist.'],
      ['kanban', 'Planner per app', 'Add the apps you\'re building. Get video ideas for each, with a script already written, and move them from idea to published.'],
      ['lock', 'Private by design', 'Videos are recorded, edited and exported on your computer. Only the plan and the words are saved to your account.']
    ],
    who: [['Indie makers', 'Show your side project in 60 seconds and post it everywhere.'], ['Small teams', 'Release notes, tutorials and bug reports as videos your users watch.'],
          ['Devlog creators', 'Build in public: one take a day, edited in minutes.']],
    faq: [
      ['Is it free?', 'Yes. Recording, editing, exporting and the publish kit are free.'],
      ['Do I need to install anything?', 'No. It works in Chrome, Edge, Firefox and Safari on a computer. The optional Chrome extension adds one-click tab recording and zooms on your clicks.'],
      ['Where are my videos stored?', 'In your browser, on your computer. They are never uploaded to us. Your account keeps the plan: titles, scripts, edit decisions and descriptions. Download finished videos to keep them safe.'],
      ['Does it upload to YouTube for me?', 'Yes. Sign in with Google once and upload the video, its thumbnail and captions straight from the publish kit. For Instagram or TikTok, export the MP4 and paste the caption the app wrote.'],
      ['Are the captions sent to a server to be written?', 'No. Speech recognition runs in your browser (the model downloads once). Only the words are saved with your take, like your script.'],
      ['Can I make Shorts and Reels?', 'Yes. Pick 9:16 in the editor or press "Make a Short version" on any video. The screen goes on top and your camera below.'],
      ['Can I use it on my phone?', 'You can plan, write scripts, use the full-screen teleprompter and record camera takes. Screen recording needs a computer.'],
      ['Where does the music come from?', 'Pick one of the Buddy beats the app makes for you (free to use, even on monetized videos), or bring your own audio file you have the rights to use.']
    ]
  };

  /* The hero player: the sample tour drawn live, on a loop (no sound). */
  function heroPlayer(canvas, prog, once) {
    var takes = [
      { id: 'h1', key: 'sample-hello', label: 'Hello', mode: 'cam', duration: 9, sample: 'hello', clicks: [], markers: [], cam_offset: 0 },
      { id: 'h2', key: 'sample-garden', label: 'Tour', mode: 'screen_cam', duration: 40, sample: 'garden', clicks: VB.SAMPLES.garden.clicks, markers: [], cam_offset: 0 }
    ];
    var e = VB.fullEdit({ aspect: '16:9', layout: 'pip', bg: 'mint', pad: 0.05, radius: 14, transition: 'fade', watermark: '@pocketgarden',
      scenes: [VB.cardScene('app', 'Pocket Garden', 'Plant care in 40 seconds', '#2e9d5b', '🌱'),
        Object.assign(VB.takeScene(takes[0]), { 'in': 0.3, out: 6, texts: [{ id: 't1', s: 0.6, e: 4.4, text: 'Sam Rivera', sub: 'Maker of Pocket Garden', style: 'lower', pos: 'bl' }] }),
        Object.assign(VB.takeScene(takes[1]), { cuts: [[17.8, 20.2]], texts: [{ id: 't2', s: 12.4, e: 15.6, text: 'One tap logs the watering', sub: '', style: 'callout', pos: 'tl' }] }),
        VB.cardScene('subscribe', 'Try Pocket Garden free', 'pocket-garden.example', '#cc181e', '🌱')] }, 'youtube');
    var srcs = {}, plan, g = canvas.getContext('2d'), start = performance.now() - 8500, raf = 0, dead = false;
    Promise.all(takes.map(function (t) { return VB.openTake(t, { fresh: true }).then(function (s) { srcs[t.id] = s; }); })).then(function () {
      plan = VB.plan(e, takes, srcs);
      (function frame(now) {
        if (dead) return;
        var o = once ? 14 : ((now - start) / 1000) % plan.outDur;
        VB.render(g, canvas.width, canvas.height, plan, o, {});
        if (prog) prog.style.width = (o / plan.outDur * 100).toFixed(2) + '%';
        if (!once) raf = requestAnimationFrame(frame);
      })(performance.now());
    });
    return function () { dead = true; cancelAnimationFrame(raf); };
  }

  UI.page('landing', { title: 'Record, edit and publish videos about your apps' }, function (view, ctx) {
    var me = ctx.me, C = COPY, esc = UI.esc, stop = null;
    var primary = me ? '<a class="ui-btn primary lg" href="#home" data-go="home">Open your studio ' + UI.icon('arrow') + '</a><a class="ui-btn lg" href="#record" data-go="record"><i class="rec-dot" style="color:var(--c-brand)"></i>Record now</a>'
      : '<a class="ui-btn primary lg" href="#auth/signup" data-go="auth/signup">' + esc(C.cta) + ' ' + UI.icon('arrow') + '</a>' +
        '<a class="ui-btn lg" href="#auth" data-go="auth">I have an account</a>';
    view.innerHTML =
      '<div class="lp-top"><section class="lp-hero"><div class="ui-wrap"><div>' +
        '<div class="eyebrow">' + esc(C.eyebrow) + '</div><h1>' + C.title + '</h1><p class="lp-lead">' + esc(C.lead) + '</p>' +
        '<div class="lp-cta">' + primary + '</div>' +
        '<div class="lp-proof">' + C.proof.map(function (p) { return '<span>' + UI.icon('check') + esc(p) + '</span>'; }).join('') + '</div></div>' +
        '<div class="lp-watch" aria-label="A video made with VideoBlog Buddy"><div class="bar"><span class="vb-logo">VideoBlog<span class="tube">Buddy</span></span><span class="srch">Search</span></div>' +
          '<div class="grid"><div><canvas data-hero width="960" height="540"></canvas><div class="prog"><i data-prog></i></div>' +
          '<div class="meta"><b>Pocket Garden in 40 seconds</b><div class="chan"><span class="av">🌱</span><span>Pocket Garden<br>1,204 views</span><span class="sub">SUBSCRIBE</span></div></div></div>' +
          '<div class="side">' + [['#cc181e', 'BUG OF THE WEEK', '3:12'], ['#167ac6', 'HOW I BUILT IT', '8:45'], ['#5b4ccf', '3 TIPS', '0:41'], ['#c86f00', 'WHAT\'S NEW', '2:03']].map(function (s) {
            return '<div class="it"><div class="th" style="background:linear-gradient(135deg,' + s[0] + ',' + VB.mix(s[0], -0.45) + ')">' + s[1] + '<span>' + s[2] + '</span></div><div class="ln"></div><div class="ln s"></div></div>'; }).join('') + '</div></div></div>' +
      '</div></section></div>' +
      '<section class="lp-section ytf" id="watch"><div class="ui-wrap"><div class="ytf-in"><div class="ytf-copy"><div class="eyebrow"><svg viewBox="0 0 28 20" width="20" height="14" aria-hidden="true"><rect width="28" height="20" rx="5" fill="#FF0033"/><path d="M11.2 5.8v8.4l7.3-4.2z" fill="#fff"/></svg>Watch</div><h2>See VideoBlog Buddy in about a minute</h2><p>A short video tour of what VideoBlog Buddy does and how it works.</p><a class="ytf-link" href="https://www.youtube.com/watch?v=Olt2yMqA_TI" target="_blank" rel="noopener">Watch on YouTube &#8599;</a></div><div><div class="ytf-frame"><button type="button" class="ytf-cover" data-yt-film="Olt2yMqA_TI" data-yt-title="VideoBlog Buddy video" aria-label="Play the VideoBlog Buddy video (1:07)"><img src="_/theme/yt-cover.jpg" alt="" loading="lazy" decoding="async" width="960" height="540"><span class="ytf-play" aria-hidden="true"><svg viewBox="0 0 68 48" width="68" height="48"><path d="M66.5 7.7a8.5 8.5 0 0 0-6-6C55.3.3 34 .3 34 .3s-21.3 0-26.5 1.4a8.5 8.5 0 0 0-6 6C.1 13 .1 24 .1 24s0 11 1.4 16.3a8.5 8.5 0 0 0 6 6c5.2 1.4 26.5 1.4 26.5 1.4s21.3 0 26.5-1.4a8.5 8.5 0 0 0 6-6C67.9 35 67.9 24 67.9 24s0-11-1.4-16.3z" fill="#FF0033"/><path d="M45 24 27 14v20z" fill="#fff"/></svg></span><span class="ytf-len">1:07</span></button></div><p class="ytf-note">The video loads from YouTube when you press play.</p></div></div></div></section>' +
      '<section class="lp-section" id="how"><div class="ui-wrap"><div class="lp-head"><h2>From idea to upload in one place</h2><p>No video skills needed. If you can click Record, you can make a channel.</p></div>' +
        '<div class="lp-steps">' + C.steps.map(function (s, i) {
          return '<div class="ui-card lp-step"><span class="num">' + (i + 1) + '</span><h3>' + esc(s[0]) + '</h3><p class="muted" style="margin:0">' + esc(s[1]) + '</p><ul>' + s[2].map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
        }).join('') + '</div></div></section>' +
      '<section class="lp-section" style="padding-top:10px"><div class="ui-wrap"><div class="lp-head"><h2>Everything a screen recorder should do</h2><p>And the parts after recording that usually take all evening.</p></div>' +
        '<div class="ui-grid lp-feats">' + C.features.map(function (f) { return '<div class="ui-card lp-feature"><span class="ic">' + UI.icon(f[0]) + '</span><h3>' + esc(f[1]) + '</h3><p>' + esc(f[2]) + '</p></div>'; }).join('') + '</div></div></section>' +
      '<section class="lp-section" style="padding-top:10px"><div class="ui-wrap"><div class="lp-head"><h2>Made for</h2></div><div class="lp-who">' +
        C.who.map(function (w) { return '<div class="ui-card"><h3>' + esc(w[0]) + '</h3><p class="muted" style="margin:0">' + esc(w[1]) + '</p></div>'; }).join('') + '</div></div></section>' +
      '<section class="lp-section" style="padding-top:10px"><div class="ui-wrap"><div class="lp-head"><h2>Questions</h2></div><div class="lp-faq">' +
        C.faq.map(function (q) { return '<details><summary>' + esc(q[0]) + '</summary><p>' + esc(q[1]) + '</p></details>'; }).join('') + '</div></div></section>' +
      '<section class="lp-section"><div class="ui-wrap"><div class="lp-band"><div><h2>Your next video is one click away</h2><p>Sign up, press Record, show what you built.</p></div>' +
        (me ? '<a class="ui-btn lg" href="#record" data-go="record">Record now</a>' : '<a class="ui-btn lg" href="#auth/signup" data-go="auth/signup">' + esc(C.cta) + '</a>') +
      '</div></div></section>';
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var cv = view.querySelector('[data-hero]');
    stop = heroPlayer(cv, view.querySelector('[data-prog]'), reduce);
    return { ready: new Promise(function (r) { setTimeout(r, 300); }), destroy: function () { if (stop) stop(); } };
  });
})();

/* ===== planner.html ===== */
(function () {
  var esc = UI.esc;
  function dueLabel(d) {
    if (!d) return '';
    var today = new Date(); today.setHours(12, 0, 0, 0);
    var x = new Date(d + 'T12:00:00'), days = Math.round((x - today) / 864e5);
    if (days < 0) return days === -1 ? 'Yesterday' : Math.abs(days) + ' days late';
    if (days === 0) return 'Today'; if (days === 1) return 'Tomorrow';
    if (days < 7) return x.toLocaleDateString(undefined, { weekday: 'long' });
    return UI.fmtDate(d, { day: 'numeric', month: 'short' });
  }
  function late(v) { if (!v.due || v.status === 'published') return false; var t = new Date(); t.setHours(0, 0, 0, 0); return new Date(v.due + 'T12:00:00') < t; }

  UI.page('planner', { title: 'Planner', nav: 'Planner', icon: 'kanban', auth: 'user', order: 30 }, function (view, ctx) {
    var D = null, app = UI.store.get('pl.app', ''), col = 'idea', ideaApp = '', mode = UI.store.get('pl.view', 'board') === 'calendar' ? 'calendar' : 'board';
    var month = new Date(); month.setDate(1); month.setHours(12, 0, 0, 0);
    function pri(v) { var n = v.priority || 0; return '<button class="pl-pri" data-pri title="How excited are you about it? (click)" aria-label="Excitement ' + n + ' of 3">' + [1, 2, 3].map(function (k) { return '<span class="' + (k <= n ? '' : 'off') + '">🔥</span>'; }).join('') + '</button>'; }
    function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    view.innerHTML = '<div class="ui-wrap"><div class="ui-skel" style="height:420px"></div></div>';
    function q(s) { return view.querySelector(s); }
    function shown() { return D.videos.filter(function (v) { return !app || (v.product && v.product.id === app); }); }
    function cardHtml(v) {
      var i = VB.STATUSES.map(function (s) { return s.key; }).indexOf(v.status);
      return '<div class="pl-card" draggable="true" data-id="' + esc(v.id) + '"><a class="t" href="#video/' + esc(v.id) + '">' + esc(VB.kind(v.kind).emoji) + ' ' + esc(v.title) + '</a>' +
        '<div class="row">' + (v.status !== 'published' ? pri(v) : '') + (v.product ? VB.appChip(v.product) : '') + (v.due ? '<span class="due' + (late(v) ? ' late' : '') + '">' + UI.icon('calendar') + ' ' + esc(dueLabel(v.due)) + '</span>' : '') +
        '<span class="mv">' + (i > 0 ? '<button data-mv="-1" aria-label="Move back">◀</button>' : '') + (i < 4 ? '<button data-mv="1" aria-label="Move forward">▶</button>' : '') + '</span></div></div>';
    }
    function draw() {
      var vids = shown();
      var next = vids.filter(function (v) { return v.due && v.status !== 'published'; }).sort(function (a, b) { return a.due < b.due ? -1 : 1; }).slice(0, 8);
      view.innerHTML = '<div class="ui-wrap"><div class="pl-head"><div><h1>Planner</h1><p class="muted" style="margin:4px 0 0">Every video from idea to published. Drag cards along as they move.</p></div>' +
        '<div class="ui-row"><div class="ui-seg"><button data-mode="board" class="' + (mode === 'board' ? 'on' : '') + '">' + UI.icon('kanban') + 'Board</button><button data-mode="calendar" class="' + (mode === 'calendar' ? 'on' : '') + '">' + UI.icon('calendar') + 'Calendar</button></div>' +
        '<button class="ui-btn primary" data-new>' + UI.icon('plus') + 'New idea</button></div></div>' +
        (D.products.length ? '<div class="pl-filters"><button data-app="" class="' + (app ? '' : 'on') + '">All apps</button>' + D.products.map(function (p) {
          return '<button data-app="' + esc(p.id) + '" class="' + (app === p.id ? 'on' : '') + '"><i style="background:' + esc(p.color) + '"></i>' + esc(p.name) + '</button>'; }).join('') + '</div>' : '') +
        (next.length ? '<p class="vb-section-title">Coming up</p><div class="pl-next">' + next.map(function (v) {
          return '<a class="pl-due' + (late(v) ? ' late' : '') + '" href="#video/' + esc(v.id) + '"><span class="when">' + esc(dueLabel(v.due)) + '</span><b>' + esc(v.title) + '</b>' + VB.statusChip(v.status) + '</a>'; }).join('') + '</div>' : '') +
        (mode === 'calendar' ? calendar(vids) :
        '<div class="pl-phonetabs ui-seg">' + VB.STATUSES.map(function (s) { return '<button data-coltab="' + s.key + '" class="' + (col === s.key ? 'on' : '') + '">' + s.label + '</button>'; }).join('') + '</div>' +
        '<div class="pl-board">' + VB.STATUSES.map(function (s) {
          var list = vids.filter(function (v) { return v.status === s.key; });
          if (s.key === 'idea' || s.key === 'script') list.sort(function (a, b) { return (b.priority || 0) - (a.priority || 0); });
          return '<section class="pl-col' + (col === s.key ? ' show' : '') + '" data-col="' + s.key + '"><div class="pl-colh">' + UI.icon(s.icon) + s.label + ' <span class="n">' + list.length + '</span>' +
            (s.key === 'idea' || s.key === 'script' ? '<button class="ui-btn ghost icon sm" data-add="' + s.key + '" aria-label="Add">' + UI.icon('plus') + '</button>' : '') + '</div>' +
            (s.key === 'idea' ? '<form class="pl-quick" data-quick><input type="text" name="title" maxlength="100" placeholder="Quick idea… (press Enter)" aria-label="Quick idea"></form>' : '') +
            '<div class="pl-cards">' + (list.length ? list.map(cardHtml).join('') : '<p class="small faint" style="margin:6px 4px">Nothing here.</p>') + '</div></section>';
        }).join('') + '</div>') +
        '<section class="pl-ideas"><div class="pl-ideas-head"><h2>💡 Idea machine</h2><span class="muted small">Video ideas from your app\'s details, with a script ready.</span><span class="ui-spacer"></span>' +
          (D.products.length ? '<select data-ideaapp>' + D.products.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === ideaApp ? ' selected' : '') + '>' + esc((p.emoji ? p.emoji + ' ' : '') + p.name) + '</option>'; }).join('') + '</select>' : '') + '</div>' +
          '<div data-ideas></div></section></div>';
      drawIdeas();
    }
    function calendar(vids) {
      var y = month.getFullYear(), mo = month.getMonth(), first = new Date(y, mo, 1, 12), start = new Date(first);
      start.setDate(1 - ((first.getDay() + 6) % 7));
      var today = iso(new Date()), days = [], d = new Date(start);
      for (var i = 0; i < 42; i++) { days.push(new Date(d)); d.setDate(d.getDate() + 1); if (i === 34 && d.getMonth() !== mo) break; }
      var unsched = vids.filter(function (v) { return !v.due && v.status !== 'published'; }).sort(function (a, b) { return (b.priority || 0) - (a.priority || 0); });
      function ev(v, pubDay) { return '<a class="pl-ev st-' + esc(v.status) + (late(v) ? ' late' : '') + '" draggable="true" data-ev="' + esc(v.id) + '" href="#video/' + esc(v.id) + '" title="' + esc(v.title + ' · ' + VB.status(v.status).label) + '">' + (pubDay ? '✓ ' : esc(VB.kind(v.kind).emoji) + ' ') + esc(v.title) + '</a>'; }
      return (unsched.length ? '<div class="pl-unsch"><span class="small muted">Not scheduled (drag onto a day):</span>' + unsched.slice(0, 12).map(function (v) { return ev(v); }).join('') + (unsched.length > 12 ? '<span class="small muted">+' + (unsched.length - 12) + ' more</span>' : '') + '</div>' : '') +
        '<div class="pl-cal"><div class="pl-calh"><button class="ui-btn ghost icon sm" data-mon="-1" aria-label="Previous month">◀</button><h2>' + esc(first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })) + '</h2>' +
        '<button class="ui-btn sm" data-mon="0">Today</button><button class="ui-btn ghost icon sm" data-mon="1" aria-label="Next month">▶</button></div>' +
        '<div class="pl-grid">' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(function (n) { return '<div class="pl-dow">' + n + '</div>'; }).join('') +
        days.map(function (day) {
          var k = iso(day), list = vids.filter(function (v) { return v.status !== 'published' && v.due === k; }), pub = vids.filter(function (v) { return v.status === 'published' && v.published_at && iso(new Date(v.published_at)) === k; });
          return '<div class="pl-day' + (day.getMonth() !== mo ? ' other' : '') + (k === today ? ' today' : '') + '" data-day="' + k + '"><span class="n">' + day.getDate() + '</span>' + pub.map(function (v) { return ev(v, true); }).join('') + list.map(function (v) { return ev(v); }).join('') + '</div>';
        }).join('') + '</div></div><p class="small muted" style="margin-top:8px">Click an empty day to plan a video for it. Drag a video to another day to move its publish date.</p>';
    }
    function drawIdeas() {
      var box = q('[data-ideas]'); if (!box) return;
      if (!D.products.length) { box.innerHTML = '<div class="ui-empty">' + UI.icon('grid') + '<h3>Add an app first</h3><p>Tell VideoBlog Buddy what you\'re building, and it suggests videos about it.</p><a class="ui-btn primary" href="#apps" data-go="apps">' + UI.icon('plus') + 'Add an app</a></div>'; return; }
      if (!ideaApp || !D.products.some(function (p) { return p.id === ideaApp; })) ideaApp = (app && D.products.some(function (p) { return p.id === app; })) ? app : D.products[0].id;
      var p = D.products.filter(function (x) { return x.id === ideaApp; })[0];
      var have = D.videos.map(function (v) { return v.title.toLowerCase(); });
      box.innerHTML = '<div class="pl-idea-grid">' + VB.ideasFor(p).map(function (i, n) {
        var done = have.indexOf(i.title.toLowerCase()) >= 0, t = VB.TEMPLATES.filter(function (x) { return x.key === i.tpl; })[0];
        return '<div class="pl-idea"><span class="k">' + esc(VB.kind(i.kind).emoji + ' ' + VB.kind(i.kind).label) + ' · ' + esc(t ? t.name : '') + '</span><b>' + esc(i.title) + '</b>' +
          (done ? '<span class="ui-badge good">' + UI.icon('check') + 'On the board</span>' : '<button class="ui-btn sm" data-idea="' + n + '">' + UI.icon('plus') + 'Add to board</button>') + '</div>';
      }).join('') + '</div>';
    }
    function move(id, status) {
      var v = D.videos.filter(function (x) { return x.id === id; })[0]; if (!v || v.status === status) return;
      var old = v.status; v.status = status; draw();
      UI.apiQuiet('video_update', id, { status: status }).then(function (r) {
        Object.assign(v, { status: r.video.status, published_at: r.video.published_at });
        if (status === 'published') { VB.confetti(); if (r.new_badges && r.new_badges.length) VB.badgePop(r.new_badges); }
      }, function (e) { v.status = old; draw(); UI.toast(e.message, 'error'); });
    }
    view.addEventListener('click', function (e) {
      var t = e.target, b;
      if ((b = t.closest('[data-app]'))) { app = b.getAttribute('data-app'); UI.store.set('pl.app', app); draw(); return; }
      if ((b = t.closest('[data-coltab]'))) { col = b.getAttribute('data-coltab'); draw(); return; }
      if ((b = t.closest('[data-mode]'))) { mode = b.getAttribute('data-mode'); UI.store.set('pl.view', mode); draw(); return; }
      if ((b = t.closest('[data-mon]'))) { var dm = +b.getAttribute('data-mon'); if (dm) month.setMonth(month.getMonth() + dm); else { month = new Date(); month.setDate(1); month.setHours(12, 0, 0, 0); } draw(); return; }
      if ((b = t.closest('[data-pri]'))) {
        e.preventDefault();
        var pv = D.videos.filter(function (x) { return x.id === b.closest('[data-id]').getAttribute('data-id'); })[0], np = ((pv.priority || 0) + 1) % 4;
        pv.priority = np; draw();
        UI.apiQuiet('video_update', pv.id, { priority: np })['catch'](function (er) { UI.toast(er.message, 'error'); });
        return;
      }
      if ((b = t.closest('.pl-day')) && !t.closest('.pl-ev')) {
        VB.newVideo({ products: D.products, product_id: app, status: 'idea', due: b.getAttribute('data-day'), handle: D.handle, onCreated: function () { load(); } });
        return;
      }
      if (t.closest('[data-new]') || (b = t.closest('[data-add]'))) {
        VB.newVideo({ products: D.products, product_id: app, status: b ? b.getAttribute('data-add') : 'idea', handle: D.handle, onCreated: function () { load(); } });
        return;
      }
      if ((b = t.closest('[data-mv]'))) {
        var card = b.closest('[data-id]'), v = D.videos.filter(function (x) { return x.id === card.getAttribute('data-id'); })[0];
        var keys = VB.STATUSES.map(function (s) { return s.key; }), i = keys.indexOf(v.status) + +b.getAttribute('data-mv');
        move(v.id, keys[VB.clamp(i, 0, 4)]); col = keys[VB.clamp(i, 0, 4)];
        return;
      }
      if ((b = t.closest('[data-idea]'))) {
        var p = D.products.filter(function (x) { return x.id === ideaApp; })[0], idea = VB.ideasFor(p)[+b.getAttribute('data-idea')];
        var tpl = VB.TEMPLATES.filter(function (x) { return x.key === idea.tpl; })[0];
        UI.busy(b, UI.api('video_create', { title: idea.title, kind: idea.kind, product_id: p.id, status: 'script', script: tpl ? VB.fill(tpl.body, p, D.handle) : '' })).then(function (r) {
          D.videos.unshift(r.video); UI.toast('Added to the board with a script', 'ok'); draw();
        });
      }
    });
    view.addEventListener('change', function (e) { if (e.target.matches('[data-ideaapp]')) { ideaApp = e.target.value; drawIdeas(); } });
    view.addEventListener('submit', function (e) {
      var f = e.target.closest('[data-quick]'); if (!f) return;
      e.preventDefault();
      var title = f.title.value.trim(); if (title.length < 2) return;
      f.title.disabled = true;
      UI.api('video_create', { title: title, status: 'idea', product_id: app || null }).then(function (r) {
        D.videos.unshift(r.video); draw(); UI.toast('Idea saved', 'ok');
        var nf = q('[data-quick] input'); if (nf) nf.focus();
      }, function () { f.title.disabled = false; });
    });
    /* calendar: drag a video onto a day to set its publish date */
    var evId = null;
    view.addEventListener('dragstart', function (e) { var c = e.target.closest && e.target.closest('[data-ev]'); if (!c) return; evId = c.getAttribute('data-ev'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', evId); } catch (x) { /* old */ } });
    view.addEventListener('dragover', function (e) { var c = e.target.closest && e.target.closest('.pl-day'); if (!c || !evId) return; e.preventDefault(); view.querySelectorAll('.pl-day.over').forEach(function (x) { x.classList.remove('over'); }); c.classList.add('over'); });
    view.addEventListener('drop', function (e) {
      var c = e.target.closest && e.target.closest('.pl-day'); if (!c || !evId) return; e.preventDefault();
      var vid = evId, day = c.getAttribute('data-day'), v = D.videos.filter(function (x) { return x.id === vid; })[0]; evId = null;
      if (!v || v.status === 'published') { draw(); return; }
      var old = v.due; v.due = day; draw();
      UI.apiQuiet('video_update', vid, { due: day }).then(function () { UI.toast('“' + v.title + '” is due ' + dueLabel(day).toLowerCase(), 'ok'); }, function (er) { v.due = old; draw(); UI.toast(er.message, 'error'); });
    });
    view.addEventListener('dragend', function () { evId = null; view.querySelectorAll('.pl-day.over').forEach(function (x) { x.classList.remove('over'); }); });
    var dragId = null;
    view.addEventListener('dragstart', function (e) { var c = e.target.closest && e.target.closest('.pl-card'); if (!c) return; dragId = c.getAttribute('data-id'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragId); } catch (x) { /* old */ } });
    view.addEventListener('dragover', function (e) { var c = e.target.closest && e.target.closest('.pl-col'); if (!c || !dragId) return; e.preventDefault(); view.querySelectorAll('.pl-col.over').forEach(function (x) { x.classList.remove('over'); }); c.classList.add('over'); });
    view.addEventListener('drop', function (e) { var c = e.target.closest && e.target.closest('.pl-col'); if (!c || !dragId) return; e.preventDefault(); var id = dragId; dragId = null; move(id, c.getAttribute('data-col')); });
    view.addEventListener('dragend', function () { dragId = null; view.querySelectorAll('.pl-col.over').forEach(function (x) { x.classList.remove('over'); }); });
    function load() { return UI.api('planner_get').then(function (d) { D = d; draw(); }); }
    return load();
  });
})();

/* ===== profile.html ===== */
(function () {
  var esc = UI.esc;
  UI.page('profile', { title: 'Your profile', auth: 'user' }, function (view, ctx) {
    var me = ctx.me;
    view.innerHTML = '<div class="ui-wrap ui-narrow"><div class="pf-head"><span class="ui-avatar">' + esc(UI.initials(me.name)) + '</span>' +
      '<div><h1>' + esc(me.name) + '</h1><div class="muted">' + esc(me.email) + (me.joined ? ' · member since ' + esc(UI.fmtDate(me.joined, { month: 'long', year: 'numeric' })) : '') + '</div></div></div>' +
      '<div class="pf-grid"><form class="ui-card ui-stack" data-name><h3>Your name</h3><label class="ui-field"><span>Shown to other people</span>' +
      '<input type="text" name="name" value="' + esc(me.name) + '" maxlength="60" required></label><button class="ui-btn primary" type="submit">Save</button></form>' +
      '<div class="ui-card ui-stack"><h3>Appearance</h3><p class="muted small">Follow your device, or pick one.</p><div data-theme-box></div>' +
      '<h3 style="margin-top:22px">Password</h3><p class="muted small">We\'ll email you a link to choose a new one.</p>' +
      '<button class="ui-btn" data-reset>' + UI.icon('mail') + 'Email me a reset link</button></div></div>' +
      '<div class="ui-card" style="margin-top:16px"><div class="pf-links">' +
      (me.is_admin ? '<a href="#admin" data-go="admin">' + UI.icon('shield') + 'Admin</a>' : '') +
      '<button data-feedback>' + UI.icon('chat') + 'Submit feedback</button>' +
      '<button data-lk-open="overview">' + UI.icon('lock') + 'Privacy &amp; Terms, and your data</button>' +
      '<button data-signout-here>' + UI.icon('logout') + 'Sign out</button></div></div></div>';
    function themeBox() {
      var t = UI.theme();
      view.querySelector('[data-theme-box]').innerHTML = '<div class="ui-seg">' + [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(function (o) {
        return '<button type="button" data-theme-pick="' + o[0] + '" class="' + (t === o[0] ? 'on' : '') + '">' + o[1] + '</button>';
      }).join('') + '</div>';
    }
    themeBox();
    view.addEventListener('click', function (e) {
      var t = e.target.closest('[data-theme-pick]');
      if (t) { UI.setTheme(t.getAttribute('data-theme-pick')); themeBox(); UI.renderChrome(); return; }
      if (e.target.closest('[data-reset]')) {
        UI.busy(e.target.closest('[data-reset]'), UI.auth('reset', { email: me.email })).then(function (r) { UI.toast(r.message, 'ok'); });
      }
      if (e.target.closest('[data-signout-here]')) UI.auth('logout');
    });
    view.querySelector('[data-name]').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = UI.formData(e.target);
      UI.busy(e.target.querySelector('[type=submit]'), UI.api('update_profile', v.name)).then(function (r) {
        UI.setMe(r.me); ctx.me = r.me; UI.toast('Saved', 'ok');
        view.querySelector('.pf-head h1').textContent = r.me.name;
      });
    });
  });
})();

/* ===== prompter.html ===== */
(function () {
  var esc = UI.esc;
  UI.page('prompter', { title: 'Teleprompter', auth: 'user', chrome: false }, function (view, ctx) {
    var id = ctx.args[0], P = null, S = Object.assign({ speed: 40, size: 34, mirror: false }, UI.store.get('pp', {}));
    function save() { UI.store.set('pp', S); }
    function key(e) {
      if (!P) return;
      if (e.key === ' ') { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSpeed(S.speed + 6); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setSpeed(S.speed - 6); }
      else if (e.key === 'ArrowLeft') P.nudge(-160); else if (e.key === 'ArrowRight') P.nudge(160);
      else if (e.key === 'Escape') history.back();
    }
    function toggle() { var on = P.toggle(); var b = view.querySelector('[data-pp=toggle]'); b.innerHTML = UI.icon(on ? 'pause' : 'play') + (on ? 'Pause' : 'Scroll'); }
    function setSpeed(v) { S.speed = VB.clamp(v, 8, 160); P.setSpeed(S.speed); view.querySelector('[data-sv]').textContent = S.speed; save(); }
    function setSize(v) { S.size = VB.clamp(v, 16, 80); P.setFont(S.size); view.querySelector('[data-zv]').textContent = S.size; save(); }
    document.addEventListener('keydown', key);
    var ready = UI.api('video_get', id).then(function (r) {
      view.innerHTML = '<div class="pp-wrap"><div data-roll></div><div class="pp-bar"><a class="ui-btn sm" href="#video/' + esc(id) + '/script">' + UI.icon('back') + 'Back</a>' +
        '<span class="pp-title">' + esc(r.video.title) + '</span><span class="grow"></span>' +
        '<button class="ui-btn primary" data-pp="toggle">' + UI.icon('play') + 'Scroll</button><button class="ui-btn sm" data-pp="top">' + UI.icon('refresh') + '</button>' +
        '<span class="small" style="color:#999;margin-left:6px">Speed</span><button class="ui-btn sm" data-pp="s-">−</button><span class="val" data-sv>' + S.speed + '</span><button class="ui-btn sm" data-pp="s+">+</button>' +
        '<span class="small" style="color:#999;margin-left:6px">Size</span><button class="ui-btn sm" data-pp="z-">A−</button><span class="val" data-zv>' + S.size + '</span><button class="ui-btn sm" data-pp="z+">A+</button>' +
        '<button class="ui-btn sm" data-pp="mirror">' + (S.mirror ? 'Mirrored' : 'Mirror') + '</button></div></div>';
      var el = view.querySelector('[data-roll]'); el.style.flex = '1'; el.style.display = 'flex';
      var inner = document.createElement('div'); inner.style.flex = '1'; el.appendChild(inner);
      P = VB.Prompter(inner, r.video.script || '', { speed: S.speed, fontSize: S.size });
      P.setMirror(S.mirror);
      view.addEventListener('click', function (e) {
        var b = e.target.closest('[data-pp]'); if (!b) return;
        var a = b.getAttribute('data-pp');
        if (a === 'toggle') toggle(); else if (a === 'top') P.reset();
        else if (a === 's-') setSpeed(S.speed - 6); else if (a === 's+') setSpeed(S.speed + 6);
        else if (a === 'z-') setSize(S.size - 4); else if (a === 'z+') setSize(S.size + 4);
        else if (a === 'mirror') { S.mirror = !S.mirror; P.setMirror(S.mirror); b.textContent = S.mirror ? 'Mirrored' : 'Mirror'; save(); }
      });
    });
    return { ready: ready, destroy: function () { document.removeEventListener('keydown', key); if (P) P.destroy(); } };
  });
})();

/* ===== record.html ===== */
(function () {
  var esc = UI.esc;
  var MODE_PICS = {
    screen_cam: '<svg viewBox="0 0 44 30"><rect x="1" y="1" width="42" height="28" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="34" cy="21" r="6" fill="#e62117"/></svg>',
    screen: '<svg viewBox="0 0 44 30"><rect x="1" y="1" width="42" height="28" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 9h20M8 15h28M8 21h14" stroke="currentColor" stroke-width="2"/></svg>',
    cam: '<svg viewBox="0 0 44 30"><circle cx="22" cy="12" r="6" fill="#e62117"/><path d="M10 29c1-7 6-10 12-10s11 3 12 10" fill="#e62117"/></svg>'
  };
  var MODE_NAMES = { screen_cam: 'Screen + camera', screen: 'Screen only', cam: 'Camera only' };

  UI.page('record', { title: 'Record', nav: 'Record', icon: 'record', auth: 'user', order: 20 }, function (view, ctx) {
    var S = Object.assign({ mode: VB.canScreen() ? 'screen_cam' : 'cam', camId: '', micId: undefined, quality: '1080', systemAudio: true, countdown: 3, prompter: true, pip: true, speed: 38,
      shape: 'circle', pos: 'br' }, UI.store.get('rec', {}));
    if (!VB.canScreen()) S.mode = 'cam';
    var data = null, video = null, takes = [], R = null, state = 'idle', timer = 0, raf = 0, prompter = null, review = null, reviewPlayer = null;
    var cancelCount = null, quietSince = 0, unsub = null, dead = false, pendingTab = null;
    function save() { UI.store.set('rec', { mode: S.mode, camId: S.camId, micId: S.micId, quality: S.quality, systemAudio: S.systemAudio, countdown: S.countdown, prompter: S.prompter, pip: S.pip, speed: S.speed, shape: S.shape, pos: S.pos }); UI.store.set('rec.cam', { shape: S.shape, pos: S.pos }); }
    function q(s) { return view.querySelector(s); }

    view.innerHTML = '<div class="ui-wrap"><div class="ui-skel" style="height:420px"></div></div>';

    function load() {
      var vid = ctx.args[0];
      return UI.api('planner_get').then(function (d) {
        data = d;
        if (!vid) { video = null; takes = []; return; }
        return UI.api('video_get', vid).then(function (r) { video = r.video; takes = r.takes; }, function () { video = null; takes = []; UI.toast('That video wasn\'t found: recording into a new one.'); });
      }).then(draw);
    }

    function draw() {
      var canScreen = VB.canScreen();
      view.innerHTML = '<div class="ui-wrap rc-wrap"><div class="rc-head"><h1><i class="vb-rec-dot"></i>Record</h1>' +
        '<div class="rc-for"><span class="small muted">for</span><select data-video aria-label="Video"><option value="">＋ A new video</option>' +
          data.videos.filter(function (v) { return v.status !== 'published'; }).map(function (v) { return '<option value="' + esc(v.id) + '"' + (video && v.id === video.id ? ' selected' : '') + '>' + esc(v.title) + '</option>'; }).join('') +
        '</select><input type="text" data-newtitle maxlength="100" placeholder="New video title" value="' + esc(defaultTitle()) + '"' + (video ? ' hidden' : '') + '></div>' +
        (video ? '<a class="ui-btn sm" href="#video/' + esc(video.id) + '">' + UI.icon('back') + 'Back to video</a>' : '') + '</div>' +
        '<div class="rc-layout"><section>' +
          '<div class="rc-stage" data-stage><video class="scr" data-scr muted playsinline hidden></video><video class="camfull" data-camfull muted playsinline hidden></video>' +
          '<div class="rc-ph" data-ph>' + phText() + '</div><video class="rc-bubble" data-bubble muted playsinline hidden></video>' +
          '<div class="rc-live" data-live hidden><i></i><span data-livet>0:00</span></div><div class="rc-count" data-count hidden></div></div>' +
          '<div class="rc-bar" data-bar></div>' +
          '<div data-prompt-wrap></div>' +
          '<div data-review></div>' +
          '<div class="rc-takes" data-takes></div>' +
        '</section><aside class="ui-card rc-panel" data-panel></aside></div></div>';
      drawPanel(); drawBar(); drawTakes(); drawPrompt(); applyBubble(); refreshDevices();
      if (!pendingTab && VB.pendingTab) { pendingTab = VB.pendingTab; VB.pendingTab = null; }
      if (pendingTab) { var p = pendingTab; pendingTab = null; startFromTab(p); }
    }
    function defaultTitle() {
      return 'Recording ' + new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }
    function phText() {
      if (S.mode === 'cam') return '<div>' + UI.icon('camera') + '<span class="tt">Camera only</span><span class="small">Press Record, or allow the camera to see yourself first.</span></div>';
      return '<div>' + UI.icon('monitor') + '<span class="tt">Your screen shows up here</span><span class="small">Press <b>Record</b> and pick a tab, a window or your whole screen.<br>Tip: pick a <b>Chrome tab</b> for click zooms.</span></div>';
    }
    function drawPanel() {
      var canScreen = VB.canScreen();
      q('[data-panel]').innerHTML =
        '<div><h3>What to record</h3><div class="rc-modes">' + ['screen_cam', 'screen', 'cam'].map(function (m) {
          return '<button class="rc-mode' + (S.mode === m ? ' on' : '') + '" data-mode="' + m + '"' + (m !== 'cam' && !canScreen ? ' disabled' : '') + '><div class="pic">' + MODE_PICS[m] + '</div>' + MODE_NAMES[m] + '</button>';
        }).join('') + '</div>' + (canScreen ? '' : '<p class="ui-hint">Screen recording needs Chrome, Edge or Firefox on a computer. Here you can record camera takes with the teleprompter.</p>') + '</div>' +
        '<div class="ui-stack" style="--gap:10px"><label class="ui-field" ' + (S.mode === 'screen' ? 'hidden' : '') + '><span>Camera</span><select data-cam><option value="">Default camera</option></select></label>' +
        '<label class="ui-field"><span>Microphone</span><select data-mic><option value="default">Default microphone</option><option value="">No microphone</option></select></label>' +
        '<div class="rc-mic"><span>Level</span><div class="vb-meter"><i data-meter></i></div><span data-micmsg></span></div>' +
        '<button class="ui-btn sm" data-allow>' + UI.icon('mic') + 'Allow camera &amp; mic</button></div>' +
        (S.mode !== 'cam' ? '<label class="ui-check"><input type="checkbox" data-sys' + (S.systemAudio ? ' checked' : '') + '><span>Record the sound of the tab or screen too</span></label>' : '') +
        (S.mode === 'screen_cam' ? '<div><h3>Camera bubble</h3><div class="rc-row2"><div class="ui-seg">' + [['circle', '●'], ['rounded', '▢'], ['square', '■']].map(function (o) {
            return '<button data-shape="' + o[0] + '" class="' + (S.shape === o[0] ? 'on' : '') + '" aria-label="' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div>' +
          '<div class="ui-seg">' + [['tl', '↖'], ['tr', '↗'], ['bl', '↙'], ['br', '↘']].map(function (o) {
            return '<button data-pos="' + o[0] + '" class="' + (S.pos === o[0] ? 'on' : '') + '" aria-label="corner ' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div></div>' +
          '<p class="ui-hint">The camera is saved separately, so you can still move, resize or hide the bubble in the editor.</p></div>' : '') +
        '<div class="rc-row2"><div><h3>Quality</h3><div class="ui-seg">' + [['720', '720p'], ['1080', '1080p']].map(function (o) {
            return '<button data-q="' + o[0] + '" class="' + (S.quality === o[0] ? 'on' : '') + '">' + o[1] + '</button>'; }).join('') + '</div></div>' +
          '<div><h3>Countdown</h3><div class="ui-seg">' + [[0, 'Off'], [3, '3 s'], [5, '5 s']].map(function (o) {
            return '<button data-cd="' + o[0] + '" class="' + (S.countdown === o[0] ? 'on' : '') + '">' + o[1] + '</button>'; }).join('') + '</div></div></div>' +
        '<div class="ui-stack"><label class="ui-check"><input type="checkbox" data-prompton' + (S.prompter ? ' checked' : '') + '><span>Show the teleprompter' + (video && video.script ? '' : ' <span class="muted small">(this video has no script yet)</span>') + '</span></label>' +
        (VB.pip.supported() ? '<label class="ui-check"><input type="checkbox" data-pipon' + (S.pip ? ' checked' : '') + '><span>Floating controls (always on top, follows you to other tabs)</span></label>' : '') + '</div>' +
        '<div class="rc-ext" data-extline>' + extLine() + '</div>' +
        '<div><h3>Add a file instead</h3><label class="ui-btn sm" style="cursor:pointer">' + UI.icon('upload') + 'Import a video file<input type="file" accept="video/*" data-import hidden></label>' +
        '<p class="ui-hint">A phone clip or an older recording becomes a take of this video.</p></div>';
    }
    function extLine() {
      var s = VB.ext.state;
      if (s.paired) return UI.icon('puzzle') + ' <b>Extension connected.</b> Clicks in the tab you record become auto-zooms. To record any tab in one click, open the extension on that tab.';
      if (s.installed) return UI.icon('puzzle') + ' Extension installed. Open its popup here and press <b>Connect</b> to record clicks.';
      return UI.icon('puzzle') + ' Want auto-zoom on your clicks and one-click tab recording? <a href="#extension">Get the browser extension</a>.';
    }
    function drawBar() {
      var bar = q('[data-bar]'); if (!bar) return;
      var rec = state === 'recording' || state === 'paused';
      if (rec) {
        bar.innerHTML = '<span class="rc-timer" data-timer>' + VB.fmtTime(R ? R.t() : 0) + '</span>' +
          '<button class="ui-btn" data-act="pause">' + UI.icon(state === 'paused' ? 'play' : 'pause') + (state === 'paused' ? 'Resume' : 'Pause') + '</button>' +
          '<button class="ui-btn" data-act="mark" title="Chapter marker (M)">' + UI.icon('flag') + 'Marker</button>' +
          '<button class="ui-btn primary" data-act="stop">' + UI.icon('stop') + 'Stop</button>' +
          '<button class="ui-btn ghost sm" data-act="restart" title="Throw this take away and start again">' + UI.icon('refresh') + 'Restart</button>' +
          '<span class="grow"></span><div class="rc-mic"><div class="vb-meter"><i data-meter2></i></div><span data-micmsg2></span></div>';
      } else if (state === 'arming' || state === 'countdown' || state === 'saving') {
        bar.innerHTML = '<button class="ui-btn primary rc-big" disabled>' + (state === 'saving' ? 'Saving…' : state === 'arming' ? 'Getting ready…' : 'Get ready…') + '</button>' +
          (state === 'countdown' ? '<button class="ui-btn" data-act="cancel">Cancel</button>' : '');
      } else if (state === 'review') {
        bar.innerHTML = '';
      } else {
        bar.innerHTML = '<button class="ui-btn primary rc-big" data-act="record"' + (VB.canRecord() ? '' : ' disabled') + '><i class="rec-dot"></i>Record</button>' +
          (S.mode !== 'cam' ? '<button class="ui-btn" data-act="choose">' + UI.icon('monitor') + (R && R.display ? 'Change screen' : 'Choose screen') + '</button>' : '') +
          '<span class="grow"></span><div class="rc-keys"><span><span class="vb-kbd">M</span> marker</span><span><span class="vb-kbd">P</span> pause</span><span><span class="vb-kbd">S</span> stop</span></div>' +
          (VB.canRecord() ? '' : '<p class="ui-error" style="width:100%">This browser can\'t record video. Use Chrome, Edge, Firefox or Safari.</p>');
      }
    }
    function drawPrompt() {
      var box = q('[data-prompt-wrap]'); if (!box) return;
      if (prompter) { prompter.destroy(); prompter = null; }
      if (!S.prompter || state === 'review') { box.innerHTML = ''; return; }
      var script = video && video.script;
      box.innerHTML = '<div class="rc-prompt' + (script ? '' : ' none') + '" data-prompter></div><div class="rc-prompt-bar"><span>Teleprompter</span>' +
        '<button class="ui-btn sm" data-pr="toggle">' + UI.icon('play') + 'Scroll</button><button class="ui-btn sm" data-pr="slower">−</button><span data-prspeed>' + S.speed + '</span><button class="ui-btn sm" data-pr="faster">+</button>' +
        '<button class="ui-btn sm ghost" data-pr="reset">' + UI.icon('refresh') + 'Top</button>' +
        (video ? '<a class="ui-btn sm ghost" href="#video/' + esc(video.id) + '/script">' + UI.icon('edit') + 'Edit script</a><a class="ui-btn sm ghost" href="#prompter/' + esc(video.id) + '">' + UI.icon('scroll') + 'Full screen</a>' : '') +
        '<span class="small">Starts scrolling when you record.</span></div>';
      prompter = VB.Prompter(q('[data-prompter]'), script || '', { speed: S.speed });
    }
    function drawTakes() {
      var box = q('[data-takes]'); if (!box) return;
      if (!video) { box.innerHTML = '<p class="small muted">Takes you keep are saved into a new video. Record as many as you like: you\'ll pick and trim them in the editor.</p>'; return; }
      box.innerHTML = '<div class="ui-row between" style="margin-bottom:10px"><h3 style="margin:0">' + UI.plural(takes.length, 'take') + ' in “' + esc(video.title) + '”</h3>' +
        (takes.length ? '<a class="ui-btn sm blue" href="#edit/' + esc(video.id) + '">' + UI.icon('scissors') + 'Open the editor</a>' : '') + '</div>' +
        (takes.length ? takes.map(function (t) {
          return '<div class="rc-take">' + (VB.takeThumb(t) ? '<img src="' + esc(VB.takeThumb(t)) + '" alt="">' : '<span class="noimg"></span>') +
            '<div class="grow"><b>' + esc(t.label) + '</b>' + (t.starred ? ' ⭐' : '') + '<div class="small muted">' + VB.fmtTime(t.duration) + ' · ' + esc(MODE_NAMES[t.mode] || 'Imported') +
            (t.markers.length ? ' · ' + UI.plural(t.markers.length, 'marker') : '') + (t.clicks.length ? ' · ' + UI.plural(t.clicks.length, 'click') : '') + '</div></div></div>';
        }).join('') : '<p class="small muted">No takes yet.</p>');
    }
    function applyBubble() {
      var b = q('[data-bubble]'); if (!b) return;
      b.className = 'rc-bubble ' + S.shape + ' ' + S.pos;
      var stage = q('[data-stage]'); stage.classList.toggle('camonly', S.mode === 'cam');
      var showScr = S.mode !== 'cam' && R && R.display, showCam = R && R.cam;
      q('[data-scr]').hidden = !showScr;
      q('[data-camfull]').hidden = !(S.mode === 'cam' && showCam);
      b.hidden = !(S.mode === 'screen_cam' && showCam);
      q('[data-ph]').hidden = !!(showScr || (S.mode === 'cam' && showCam));
      if (!q('[data-ph]').hidden) q('[data-ph]').innerHTML = phText();
    }
    function attach() {
      if (!R) return;
      var scr = q('[data-scr]'), cf = q('[data-camfull]'), bb = q('[data-bubble]');
      if (R.display && scr.srcObject !== R.display) { scr.srcObject = R.display; scr.play()['catch'](function () {}); }
      if (R.cam) {
        if (cf.srcObject !== R.cam) { cf.srcObject = R.cam; cf.play()['catch'](function () {}); }
        if (bb.srcObject !== R.cam) { bb.srcObject = R.cam; bb.play()['catch'](function () {}); }
      }
      applyBubble();
    }
    function refreshDevices() {
      VB.devices().then(function (d) {
        var cs = q('[data-cam]'), ms = q('[data-mic]'), al = q('[data-allow]');
        if (cs) cs.innerHTML = '<option value="">Default camera</option>' + d.cams.filter(function (c) { return c.deviceId && c.deviceId !== 'default'; }).map(function (c, i) {
          return '<option value="' + esc(c.deviceId) + '"' + (c.deviceId === S.camId ? ' selected' : '') + '>' + esc(c.label || 'Camera ' + (i + 1)) + '</option>'; }).join('');
        if (ms) {
          ms.innerHTML = '<option value="default">Default microphone</option>' + d.mics.filter(function (c) { return c.deviceId && c.deviceId !== 'default' && c.deviceId !== 'communications'; }).map(function (c, i) {
            return '<option value="' + esc(c.deviceId) + '">' + esc(c.label || 'Microphone ' + (i + 1)) + '</option>'; }).join('') + '<option value="">No microphone</option>';
          ms.value = S.micId === '' ? '' : (S.micId || 'default');
          if (ms.value === '' && S.micId !== '') ms.value = 'default';
        }
        if (al) al.hidden = d.labels;
      });
    }
    function recorder() {
      if (!R) {
        R = VB.Recorder({ mode: S.mode, camId: S.camId, micId: S.micId === 'default' || S.micId == null ? undefined : S.micId, quality: S.quality, systemAudio: S.systemAudio,
          onEnded: function () { if (state === 'recording' || state === 'paused') { UI.toast('Screen sharing stopped: saving the take.'); stop(); } else { if (R && R.display) { R.display = null; } attach(); drawBar(); } } });
        VB.rec = R;
      }
      return R;
    }
    function resetRecorder() { if (R) { R.release(); R = null; VB.rec = null; } }
    function meterLoop() {
      cancelAnimationFrame(raf);
      (function tick() {
        if (dead) return;
        var lv = R ? R.level() : 0, a = q('[data-meter]'), b = q('[data-meter2]');
        if (a) a.style.width = Math.round(lv * 100) + '%';
        if (b) b.style.width = Math.round(lv * 100) + '%';
        var rec = state === 'recording';
        if (rec && R && R.mic) {
          if (lv > 0.03) quietSince = 0; else if (!quietSince) quietSince = performance.now();
          var msg = q('[data-micmsg2]'); if (msg) { var quiet = quietSince && performance.now() - quietSince > 6000; msg.textContent = quiet ? 'Is your mic muted?' : ''; msg.className = quiet ? 'rc-warn' : ''; }
        }
        raf = requestAnimationFrame(tick);
      })();
    }
    function prime(withScreen, tabId) {
      state = 'arming'; drawBar();
      return recorder().prepare(withScreen, tabId).then(function () { state = 'idle'; attach(); refreshDevices(); meterLoop(); drawBar(); },
        function (e) {
          state = 'idle'; drawBar(); attach();
          var msg = e && e.name === 'NotAllowedError' ? (withScreen ? 'Screen sharing was cancelled.' : 'The browser blocked the camera or microphone. Allow them in the address bar, then try again.')
            : e && e.name === 'NotFoundError' ? 'No camera or microphone was found. Pick “No microphone” or the screen-only mode.' : (e && e.message) || 'Couldn\'t start recording.';
          UI.toast(msg, 'error'); throw e;
        });
    }
    function countdown(n) {
      return new Promise(function (res, rej) {
        if (!n) return res();
        state = 'countdown'; drawBar();
        var box = q('[data-count]'), left = n, stop = false;
        cancelCount = function () { stop = true; box.hidden = true; VB.pip.update({ countdown: '' }); VB.ext.send('countdown', { n: 0 }); rej(new Error('cancelled')); };
        box.hidden = false;
        (function step() {
          if (stop || dead) return;
          if (left <= 0) { box.hidden = true; VB.pip.update({ countdown: '' }); VB.ext.send('countdown', { n: 0 }); cancelCount = null; return res(); }
          box.innerHTML = '<span>' + left + '</span>'; VB.pip.update({ countdown: String(left) }); VB.ext.send('countdown', { n: left });
          left--; setTimeout(step, 1000);
        })();
      });
    }
    function openPip() {
      if (!S.pip || !VB.pip.supported() || S.mode === 'cam') return Promise.resolve(null);
      return VB.pip.open({ cam: null, script: S.prompter && video && video.script, speed: S.speed, onAction: function (a) { act(a); } });
    }
    /* Record: floating window first (it needs the click), then the screen picker, countdown, go. */
    function record(tabId, source) {
      if (state !== 'idle') return;
      var pipP = openPip();
      pipP.then(function () {
        return prime(S.mode !== 'cam', tabId);
      }).then(function () {
        if (VB.pip.win && R.cam) VB.pip.fill({ cam: R.cam, script: S.prompter && video && video.script, speed: S.speed, onAction: function (a) { act(a); } });
        return countdown(S.countdown);
      }).then(function () {
        R.start(video ? video.id : null, source);
        state = 'recording'; quietSince = 0;
        VB.ext.send('rec', { on: true });
        if (prompter && S.prompter) prompter.start();
        VB.pip.update({ prompt: true });
        q('[data-live]').hidden = false;
        window.onbeforeunload = function () { return 'You are recording. Leave anyway?'; };
        tick(); drawBar();
      })['catch'](function (e) { if (e && e.message !== 'cancelled') console.warn(e); state = 'idle'; drawBar(); VB.pip.close(); });
    }
    function tick() {
      clearInterval(timer);
      timer = setInterval(function () {
        if (!R || dead) return;
        var t = VB.fmtTime(R.t()), el = q('[data-timer]'), lt = q('[data-livet]');
        if (el) el.textContent = t; if (lt) lt.textContent = t;
        var live = q('[data-live]'); if (live) live.classList.toggle('paused', state === 'paused');
        VB.pip.update({ time: t, paused: state === 'paused' });
      }, 250);
    }
    function flash(text) {
      var st = q('[data-stage]'); if (!st) return;
      var f = document.createElement('div'); f.className = 'rc-flash'; f.textContent = text; st.appendChild(f);
      setTimeout(function () { f.remove(); }, 1400);
    }
    function act(a) {
      if (a === 'record') return record();
      if (a === 'choose') { if (R && R.display) { R.display.getTracks().forEach(function (t) { t.stop(); }); R.display = null; } return prime(true)['catch'](function () {}); }
      if (a === 'cancel') { if (cancelCount) cancelCount(); return; }
      if (state !== 'recording' && state !== 'paused') return;
      if (a === 'pause') {
        if (state === 'recording') { R.pause(); state = 'paused'; if (prompter) prompter.pause(); VB.pip.update({ paused: true, prompt: false }); VB.ext.send('rec', { on: true, paused: true }); }
        else { R.resume(); state = 'recording'; if (prompter && S.prompter) prompter.start(); VB.pip.update({ paused: false, prompt: true }); VB.ext.send('rec', { on: true }); }
        drawBar();
      } else if (a === 'mark') {
        var m = R.mark('chapter'); if (m) flash('⚑ ' + m[2] + ' at ' + VB.fmtTime(m[0]));
      } else if (a === 'stop') stop();
      else if (a === 'restart') {
        UI.confirm({ title: 'Throw this take away and start again?', ok: 'Restart', danger: true }).then(function (yes) {
          if (!yes || !R) return;
          stop(true).then(function (info) { if (info) VB.vault.dropTake(info.key); record(); });
        });
      }
    }
    function stop(silent) {
      if (state !== 'recording' && state !== 'paused') return Promise.resolve(null);
      var thumb = VB.liveThumb(q('[data-scr]'), q('[data-bubble]'), S.mode === 'cam' ? 'cam' : S.mode);
      if (S.mode === 'cam') thumb = VB.liveThumb(null, q('[data-camfull]'), 'cam');
      state = 'saving'; drawBar(); clearInterval(timer);
      window.onbeforeunload = null;
      VB.ext.send('rec', { on: false });
      if (prompter) prompter.pause();
      VB.pip.close();
      var live = q('[data-live]'); if (live) live.hidden = true;
      return R.stop().then(function (info) {
        info.thumb = thumb;
        if (silent) { state = 'idle'; drawBar(); return info; }
        showReview(info); return info;
      }, function (e) {
        state = 'idle'; drawBar(); UI.toast(e.message, 'error');
        if (e.info && e.info.mainBlob) VB.download(e.info.mainBlob, 'recording.' + (/mp4/.test(e.info.main.type) ? 'mp4' : 'webm'));
        return null;
      });
    }
    function showReview(info) {
      state = 'review'; review = info; drawBar(); drawPrompt();
      var n = takes.length + 1, box = q('[data-review]');
      box.innerHTML = '<div class="ui-card rc-review"><div class="ui-row between"><h3 style="margin:0">Take ' + n + ': how was it?</h3><span class="ui-badge good">' + UI.icon('check') + 'Saved on this computer</span></div>' +
        '<canvas data-rv style="margin-top:12px"></canvas><div class="ui-row" style="margin-top:8px"><button class="ui-btn sm" data-rvplay>' + UI.icon('play') + 'Play</button><span class="small muted" data-rvt>0:00</span></div>' +
        '<div class="facts"><span>' + VB.fmtTime(info.duration) + '</span><span>' + VB.fmtBytes(info.bytes) + '</span><span>' + UI.plural(info.markers.length, 'marker') + '</span>' +
          (info.main.surface === 'browser' ? '<span>' + UI.plural(info.clicks.length, 'click') + ' recorded</span>' : (S.mode !== 'cam' ? '<span>Clicks are recorded when you share a tab with the extension on</span>' : '')) + '</div>' +
        '<label class="ui-field"><span>Name this take</span><input type="text" data-rvlabel maxlength="60" value="Take ' + n + '"></label>' +
        '<div class="ui-row" style="margin-top:12px"><button class="ui-btn primary" data-rv="keep">' + UI.icon('check') + 'Keep take</button>' +
        '<button class="ui-btn" data-rv="retake">' + UI.icon('refresh') + 'Retake</button><button class="ui-btn ghost danger" data-rv="discard">' + UI.icon('trash') + 'Discard</button>' +
        '<span class="ui-spacer"></span><button class="ui-btn ghost sm" data-rv="dl">' + UI.icon('download') + 'Download raw</button></div></div>';
      var t = { id: 'review', key: info.key, mode: info.mode, duration: info.duration, cam_offset: info.cam_offset, clicks: info.clicks, markers: info.markers, main: info.main, cam: info.cam, label: 'Take' };
      VB.forgetSource('review');
      VB.openTake(t).then(function (src) {
        if (dead || state !== 'review') return;
        var e = VB.fullEdit(null, video ? video.kind : 'youtube'); e.cam.shape = S.shape; e.cam.pos = S.pos; e.transition = 'cut'; e.scenes = [VB.takeScene(t)]; e.layout = e.aspect === '9:16' ? 'stack' : 'pip';
        var srcs = {}; srcs[t.id] = src;
        reviewPlayer = VB.Player(q('[data-rv]'), { onTime: function (o) { var el = q('[data-rvt]'); if (el) el.textContent = VB.fmtTime(o) + ' / ' + VB.fmtTime(info.duration); },
          onState: function (p) { var b = q('[data-rvplay]'); if (b) b.innerHTML = UI.icon(p ? 'pause' : 'play') + (p ? 'Pause' : 'Play'); } });
        reviewPlayer.setPlan(VB.plan(e, [t], srcs));
        reviewPlayer.seek(Math.min(1, info.duration / 2));
      });
    }
    function endReview() {
      if (reviewPlayer) { reviewPlayer.destroy(); reviewPlayer = null; }
      VB.forgetSource('review');
      review = null; state = 'idle';
      var box = q('[data-review]'); if (box) box.innerHTML = '';
      drawBar(); drawPrompt();
    }
    function ensureVideo() {
      if (video) return Promise.resolve(video);
      var title = (q('[data-newtitle]') && q('[data-newtitle]').value.trim()) || defaultTitle();
      return UI.api('video_create', { title: title, status: 'recorded' }).then(function (r) {
        video = r.video; data.videos.unshift(r.video);
        history.replaceState(null, '', '#record/' + video.id);
        return video;
      });
    }
    function keep(btn) {
      var info = review, label = (q('[data-rvlabel]').value || '').trim();
      var meta = Object.assign({}, info, { label: label }); delete meta.mainBlob; delete meta.camBlob;
      return UI.busy(btn, ensureVideo().then(function (v) { return UI.api('take_add', v.id, meta); })).then(function (r) {
        takes.push(r.take); video.status = r.video.status;
        endReview(); draw();
        UI.toast('Take kept. Record another, or open the editor.', 'ok');
        if (takes.length === 1 && !UI.store.get('first-take-cheer')) { UI.store.set('first-take-cheer', 1); VB.confetti(80); }
      });
    }
    function importFile(file) {
      if (!file) return;
      var url = URL.createObjectURL(file);
      VB.videoEl(url).then(function (v) {
        var dur = v.duration;
        if (!(dur > 0.3)) throw new Error('That video seems to be empty.');
        return VB.seek(v, Math.min(dur / 3, 4)).then(function () {
          var c = document.createElement('canvas'); c.width = v.videoWidth || 1280; c.height = v.videoHeight || 720; c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
          var key = VB.uid('k'), portrait = v.videoHeight > v.videoWidth;
          var meta = { key: key, label: file.name.replace(/\.[^.]+$/, '').slice(0, 60), mode: portrait ? 'cam' : 'screen', duration: +dur.toFixed(2), source: 'upload',
            main: { w: v.videoWidth, h: v.videoHeight, type: file.type, surface: 'file', audio: true }, cam: null, cam_offset: 0, markers: [], clicks: [], bytes: file.size,
            device: VB.vault.id(), thumb: VB.smallJpeg(c, 320) };
          return VB.vault.put('take:' + key + ':main', file, { name: file.name }).then(ensureVideo).then(function (vv) { return UI.api('take_add', vv.id, meta); });
        });
      }).then(function (r) { takes.push(r.take); draw(); UI.toast('Imported as a take', 'ok'); }, function (e) { UI.toast(e.message || 'That file couldn\'t be read.', 'error'); })
        .then(function () { URL.revokeObjectURL(url); });
    }
    function startFromTab(m) {
      if (state !== 'idle') { UI.toast('Already recording.'); return; }
      if (S.mode === 'cam') { S.mode = 'screen_cam'; save(); resetRecorder(); drawPanel(); }
      if (R && R.display) { R.display.getTracks().forEach(function (t) { t.stop(); }); R.display = null; }
      UI.toast('Recording the tab “' + (m.title || 'tab') + '”');
      record(m.streamId, 'extension');
    }

    view.addEventListener('click', function (e) {
      var t = e.target, b;
      if ((b = t.closest('[data-act]'))) { act(b.getAttribute('data-act')); return; }
      if ((b = t.closest('[data-mode]'))) { if (state !== 'idle') return; S.mode = b.getAttribute('data-mode'); save(); resetRecorder(); drawPanel(); drawBar(); applyBubble(); refreshDevices(); return; }
      if ((b = t.closest('[data-shape]'))) { S.shape = b.getAttribute('data-shape'); save(); drawPanel(); applyBubble(); refreshDevices(); return; }
      if ((b = t.closest('[data-pos]'))) { S.pos = b.getAttribute('data-pos'); save(); drawPanel(); applyBubble(); refreshDevices(); return; }
      if ((b = t.closest('[data-q]'))) { if (state !== 'idle') return; S.quality = b.getAttribute('data-q'); save(); if (R) { R.opts.quality = S.quality; } drawPanel(); refreshDevices(); return; }
      if ((b = t.closest('[data-cd]'))) { S.countdown = +b.getAttribute('data-cd'); save(); drawPanel(); refreshDevices(); return; }
      if (t.closest('[data-allow]')) { prime(false)['catch'](function () {}); return; }
      if ((b = t.closest('[data-pr]'))) {
        var a = b.getAttribute('data-pr');
        if (!prompter) return;
        if (a === 'toggle') { var on = prompter.toggle(); b.innerHTML = UI.icon(on ? 'pause' : 'play') + (on ? 'Pause' : 'Scroll'); }
        if (a === 'slower' || a === 'faster') { S.speed = VB.clamp(S.speed + (a === 'faster' ? 6 : -6), 8, 140); prompter.setSpeed(S.speed); q('[data-prspeed]').textContent = S.speed; save(); }
        if (a === 'reset') prompter.reset();
        return;
      }
      if (t.closest('[data-rvplay]')) { if (reviewPlayer) reviewPlayer.toggle(); return; }
      if ((b = t.closest('[data-rv]'))) {
        var k = b.getAttribute('data-rv');
        if (k === 'keep') keep(b);
        else if (k === 'dl') { var info = review; VB.download(info.mainBlob, VB.slug(video ? video.title : 'take') + '-screen.webm'); if (info.camBlob) VB.download(info.camBlob, VB.slug(video ? video.title : 'take') + '-camera.webm'); }
        else if (k === 'discard' || k === 'retake') {
          var key = review.key;
          (k === 'discard' ? UI.confirm({ title: 'Discard this take?', text: 'The recording is deleted from this computer.', ok: 'Discard', danger: true }) : Promise.resolve(true)).then(function (yes) {
            if (!yes) return;
            VB.vault.dropTake(key); endReview();
            if (k === 'retake') record();
          });
        }
      }
    });
    view.addEventListener('change', function (e) {
      var t = e.target;
      if (t.matches('[data-video]')) {
        if (state !== 'idle') { t.value = video ? video.id : ''; return; }
        if (t.value) UI.go('record', t.value); else { video = null; takes = []; history.replaceState(null, '', '#record'); draw(); }
        return;
      }
      if (t.matches('[data-cam]')) { S.camId = t.value; save(); if (R && state === 'idle') { if (R.cam) R.cam.getTracks().forEach(function (x) { x.stop(); }); R.cam = null; R.opts.camId = S.camId; prime(false)['catch'](function () {}); } return; }
      if (t.matches('[data-mic]')) { S.micId = t.value === 'default' ? undefined : t.value; save(); if (state === 'idle') { resetRecorder(); if (t.value !== '') prime(false)['catch'](function () {}); } return; }
      if (t.matches('[data-sys]')) { S.systemAudio = t.checked; save(); if (R) R.opts.systemAudio = S.systemAudio; return; }
      if (t.matches('[data-prompton]')) { S.prompter = t.checked; save(); drawPrompt(); return; }
      if (t.matches('[data-pipon]')) { S.pip = t.checked; save(); return; }
      if (t.matches('[data-import]')) importFile(t.files[0]);
    });
    function onKey(e) {
      if (/INPUT|TEXTAREA|SELECT/.test((e.target.tagName || '')) || e.ctrlKey || e.metaKey || e.altKey) return;
      var k = e.key.toLowerCase();
      if (k === 'm') act('mark'); else if (k === 'p') act('pause'); else if (k === 's') act('stop');
      else if (k === 'escape' && cancelCount) cancelCount();
    }
    document.addEventListener('keydown', onKey);
    unsub = VB.ext.on(function (m) {
      if (m.type === 'tab-stream' && m.streamId) { if (data) startFromTab(m); else pendingTab = m; }
      else if (m.type === 'command') {
        if (m.name === 'start' && state === 'idle') { UI.toast('Use the extension on the tab you want to record, or press Record here.'); }
        else act(m.name === 'marker' ? 'mark' : m.name);
      } else if (m.type === 'click' && R) R.addClick(m.ts, m.x, m.y);
      else if (m.type === 'hello' || m.type === 'paired') { var el = q('[data-extline]'); if (el) el.innerHTML = extLine(); }
    });
    VB.ext.ping();
    return {
      ready: load(),
      destroy: function () {
        dead = true; document.removeEventListener('keydown', onKey); if (unsub) unsub(); clearInterval(timer); cancelAnimationFrame(raf);
        if (prompter) prompter.destroy();
        if (reviewPlayer) reviewPlayer.destroy();
        window.onbeforeunload = null;
        if (cancelCount) { try { cancelCount(); } catch (e) { /* cancelled */ } }
        if ((state === 'recording' || state === 'paused') && R) {  // leaving mid-take: save it into the video
          var rr = R, v = video;
          UI.toast('Recording stopped. Saving the take…');
          VB.ext.send('rec', { on: false }); VB.pip.close();
          rr.stop().then(function (info) {
            var meta = Object.assign({}, info, { label: 'Take (auto-saved)' }); delete meta.mainBlob; delete meta.camBlob;
            return (v ? Promise.resolve(v) : UI.api('video_create', { title: defaultTitle(), status: 'recorded' }).then(function (r) { return r.video; }))
              .then(function (vv) { return UI.api('take_add', vv.id, meta); });
          }).then(function () { UI.toast('Take saved', 'ok'); rr.release(); }, function () { rr.release(); });
        } else {
          if (state === 'review' && review) {  // left without choosing: keep it rather than lose it
            var info2 = review, meta2 = Object.assign({}, info2, { label: 'Take (unreviewed)' }); delete meta2.mainBlob; delete meta2.camBlob;
            ensureVideo().then(function (vv) { return UI.api('take_add', vv.id, meta2); }).then(function () { UI.toast('The take you didn\'t review was kept', 'ok'); });
          }
          VB.forgetSource('review');
          resetRecorder(); VB.pip.close();
        }
      }
    };
  });
})();

/* ===== video.html ===== */
(function () {
  var esc = UI.esc;
  var TABS = [['takes', 'Takes', 'film'], ['script', 'Script', 'scroll'], ['publish', 'Publish kit', 'rocket'], ['thumbnail', 'Thumbnail', 'image']];
  var MODE = { screen_cam: 'Screen + camera', screen: 'Screen', cam: 'Camera', file: 'Imported' };

  /* A classic player bar under a canvas Player. -> {el, update(o)} */
  VB.playerBar = function (player, opts) {
    opts = opts || {};
    var el = document.createElement('div'); el.className = 'vb-ctl';
    el.innerHTML = '<button data-pp aria-label="Play">' + UI.icon('play') + '</button><span class="tm" data-tm>0:00 / 0:00</span><div class="vb-scrub" data-scrub><i></i><b></b></div>' +
      (opts.full ? '<button data-full aria-label="Full screen">' + UI.icon('external') + '</button>' : '');
    var scrub = el.querySelector('[data-scrub]'), drag = false;
    function at(e) { var r = scrub.getBoundingClientRect(); return VB.clamp((e.clientX - r.left) / r.width, 0, 1) * (player.plan ? player.plan.outDur : 0); }
    scrub.addEventListener('pointerdown', function (e) { drag = true; try { scrub.setPointerCapture(e.pointerId); } catch (x) { /* synthetic */ } player.seek(at(e)); });
    scrub.addEventListener('pointermove', function (e) { if (drag) player.seek(at(e)); });
    scrub.addEventListener('pointerup', function () { drag = false; });
    el.querySelector('[data-pp]').addEventListener('click', function () { player.toggle(); });
    var full = el.querySelector('[data-full]');
    if (full) full.addEventListener('click', function () { var c = opts.canvas; if (c && c.requestFullscreen) c.requestFullscreen()['catch'](function () {}); });
    return {
      el: el,
      update: function (o) {
        var d = player.plan ? player.plan.outDur : 0, k = d ? o / d : 0;
        el.querySelector('[data-tm]').textContent = VB.fmtTime(o) + ' / ' + VB.fmtTime(d);
        scrub.querySelector('i').style.width = (k * 100) + '%'; scrub.querySelector('b').style.left = (k * 100) + '%';
      },
      state: function (p) { el.querySelector('[data-pp]').innerHTML = UI.icon(p ? 'pause' : 'play'); },
      marks: function (list) {
        scrub.querySelectorAll('.ch').forEach(function (x) { x.remove(); });
        var d = player.plan ? player.plan.outDur : 0;
        (list || []).forEach(function (c) { if (!d || !c.t) return; var s = document.createElement('span'); s.className = 'ch'; s.style.left = (c.t / d * 100) + '%'; scrub.appendChild(s); });
      }
    };
  };

  UI.page('video', { title: 'Video', auth: 'user' }, function (view, ctx) {
    var id = ctx.args[0], tab = TABS.some(function (t) { return t[0] === ctx.args[1]; }) ? ctx.args[1] : 'takes';
    var D = null, player = null, bar = null, srcs = {}, here = {}, dead = false, tplCache = null, frames = null, frameTok = 0;
    view.innerHTML = '<div class="ui-wrap"><div class="ui-skel" style="height:380px"></div></div>';
    function q(s) { return view.querySelector(s); }
    function product() { return D.product; }
    function patch(p, quiet) {
      return (quiet ? UI.apiQuiet : UI.api)('video_update', id, p).then(function (r) {
        D.video = r.video; if (r.new_badges && r.new_badges.length) VB.badgePop(r.new_badges);
        return r;
      });
    }
    function load() {
      return UI.api('video_get', id).then(function (r) {
        D = r;
        document.title = r.video.title + ' · ' + UI.config.name;
        return Promise.all(r.takes.map(function (t) { return VB.takeHere(t).then(function (h) { here[t.id] = h; }); }));
      }).then(draw);
    }
    function editNow() { return VB.starterEdit(D.video, D.takes, D.product, D.handle); }
    function draw() {
      var v = D.video, st = VB.STATUSES.map(function (s) { return s.key; }).indexOf(v.status);
      view.innerHTML = '<div class="ui-wrap vd-wrap"><a class="ui-btn ghost sm" href="#home" data-go="home" style="margin-bottom:10px">' + UI.icon('back') + 'Studio</a>' +
        '<div class="vd-top"><div><div class="vd-player" data-playerbox><canvas data-canvas width="960" height="540"></canvas></div><p class="small muted" data-pnote style="margin:8px 0 0"></p></div>' +
        '<div class="ui-card vd-info"><input class="title" data-title value="' + esc(v.title) + '" maxlength="100" aria-label="Title">' +
          '<div class="vd-pipe">' + VB.STATUSES.map(function (s, i) {
            return '<button data-status="' + s.key + '" class="' + (i < st ? 'done' : i === st ? 'cur' : '') + '">' + UI.icon(s.icon) + s.label + '</button>'; }).join('') + '</div>' +
          '<div class="vd-fields"><label class="ui-field"><span>App</span><select data-f="product_id"><option value="">No app</option>' + D.products.map(function (p) {
              return '<option value="' + esc(p.id) + '"' + (v.product && v.product.id === p.id ? ' selected' : '') + '>' + esc((p.emoji ? p.emoji + ' ' : '') + p.name) + '</option>'; }).join('') + '</select></label>' +
            '<label class="ui-field"><span>Format</span><select data-f="kind">' + VB.KINDS.map(function (k) { return '<option value="' + k.key + '"' + (v.kind === k.key ? ' selected' : '') + '>' + k.emoji + ' ' + esc(k.label) + '</option>'; }).join('') + '</select></label>' +
            '<label class="ui-field"><span>Publish by</span><input type="date" data-f="due" value="' + esc(v.due || '') + '"></label>' +
            '<label class="ui-field"><span>Length</span><input type="text" readonly value="' + (v.duration ? VB.fmtTime(v.duration) : 'not edited yet') + '"></label></div>' +
          (v.youtube_url ? '<a class="vb-link small" href="' + esc(v.youtube_url) + '" target="_blank" rel="noopener">' + UI.icon('external') + ' ' + esc(v.youtube_url) + '</a>' : '') +
          '<div class="vd-actions"><a class="ui-btn primary" href="#record/' + esc(id) + '"><i class="rec-dot"></i>Record a take</a>' +
            '<a class="ui-btn blue" href="#edit/' + esc(id) + '">' + UI.icon('scissors') + 'Edit video</a>' +
            '<button class="ui-btn ghost icon" data-more aria-label="More">' + UI.icon('more') + '</button></div>' +
          (v.notes ? '<p class="small muted" style="margin:0">' + esc(v.notes) + '</p>' : '') + '</div></div>' +
        '<nav class="ui-tabs">' + TABS.map(function (t) { return '<a href="#video/' + esc(id) + '/' + t[0] + '" class="' + (t[0] === tab ? 'on' : '') + '">' + UI.icon(t[2]) + t[1] +
          (t[0] === 'takes' ? ' <span class="count">' + D.takes.length + '</span>' : '') + '</a>'; }).join('') + '</nav><div data-body></div></div>';
      setupPlayer();
      ({ takes: drawTakes, script: drawScript, publish: drawPublish, thumbnail: drawThumb })[tab]();
    }
    function setupPlayer() {
      if (player) player.destroy();
      var c = q('[data-canvas]');
      player = VB.Player(c, { onTime: function (o) { if (bar) bar.update(o); }, onState: function (p) { if (bar) bar.state(p); } });
      bar = VB.playerBar(player, { full: true, canvas: c });
      q('[data-playerbox]').appendChild(bar.el);
      c.addEventListener('click', function () { player.toggle(); });
      var e = editNow(), note = q('[data-pnote]');
      var need = D.takes.filter(function (t) { return e.scenes.some(function (s) { return s.take === t.id; }); });
      Promise.all(need.map(function (t) { return VB.openTake(t).then(function (s) { srcs[t.id] = s; }, function () { /* unreadable */ }); })).then(function () {
        if (dead) return;
        var plan = VB.plan(e, D.takes, srcs);
        player.setPlan(plan); bar.update(0); bar.marks(VB.chapters(plan));
        player.seek(Math.min(plan.outDur * 0.2, 4));
        var missing = need.filter(function (t) { return srcs[t.id] && srcs[t.id].missing; }).length;
        note.textContent = !D.takes.length ? 'No takes yet: record one, or plan the video first.' : (D.video.edit && D.video.edit.scenes && D.video.edit.scenes.length ? 'Playing your edit.' : 'A first cut from your takes. Open the editor to trim, zoom and add text.') +
          (missing ? ' ' + UI.plural(missing, 'take') + ' recorded on another computer.' : '');
      });
    }

    /* ---------------- takes */
    function drawTakes() {
      var b = q('[data-body]');
      b.innerHTML = (D.takes.length ? D.takes.map(function (t) {
        var h = here[t.id];
        return '<div class="vd-take" data-tid="' + esc(t.id) + '">' + (VB.takeThumb(t) ? '<img src="' + esc(VB.takeThumb(t)) + '" alt="">' : '<span class="noimg"></span>') +
          '<div><input class="lbl" data-lbl value="' + esc(t.label) + '" maxlength="60" aria-label="Take name">' +
          '<div class="facts"><span>' + VB.fmtTime(t.duration) + '</span><span>' + esc(MODE[t.mode] || t.mode) + '</span>' + (t.bytes ? '<span>' + VB.fmtBytes(t.bytes) + '</span>' : '') +
          (t.markers.length ? '<span>⚑ ' + t.markers.length + '</span>' : '') + (t.clicks.length ? '<span>' + UI.icon('cursor') + ' ' + t.clicks.length + ' clicks</span>' : '') +
          (VB.wordsOf(t).length ? '<span>💬 ' + UI.plural(VB.wordsOf(t).length, 'word') + '</span>' : '') +
          '<span>' + esc(UI.ago(t.created)) + '</span>' + (t.sample ? '<span class="ui-badge">Sample</span>' : h ? '<span class="ui-badge good">On this computer</span>' : '<span class="ui-badge warn">On another computer</span>') + '</div></div>' +
          '<div class="acts"><button class="ui-btn ghost icon vd-star' + (t.starred ? ' on' : '') + '" data-star aria-label="Best take">' + UI.icon(t.starred ? 'star2' : 'star') + '</button>' +
          (!t.sample && h ? '<button class="ui-btn ghost icon" data-dl aria-label="Download">' + UI.icon('download') + '</button>' : '') +
          (!t.sample && !h ? '<label class="ui-btn sm" style="cursor:pointer">' + UI.icon('link') + 'Re-link file<input type="file" accept="video/*" data-relink hidden></label>' : '') +
          '<button class="ui-btn ghost icon" data-deltake aria-label="Delete take">' + UI.icon('trash') + '</button></div></div>';
      }).join('') : '<div class="ui-empty">' + UI.icon('film') + '<h3>No takes yet</h3><p>Record your screen and camera. Do it in short takes: you\'ll arrange them in the editor.</p><a class="ui-btn primary" href="#record/' + esc(id) + '"><i class="rec-dot"></i>Record the first take</a></div>') +
        (D.takes.length ? '<p class="small muted" style="margin-top:12px">⭐ Star the best take: it goes first in a new edit. Recordings live in the browser that made them; a take “on another computer” can be re-linked from a downloaded file.</p>' : '');
    }
    function takeOf(el) { var tid = el.closest('[data-tid]').getAttribute('data-tid'); return D.takes.filter(function (t) { return t.id === tid; })[0]; }

    /* ---------------- script */
    function drawScript() {
      var b = q('[data-body]'), v = D.video;
      b.innerHTML = '<div class="vd-sbar"><button class="ui-btn sm" data-tpls>' + UI.icon('sparkle') + 'Templates</button>' +
        '<button class="ui-btn sm" data-hooks>🪝 Hook lab</button><button class="ui-btn sm" data-notes>' + UI.icon('list') + 'From release notes</button>' +
        '<button class="ui-btn sm" data-ai>' + UI.icon('wand') + 'Ask an AI</button><button class="ui-btn sm" data-vers>' + UI.icon('undo') + 'Versions' + ((v.script_versions || []).length ? ' (' + v.script_versions.length + ')' : '') + '</button>' +
        '<a class="ui-btn sm" href="#prompter/' + esc(id) + '">' + UI.icon('scroll') + 'Teleprompter</a><a class="ui-btn sm primary" href="#record/' + esc(id) + '"><i class="rec-dot"></i>Record with it</a>' +
        '<span class="ui-spacer"></span><span class="stat" data-sstat></span></div>' +
        '<div class="vd-script"><textarea data-script placeholder="# Hook&#10;Say what the video is about in one line.&#10;&#10;# Demo&#10;[SHOW: the screen you\'ll record]&#10;What you\'ll say over it. (pause)&#10;&#10;# Call to action&#10;Try it free: link in the description.">' + esc(v.script) + '</textarea>' +
        '<div><p class="vb-section-title">Preview</p><div class="vd-sprev" data-sprev></div><p class="small muted" style="margin-top:8px"><b>#</b> starts a section (it becomes a chapter idea), <b>[SHOW: …]</b> is a note to yourself (not read out), <b>(pause)</b> is a beat.</p>' +
        '<div class="vd-doc" data-doctor></div></div></div>';
      preview();
    }
    var doctor = VB.debounce(function () {
      var box = q('[data-doctor]'), ta = q('[data-script]'); if (!box || !ta) return;
      var r = VB.doctor(ta.value, D.video.kind), col = r.score >= 80 ? '#2e9d5b' : r.score >= 55 ? '#e6a700' : '#cc181e';
      var ICON = { ok: '✅', warn: '⚠️', bad: '❌' };
      box.innerHTML = '<div class="hd"><span class="sc" style="background:' + col + '">' + r.score + '</span><div><b>Script check-up</b><div class="small muted">' +
        (r.score >= 80 ? 'Ready to record.' : r.score >= 55 ? 'Close. A few quick fixes below.' : 'Worth another pass before recording.') + '</div></div></div>' +
        '<ul>' + r.items.map(function (it) { return '<li><span>' + ICON[it.state] + '</span><span>' + esc(it.title) + (it.tip ? '<small>' + esc(it.tip) + '</small>' : '') + '</span></li>'; }).join('') + '</ul>' +
        (r.stats.words > 60 && !VB.isVertical(D.video.kind) ? '<div class="ui-row" style="margin-top:10px"><button class="ui-btn sm" data-mkshort>' + UI.icon('phone') + 'Make a 60-second Short from this script</button></div>' : '');
    }, 350);
    function preview() {
      var txt = q('[data-script]').value, s = VB.scriptStats(txt);
      q('[data-sstat]').textContent = UI.plural(s.words, 'word') + ' · about ' + VB.fmtTime(s.seconds) + ' spoken · ' + UI.plural(s.sections, 'section');
      var lines = VB.parseScript(txt);
      q('[data-sprev]').innerHTML = lines.length ? lines.map(function (l) {
        return l.k === 'h' ? '<div class="h">' + esc(l.text) + '</div>' : l.k === 'show' ? '<p class="show">▸ ' + esc(l.text) + '</p>' : '<p class="line">' + esc(l.text).replace(/\(pause\)/gi, '<span style="color:#ffd34d">⏸</span>') + '</p>';
      }).join('') : '<p class="show">Your script appears here as you type.</p>';
      doctor();
    }
    function setScript(txt, msg) {
      var ta = q('[data-script]'); if (!ta) return;
      ta.value = txt; preview();
      saveScript.cancel ? saveScript.cancel() : null;
      return patch({ script: txt, snapshot: true, status: D.video.status === 'idea' && txt.trim() ? 'script' : D.video.status }, true).then(function () {
        if (msg) UI.toast(msg, 'ok');
        var vb = q('[data-vers]'); if (vb) vb.innerHTML = UI.icon('undo') + 'Versions' + ((D.video.script_versions || []).length ? ' (' + D.video.script_versions.length + ')' : '');
      });
    }
    function hookLab() {
      var list = VB.hooks(product(), D.handle);
      var m = UI.modal('<h2>🪝 Hook lab</h2><p class="muted">The first 3 seconds decide if people stay. Pick one: it replaces your first spoken line' + (product() ? ', filled in from <b>' + esc(product().name) + '</b>' : '') + '.</p>' +
        '<div class="vd-hooks">' + list.map(function (h, i) { return '<button data-hook="' + i + '"><small>' + esc(h.kind) + '</small>' + esc(h.text) + '</button>'; }).join('') + '</div>', { wide: true });
      m.el.addEventListener('click', function (e) {
        var b = e.target.closest('[data-hook]'); if (!b) return;
        var hook = list[+b.getAttribute('data-hook')].text, ta = q('[data-script]'), lines = ta.value.split('\n'), done = false;
        for (var i = 0; i < lines.length; i++) {
          var l = lines[i].trim();
          if (!l || /^#/.test(l) || /^\[.*\]$/.test(l)) continue;
          lines[i] = hook; done = true; break;
        }
        var txt = done ? lines.join('\n') : '# Hook\n' + hook + '\n\n' + ta.value;
        m.close(); setScript(txt, 'Hook in. Read it out loud once.');
      });
    }
    function notesDialog() {
      var m = UI.modal('<h2>From release notes</h2><p class="muted">Paste your changelog, release notes or commit messages (one per line). You get a “What\'s new” script: new features first, then improvements and fixes.</p>' +
        '<textarea data-ntxt rows="8" style="width:100%" placeholder="- feat: dark mode for the whole app&#10;- Add CSV export&#10;- fix: login button on iPhone&#10;- Faster search"></textarea>' +
        '<p class="vb-section-title" style="margin-top:12px">Script</p><div class="vd-sprev" data-npre style="max-height:260px"><p class="show">The script appears here.</p></div>' +
        '<div class="ui-row end" style="margin-top:12px"><button class="ui-btn ghost" data-close>Cancel</button><button class="ui-btn primary" data-nuse disabled>Use this script</button></div>', { wide: true });
      var ta = m.el.querySelector('[data-ntxt]'), pre = m.el.querySelector('[data-npre]'), use = m.el.querySelector('[data-nuse]'), out = '';
      ta.focus();
      ta.addEventListener('input', function () {
        out = VB.fromNotes(ta.value, product(), D.handle); use.disabled = !out;
        pre.innerHTML = out ? VB.parseScript(out).map(function (l) { return l.k === 'h' ? '<div class="h">' + esc(l.text) + '</div>' : l.k === 'show' ? '<p class="show">▸ ' + esc(l.text) + '</p>' : '<p class="line">' + esc(l.text) + '</p>'; }).join('') : '<p class="show">The script appears here.</p>';
      });
      use.addEventListener('click', function () {
        var cur = q('[data-script]').value.trim();
        function go() { m.close(); setScript(out, 'Release notes turned into a script. Your old one is in Versions.'); }
        if (cur) UI.confirm({ title: 'Replace the current script?', text: 'The current one is kept in Versions.', ok: 'Replace' }).then(function (y) { if (y) go(); }); else go();
      });
    }
    function aiDialog() {
      var task = UI.store.get('vd.ai', 'script');
      var m = UI.modal('<h2>' + UI.icon('wand') + ' Ask an AI</h2><p class="muted">Copy this prompt into ChatGPT, Claude, Gemini or any AI chat. It already knows your app and this video. Nothing is sent from here.</p>' +
        '<div class="ed-chips" data-aitasks style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">' + VB.AI_TASKS.map(function (t) { return '<button class="ui-btn sm' + (t[0] === task ? ' primary' : '') + '" data-task="' + t[0] + '">' + t[2] + ' ' + esc(t[1]) + '</button>'; }).join('') + '</div>' +
        '<div class="vd-ai"><textarea data-aiprompt rows="9" style="width:100%"></textarea></div>' +
        '<div class="ui-row" style="margin:8px 0 14px"><button class="ui-btn primary" data-aicopy>' + UI.icon('copy') + 'Copy the prompt</button>' +
          '<a class="ui-btn ghost sm" href="https://chatgpt.com/" target="_blank" rel="noopener">ChatGPT ↗</a><a class="ui-btn ghost sm" href="https://claude.ai/new" target="_blank" rel="noopener">Claude ↗</a><a class="ui-btn ghost sm" href="https://gemini.google.com/app" target="_blank" rel="noopener">Gemini ↗</a></div>' +
        '<label class="ui-field"><span>Paste the answer here</span><textarea data-aians rows="6" style="width:100%" placeholder="# Hook&#10;…"></textarea></label>' +
        '<div class="ui-row end" style="margin-top:12px"><button class="ui-btn ghost" data-close>Close</button><button class="ui-btn" data-aiadd disabled>Add below my script</button><button class="ui-btn primary" data-aiuse disabled>Use as my script</button></div>', { wide: true });
      var pr = m.el.querySelector('[data-aiprompt]'), ans = m.el.querySelector('[data-aians]');
      function fill() { pr.value = VB.aiPrompt(task, { product: product(), video: D.video, script: q('[data-script]').value, handle: D.handle }); }
      fill();
      m.el.addEventListener('click', function (e) {
        var b = e.target.closest('[data-task]');
        if (b) { task = b.getAttribute('data-task'); UI.store.set('vd.ai', task); m.el.querySelectorAll('[data-task]').forEach(function (x) { x.classList.toggle('primary', x === b); }); fill(); return; }
        if (e.target.closest('[data-aicopy]')) { VB.copy(pr.value, 'Prompt'); return; }
        if (e.target.closest('[data-aiuse]')) { m.close(); setScript(ans.value.trim(), 'The AI\'s script is in. Your old one is in Versions.'); return; }
        if (e.target.closest('[data-aiadd]')) { var cur = q('[data-script]').value.replace(/\s+$/, ''); m.close(); setScript((cur ? cur + '\n\n' : '') + ans.value.trim(), 'Added below your script.'); }
      });
      ans.addEventListener('input', function () { var on = !!ans.value.trim(); m.el.querySelector('[data-aiuse]').disabled = !on; m.el.querySelector('[data-aiadd]').disabled = !on; });
    }
    function versions() {
      var list = D.video.script_versions || [];
      var m = UI.modal('<h2>Script versions</h2><p class="muted">A copy is kept every 10 minutes of writing, and before a template, hook, AI answer or restore replaces it.</p>' +
        (list.length ? '<div class="vd-vers">' + list.map(function (x, i) {
          return '<div><div class="it"><div class="grow" style="flex:1"><b>' + esc(UI.fmtDateTime ? UI.fmtDateTime(x.at) : x.at) + '</b><div class="small muted">' + UI.plural(x.words || 0, 'word') + ' · ' + esc(String(x.text || '').split('\n').filter(function (l) { return l.trim() && !/^[#\[]/.test(l.trim()); })[0] || '').slice(0, 70) + '</div></div>' +
            '<button class="ui-btn sm ghost" data-vsee="' + i + '">' + UI.icon('eye') + 'See</button><button class="ui-btn sm" data-vback="' + i + '">' + UI.icon('undo') + 'Restore</button></div><pre data-vpre="' + i + '" hidden>' + esc(x.text) + '</pre></div>';
        }).join('') + '</div>' : '<div class="ui-empty">' + UI.icon('scroll') + '<h3>No versions yet</h3><p>Keep writing: copies appear here.</p></div>'), { wide: true });
      m.el.addEventListener('click', function (e) {
        var b = e.target.closest('[data-vsee]'); if (b) { var pre = m.el.querySelector('[data-vpre="' + b.getAttribute('data-vsee') + '"]'); pre.hidden = !pre.hidden; return; }
        b = e.target.closest('[data-vback]'); if (!b) return;
        var x = list[+b.getAttribute('data-vback')]; m.close(); setScript(x.text, 'Restored. The script you had is now a version too.');
      });
    }
    var saveScript = VB.debounce(function () {
      var txt = q('[data-script]') ? q('[data-script]').value : null;
      if (txt == null) return;
      var p = { script: txt };
      if (txt.trim() && D.video.status === 'idea') p.status = 'script';
      patch(p, true);
    }, 900);
    function templates() {
      var all = VB.TEMPLATES.map(function (t) { return Object.assign({ by: 'VideoBlog Buddy' }, t); });
      var p = tplCache ? Promise.resolve(tplCache) : UI.apiQuiet('templates_list').then(function (r) { tplCache = r.templates; return tplCache; }, function () { return []; });
      p.then(function (extra) {
        var list = all.concat(extra.map(function (t) { return Object.assign({ key: 'db:' + t.id }, t); }));
        var m = UI.modal('<h2>Script templates</h2><p class="muted">Filled in from ' + (product() ? '<b>' + esc(product().name) + '</b>\'s details' : 'your app (pick one in the details above)') + '. Inserting replaces the current script.</p>' +
          '<div class="vd-tpls">' + list.map(function (t) {
            return '<button class="vd-tpl" data-key="' + esc(t.key) + '"><span style="font-size:1.4rem">' + esc(t.emoji || '📝') + '</span><b>' + esc(t.name) + '</b><small>' + esc(t.blurb || '') + '</small>' +
              '<small style="margin-top:6px">' + esc(VB.kind(t.kind).short) + (t.by && t.by !== 'VideoBlog Buddy' ? ' · by ' + esc(t.by) : '') + '</small></button>';
          }).join('') + '</div>', { wide: true });
        m.el.addEventListener('click', function (e) {
          var b = e.target.closest('[data-key]'); if (!b) return;
          var t = list.filter(function (x) { return x.key === b.getAttribute('data-key'); })[0];
          var ta = q('[data-script]');
          function go() { ta.value = VB.fill(t.body, product(), D.handle); preview(); saveScript(); saveScript.flush(); m.close(); if (t.id) UI.apiQuiet('template_used', t.id); UI.toast('Template inserted', 'ok'); }
          if (ta.value.trim()) UI.confirm({ title: 'Replace the current script?', ok: 'Replace' }).then(function (y) { if (y) go(); }); else go();
        });
      });
    }

    /* ---------------- publish kit */
    function chaptersNow() { return VB.chapters(VB.plan(editNow(), D.takes, null)); }
    function drawPublish() {
      var b = q('[data-body]'), v = D.video, pub = v.publish || {}, vert = VB.isVertical(v.kind);
      var empty = !pub.title && !pub.description;
      b.innerHTML = '<div class="vd-pub"><div class="vd-pf">' +
        '<div class="ui-row"><button class="ui-btn primary" data-gen>' + UI.icon('wand') + (empty ? 'Write my publish kit' : 'Write it again') + '</button>' +
        '<span class="small muted">From ' + (product() ? esc(product().name) + '\'s details, ' : '') + 'the video and its chapters. Edit anything after.</span></div>' +
        field('title', 'Title', 'input', 100) + '<div class="vd-titles" data-titles>' + (pub.titles || []).map(function (t) { return '<button data-pick="' + esc(t) + '">' + esc(t) + '</button>'; }).join('') + '</div>' +
        field('description', 'Description', 'desc', 5000) + field('tags', 'Tags (comma separated)', 'input', 500) + field('hashtags', 'Hashtags', 'input', 300) +
        field('pinned', 'Pinned comment', 'area', 1000) + field(vert ? 'caption' : 'caption', vert ? 'Caption for Shorts / Reels / TikTok' : 'Caption for a Short or social post', 'area', 2200) +
        '</div><div class="ui-stack"><div class="ui-card vd-yt" style="padding:16px" data-ytcard></div><div class="ui-card" style="padding:16px"><h3 style="font-size:1rem">Upload checklist</h3><div class="vd-check" data-check></div></div>' +
        '<div class="ui-card" style="padding:16px"><h3 style="font-size:1rem">Published?</h3><label class="ui-field"><span>Link to the video</span><input type="url" data-yt placeholder="https://youtu.be/…" value="' + esc(v.youtube_url) + '"></label>' +
        '<div class="ui-row" style="margin-top:10px">' + (v.status === 'published' ? '<span class="ui-badge good">' + UI.icon('check') + 'Published ' + esc(UI.ago(v.published_at)) + '</span><button class="ui-btn sm ghost" data-unpub>Undo</button>'
          : '<button class="ui-btn primary" data-pub>' + UI.icon('tv') + 'Mark as published</button>') + '</div>' +
        '<p class="small muted" style="margin:10px 0 0">Uploaded somewhere else (YouTube Studio, Instagram, TikTok)? Paste the link and mark it published to keep your streak.</p></div></div></div>';
      checklist(); ytCard();
      function field(k, label, type, max) {
        var val = pub[k] || '', inner = type === 'input' ? '<input type="text" data-pk="' + k + '" value="' + esc(val) + '" maxlength="' + max + '">'
          : '<textarea data-pk="' + k + '" class="' + (type === 'desc' ? 'desc' : '') + '" maxlength="' + max + '" rows="' + (type === 'desc' ? 14 : 3) + '">' + esc(val) + '</textarea>';
        return '<label class="ui-field"><span>' + label + '<span><span class="cnt" data-cnt="' + k + '">' + val.length + '/' + max + '</span> <button type="button" class="ui-btn ghost sm" data-copy="' + k + '">' + UI.icon('copy') + 'Copy</button></span></span>' + inner + '</label>';
      }
    }
    function readPub() {
      var pub = Object.assign({}, D.video.publish || {});
      view.querySelectorAll('[data-pk]').forEach(function (el) { pub[el.getAttribute('data-pk')] = el.value; });
      return pub;
    }
    var savePub = VB.debounce(function () { if (q('[data-pk]')) patch({ publish: readPub() }, true).then(checklist); }, 900);

    /* ---------------- direct YouTube upload */
    var yt = { file: null, privacy: UI.store.get('yt.privacy', 'private'), when: '', cat: UI.store.get('yt.cat', '28'), kids: false, thumb: true, caps: true, busy: null };
    function planNow() { return VB.plan(editNow(), D.takes, null); }
    function ytCard() {
      var box = q('[data-ytcard]'); if (!box) return;
      var v = D.video, done = v.publish && v.publish.yt && v.publish.yt.id, cfg = VB.config || {};
      var head = '<h3 style="font-size:1rem;display:flex;gap:8px;align-items:center">' + UI.icon('upload') + 'Upload to YouTube</h3>';
      if (yt.busy) {
        box.innerHTML = head + '<p class="small" style="margin:0 0 8px" data-ytmsg>' + esc(yt.busy.msg) + '</p><div class="ed-prog" style="height:10px;background:var(--c-surface-2);border:1px solid var(--c-line);border-radius:2px;overflow:hidden"><i data-ytbar style="display:block;height:100%;width:' + (yt.busy.f * 100).toFixed(1) + '%;background:linear-gradient(90deg,var(--c-brand-2),var(--c-brand))"></i></div>' +
          '<div class="ui-row" style="margin-top:10px"><button class="ui-btn sm" data-ytstop>Cancel</button></div>';
        return;
      }
      if (done) {
        var y = v.publish.yt;
        box.innerHTML = head + '<p style="margin:0 0 8px"><span class="ui-badge good">' + UI.icon('check') + 'On YouTube · ' + esc(y.privacy) + (y.publish_at ? ' · goes public ' + esc(UI.fmtDateTime ? UI.fmtDateTime(y.publish_at) : y.publish_at) : '') + '</span></p>' +
          '<div class="ui-row"><a class="ui-btn sm" href="https://youtu.be/' + esc(y.id) + '" target="_blank" rel="noopener">' + UI.icon('external') + 'Watch</a><a class="ui-btn sm" href="https://studio.youtube.com/video/' + esc(y.id) + '/edit" target="_blank" rel="noopener">' + UI.icon('edit') + 'YouTube Studio</a>' +
          '<button class="ui-btn sm ghost" data-ytagain>Upload a new version</button></div>' +
          (y.privacy !== 'public' && v.status !== 'published' ? '<p class="small muted" style="margin:10px 0 0">When it\'s public, press <b>Mark as published</b> below to count it.</p>' : '');
        return;
      }
      if (!cfg.google_client_id) {
        box.innerHTML = head + '<p class="small muted" style="margin:0">' + (ctx.me && ctx.me.is_admin ? 'Connect a Google Cloud project once (about 5 minutes) and every member can upload straight from here. <a class="vb-link" href="#admin/settings">Set it up in Admin → Settings</a>.'
          : 'Direct upload isn\'t switched on yet. Export the video, then upload it in <a class="vb-link" href="https://studio.youtube.com" target="_blank" rel="noopener">YouTube Studio</a> and paste the kit.') + '</p>';
        return;
      }
      var last = VB.lastExport[id], file = yt.file || last, words = VB.planCues(planNow()).length > 0;
      box.innerHTML = head +
        (file ? '<div class="vd-ytfile">🎞️ <span style="flex:1"><b>' + esc(file.name) + '</b><br><span class="small muted">' + VB.fmtBytes(file.blob.size) + (file === last ? ' · exported a moment ago' : '') + '</span></span><label class="ui-btn ghost sm" style="cursor:pointer">Change<input type="file" accept="video/*" data-ytfile hidden></label></div>'
          : '<p class="small muted" style="margin:0 0 8px">Export the video in the editor first, or choose the file:</p><label class="ui-btn sm" style="cursor:pointer">' + UI.icon('film') + 'Choose the video file<input type="file" accept="video/*" data-ytfile hidden></label>') +
        '<div class="ui-field" style="margin-top:12px"><span>Who can watch</span><div class="ui-seg">' + [['private', 'Private'], ['unlisted', 'Unlisted'], ['public', 'Public'], ['schedule', 'Schedule']].map(function (o) {
          return '<button data-ytp="' + o[0] + '" class="' + (yt.privacy === o[0] ? 'on' : '') + '">' + o[1] + '</button>'; }).join('') + '</div></div>' +
        (yt.privacy === 'schedule' ? '<label class="ui-field"><span>Goes public at</span><input type="datetime-local" data-ytwhen value="' + esc(yt.when) + '"></label>' : '') +
        '<label class="ui-field" style="margin-top:8px"><span>Category</span><select data-ytcat>' + VB.yt.CATEGORIES.map(function (c) { return '<option value="' + c[0] + '"' + (yt.cat === c[0] ? ' selected' : '') + '>' + esc(c[1]) + '</option>'; }).join('') + '</select></label>' +
        '<label class="ui-check"><input type="checkbox" data-ytthumb' + (yt.thumb && v.thumb_design && v.thumb_design.text ? ' checked' : ' disabled') + '><span>Set my thumbnail' + (v.thumb_design && v.thumb_design.text ? '' : ' (make one in the Thumbnail tab first)') + '</span></label>' +
        '<label class="ui-check"><input type="checkbox" data-ytcaps' + (yt.caps && words ? ' checked' : '') + (words ? '' : ' disabled') + '><span>Add my captions' + (words ? '' : ' (write them in the editor\'s Words tab)') + '</span></label>' +
        '<label class="ui-check"><input type="checkbox" data-ytkids' + (yt.kids ? ' checked' : '') + '><span>Made for kids</span></label>' +
        '<button class="ui-btn primary" data-ytgo style="margin-top:10px;width:100%"' + (file ? '' : ' disabled') + '>' + UI.icon('upload') + 'Upload to YouTube</button>' +
        '<p class="small muted" style="margin:8px 0 0">Uses the title, description and tags on the left. It goes straight from this computer to your channel; Google asks you to sign in the first time.</p>';
    }
    function thumbJpeg() {
      var d = D.video.thumb_design || {};
      return VB.vault.get('thumb:' + id).then(function (r) {
        if (r && r.blob) return r.blob;
        if (!d.text) return null;
        var c = document.createElement('canvas'); c.width = 1280; c.height = 720;
        var tk = D.takes.filter(function (t) { return t.id === d.take; })[0];
        return (tk ? VB.grabFrame(tk, d.t).catch(function () { return null; }) : Promise.resolve(null)).then(function (fr) {
          VB.drawThumb(c.getContext('2d'), 1280, 720, d, fr, product());
          return new Promise(function (res) { c.toBlob(res, 'image/jpeg', 0.9); });
        });
      });
    }
    function ytUpload() {
      var file = yt.file || VB.lastExport[id]; if (!file) return;
      var pub = readPub(), v = D.video, vert = VB.isVertical(v.kind) || (v.edit && v.edit.aspect === '9:16');
      var when = yt.privacy === 'schedule' ? (yt.when ? new Date(yt.when) : null) : null;
      if (yt.privacy === 'schedule' && (!when || isNaN(when) || when < new Date(Date.now() + 5 * 60000))) { UI.toast('Pick a time at least a few minutes from now.', 'error'); return; }
      var caps = yt.caps && VB.planCues(planNow()).length > 0, wantThumb = yt.thumb && v.thumb_design && v.thumb_design.text;
      var meta = { title: pub.title || v.title, description: pub.description || '', tags: pub.tags || '', category: yt.cat, kids: yt.kids, vertical: vert,
        privacy: yt.privacy === 'schedule' ? 'private' : yt.privacy, publishAt: when ? when.toISOString() : '', captions: caps };
      var signal = {}, extra = [];
      yt.busy = { f: 0, msg: 'Asking Google…', signal: signal }; ytCard();
      function prog(f, msg) { if (!yt.busy) return; yt.busy.f = f; if (msg) yt.busy.msg = msg; var b2 = q('[data-ytbar]'), m2 = q('[data-ytmsg]'); if (b2) b2.style.width = (f * 100).toFixed(1) + '%'; if (m2) m2.textContent = yt.busy.msg; }
      VB.yt.connect(caps).then(function () {
        prog(0.01, 'Uploading ' + VB.fmtBytes(file.blob.size) + '… keep this tab open.');
        return VB.yt.upload(file.blob, meta, function (f) { prog(f * 0.92, 'Uploading… ' + Math.round(f * 100) + '%'); }, signal);
      }).then(function (res) {
        prog(0.94, 'Uploaded. Adding the finishing touches…');
        var jobs = [];
        if (wantThumb) jobs.push(thumbJpeg().then(function (j) { return j ? VB.yt.thumbnail(res.id, j).then(function () { return 'thumb'; }) : null; }).catch(function (e) { extra.push('thumbnail: ' + e.message); return null; }));
        if (caps) jobs.push(VB.yt.captions(res.id, VB.toSRT(VB.planCues(planNow())), 'en').then(function () { return 'caps'; }).catch(function (e) { extra.push('captions: ' + e.message); return null; }));
        return Promise.all(jobs).then(function (got) {
          var info = { id: res.id, privacy: meta.privacy, at: new Date().toISOString(), publish_at: meta.publishAt, thumb: got.indexOf('thumb') >= 0, captions: got.indexOf('caps') >= 0 };
          var p = { publish: Object.assign({}, pub, { yt: info }), youtube_url: 'https://youtu.be/' + res.id };
          if (meta.privacy === 'public') p.status = 'published';
          return patch(p);
        });
      }).then(function () {
        yt.busy = null; yt.file = null; VB.confetti(80);
        UI.toast('It\'s on YouTube' + (meta.privacy === 'public' ? ' and live! 🎉' : ' (' + (meta.publishAt ? 'scheduled' : meta.privacy) + ').') + (extra.length ? ' Not done: ' + extra.join('; ') : ''), extra.length ? 'error' : 'ok');
        draw();
      }, function (err) {
        yt.busy = null; ytCard();
        if (!(err && err.cancelled)) UI.toast(err && err.message || 'The upload didn\'t work.', 'error'); else UI.toast('Upload cancelled');
      });
    }
    function checklist() {
      var box = q('[data-check]'); if (!box) return;
      var pub = readPub(), checks = pub.checks || {};
      box.innerHTML = VB.checklist(D.video).map(function (it) {
        var auto = it.auto ? it.auto({ video: D.video, publish: pub }) : null, on = auto != null ? auto : !!checks[it.key];
        return '<label><input type="checkbox" data-ck="' + it.key + '"' + (on ? ' checked' : '') + (auto != null ? ' disabled' : '') + '><span>' + esc(it.label) + (auto != null ? '<span class="auto">auto</span>' : '') + '</span></label>';
      }).join('');
    }

    /* ---------------- thumbnail */
    function drawThumb() {
      var b = q('[data-body]'), v = D.video, d = Object.assign({ tpl: 'bold', text: '', text2: '', color: '#ffde00', bg: (product() && product().color) || '#cc181e', emoji: (product() && product().emoji) || '', face: true, arrow: false, take: '', t: 0 }, v.thumb_design || {});
      if (!d.text) { var words = v.title.split(/\s+/); d.text = words.slice(0, Math.ceil(words.length / 2)).join(' ').slice(0, 30); d.text2 = words.slice(Math.ceil(words.length / 2)).join(' ').slice(0, 30); }
      var usable = D.takes.filter(function (t) { return here[t.id]; });
      if (!d.take || !usable.some(function (t) { return t.id === d.take; })) { var first = usable.filter(function (t) { return t.mode !== 'cam'; })[0] || usable[0] || {}; d.take = first.id || ''; d.t = +Math.min(8, (first.duration || 0) / 3).toFixed(1); }
      var tk = usable.filter(function (t) { return t.id === d.take; })[0];
      b.innerHTML = '<div class="vd-thumb"><div><canvas data-tc width="1280" height="720"></canvas><div class="ui-row" style="margin-top:12px">' +
        '<button class="ui-btn primary" data-tsave>' + UI.icon('check') + 'Use as the video\'s thumbnail</button><button class="ui-btn" data-tdl>' + UI.icon('download') + 'Download JPG (1280×720)</button></div>' +
        '<p class="small muted">YouTube wants 1280×720 and under 2 MB: this download is both. Big face, few words, high contrast.</p></div>' +
        '<form class="ui-card vd-tctl" data-tform style="padding:16px"><div class="ui-field"><span>Layout</span><div class="ui-choices">' + VB.THUMB_TPLS.map(function (t) {
          return '<label class="ui-choice"><input type="radio" name="tpl" value="' + t[0] + '"' + (d.tpl === t[0] ? ' checked' : '') + '><span>' + t[1] + '</span></label>'; }).join('') + '</div></div>' +
        '<label class="ui-field"><span>Big words</span><input type="text" name="text" maxlength="60" value="' + esc(d.text) + '"></label>' +
        '<label class="ui-field"><span>Second line</span><input type="text" name="text2" maxlength="60" value="' + esc(d.text2) + '"></label>' +
        '<div class="ui-row"><label class="ui-row small">Text <input type="color" name="color" value="' + esc(d.color) + '"></label><label class="ui-row small">Background <input type="color" name="bg" value="' + esc(d.bg) + '"></label>' +
          '<label class="ui-field" style="width:80px"><span class="small">Emoji</span><input type="text" name="emoji" maxlength="8" value="' + esc(d.emoji) + '"></label></div>' +
        '<label class="ui-field"><span>Picture from</span><select name="take">' + (usable.length ? usable.map(function (t) { return '<option value="' + esc(t.id) + '"' + (t.id === d.take ? ' selected' : '') + '>' + esc(t.label) + '</option>'; }).join('') : '<option value="">No take on this computer</option>') + '</select></label>' +
        '<label class="ui-field"><span>Moment <span class="muted" data-tt>' + VB.fmtTime(d.t) + '</span></span><input type="range" name="t" min="0" max="' + (tk ? tk.duration.toFixed(1) : 1) + '" step="0.1" value="' + d.t + '"></label>' +
        '<label class="ui-check"><input type="checkbox" name="face"' + (d.face ? ' checked' : '') + '><span>Your face in a circle (from the camera)</span></label>' +
        '<label class="ui-check"><input type="checkbox" name="arrow"' + (d.arrow ? ' checked' : '') + '><span>Big red arrow</span></label></form></div>';
      frames = null;
      grab(d).then(function () { renderThumb(); });
    }
    function thumbDesign() {
      var f = q('[data-tform]'); if (!f) return {};
      var v = UI.formData(f); v.t = +v.t || 0; return v;
    }
    function grab(d) {
      var tk = D.takes.filter(function (t) { return t.id === d.take; })[0], tok = ++frameTok;
      if (!tk) { frames = null; return Promise.resolve(); }
      return VB.grabFrame(tk, d.t).then(function (f) { if (tok === frameTok) frames = f; }, function () { frames = null; });
    }
    function renderThumb() {
      var c = q('[data-tc]'); if (!c) return;
      if (document.fonts && document.fonts.load) document.fonts.load('400 40px Anton').then(draw2, draw2); else draw2();
      function draw2() { VB.drawThumb(c.getContext('2d'), 1280, 720, thumbDesign(), frames, product()); }
    }
    var regrab = VB.debounce(function () { grab(thumbDesign()).then(renderThumb); }, 250);

    /* ---------------- events */
    view.addEventListener('click', function (e) {
      var t = e.target, b;
      if ((b = t.closest('[data-status]'))) {
        var sKey = b.getAttribute('data-status');
        patch({ status: sKey }).then(function () { if (sKey === 'published') VB.confetti(); draw(); });
        return;
      }
      if ((b = t.closest('[data-more]'))) { VB.videoMenu(b, D.video, function () { UI.go('home'); }); return; }
      if ((b = t.closest('[data-star]'))) { var tk = takeOf(b); UI.api('take_update', tk.id, { starred: !tk.starred }).then(function (r) { Object.assign(tk, r.take); drawTakes(); }); return; }
      if ((b = t.closest('[data-dl]'))) {
        var tk2 = takeOf(b);
        Promise.all([VB.vault.get('take:' + tk2.key + ':main'), VB.vault.get('take:' + tk2.key + ':cam')]).then(function (r) {
          var base = VB.slug(D.video.title + '-' + tk2.label);
          if (r[0]) VB.download(r[0].blob, base + (tk2.cam ? '-screen' : '') + '.' + (/mp4/.test(r[0].type) ? 'mp4' : 'webm'));
          if (r[1]) VB.download(r[1].blob, base + '-camera.webm');
        });
        return;
      }
      if ((b = t.closest('[data-deltake]'))) {
        var tk3 = takeOf(b);
        UI.confirm({ title: 'Delete “' + tk3.label + '”?', text: 'It leaves this video and its edit. If no other video uses the recording, it\'s deleted from this computer too.', ok: 'Delete', danger: true }).then(function (yes) {
          if (!yes) return;
          UI.api('take_delete', tk3.id).then(function (r) {
            (r.free_keys || []).forEach(function (k) { VB.vault.dropTake(k); });
            D.takes = D.takes.filter(function (x) { return x.id !== tk3.id; });
            if (D.video.edit && D.video.edit.scenes) {
              D.video.edit.scenes = D.video.edit.scenes.filter(function (s) { return s.take !== tk3.id; });
              patch({ edit: D.video.edit }, true);
            }
            VB.forgetSource(tk3.id); draw();
          });
        });
        return;
      }
      if (t.closest('[data-tpls]')) { templates(); return; }
      if (t.closest('[data-hooks]')) { hookLab(); return; }
      if (t.closest('[data-notes]')) { notesDialog(); return; }
      if (t.closest('[data-ai]')) { aiDialog(); return; }
      if (t.closest('[data-vers]')) { versions(); return; }
      if ((b = t.closest('[data-mkshort]'))) {
        var sv = VB.shortVersion(q('[data-script]').value);
        UI.busy(b, UI.api('video_create', { title: (D.video.title + ' (Short)').slice(0, 100), kind: 'short', status: 'script', product_id: D.video.product ? D.video.product.id : '', script: sv, due: D.video.due || '' })).then(function (r) {
          UI.toast('Made a Short with a 60-second script', 'ok'); UI.go('video', r.video.id, 'script');
        });
        return;
      }
      if ((b = t.closest('[data-ytp]'))) { yt.privacy = b.getAttribute('data-ytp'); if (yt.privacy !== 'schedule') UI.store.set('yt.privacy', yt.privacy); ytCard(); return; }
      if (t.closest('[data-ytgo]')) { ytUpload(); return; }
      if (t.closest('[data-ytstop]')) { if (yt.busy && yt.busy.signal && yt.busy.signal.abort) yt.busy.signal.abort(); return; }
      if (t.closest('[data-ytagain]')) { var pa = Object.assign({}, D.video.publish || {}, { yt: {} }); D.video.publish = pa; ytCard(); return; }
      if (t.closest('[data-gen]')) {
        var pub0 = readPub();
        var kit = VB.publishKit({ video: D.video, product: product(), chapters: chaptersNow(), handle: D.handle, outDur: D.video.duration });
        var fresh = Object.assign({}, pub0, kit, { checks: pub0.checks || {} });
        patch({ publish: fresh }).then(function () { drawPublish(); UI.toast('Publish kit written. Tweak it, then copy it into YouTube.', 'ok'); });
        return;
      }
      if ((b = t.closest('[data-pick]'))) { var ti = q('[data-pk=title]'); ti.value = b.getAttribute('data-pick'); ti.dispatchEvent(new Event('input', { bubbles: true })); return; }
      if ((b = t.closest('[data-copy]'))) { var el = q('[data-pk=' + b.getAttribute('data-copy') + ']'); VB.copy(el.value, b.closest('.ui-field').querySelector('span').firstChild.textContent); return; }
      if (t.closest('[data-pub]')) {
        var ytu = q('[data-yt]').value.trim();
        patch({ status: 'published', youtube_url: ytu }).then(function () { VB.confetti(); UI.toast('Published! 🎉', 'ok'); draw(); });
        return;
      }
      if (t.closest('[data-unpub]')) { patch({ status: 'edited' }).then(draw); return; }
      if ((b = t.closest('[data-tsave]'))) {
        var c = q('[data-tc]');
        UI.busy(b, patch({ thumb: VB.smallJpeg(c, 320, 0.75), thumb_design: thumbDesign() })).then(function () {
          c.toBlob(function (bl) { if (bl) VB.vault.put('thumb:' + id, bl, { name: 'thumbnail.jpg' }); }, 'image/jpeg', 0.9);
          UI.toast('Thumbnail saved', 'ok');
        });
        return;
      }
      if (t.closest('[data-tdl]')) {
        var c2 = q('[data-tc]');
        (function tryQ(qv) {
          c2.toBlob(function (bl) { if (bl.size > 1.95e6 && qv > 0.5) return tryQ(qv - 0.1); VB.download(bl, VB.slug(D.video.title) + '-thumbnail.jpg'); }, 'image/jpeg', qv);
        })(0.92);
      }
    });
    view.addEventListener('change', function (e) {
      var t = e.target;
      if (t.matches('[data-title]')) {
        var val = t.value.trim();
        if (val.length < 2) { t.value = D.video.title; return; }
        patch({ title: val }).then(function () { document.title = val + ' · ' + UI.config.name; });
        return;
      }
      if (t.matches('[data-f]')) {
        var k = t.getAttribute('data-f'), p = {}; p[k] = t.value || null;
        patch(p).then(function (r) {
          if (k === 'product_id') { D.product = D.products.filter(function (x) { return x.id === t.value; })[0] || null; }
          if (k === 'kind' && D.video.edit && D.video.edit.scenes && D.video.edit.scenes.length) UI.toast('The format changed. The editor keeps your scenes; pick the new size in its Style tab.');
          draw();
        });
        return;
      }
      if (t.matches('[data-lbl]')) { var tk = takeOf(t); UI.apiQuiet('take_update', tk.id, { label: t.value }).then(function (r) { Object.assign(tk, r.take); }); return; }
      if (t.matches('[data-relink]')) {
        var tk4 = takeOf(t), file = t.files[0]; if (!file) return;
        VB.vault.put('take:' + tk4.key + ':main', file, { name: file.name }).then(function () {
          return UI.api('take_update', tk4.id, { device: VB.vault.id(), bytes: file.size });
        }).then(function (r) { Object.assign(tk4, r.take); here[tk4.id] = true; VB.forgetSource(tk4.id); UI.toast('File linked: the take plays here now', 'ok'); draw(); });
        return;
      }
      if (t.matches('[data-ytfile]')) { var yf = t.files[0]; if (yf) { yt.file = { blob: yf, name: yf.name }; ytCard(); } return; }
      if (t.matches('[data-ytwhen]')) { yt.when = t.value; return; }
      if (t.matches('[data-ytcat]')) { yt.cat = t.value; UI.store.set('yt.cat', yt.cat); return; }
      if (t.matches('[data-ytthumb]')) { yt.thumb = t.checked; return; }
      if (t.matches('[data-ytcaps]')) { yt.caps = t.checked; return; }
      if (t.matches('[data-ytkids]')) { yt.kids = t.checked; return; }
      if (t.matches('[data-ck]')) { var pub = readPub(); pub.checks = Object.assign({}, pub.checks || {}); pub.checks[t.getAttribute('data-ck')] = t.checked; D.video.publish = pub; patch({ publish: pub }, true); return; }
      if (t.matches('[data-yt]')) { var u = t.value.trim(); if (u && !/^https?:\/\//.test(u)) { UI.toast('The link should start with https://', 'error'); return; } patch({ youtube_url: u }, true); return; }
      if (t.closest('[data-tform]')) {
        if (t.name === 'take') { var f = q('[data-tform]'), tk5 = D.takes.filter(function (x) { return x.id === t.value; })[0]; if (tk5) { f.t.max = tk5.duration.toFixed(1); f.t.value = 0; } regrab(); return; }
        if (t.name === 't') { regrab(); return; }
        renderThumb();
      }
    });
    view.addEventListener('input', function (e) {
      var t = e.target;
      if (t.matches('[data-script]')) { preview(); saveScript(); return; }
      if (t.matches('[data-pk]')) {
        var k = t.getAttribute('data-pk'), c = q('[data-cnt=' + k + ']'), max = +t.getAttribute('maxlength');
        if (c) { c.textContent = t.value.length + '/' + max; c.classList.toggle('over', t.value.length >= max); }
        savePub(); return;
      }
      if (t.closest('[data-tform]')) {
        if (t.name === 't') { var tt = q('[data-tt]'); if (tt) tt.textContent = VB.fmtTime(+t.value); regrab(); return; }
        renderThumb();
      }
    });
    return {
      ready: VB.getConfig().then(load),
      destroy: function () {
        dead = true; if (saveScript.pending()) saveScript.flush(); if (savePub.pending()) savePub.flush();
        if (yt.busy) UI.toast('The YouTube upload keeps going in the background only while this tab is open.');
        if (player) player.destroy(); VB.releaseSources();
      }
    };
  });
})();
