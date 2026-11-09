/* vb-sound.js (was web/pages/_h_sound.html): _h_sound: sounds made in the browser, so there's nothing to license. VB.BEATS / VB.beat(name) "Buddy beats": four background tracks synthesised on the fly (a seamless loop as a WAV Blob) VB.sfx(ac, kind) short sound effects: a mouse 'click' and a 'whoosh' for scene changes VB.sfxEvents(plan) when they play on the output timeline (VB.plan puts them in plan.sfx) */
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
