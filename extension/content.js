/* VideoBlog Buddy extension: runs on every page.
   1. Bridge: if the page is the VideoBlog Buddy app, it pings us with window.postMessage({vbb: 'app'}); we answer
      {vbb: 'ext'} and pass recording state / countdowns / tests to the service worker, and messages back to the page.
      Pages that don't ping are never talked to.
   2. While the app records: a red ring where you click (it shows in the video), a badge for shortcut keys
      (Ctrl/Alt/Cmd combos, Enter, Esc, Tab, arrows; never the letters you type), the countdown, and the
      drawing pen (Alt+Shift+D). Click positions (0..1 of the window) + times go to the service worker, which
      forwards them only to the connected app. Everything is drawn in a closed shadow root, so pages can't touch it. */
(function () {
  'use strict';
  if (window.__vbbContent) return;
  window.__vbbContent = true;
  var VERSION = chrome.runtime.getManifest().version;
  var rec = { on: false, paused: false, opts: { rings: true, keys: true } };
  var alive = true;
  function send(msg, cb) {
    try { chrome.runtime.sendMessage(msg, function (r) { if (chrome.runtime.lastError) return; if (cb) cb(r); }); }
    catch (e) { alive = false; }  // the extension was reloaded: this old script is orphaned
  }
  function post(msg) {
    var o = location.origin && location.origin !== 'null' ? location.origin : '*';
    window.postMessage(Object.assign({ vbb: 'ext' }, msg), o);
  }

  /* ---------------- 1. bridge */
  window.addEventListener('message', function (e) {
    if (e.source !== window || !e.data || e.data.vbb !== 'app' || !alive) return;
    var d = e.data;
    if (d.type === 'ping') send({ t: 'app-hello' }, function (r) { if (r) post({ type: 'hello', paired: !!r.paired, version: VERSION, opts: r.opts }); });
    else if (d.type === 'rec') send({ t: 'app-rec', on: !!d.on, paused: !!d.paused });
    else if (d.type === 'countdown') send({ t: 'app-countdown', n: d.n | 0 });
    else if (d.type === 'test') send({ t: 'app-test' });
  });
  chrome.runtime.onMessage.addListener(function (m) {
    if (m.t === 'to-app') post(m.msg);
    else if (m.t === 'rec') { rec = { on: !!m.on, paused: !!m.paused, opts: m.opts || rec.opts }; if (!rec.on) stopDraw(); }
    else if (m.t === 'countdown') countdown(m.n);
    else if (m.t === 'draw-toggle') { if (drawing) stopDraw(); else startDraw(); }
  });
  send({ t: 'get-rec' }, function (r) { if (r) rec = { on: !!r.on, paused: !!r.paused, opts: r.opts || rec.opts }; });

  /* ---------------- 2. overlay */
  var host = null, root = null;
  var CSS = ':host{all:initial}.l{position:fixed;inset:0;pointer-events:none;z-index:2147483647;font-family:Roboto,Arial,sans-serif}' +
    '.ring{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:4px solid #e62117;box-sizing:border-box;animation:r .6s ease-out forwards}' +
    '.dot{position:fixed;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:rgba(230,33,23,.85);animation:d .45s ease-out forwards}' +
    '@keyframes r{from{transform:scale(.3);opacity:1}to{transform:scale(1.6);opacity:0}}@keyframes d{to{opacity:0;transform:scale(.5)}}' +
    '.key{position:fixed;left:50%;bottom:48px;transform:translateX(-50%);background:rgba(20,20,20,.88);color:#fff;font:700 22px/1 Roboto,Arial,sans-serif;padding:12px 18px;border-radius:8px;' +
    'box-shadow:0 6px 24px rgba(0,0,0,.35);border-bottom:3px solid #e62117;transition:opacity .3s}.key.out{opacity:0}' +
    '.cd{position:fixed;left:50%;top:50%;width:160px;height:160px;margin:-80px 0 0 -80px;border-radius:50%;background:rgba(15,15,15,.82);color:#fff;display:flex;align-items:center;justify-content:center;' +
    'font:900 88px/1 Roboto,Arial,sans-serif;box-shadow:0 0 0 6px #e62117;animation:p .9s ease-out}@keyframes p{from{transform:scale(1.4);opacity:0}30%{opacity:1}}' +
    'canvas{position:fixed;inset:0;pointer-events:auto;cursor:crosshair}.hint{position:fixed;top:14px;left:50%;transform:translateX(-50%);background:#e62117;color:#fff;font:600 13px/1 Roboto,Arial,sans-serif;padding:8px 12px;border-radius:4px}';
  function layer() {
    if (host && host.isConnected) return root;
    host = document.createElement('vbb-overlay');
    root = host.attachShadow({ mode: 'closed' });
    var st = document.createElement('style'); st.textContent = CSS; root.appendChild(st);
    var l = document.createElement('div'); l.className = 'l'; root.appendChild(l);
    (document.documentElement || document.body).appendChild(host);
    return root;
  }
  function L() { return layer().querySelector('.l'); }
  function ring(x, y) {
    var r = document.createElement('div'); r.className = 'ring'; r.style.left = x + 'px'; r.style.top = y + 'px';
    var d = document.createElement('div'); d.className = 'dot'; d.style.left = x + 'px'; d.style.top = y + 'px';
    L().appendChild(r); L().appendChild(d);
    setTimeout(function () { r.remove(); d.remove(); }, 700);
  }
  document.addEventListener('pointerdown', function (e) {
    if (!rec.on || rec.paused || !alive || drawing || !e.isTrusted) return;
    if (rec.opts.rings !== false) ring(e.clientX, e.clientY);
    send({ t: 'click', x: e.clientX / Math.max(1, innerWidth), y: e.clientY / Math.max(1, innerHeight), ts: Date.now() });
  }, true);

  var keyEl = null, keyTimer = 0;
  var SPECIAL = { Enter: 'Enter ⏎', Escape: 'Esc', Tab: 'Tab ⇥', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backspace: '⌫', Delete: 'Del' };
  var MAC = /Mac/i.test(navigator.platform);
  document.addEventListener('keydown', function (e) {
    if (!rec.on || rec.paused || rec.opts.keys === false || !alive || !e.isTrusted) return;
    if (['Control', 'Shift', 'Alt', 'Meta'].indexOf(e.key) >= 0) return;
    var mods = [];
    if (e.ctrlKey) mods.push('Ctrl'); if (e.metaKey) mods.push(MAC ? '⌘' : 'Win'); if (e.altKey) mods.push(MAC ? '⌥' : 'Alt');
    var label;
    if (mods.length) { if (e.shiftKey) mods.push('Shift'); label = mods.concat([e.key.length === 1 ? e.key.toUpperCase() : (SPECIAL[e.key] || e.key)]).join(' + '); }
    else if (SPECIAL[e.key]) label = (e.shiftKey ? 'Shift + ' : '') + SPECIAL[e.key];
    else return;  // plain typing is never shown or sent
    if (!keyEl || !keyEl.isConnected) { keyEl = document.createElement('div'); keyEl.className = 'key'; L().appendChild(keyEl); }
    keyEl.textContent = label; keyEl.classList.remove('out');
    clearTimeout(keyTimer); keyTimer = setTimeout(function () { if (keyEl) keyEl.classList.add('out'); }, 1300);
  }, true);

  var cdEl = null;
  function countdown(n) {
    if (cdEl) { cdEl.remove(); cdEl = null; }
    if (!n) return;
    cdEl = document.createElement('div'); cdEl.className = 'cd'; cdEl.textContent = n; L().appendChild(cdEl);
    var el = cdEl; setTimeout(function () { if (el === cdEl) { el.remove(); cdEl = null; } }, 1100);
  }

  /* ---------------- the drawing pen */
  var drawing = false, cv = null, hint = null, strokes = [], cur = null, raf = 0;
  function startDraw() {
    if (drawing) return;
    drawing = true;
    cv = document.createElement('canvas'); hint = document.createElement('div'); hint.className = 'hint';
    hint.textContent = 'Drawing: drag to draw · Esc or Alt+Shift+D to stop';
    L().appendChild(cv); L().appendChild(hint);
    var dpr = window.devicePixelRatio || 1;
    function size() { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px'; }
    size(); window.addEventListener('resize', size);
    cv.addEventListener('pointerdown', function (e) { cur = { pts: [[e.clientX, e.clientY]], end: 0 }; strokes.push(cur); try { cv.setPointerCapture(e.pointerId); } catch (x) { /* fine */ } });
    cv.addEventListener('pointermove', function (e) { if (cur) cur.pts.push([e.clientX, e.clientY]); });
    cv.addEventListener('pointerup', function () { if (cur) cur.end = performance.now(); cur = null; });
    (function frame(now) {
      if (!drawing) return;
      var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, innerWidth, innerHeight);
      strokes = strokes.filter(function (s) { return !s.end || now - s.end < 3500; });
      strokes.forEach(function (s) {
        var a = s.end ? Math.max(0, 1 - (now - s.end - 2500) / 1000) : 1;
        g.globalAlpha = Math.min(1, a); g.strokeStyle = '#e62117'; g.lineWidth = 6; g.lineCap = 'round'; g.lineJoin = 'round';
        g.shadowColor = 'rgba(0,0,0,.25)'; g.shadowBlur = 4;
        g.beginPath(); s.pts.forEach(function (p, i) { if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); g.stroke();
      });
      raf = requestAnimationFrame(frame);
    })(performance.now());
  }
  function stopDraw() {
    if (!drawing) return;
    drawing = false; cancelAnimationFrame(raf); strokes = []; cur = null;
    if (cv) cv.remove(); if (hint) hint.remove(); cv = hint = null;
  }
  document.addEventListener('keydown', function (e) { if (drawing && e.key === 'Escape') stopDraw(); }, true);
})();
