/* vb-engine.js (was web/pages/_b_engine.html): _b_engine: the video engine. Everything runs in the browser; nothing is uploaded. VB.videoEl / VB.seek open + seek recorded WebM (fixes their missing duration) VB.openTake(take, {fresh}) -> src {main: {img, w, h, el?}, cam, frame(t)} (samples are drawn live) VB.analyze(src) / VB.silences(...) loudness envelope (50 per second) / the pauses "Remove pauses" cuts VB.autoZooms(clicks) / VB.zoomAt zoom regions from recorded clicks / the zoom at a moment VB.plan(edit, takes, srcs) the edit as a timeline: scenes -> kept segments, output times, chapters VB.render(g, W, H, plan, o, opt) draws output time o: layouts, camera bubble, zoom, cards, text, hide/highlight boxes, captions (from take.words), transitions VB.Player(canvas) preview player (video elements drive the clock; cards/samples a timer) VB.exportVideo(plan, opts) real-time render to MP4 (or WebM) with MediaRecorder VB.drawThumb / VB.grabFrame YouTube thumbnail maker */
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
  function drawCaptions(g, W, H, e, s, t, progress, floor) {
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
    var base = vert ? H * 0.7 : H - m * 0.09 - (progress ? m * 0.012 : 0);
    if (floor && floor < H) base = Math.min(base, floor - m * 0.025);  // stay above a lower third or ticker
    var y0 = c.pos === 'top' ? m * 0.1 + lh / 2 : c.pos === 'middle' ? H / 2 - total / 2 + lh / 2 : base - total + lh / 2;
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
  /* The edit's colour look for the camera, and (if asked) the screen without the camera-only parts. */
  function looksFor(e) {
    var lk = e.look;
    if (!VB.lookActive || !VB.lookActive(lk)) return null;
    if (looksFor.src !== lk || looksFor.json !== JSON.stringify(lk)) {
      looksFor.src = lk; looksFor.json = JSON.stringify(lk);
      looksFor.val = { cam: lk, screen: lk.target === 'all' ? Object.assign({}, lk, { light: { on: false }, crop: { z: 1, x: 0.5, y: 0.5, mirror: false } }) : null };
    }
    return looksFor.val;
  }
  function drawTake(g, W, H, plan, L, o, opt) {
    var e = plan.edit, s = L.s, src = s.src, m = Math.min(W, H);
    if (!src || src.missing) {
      g.fillStyle = '#181818'; g.fillRect(0, 0, W, H); g.fillStyle = '#aaa'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '500 ' + fontPx(W, H, 0.04) + 'px Roboto, Arial';
      g.fillText(src && src.missing ? '“' + (s.take.label || 'Take') + '” is on another computer' : 'Loading…', W / 2, H / 2);
      return;
    }
    src.frame(L.srcT);
    var Lo = layoutOf(plan, s), pad = (e.pad || 0) * m, rad = (e.pad > 0.004 ? e.radius || 0 : 0) * m / 1080, zoom = VB.zoomAt(s.zooms, L.srcT);
    var main = src.main, cam = src.cam, lk = opt && opt.noLook ? null : looksFor(e);
    if (lk) {
      if (s.take.mode === 'cam') main = VB.gradeSource('main', main, lk.cam, o);
      else {
        if (cam) cam = VB.gradeSource('cam', cam, lk.cam, o);
        if (lk.screen) main = VB.gradeSource('main', main, lk.screen, o);
      }
    }
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
    var hasFrames = !opt.noFrames && e.frames && e.frames.length && VB.drawFrames;
    if (L.s.type === 'card') drawCard(g, W, H, L.s.sc, L.local, L.s.dur, opt);
    else {
      drawTake(g, W, H, plan, L, o, opt);
      (L.s.sc.texts || []).forEach(function (tx) {
        if (L.srcT >= tx.s && L.srcT <= tx.e && tx.id !== opt.hideTextId) drawText(g, W, H, tx, (L.srcT - tx.s) / L.s.speed, (tx.e - tx.s) / L.s.speed);
      });
      if (!opt.noCaptions) drawCaptions(g, W, H, e, L.s, L.srcT, e.progress, hasFrames && e.captions && e.captions.on ? VB.frameFloor(W, H, plan, o, L) : 0);
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
    // Frames go on last, so they stay put when the scene under them changes (like a TV studio graphic).
    if (hasFrames) VB.drawFrames(g, W, H, plan, o, L, opt);
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
  /* Voice presets for the export. -> the last node of the chain (input = the voice gain). */
  VB.VOICE_FX = [['off', 'As recorded'], ['clean', 'Clean'], ['broadcast', 'Broadcast'], ['warm', 'Warm podcast']];
  VB.voiceChain = function (ac, input, kind) {
    function bq(type, f, gain, q) { var n = ac.createBiquadFilter(); n.type = type; n.frequency.value = f; if (gain != null) n.gain.value = gain; if (q != null) n.Q.value = q; return n; }
    function comp(th, ratio, at, rel, knee) { var c = ac.createDynamicsCompressor(); c.threshold.value = th; c.ratio.value = ratio; c.attack.value = at; c.release.value = rel; c.knee.value = knee; return c; }
    function gainN(v) { var n = ac.createGain(); n.gain.value = v; return n; }
    var chain;
    if (kind === 'clean') {  // cut the rumble, a little presence, even out the level
      chain = [bq('highpass', 85, null, 0.7), bq('lowshelf', 180, -2), bq('peaking', 3200, 3, 0.9), comp(-26, 3.5, 0.008, 0.2, 8), gainN(1.45)];
    } else if (kind === 'broadcast') {  // radio voice: tight lows, forward mids, air, strong levelling and a limiter
      chain = [bq('highpass', 95, null, 0.8), bq('lowshelf', 220, -3), bq('peaking', 3500, 4, 1), bq('highshelf', 9000, 2.5), comp(-30, 5, 0.004, 0.15, 6), gainN(1.9), comp(-3, 20, 0.001, 0.05, 0)];
    } else if (kind === 'warm') {  // podcast: fuller lows, softer highs, gentle levelling
      chain = [bq('highpass', 70, null, 0.7), bq('lowshelf', 160, 2.5), bq('peaking', 2600, -1.5, 0.8), bq('highshelf', 8000, -2), comp(-24, 3, 0.01, 0.25, 10), gainN(1.4), comp(-2, 20, 0.002, 0.08, 0)];
    } else return input;
    var last = input;
    chain.forEach(function (n) { last.connect(n); last = n; });
    return last;
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
      await VB.loadFrameFonts();
      var dest = ac.createMediaStreamDestination(), voice = ac.createGain();
      var voiceOut = VB.voiceChain(ac, voice, plan.edit.voice_fx);
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
