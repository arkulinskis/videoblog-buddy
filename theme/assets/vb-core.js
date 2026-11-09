/* vb-core.js (was web/pages/_a_core.html): _a_core: window.VB, shared by every page (loaded first: files starting with "_" have no UI.page). VB helpers + icons, constants (KINDS, STATUSES, BGS, DEFAULT_EDIT), VB.vault (IndexedDB: the recordings live here, never on the server), VB.ext (bridge to the browser extension), VB.sample (the sample recordings, drawn live: a fictional app tour + a cartoon presenter + a mumbly voice), confetti. */
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
      captions: { on: false, style: vert ? 'bold' : 'karaoke', pos: vert ? 'middle' : 'bottom', size: 1, upper: false, color: '#ffde00' },
      look: VB.fullLook(UI.store.get('vb.look', null)), frames: [], scenes: [] };
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
    // The default look (Look tab -> "Use for new videos") only goes on new edits, never on older ones.
    out.look = VB.fullLook(e.look ? JSON.parse(JSON.stringify(e.look)) : (e.scenes && e.scenes.length ? null : d.look));
    out.frames = (e.frames || []).map(function (f) { return JSON.parse(JSON.stringify(f)); });
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
    var auto = UI.store.get('vb.frames', null);  // frames chosen for every new video (Frames tab)
    if (auto && auto.layers && auto.layers.length) e.frames = VB.framesFrom(auto.layers, { name: UI.me && UI.me.name, handle: handle, product: product });
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
