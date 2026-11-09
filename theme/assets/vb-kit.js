/* vb-kit.js: the small window.UI helpers VideoBlog Buddy's JavaScript engines (vb-*.js) were written against, now that
   the app itself is Python Forms. Loaded after app-kit.js (which has UI.esc, UI.plural, UI.store, UI.icon, UI.ICONS,
   light/dark) and before the engines.

   Server:   UI.api(fn, ...args) / UI.apiQuiet go through window.VB_BRIDGE, a Python function set by client_code/vb.py
             (anvil.server.call there). A reply {ok: false, error} rejects with err.expected = true; errors nobody
             catches become a toast.
   Host:     VB.host = Python functions (client_code/vb.py): toast, confirm, video_menu, go. UI.toast / UI.confirm use
             them, so the engines show the same notifications and dialogs as the Forms; VB.videoMenu opens the Python
             VideoMenu dialog.
   Screens:  UI.page(name, opts, mount) keeps an engine screen in UI.pages; Components/Screen mounts it (record, video,
             edit in vb-screens.js) into a fresh element each time, so listeners never pile up.
   Also:     UI.me (set by Python on start, sign in and sign out), UI.current() (the open page, set by router.py),
             UI.go, UI.busy, UI.formData, UI.ago, UI.fmtDate(Time), UI.initials, UI.modal (the engines' own small
             dialogs) and [data-go] links inside engine markup. */
(function () {
  'use strict';
  var UI = window.UI = window.UI || {};
  var VB = window.VB = window.VB || {};
  UI.pages = UI.pages || {};
  UI.me = UI.me || null;
  UI._page = { name: '', args: [] };
  VB.host = VB.host || {};

  UI.page = function (name, opts, mount) {
    if (typeof opts === 'function') { mount = opts; opts = {}; }
    opts.name = name; opts.mount = mount;
    UI.pages[name] = opts;
  };
  /* Mount an engine screen into el (a fresh child element each time). Returns {ready: Promise, destroy()}. */
  UI.mountScreen = function (name, el, args) {
    var p = UI.pages[name];
    if (!p) throw new Error('No screen called ' + name);
    el.innerHTML = '';
    var view = document.createElement('div');
    view.className = 'vb-screen vb-screen-' + name;
    el.appendChild(view);
    var out;
    try { out = p.mount(view, { name: name, args: args || [], me: UI.me, go: UI.go, api: UI.api, page: p }); } catch (e) { console.error(e); out = Promise.reject(e); }
    var ready = out && typeof out.then === 'function' ? out : (out && out.ready) || Promise.resolve();
    ready = Promise.resolve(ready).then(function (v) { window.UI_READY = true; return v; }, function (e) {
      window.UI_READY = true;
      console.error(e);
      if (!view.innerHTML) view.innerHTML = '<div class="ui-wrap"><div class="ui-empty">' + UI.icon('info') +
        '<h3>This page didn\'t load</h3><p class="muted">' + UI.esc(e && e.message || 'Something went wrong.') + '</p></div></div>';
    });
    return { ready: ready, destroy: (out && out.destroy) || function () {} };
  };
  UI.current = function () { return UI._page; };

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
  UI.busy = function (btn, promise) {
    if (!btn) return promise;
    btn.disabled = true; btn.classList.add('is-busy');
    var done = function () { btn.disabled = false; btn.classList.remove('is-busy'); };
    promise.then(done, done);
    return promise;
  };
  UI.hashFor = function (name) {
    var args = Array.prototype.slice.call(arguments, 1).filter(function (a) { return a != null && a !== ''; });
    return '#' + [name].concat(args.map(encodeURIComponent)).join('/');
  };
  UI.go = function () {
    var h = UI.hashFor.apply(null, arguments);
    if (location.hash === h && VB.host.go) VB.host.go(h); else location.hash = h;
  };
  UI.refresh = function () { if (VB.host.go) VB.host.go(location.hash); };

  /* ------------------------------------------------------------------ toasts and dialogs */
  UI.toast = function (msg, kind) {
    if (VB.host.toast) { try { VB.host.toast(String(msg), kind || ''); return; } catch (e) { /* fall through */ } }
    var box = document.querySelector('.ui-toasts');
    if (!box) { box = document.createElement('div'); box.className = 'ui ui-toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    var t = document.createElement('div');
    t.className = 'ui-toast' + (kind ? ' ' + kind : '');
    t.innerHTML = '<span>' + UI.esc(msg) + '</span>';
    box.appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 200); }, kind === 'error' ? 6500 : 3200);
  };
  UI.confirm = function (o) {
    o = typeof o === 'string' ? { title: o } : (o || {});
    if (VB.host.confirm) return Promise.resolve(VB.host.confirm(JSON.stringify(o))).then(function (v) { return !!v; });
    return Promise.resolve(window.confirm(o.title || 'Are you sure?'));
  };
  /* A plain dialog for the engines' own small prompts (export settings, AI prompts, notes ...). */
  UI.modal = function (html, opts) {
    opts = opts || {};
    var prev = document.activeElement, wrap = document.createElement('div');
    wrap.className = 'ui ui-modal-wrap';
    wrap.innerHTML = '<div class="ui-modal' + (opts.wide ? ' wide' : '') + '" role="dialog" aria-modal="true" tabindex="-1">' +
      '<button type="button" class="ui-btn ghost icon ui-modal-x" data-close aria-label="Close">' + UI.icon('x') + '</button>' + html + '</div>';
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
    var first = wrap.querySelector('input, textarea, select') || wrap.querySelector('.ui-modal');
    setTimeout(function () { if (first.focus) first.focus(); }, 30);
    return { el: wrap.querySelector('.ui-modal'), close: close };
  };

  /* The "⋯" actions on a video (the video hub uses it): the Python VideoMenu dialog. after() runs when it changed something. */
  VB.videoMenu = function (btn, v, after) {
    if (!VB.host.video_menu) return;
    Promise.resolve(VB.host.video_menu(JSON.stringify(v))).then(function (changed) { if (changed && after) after(); });
  };

  /* ------------------------------------------------------------------ the server, through Python */
  function send(kind, payload) {
    if (!window.VB_BRIDGE) return Promise.reject(new Error('The app is still starting.'));
    var out;
    try { out = window.VB_BRIDGE(kind, JSON.stringify(payload || {})); } catch (e) { return Promise.reject(e); }
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
  function expected(res) {
    if (res && typeof res === 'object' && res.ok === false) {
      var err = new Error(res.error || 'That didn\'t work.'); err.uiApi = true; err.expected = true; err.result = res;
      throw err;
    }
    return res;
  }
  UI.api = function (fn) { return send('call', { fn: fn, args: Array.prototype.slice.call(arguments, 1), quiet: false }).then(expected); };
  UI.apiQuiet = function (fn) { return send('call', { fn: fn, args: Array.prototype.slice.call(arguments, 1), quiet: true }).then(expected); };
  window.addEventListener('unhandledrejection', function (e) {
    if (e.reason && e.reason.uiApi) { e.preventDefault(); UI.toast(e.reason.message, 'error'); }
  });

  /* [data-go="page/arg"] inside engine markup (back buttons, empty states) */
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-go]');
    if (!el) return;
    e.preventDefault();
    UI.go.apply(null, el.getAttribute('data-go').split('/'));
  });
})();
