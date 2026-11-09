/* vb-studio.js (was web/pages/_i_studio.html): _i_studio: production-quality tools for talking-head videos. Nothing here uses AI and nothing leaves the browser. Looks: VB.LOOKS (16 colour looks, made as 3D LUTs in the browser), VB.gradeSource (WebGL colour grading of a camera or screen frame: exposure, contrast, highlights, shadows, warmth, tint, saturation, vibrance, fade, sharpen, smooth skin, grain, vignette, a virtual key light and a reframe crop; plain-canvas fallback without WebGL), VB.parseCube (.cube LUT files), VB.lookAuto ("Fix my lighting": levels + grey-world white balance), VB.lightCheck (the recorder's light meter), VB.QUICK_FIXES. Frames: VB.FRAME_STYLES (13 newsroom-style overlays you type into), VB.FRAME_TRANS (13 in/out transitions), VB.FRAME_SETS (ready-made sets, Addanapp included), VB.newFrame, VB.drawFrames (called by VB.render). */
(function () {
  'use strict';
  var VB = window.VB, clamp = VB.clamp, rr = VB.rr;

  /* ================================================================== LOOKS */
  function luma(c) { return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
  function sat(c, k) { var l = luma(c); return [l + (c[0] - l) * k, l + (c[1] - l) * k, l + (c[2] - l) * k]; }
  function curve(x, k) {  // S-curve around the middle (k > 0 more contrast, k < 0 less)
    x = clamp(x, 0, 1);
    var s = x < 0.5 ? 0.5 * Math.pow(2 * x, 1 + Math.abs(k)) : 1 - 0.5 * Math.pow(2 * (1 - x), 1 + Math.abs(k));
    return k >= 0 ? s : x + (x - s);
  }
  function curves(c, k) { return [curve(c[0], k), curve(c[1], k), curve(c[2], k)]; }
  function gain(c, r, g, b) { return [c[0] * r, c[1] * g, c[2] * b]; }
  function lift(c, a, top) { top = top == null ? 1 : top; return c.map(function (v) { return a + v * (top - a); }); }
  function split(c, sh, hi, amt) {  // tint the shadows and the highlights
    var l = luma(c), ws = (1 - l) * (1 - l), wh = l * l;
    return [0, 1, 2].map(function (i) { return c[i] + ((sh[i] - 0.5) * ws + (hi[i] - 0.5) * wh) * amt; });
  }
  function power(c, p) { return c.map(function (v) { return Math.pow(clamp(v, 0, 1), p); }); }
  function mono(c, r, g, b) { var l = c[0] * r + c[1] * g + c[2] * b; return [l, l, l]; }
  /* Each look is a colour function (a 3D LUT is made from it) plus a CSS-filter stand-in for browsers without WebGL. */
  VB.LOOKS = [
    { key: 'none', name: 'Natural', emoji: '⚪', blurb: 'No colour look', css: '' },
    { key: 'studio', name: 'Clean studio', emoji: '🎙️', blurb: 'Gentle contrast, skin-friendly', css: 'contrast(1.06) saturate(1.05)',
      f: function (c) { return sat(curves(gain(c, 1.02, 1, 0.98), 0.22), 1.05); } },
    { key: 'news', name: 'Newsroom', emoji: '📺', blurb: 'Punchy, clean whites', css: 'contrast(1.12) saturate(1.15)',
      f: function (c) { return sat(curves(gain(c, 1, 1, 1.02), 0.3), 1.15); } },
    { key: 'warm', name: 'Warm & friendly', emoji: '☀️', blurb: 'Soft and welcoming', css: 'sepia(.12) saturate(1.1) contrast(1.03)',
      f: function (c) { return sat(curves(gain(c, 1.06, 1.01, 0.9), 0.15), 1.06); } },
    { key: 'cool', name: 'Cool tech', emoji: '🧊', blurb: 'Crisp blue shadows', css: 'hue-rotate(-8deg) saturate(.95) contrast(1.08)',
      f: function (c) { return sat(curves(split(gain(c, 0.97, 1, 1.05), [0.35, 0.5, 0.75], [0.52, 0.52, 0.5], 0.5), 0.22), 0.95); } },
    { key: 'teal', name: 'Teal & orange', emoji: '🎬', blurb: 'The cinema look', css: 'contrast(1.12) saturate(1.15) sepia(.08)',
      f: function (c) { return sat(curves(split(c, [0.2, 0.55, 0.62], [0.78, 0.55, 0.32], 0.55), 0.3), 1.08); } },
    { key: 'film', name: 'Film fade', emoji: '🎞️', blurb: 'Lifted blacks, soft colour', css: 'contrast(.9) saturate(.82) sepia(.1) brightness(1.03)',
      f: function (c) { return lift(sat(curves(gain(c, 1.03, 1, 0.95), 0.2), 0.82), 0.07, 0.95); } },
    { key: 'golden', name: 'Golden hour', emoji: '🌇', blurb: 'Sunset warmth', css: 'sepia(.25) saturate(1.2) contrast(1.04)',
      f: function (c) { return sat(lift(split(gain(c, 1.08, 1, 0.82), [0.55, 0.45, 0.4], [0.75, 0.62, 0.35], 0.35), 0.02), 1.1); } },
    { key: 'airy', name: 'Bright & airy', emoji: '🌤️', blurb: 'Light, pastel, low contrast', css: 'brightness(1.1) contrast(.88) saturate(.9)',
      f: function (c) { return lift(sat(curves(power(c, 0.85), -0.15), 0.9), 0.04); } },
    { key: 'moody', name: 'Moody', emoji: '🌧️', blurb: 'Deep shadows, quiet colour', css: 'brightness(.92) contrast(1.18) saturate(.75)',
      f: function (c) { return sat(split(curves(power(c, 1.12), 0.4), [0.38, 0.5, 0.55], [0.5, 0.5, 0.5], 0.4), 0.75); } },
    { key: 'neon', name: 'Night neon', emoji: '🌃', blurb: 'Magenta and cyan', css: 'contrast(1.15) saturate(1.35) hue-rotate(10deg)',
      f: function (c) { return sat(curves(split(c, [0.62, 0.3, 0.68], [0.35, 0.72, 0.78], 0.5), 0.3), 1.25); } },
    { key: 'green', name: 'Green film', emoji: '🌿', blurb: 'Fresh greens, cool shadows', css: 'hue-rotate(6deg) saturate(.92) contrast(1.06)',
      f: function (c) { var d = sat(curves(split(gain(c, 0.98, 1.03, 1), [0.42, 0.52, 0.56], [0.52, 0.53, 0.46], 0.4), 0.25), 0.9); return lift(d, 0.03); } },
    { key: 'vintage', name: 'Vintage 70s', emoji: '📻', blurb: 'Faded yellow-green', css: 'sepia(.35) contrast(.9) saturate(.8)',
      f: function (c) { return lift(sat(split(gain(c, 1.05, 1.02, 0.84), [0.45, 0.55, 0.45], [0.6, 0.56, 0.4], 0.35), 0.75), 0.08, 0.92); } },
    { key: 'bleach', name: 'Bleach bypass', emoji: '⚡', blurb: 'Gritty, silvery, hard', css: 'saturate(.45) contrast(1.3)',
      f: function (c) { var l = luma(c); return curves([VB.lerp(c[0], l, 0.55), VB.lerp(c[1], l, 0.55), VB.lerp(c[2], l, 0.55)], 0.55); } },
    { key: 'bw', name: 'Classic black & white', emoji: '◐', blurb: 'Timeless', css: 'grayscale(1) contrast(1.08)',
      f: function (c) { return curves(mono(c, 0.3, 0.59, 0.11), 0.2); } },
    { key: 'noir', name: 'Noir', emoji: '🕵️', blurb: 'High-contrast black & white', css: 'grayscale(1) contrast(1.45) brightness(.92)',
      f: function (c) { return curves(power(mono(c, 0.36, 0.56, 0.08), 1.1), 0.75); } }
  ];
  VB.lookInfo = function (k) { return VB.LOOKS.filter(function (l) { return l.key === k; })[0] || null; };
  /* Neutral settings: nothing changes. */
  VB.LOOK_NEUTRAL = function () {
    return { on: false, target: 'cam', lut: 'none', amt: 1, cube: '', exposure: 0, contrast: 0, highlights: 0, shadows: 0, temp: 0, tint: 0,
      sat: 0, vib: 0, fade: 0, sharpen: 0, smooth: 0, grain: 0, vignette: 0,
      light: { on: false, x: 0.5, y: 0.38, size: 0.35, power: 0.4, warm: 0.3 }, crop: { z: 1, x: 0.5, y: 0.5, mirror: false } };
  };
  VB.fullLook = function (l) {
    var d = VB.LOOK_NEUTRAL(), out = Object.assign({}, d, l || {});
    out.light = Object.assign({}, d.light, (l && l.light) || {});
    out.crop = Object.assign({}, d.crop, (l && l.crop) || {});
    return out;
  };
  VB.SLIDERS = {  // key: [label, min, max, step]
    exposure: ['Exposure', -2, 2, 0.05], contrast: ['Contrast', -1, 1, 0.02], highlights: ['Highlights', -1, 1, 0.02], shadows: ['Shadows', -1, 1, 0.02],
    fade: ['Fade', 0, 1, 0.02], temp: ['Warmth', -1, 1, 0.02], tint: ['Tint', -1, 1, 0.02], sat: ['Saturation', -1, 1, 0.02], vib: ['Vibrance', -1, 1, 0.02],
    sharpen: ['Sharpen', 0, 1, 0.02], smooth: ['Smooth skin', 0, 1, 0.02], grain: ['Film grain', 0, 1, 0.02], vignette: ['Vignette', 0, 1, 0.02]
  };
  /* Is anything switched on? (Then the frame goes through the grader.) */
  VB.lookActive = function (l) {
    if (!l || !l.on) return false;
    if (l.lut && l.lut !== 'none' && l.amt > 0) return true;
    if (Object.keys(VB.SLIDERS).some(function (k) { return Math.abs(l[k] || 0) > 0.004; })) return true;
    if (l.light && l.light.on && l.light.power > 0) return true;
    return !!(l.crop && (l.crop.z > 1.001 || l.crop.mirror));
  };

  /* ---- LUT tables: strips of N slices (width N*N, height N), red across, green down, blue = slice. */
  var LUT_N = 32, lutData = {};
  function lutFor(key) {
    if (lutData[key]) return lutData[key];
    var look = VB.lookInfo(key); if (!look || !look.f) return null;
    var N = LUT_N, data = new Uint8Array(N * N * N * 4);
    for (var b = 0; b < N; b++) for (var g = 0; g < N; g++) for (var r = 0; r < N; r++) {
      var c = look.f([r / (N - 1), g / (N - 1), b / (N - 1)]), i = (g * N * N + b * N + r) * 4;
      data[i] = clamp(Math.round(c[0] * 255), 0, 255); data[i + 1] = clamp(Math.round(c[1] * 255), 0, 255); data[i + 2] = clamp(Math.round(c[2] * 255), 0, 255); data[i + 3] = 255;
    }
    lutData[key] = { n: N, data: data };
    return lutData[key];
  }
  /* A .cube file (Resolve, Premiere, phones): -> {n, data} or throws a friendly error. */
  VB.parseCube = function (text) {
    var n = 0, vals = [], dmin = [0, 0, 0], dmax = [1, 1, 1];
    String(text || '').split(/\r?\n/).forEach(function (line) {
      line = line.trim(); if (!line || line[0] === '#') return;
      var p = line.split(/\s+/);
      if (p[0] === 'LUT_3D_SIZE') { n = parseInt(p[1], 10); return; }
      if (p[0] === 'LUT_1D_SIZE') throw new Error('This is a 1D LUT. Use a 3D .cube file.');
      if (p[0] === 'DOMAIN_MIN') { dmin = p.slice(1, 4).map(Number); return; }
      if (p[0] === 'DOMAIN_MAX') { dmax = p.slice(1, 4).map(Number); return; }
      if (/^[-+0-9.eE]/.test(p[0]) && p.length >= 3) vals.push(+p[0], +p[1], +p[2]);
    });
    if (!n || n < 2) throw new Error('This file has no LUT_3D_SIZE line, so it isn\'t a 3D .cube LUT.');
    if (n > 64) throw new Error('This LUT is ' + n + ' points per side. Use one with 64 or fewer (most are 33).');
    if (vals.length < n * n * n * 3) throw new Error('This .cube file is cut short (' + Math.floor(vals.length / 3) + ' of ' + (n * n * n) + ' colours).');
    var data = new Uint8Array(n * n * n * 4);
    for (var i = 0; i < n * n * n; i++) {
      var r = i % n, g = Math.floor(i / n) % n, b = Math.floor(i / (n * n)), o = (g * n * n + b * n + r) * 4;
      for (var k = 0; k < 3; k++) data[o + k] = clamp(Math.round((vals[i * 3 + k] - dmin[k]) / ((dmax[k] - dmin[k]) || 1) * 255), 0, 255);
      data[o + 3] = 255;
    }
    return { n: n, data: data };
  };
  VB.useCube = function (name, parsed) { lutData['cube:' + name] = parsed; };
  VB.hasCube = function (name) { return !!lutData['cube:' + name]; };
  /* Load a saved .cube from this browser (the editor calls it when an edit uses one). */
  VB.loadCube = function (name) {
    if (!name || lutData['cube:' + name]) return Promise.resolve(!!name);
    return VB.vault.meta.get('lut:' + name).then(function (txt) { if (!txt) return false; VB.useCube(name, VB.parseCube(txt)); return true; })['catch'](function () { return false; });
  };
  VB.saveCube = function (file) {
    return file.text().then(function (txt) {
      var parsed = VB.parseCube(txt), name = file.name.replace(/\.cube$/i, '').replace(/[^\w .()-]+/g, '').slice(0, 60) || 'My LUT';
      VB.useCube(name, parsed);
      return VB.vault.meta.set('lut:' + name, txt).then(function () { return name; });
    });
  };

  /* ---- the WebGL grader */
  var VS = 'attribute vec2 p; varying vec2 v_uv; void main(){ v_uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
  var FS = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH', 'precision highp float;', '#else', 'precision mediump float;', '#endif',
    'uniform sampler2D u_img; uniform sampler2D u_lut; uniform float u_N; uniform float u_amt;',
    'uniform vec2 u_px; uniform vec2 u_size;',
    'uniform float u_exp, u_con, u_hi, u_sh, u_temp, u_tint, u_sat, u_vib, u_fade, u_sharp, u_smooth, u_vig, u_grain, u_time;',
    'uniform vec4 u_light; uniform float u_lwarm; uniform vec4 u_crop;',
    'varying vec2 v_uv;',
    'float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }',
    'vec3 tx(vec2 q){ return texture2D(u_img, clamp(q, u_px * 0.5, 1.0 - u_px * 0.5)).rgb; }',
    'vec3 lut(vec3 c){',
    '  float n = u_N, b = c.b * (n - 1.0), b0 = floor(b), b1 = min(b0 + 1.0, n - 1.0);',
    '  float x = (c.r * (n - 1.0) + 0.5) / (n * n), y = (c.g * (n - 1.0) + 0.5) / n;',
    '  return mix(texture2D(u_lut, vec2(x + b0 / n, y)).rgb, texture2D(u_lut, vec2(x + b1 / n, y)).rgb, b - b0);',
    '}',
    'float hash(vec2 q){ return fract(sin(dot(q, vec2(12.9898, 78.233))) * 43758.5453); }',
    'void main(){',
    '  vec2 uv = v_uv;',
    '  if (u_crop.w > 0.5) uv.x = 1.0 - uv.x;',
    '  uv = vec2(u_crop.y, u_crop.z) + (uv - 0.5) / u_crop.x;',
    '  vec3 c = tx(uv);',
    '  float sc = u_size.y / 720.0;',
    '  if (u_smooth > 0.0) {',
    '    vec3 acc = c; float ws = 1.0; float r = (1.2 + u_smooth * 2.6) * sc;',
    '    for (int i = 0; i < 12; i++) {',
    '      float a = float(i) * 0.5236; float rad = mod(float(i), 2.0) < 0.5 ? r : r * 2.1;',
    '      vec3 s = tx(uv + vec2(cos(a), sin(a)) * rad * u_px); vec3 d = s - c; float w = exp(-dot(d, d) * 55.0);',
    '      acc += s * w; ws += w;',
    '    }',
    '    c = mix(c, acc / ws, u_smooth * 0.9);',
    '  }',
    '  if (u_sharp > 0.0) {',
    '    vec2 o = u_px * max(1.0, sc);',
    '    vec3 bl = (tx(uv + vec2(o.x, 0.0)) + tx(uv - vec2(o.x, 0.0)) + tx(uv + vec2(0.0, o.y)) + tx(uv - vec2(0.0, o.y))) * 0.25;',
    '    c += (c - bl) * u_sharp * 2.2;',
    '  }',
    '  c = max(c, 0.0);',
    '  vec3 lin = pow(c, vec3(2.2)) * exp2(u_exp);',
    '  lin *= vec3(1.0 + 0.22 * u_temp + 0.05 * u_tint, 1.0 + 0.03 * u_temp - 0.12 * u_tint, 1.0 - 0.3 * u_temp + 0.05 * u_tint);',
    '  c = pow(max(lin, 0.0), vec3(1.0 / 2.2));',
    '  float l = lum(c);',
    '  float shw = 1.0 - smoothstep(0.0, 0.55, l), hiw = smoothstep(0.45, 1.0, l);',
    '  float nl = l + u_sh * 0.34 * shw * mix(l, 1.0 - l, step(0.0, u_sh)) * 1.6 + u_hi * 0.32 * hiw * mix(l, 1.0 - l, step(0.0, u_hi));',
    '  c *= nl / max(l, 0.0001);',
    '  c = clamp(c, 0.0, 1.0);',
    '  if (u_con >= 0.0) c = mix(c, c * c * (3.0 - 2.0 * c), u_con); else c = mix(c, vec3(0.46), -u_con * 0.45);',
    '  l = lum(c);',
    '  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));',
    '  float s = (1.0 + u_sat) * (1.0 + u_vib * (1.0 - clamp((mx - mn) * 2.5, 0.0, 1.0)) * 0.9);',
    '  c = vec3(l) + (c - vec3(l)) * s;',
    '  if (u_light.w > 0.0) {',
    '    vec2 q = (vec2(v_uv.x, 1.0 - v_uv.y) - u_light.xy) * vec2(u_size.x / u_size.y, 1.0);',
    '    float k = exp(-dot(q, q) / (u_light.z * u_light.z));',
    '    c *= 1.0 + u_light.w * 0.65 * k;',
    '    c += vec3(0.05, 0.018, -0.035) * u_lwarm * k * u_light.w;',
    '  }',
    '  c = clamp(c, 0.0, 1.0);',
    '  if (u_amt > 0.0) c = mix(c, lut(c), u_amt);',
    '  c = c * (1.0 - u_fade * 0.17) + u_fade * 0.075;',
    '  if (u_vig > 0.0) { float d = length((v_uv - 0.5) * 1.414); c *= 1.0 - u_vig * 0.7 * smoothstep(0.32, 1.05, d); }',
    '  if (u_grain > 0.0) { float g = hash(floor(v_uv * u_size / max(1.0, sc)) + fract(u_time * 7.13) * 91.7) - 0.5; c += g * u_grain * 0.11 * (1.0 - abs(lum(c) - 0.5)); }',
    '  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);',
    '}'
  ].join('\n');
  var UNI = ['u_img', 'u_lut', 'u_N', 'u_amt', 'u_px', 'u_size', 'u_exp', 'u_con', 'u_hi', 'u_sh', 'u_temp', 'u_tint', 'u_sat', 'u_vib', 'u_fade', 'u_sharp', 'u_smooth',
    'u_vig', 'u_grain', 'u_time', 'u_light', 'u_lwarm', 'u_crop'];
  var glBroken = false;
  function Grader() {
    var cv = document.createElement('canvas'), gl = null, U = {}, tex = null, lutTex = null, lutKey = null, self = {};
    try { gl = !glBroken && (cv.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true }) || cv.getContext('experimental-webgl')); } catch (e) { gl = null; }
    if (gl) {
      try {
        var sh = function (type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
        var pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
        if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
        gl.useProgram(pr);
        var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        var loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        UNI.forEach(function (n) { U[n] = gl.getUniformLocation(pr, n); });
        var mk = function () { var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(function (p) { gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE); });
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); return t; };
        tex = mk(); lutTex = mk();
        gl.uniform1i(U.u_img, 0); gl.uniform1i(U.u_lut, 1);
        cv.addEventListener('webglcontextlost', function (e) { e.preventDefault(); gl = null; });
      } catch (err) { console.warn('colour grading falls back to plain canvas:', err.message || err); gl = null; }
    }
    var fb = null;  // the fallback canvas
    self.gl = function () { return !!gl; };
    self.apply = function (img, w, h, L, time) {
      var k = Math.min(1, 1920 / Math.max(w, h)), ow = Math.max(2, Math.round(w * k)), oh = Math.max(2, Math.round(h * k));
      if (gl) {
        try {
          if (cv.width !== ow || cv.height !== oh) { cv.width = ow; cv.height = oh; }
          gl.viewport(0, 0, ow, oh);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
          var key = L.lut === 'cube' ? 'cube:' + L.cube : L.lut, lt = key && key !== 'none' ? lutFor(key) : null;
          gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, lutTex);
          if (lt && lutKey !== key) { gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, lt.n * lt.n, lt.n, 0, gl.RGBA, gl.UNSIGNED_BYTE, lt.data); lutKey = key; }
          gl.uniform1f(U.u_N, lt ? lt.n : 2); gl.uniform1f(U.u_amt, lt ? clamp(L.amt, 0, 1) : 0);
          gl.uniform2f(U.u_px, 1 / w, 1 / h); gl.uniform2f(U.u_size, ow, oh);
          gl.uniform1f(U.u_exp, L.exposure || 0); gl.uniform1f(U.u_con, L.contrast || 0); gl.uniform1f(U.u_hi, L.highlights || 0); gl.uniform1f(U.u_sh, L.shadows || 0);
          gl.uniform1f(U.u_temp, L.temp || 0); gl.uniform1f(U.u_tint, L.tint || 0); gl.uniform1f(U.u_sat, L.sat || 0); gl.uniform1f(U.u_vib, L.vib || 0);
          gl.uniform1f(U.u_fade, L.fade || 0); gl.uniform1f(U.u_sharp, L.sharpen || 0); gl.uniform1f(U.u_smooth, L.smooth || 0); gl.uniform1f(U.u_vig, L.vignette || 0);
          gl.uniform1f(U.u_grain, L.grain || 0); gl.uniform1f(U.u_time, time || 0);
          var li = L.light || {}, cr = L.crop || {};
          gl.uniform4f(U.u_light, li.x == null ? 0.5 : li.x, li.y == null ? 0.38 : li.y, Math.max(0.05, li.size || 0.35), li.on ? li.power || 0 : 0); gl.uniform1f(U.u_lwarm, li.warm || 0);
          var z = Math.max(1, cr.z || 1), half = 0.5 / z;
          gl.uniform4f(U.u_crop, z, clamp(cr.x == null ? 0.5 : cr.x, half, 1 - half), 1 - clamp(cr.y == null ? 0.5 : cr.y, half, 1 - half), cr.mirror ? 1 : 0);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          return cv;
        } catch (e) { console.warn('colour grading frame skipped:', e.message || e); return null; }
      }
      // Fallback: CSS filters on a 2D canvas (no LUT, key light or skin smoothing).
      if (!fb) fb = document.createElement('canvas');
      if (fb.width !== ow || fb.height !== oh) { fb.width = ow; fb.height = oh; }
      var g = fb.getContext('2d'), info = VB.lookInfo(L.lut), cr2 = L.crop || {}, z2 = Math.max(1, cr2.z || 1);
      var f = 'brightness(' + Math.pow(2, (L.exposure || 0) * 0.6).toFixed(3) + ') contrast(' + (1 + (L.contrast || 0) * 0.5).toFixed(3) + ') saturate(' + Math.max(0, 1 + (L.sat || 0) + (L.vib || 0) * 0.4).toFixed(3) + ')';
      if ((L.temp || 0) > 0) f += ' sepia(' + (L.temp * 0.3).toFixed(3) + ')';
      if ((L.temp || 0) < 0) f += ' hue-rotate(' + Math.round(L.temp * 12) + 'deg)';
      if (info && info.css && L.amt > 0.3) f += ' ' + info.css;
      g.save(); g.filter = f;
      var sw = w / z2, sh2 = h / z2, sx = clamp((cr2.x == null ? 0.5 : cr2.x) * w - sw / 2, 0, w - sw), sy = clamp((cr2.y == null ? 0.5 : cr2.y) * h - sh2 / 2, 0, h - sh2);
      if (cr2.mirror) { g.translate(ow, 0); g.scale(-1, 1); }
      try { g.drawImage(img, sx, sy, sw, sh2, 0, 0, ow, oh); } catch (e) { g.restore(); return null; }
      g.restore();
      if (L.vignette > 0) { var rg = g.createRadialGradient(ow / 2, oh / 2, Math.min(ow, oh) * 0.3, ow / 2, oh / 2, Math.max(ow, oh) * 0.72); rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(1, 'rgba(0,0,0,' + (L.vignette * 0.65).toFixed(2) + ')'); g.fillStyle = rg; g.fillRect(0, 0, ow, oh); }
      return fb;
    };
    return self;
  }
  var graders = {};
  VB.grader = function (role) { if (!graders[role]) graders[role] = Grader(); return graders[role]; };
  VB.webglLooks = function () { return VB.grader('main').gl(); };
  /* src {img, w, h} -> graded {img, w, h}, or src unchanged when the look is off or the frame isn't ready. */
  VB.gradeSource = function (role, src, look, time) {
    if (!src || !src.img || !VB.lookActive(look)) return src;
    var img = src.img;
    if (img.tagName === 'VIDEO' && (img.readyState < 2 || !img.videoWidth)) return src;
    var out = VB.grader(role).apply(img, src.w, src.h, look, time || 0);
    return out ? { img: out, w: out.width, h: out.height, graded: true } : src;
  };
  /* A graded copy of a canvas or image (thumbnails, stills). */
  VB.gradeCanvas = function (canvas, look) {
    if (!canvas || !VB.lookActive(look)) return canvas;
    var g = VB.gradeSource('still', { img: canvas, w: canvas.width, h: canvas.height }, look, 0);
    if (!g.graded) return canvas;
    var c = document.createElement('canvas'); c.width = g.w; c.height = g.h; c.getContext('2d').drawImage(g.img, 0, 0);
    return c;
  };

  /* ---- measuring the light (for "Fix my lighting" and the recorder's light meter) */
  var probe = null;
  function stats(img, w, h) {
    if (!probe) probe = document.createElement('canvas');
    var pw = 96, ph = Math.max(8, Math.round(96 * h / Math.max(1, w)));
    probe.width = pw; probe.height = ph;
    var g = probe.getContext('2d', { willReadFrequently: true });
    try { g.drawImage(img, 0, 0, pw, ph); } catch (e) { return null; }
    var d = g.getImageData(0, 0, pw, ph).data, hist = new Array(64).fill(0), n = 0, sr = 0, sg = 0, sb = 0, mid = 0, centre = 0, cn = 0, edge = 0, en = 0;
    for (var y = 0; y < ph; y++) for (var x = 0; x < pw; x++) {
      var i = (y * pw + x) * 4, r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255, l = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
      hist[Math.min(63, Math.floor(l * 64))]++; n++;
      if (l > 0.15 && l < 0.85) { sr += r; sg += gg; sb += b; mid++; }
      var cx = x / pw - 0.5, cy = y / ph - 0.42;
      if (Math.abs(cx) < 0.18 && Math.abs(cy) < 0.22) { centre += l; cn++; } else if (Math.abs(cx) > 0.32 || y / ph < 0.12) { edge += l; en++; }
    }
    function pct(q) { var want = q * n, acc = 0; for (var k = 0; k < 64; k++) { acc += hist[k]; if (acc >= want) return (k + 0.5) / 64; } return 1; }
    return { p02: pct(0.02), p10: pct(0.1), p50: pct(0.5), p90: pct(0.9), p98: pct(0.98), clip: hist[63] / n, crush: hist[0] / n,
      rgb: mid ? [sr / mid, sg / mid, sb / mid] : [0.5, 0.5, 0.5], centre: cn ? centre / cn : 0.5, edge: en ? edge / en : 0.5 };
  }
  VB.lightStats = function (img) { var w = img.videoWidth || img.width, h = img.videoHeight || img.height; return w && h ? stats(img, w, h) : null; };
  /* Settings that fix this picture's light and colour (levels, grey-world white balance, backlight). */
  VB.lookAuto = function (img) {
    var s = VB.lightStats(img); if (!s) return null;
    var out = {}, faceL = s.centre;
    // Exposure: bring the face (centre) towards a bright mid tone.
    var target = 0.5, ev = Math.log(Math.pow(target, 2.2) / Math.pow(clamp(faceL, 0.04, 0.95), 2.2)) / Math.LN2;
    out.exposure = +clamp(ev * 0.75, -1.2, 1.4).toFixed(2);
    out.shadows = +clamp((0.12 - s.p10) * 3.2 + (s.edge - faceL > 0.12 ? 0.25 : 0), 0, 0.7).toFixed(2);
    out.highlights = +clamp(-(s.clip * 8 + Math.max(0, s.p98 - 0.97) * 6), -0.7, 0).toFixed(2);
    var spread = s.p90 - s.p10;
    out.contrast = +clamp((0.55 - spread) * 0.6, -0.2, 0.3).toFixed(2);
    var c = s.rgb, avg = (c[0] + c[1] + c[2]) / 3;
    out.temp = +clamp((c[2] - c[0]) / avg * 1.6, -0.7, 0.7).toFixed(2);
    out.tint = +clamp((c[1] - (c[0] + c[2]) / 2) / avg * 2.2, -0.5, 0.5).toFixed(2);
    out.vib = 0.15;
    if (s.edge - faceL > 0.16) out.light = { on: true, power: +clamp((s.edge - faceL) * 1.6, 0.2, 0.7).toFixed(2) };
    return out;
  };
  /* The recorder's light meter: what's wrong with the light on the face, in plain words. */
  VB.lightCheck = function (img) {
    var s = VB.lightStats(img); if (!s) return null;
    var c = s.rgb, avg = (c[0] + c[1] + c[2]) / 3, warm = (c[0] - c[2]) / (avg || 1), out = { face: s.centre, stats: s, tips: [] };
    if (s.centre < 0.22) { out.level = 'bad'; out.msg = 'Too dark'; out.tips.push('Put a lamp or a window in front of you, a bit above your eyes.'); }
    else if (s.centre > 0.82 || s.clip > 0.08) { out.level = 'warn'; out.msg = 'Too bright'; out.tips.push('Move the light further away, or turn it down: your face is losing detail.'); }
    else if (s.edge - s.centre > 0.18) { out.level = 'warn'; out.msg = 'Backlit'; out.tips.push('Something behind you is brighter than your face. Turn around so the window is in front of you, or close the curtain.'); }
    else { out.level = 'ok'; out.msg = 'Good light'; }
    if (warm > 0.28) out.tips.push('The light is quite orange. Use a daylight bulb, or fix it later with Warmth in the Look tab.');
    if (warm < -0.18) out.tips.push('The light is bluish (screen or daylight). Add a warm lamp, or fix it later with Warmth.');
    if (s.p90 - s.p10 < 0.18 && out.level === 'ok') out.tips.push('The picture looks flat. A light from one side (45°) gives your face shape.');
    return out;
  };
  /* One-click fixes for common rooms. Each changes a look (a copy) and returns it. */
  VB.QUICK_FIXES = [
    { key: 'dark', name: 'Dark room', emoji: '🌑', fix: function (l) { l.exposure = 0.7; l.shadows = 0.45; l.smooth = Math.max(l.smooth, 0.25); l.contrast = 0.1; l.vib = 0.15; return l; } },
    { key: 'window', name: 'Window behind me', emoji: '🪟', fix: function (l) { l.shadows = 0.6; l.highlights = -0.55; l.exposure = 0.3; l.light = Object.assign({}, l.light, { on: true, power: 0.5 }); return l; } },
    { key: 'orange', name: 'Lamp too orange', emoji: '💡', fix: function (l) { l.temp = -0.45; l.tint = 0.05; return l; } },
    { key: 'blue', name: 'Too blue', emoji: '🖥️', fix: function (l) { l.temp = 0.4; l.tint = -0.05; return l; } },
    { key: 'webcam', name: 'Webcam boost', emoji: '📷', fix: function (l) { l.sharpen = 0.35; l.smooth = 0.3; l.contrast = 0.12; l.vib = 0.25; l.fade = 0; return l; } },
    { key: 'soft', name: 'Soft & flattering', emoji: '✨', fix: function (l) { l.smooth = 0.55; l.highlights = -0.2; l.light = Object.assign({}, l.light, { on: true, power: 0.3, warm: 0.4 }); l.vignette = 0.25; return l; } }
  ];

  /* ================================================================== FRAMES */
  VB.FONTS = {
    condensed: ['Condensed', '"Roboto Condensed", Roboto, Arial'], anton: ['Anton', 'Anton, Impact, sans-serif'], bebas: ['Bebas', '"Bebas Neue", Anton, Impact'],
    roboto: ['Roboto', 'Roboto, Arial, sans-serif'], serif: ['Serif', '"Instrument Serif", Georgia, serif'], mono: ['Mono', '"JetBrains Mono", Consolas, monospace']
  };
  function fam(f) { return (VB.FONTS[f.font] || VB.FONTS.condensed)[1]; }
  function bold(f) { return f.font === 'anton' || f.font === 'bebas' || f.font === 'serif' ? '400 ' : '700 '; }
  function inkOn(hex) {
    var n = parseInt(String(hex || '#000').slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 165 ? '#111' : '#fff';
  }
  function fitFont(g, text, weight, family, px, maxW, minPx) {
    var s = px; g.font = weight + s + 'px ' + family;
    while (s > (minPx || 8) && g.measureText(text).width > maxW) { s = Math.floor(s * 0.92); g.font = weight + s + 'px ' + family; }
    return s;
  }
  function clipText(g, text, maxW) {
    text = String(text || ''); if (g.measureText(text).width <= maxW) return text;
    while (text.length > 1 && g.measureText(text + '…').width > maxW) text = text.slice(0, -1);
    return text + '…';
  }
  function clockText(f, ctx) {
    if (f.style === 'rec') { var t = ctx.o || 0, fr = Math.floor((t % 1) * 30); return [Math.floor(t / 3600), Math.floor(t / 60) % 60, Math.floor(t % 60), fr].map(function (v) { return String(v).padStart(2, '0'); }).join(':'); }
    var d = ctx.now || new Date(); return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  function U(W, H, f) { return Math.min(W, H) * 0.01 * (f.size || 1); }
  function vert(W, H) { return H > W * 1.2; }
  function shine(g, x, y, w, h, t, period) {  // a light sweep across a box every few seconds
    var k = ((t % period) / period) * 3 - 1; if (k < 0 || k > 1) return;
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    var sx = x - w * 0.3 + k * w * 1.6, gr = g.createLinearGradient(sx, y, sx + w * 0.25, y + h);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(x, y, w, h); g.restore();
  }
  function bottomSafe(W, H, ctx) {
    var m = Math.min(W, H), y = H - m * (vert(W, H) ? 0.16 : 0.06) - (ctx.progress ? m * 0.012 : 0);
    return ctx.ticker ? Math.min(y, ctx.ticker - m * 0.018) : y;  // lower thirds sit above a ticker
  }
  /* Where a bottom ticker starts at time o (lower thirds and captions stay above it). */
  function tickerTop(W, H, frames, o, plan, L, ctx) {
    var top = 0;
    frames.forEach(function (f) {
      if (f.style !== 'ticker' || f.pos[0] === 't' || !span(f, o, plan, L)) return;
      var y = S.ticker.box(W, H, f, ctx).y; top = top ? Math.min(top, y) : y;
    });
    return top;
  }

  /* Each style: name, emoji, which fields it uses, its default spot, box(W,H,f,ctx) = the area it covers, draw(g,W,H,f,t,ctx). */
  var S = {};
  S.desk = { name: 'News desk', emoji: '📺', blurb: 'Two-line lower third with a tag', fields: ['tag', 'title', 'sub', 'logo', 'clock'], pos: ['bl', 'br', 'tl', 'tr'],
    box: function (W, H, f, ctx) { var u = U(W, H, f), bw = vert(W, H) ? W * 0.9 : W * 0.6, bh = u * 13.5, x = f.pos[1] === 'r' ? W - W * 0.05 - bw : (vert(W, H) ? W * 0.05 : W * 0.05);
      var y = f.pos[0] === 't' ? Math.min(W, H) * 0.06 : bottomSafe(W, H, ctx) - bh; return { x: x, y: y, w: bw, h: bh }; },
    draw: function (g, W, H, f, t, ctx) {
      var B = this.box(W, H, f, ctx), u = U(W, H, f), th = u * 8, sh = u * 5.5, x = B.x, y = B.y;
      g.font = '400 ' + Math.round(u * 4.6) + 'px Anton, Impact'; var tag = (f.tag || '').toUpperCase(), tw = tag ? g.measureText(tag).width + u * 4 : 0;
      g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x + u * 0.6, y + u * 0.6, B.w, th + sh);
      g.fillStyle = '#fff'; g.fillRect(x, y, B.w, th);
      if (tag) { g.fillStyle = f.color; g.fillRect(x, y, tw, th); g.fillStyle = inkOn(f.color); g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillText(tag, x + tw / 2, y + th / 2 + u * 0.2); shine(g, x, y, tw, th, t, 6); }
      var px = fitFont(g, f.title || '', bold(f), fam(f), Math.round(u * 5.2), B.w - tw - u * 5); g.fillStyle = '#141414'; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText(clipText(g, f.title || '', B.w - tw - u * 5), x + tw + u * 2.4, y + th / 2 + px * 0.05);
      g.fillStyle = VB.mix(f.color, -0.55); g.fillRect(x, y + th, B.w, sh);
      var right = f.logo || (f.clock ? clockText(f, ctx) : '');
      g.font = '700 ' + Math.round(u * 3.1) + 'px ' + (f.font === 'mono' ? fam(f) : 'Roboto, Arial'); var rw = right ? g.measureText(right).width + u * 4 : 0;
      if (right) { g.fillStyle = f.accent; g.fillRect(x + B.w - rw, y + th, rw, sh); g.fillStyle = inkOn(f.accent); g.textAlign = 'center'; g.fillText(right, x + B.w - rw / 2, y + th + sh / 2); }
      g.font = '500 ' + Math.round(u * 3.2) + 'px Roboto, Arial'; g.fillStyle = '#fff'; g.textAlign = 'left';
      g.fillText(clipText(g, (f.sub || '').split('\n')[0], B.w - rw - u * 5), x + u * 2.4, y + th + sh / 2);
    } };
  S.ticker = { name: 'News ticker', emoji: '📰', blurb: 'Scrolling headlines along the bottom', fields: ['tag', 'ticker', 'clock', 'speed'], pos: ['bl', 'tl'],
    box: function (W, H, f, ctx) {
      var h = U(W, H, f) * 6.6, m = Math.min(W, H), bottom = (vert(W, H) ? H - m * 0.16 : H) - (ctx.progress ? m * 0.012 : 0);
      return { x: 0, y: f.pos[0] === 't' ? 0 : bottom - h, w: W, h: h };
    },
    draw: function (g, W, H, f, t, ctx) {
      var B = this.box(W, H, f, ctx), u = U(W, H, f), y = B.y, h = B.h;
      g.fillStyle = 'rgba(12,12,14,.92)'; g.fillRect(0, y, W, h);
      g.fillStyle = f.accent; g.fillRect(0, f.pos[0] === 't' ? y + h - u * 0.5 : y, W, u * 0.5);
      var clock = f.clock ? clockText(f, ctx) : '';
      g.font = '700 ' + Math.round(u * 3.2) + 'px Roboto, Arial'; var cw = clock ? g.measureText(clock).width + u * 4 : 0;
      g.font = '400 ' + Math.round(u * 4) + 'px Anton, Impact'; var tag = (f.tag || '').toUpperCase(), tw = tag ? g.measureText(tag).width + u * 5 : 0;
      var items = String(f.ticker || '').split(/\s*[|\n]\s*/).filter(Boolean), sep = '   •   ', line = items.join(sep) + sep;
      g.save(); g.beginPath(); g.rect(tw, y, W - tw - cw, h); g.clip();
      g.font = '500 ' + Math.round(u * 3.4) + 'px ' + (f.font === 'condensed' ? 'Roboto, Arial' : fam(f)); g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.textAlign = 'left';
      var lw = Math.max(1, g.measureText(line).width), off = (t * u * 14 * (f.speed || 1)) % lw;
      for (var xx = tw + u * 2 - off; xx < W; xx += lw) {
        var cx = xx;
        items.forEach(function (it) { g.fillStyle = '#fff'; g.fillText(it, cx, y + h / 2); cx += g.measureText(it).width; g.fillStyle = f.accent; g.fillText(sep, cx, y + h / 2); cx += g.measureText(sep).width; });
      }
      g.restore();
      if (tag) { g.fillStyle = f.color; g.beginPath(); g.moveTo(0, y); g.lineTo(tw, y); g.lineTo(tw + h * 0.35, y + h); g.lineTo(0, y + h); g.fill();
        g.font = '400 ' + Math.round(u * 4) + 'px Anton, Impact'; g.fillStyle = inkOn(f.color); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(tag, tw / 2, y + h / 2 + u * 0.15); }
      if (clock) { g.fillStyle = '#000'; g.fillRect(W - cw, y, cw, h); g.font = '700 ' + Math.round(u * 3.2) + 'px Roboto, Arial'; g.fillStyle = '#fff'; g.textAlign = 'center'; g.fillText(clock, W - cw / 2, y + h / 2); }
    } };
  S.breaking = { name: 'Breaking banner', emoji: '🚨', blurb: 'Big tag over a headline', fields: ['tag', 'title', 'sub'], pos: ['bl', 'tl'],
    box: function (W, H, f, ctx) { var u = U(W, H, f), h = u * (f.sub ? 22 : 17), w = W * (vert(W, H) ? 0.92 : 0.84); return { x: (W - w) / 2, y: f.pos[0] === 't' ? Math.min(W, H) * 0.07 : bottomSafe(W, H, ctx) - h, w: w, h: h }; },
    draw: function (g, W, H, f, t, ctx) {
      var B = this.box(W, H, f, ctx), u = U(W, H, f), x = B.x, y = B.y, tagH = u * 6.5, hh = u * 10;
      var tag = (f.tag || 'BREAKING NEWS').toUpperCase();
      g.font = '400 ' + Math.round(u * 4.8) + 'px Anton, Impact'; var tw = g.measureText(tag).width + u * 6;
      g.fillStyle = f.color; g.fillRect(x, y, tw, tagH);
      g.save(); g.beginPath(); g.rect(x, y, tw, tagH); g.clip(); g.globalAlpha = 0.16; g.fillStyle = '#fff';
      for (var i = -2; i < 14; i++) { var sx = x + i * u * 4 + (t * u * 8) % (u * 4); g.beginPath(); g.moveTo(sx, y + tagH); g.lineTo(sx + u * 2, y + tagH); g.lineTo(sx + u * 4.5, y); g.lineTo(sx + u * 2.5, y); g.fill(); }
      g.restore();
      g.fillStyle = inkOn(f.color); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(tag, x + tw / 2, y + tagH / 2 + u * 0.2);
      g.fillStyle = '#fff'; g.fillRect(x, y + tagH, B.w, hh);
      g.fillStyle = f.color; g.fillRect(x, y + tagH, u * 1, hh);
      var px = fitFont(g, (f.title || '').toUpperCase(), bold(f), fam(f), Math.round(u * 6.6), B.w - u * 6); g.fillStyle = '#111'; g.textAlign = 'left';
      g.fillText(clipText(g, (f.title || '').toUpperCase(), B.w - u * 6), x + u * 3.2, y + tagH + hh / 2 + px * 0.04);
      if (f.sub) { g.fillStyle = 'rgba(10,10,12,.9)'; g.fillRect(x, y + tagH + hh, B.w, B.h - tagH - hh); g.font = '500 ' + Math.round(u * 3.2) + 'px Roboto, Arial'; g.fillStyle = '#fff';
        g.fillText(clipText(g, f.sub.split('\n')[0], B.w - u * 6), x + u * 3.2, y + tagH + hh + (B.h - tagH - hh) / 2); }
      shine(g, x, y + tagH, B.w, hh, t + 1.5, 7);
    } };
  S.bug = { name: 'Channel bug', emoji: '🏷️', blurb: 'Your logo in a corner', fields: ['logo', 'title', 'clock'], pos: ['tr', 'tl', 'br', 'bl'],
    box: function (W, H, f, ctx) {
      var u = U(W, H, f), g = VB._measure; g.font = bold(f) + Math.round(u * 5) + 'px ' + fam(f); var w1 = g.measureText(f.logo || '').width;
      g.font = '600 ' + Math.round(u * 2.2) + 'px Roboto, Arial'; var w2 = g.measureText((f.title || '').toUpperCase()).width;
      var w = Math.max(w1, w2, u * 8) + u * 5, h = u * (f.title || f.clock ? 10.5 : 8), m = Math.min(W, H) * 0.04;
      return { x: f.pos[1] === 'r' ? W - m - w : m, y: f.pos[0] === 't' ? m : bottomSafe(W, H, ctx) - h, w: w, h: h };
    },
    draw: function (g, W, H, f, t, ctx) {
      var B = this.box(W, H, f, ctx), u = U(W, H, f);
      g.save(); g.globalAlpha *= 0.9; rr(g, B.x, B.y, B.w, B.h, u * 1.2); g.fillStyle = f.color; g.fill(); g.restore();
      g.fillStyle = f.accent; rr(g, B.x, B.y + B.h - u * 0.7, B.w, u * 0.7, [0, 0, u * 1.2, u * 1.2]); g.fill();
      var ink = inkOn(f.color); g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = bold(f) + Math.round(u * 5) + 'px ' + fam(f); g.fillText(f.logo || '', B.x + B.w / 2, B.y + u * (f.title || f.clock ? 4.2 : 3.8));
      var small = [(f.title || '').toUpperCase(), f.clock ? clockText(f, ctx) : ''].filter(Boolean).join('  ·  ');
      if (small) { g.font = '600 ' + Math.round(u * 2.2) + 'px Roboto, Arial'; g.globalAlpha *= 0.85; g.fillText(clipText(g, small, B.w - u * 2), B.x + B.w / 2, B.y + u * 8.1); }
    } };
  S.live = { name: 'Live badge', emoji: '🔴', blurb: 'LIVE, a place and the time', fields: ['tag', 'sub', 'clock'], pos: ['tl', 'tr', 'bl', 'br'],
    box: function (W, H, f, ctx) { var u = U(W, H, f), g = VB._measure; g.font = '400 ' + Math.round(u * 3.8) + 'px Anton, Impact'; var w1 = g.measureText((f.tag || 'LIVE').toUpperCase()).width + u * 7.5;
      g.font = '600 ' + Math.round(u * 3) + 'px Roboto, Arial'; var txt = [f.sub, f.clock ? clockText(f, ctx) : ''].filter(Boolean).join('  ·  '), w2 = txt ? g.measureText(txt).width + u * 5 : 0;
      var w = w1 + w2, h = u * 6.5, m = Math.min(W, H) * 0.04; return { x: f.pos[1] === 'r' ? W - m - w : m, y: f.pos[0] === 't' ? m : bottomSafe(W, H, ctx) - h, w: w, h: h, w1: w1, txt: txt }; },
    draw: function (g, W, H, f, t, ctx) {
      var B = this.box(W, H, f, ctx), u = U(W, H, f);
      rr(g, B.x, B.y, B.w1, B.h, [u, B.txt ? 0 : u, B.txt ? 0 : u, u]); g.fillStyle = f.color; g.fill();
      g.save(); g.globalAlpha *= Math.sin(t * Math.PI * 2 * 0.9) > -0.2 ? 1 : 0.35; g.beginPath(); g.arc(B.x + u * 3, B.y + B.h / 2, u * 1.2, 0, 7); g.fillStyle = inkOn(f.color); g.fill(); g.restore();
      g.font = '400 ' + Math.round(u * 3.8) + 'px Anton, Impact'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = inkOn(f.color); g.fillText((f.tag || 'LIVE').toUpperCase(), B.x + u * 5.2, B.y + B.h / 2 + u * 0.15);
      if (B.txt) { rr(g, B.x + B.w1, B.y, B.w - B.w1, B.h, [0, u, u, 0]); g.fillStyle = 'rgba(12,12,14,.78)'; g.fill(); g.font = '600 ' + Math.round(u * 3) + 'px Roboto, Arial'; g.fillStyle = '#fff'; g.fillText(B.txt, B.x + B.w1 + u * 2.5, B.y + B.h / 2); }
    } };
  S.studio = { name: 'Studio frame', emoji: '🖼️', blurb: 'A border around the whole picture', fields: ['title', 'logo', 'clock'], pos: ['tl'],
    box: function (W, H) { return { x: 0, y: 0, w: W, h: H, full: true }; },
    draw: function (g, W, H, f, t, ctx) {
      var u = U(W, H, f), m = Math.min(W, H), ins = m * 0.025, bw = Math.max(2, u * 0.5);
      g.strokeStyle = f.color; g.lineWidth = bw; g.strokeRect(ins, ins, W - ins * 2, H - ins * 2);
      g.strokeStyle = f.accent; g.lineWidth = bw * 2.6; var L = m * 0.07;
      [[ins, ins, 1, 1], [W - ins, ins, -1, 1], [ins, H - ins, 1, -1], [W - ins, H - ins, -1, -1]].forEach(function (c) { g.beginPath(); g.moveTo(c[0], c[1] + c[3] * L); g.lineTo(c[0], c[1]); g.lineTo(c[0] + c[2] * L, c[1]); g.stroke(); });
      g.textBaseline = 'middle';
      if (f.title) { g.font = bold(f) + Math.round(u * 3.4) + 'px ' + fam(f); var tw = g.measureText(f.title.toUpperCase()).width + u * 4; g.fillStyle = f.color; g.fillRect(ins + L * 0.4, ins - u * 2.5, tw, u * 5); g.fillStyle = inkOn(f.color); g.textAlign = 'center'; g.fillText(f.title.toUpperCase(), ins + L * 0.4 + tw / 2, ins); }
      var br = [f.logo, f.clock ? clockText(f, ctx) : ''].filter(Boolean).join('  ·  ');
      if (br) { g.font = '700 ' + Math.round(u * 3) + 'px ' + (f.font === 'serif' || f.font === 'mono' ? fam(f) : 'Roboto, Arial'); var lw = g.measureText(br).width + u * 4; g.fillStyle = f.accent; g.fillRect(W - ins - L * 0.4 - lw, H - ins - u * 2.3, lw, u * 4.6); g.fillStyle = inkOn(f.accent); g.textAlign = 'center'; g.fillText(br, W - ins - L * 0.4 - lw / 2, H - ins); }
    } };
  S.panel = { name: 'Side panel', emoji: '📋', blurb: 'A column with a heading and points', fields: ['title', 'sub', 'logo'], pos: ['br', 'bl'], subLines: true,
    box: function (W, H, f) { if (vert(W, H)) { var h = H * 0.3; return { x: 0, y: H - h, w: W, h: h }; } var w = W * 0.3; return { x: f.pos[1] === 'l' ? 0 : W - w, y: 0, w: w, h: H }; },
    draw: function (g, W, H, f, t) {
      var B = this.box(W, H, f), u = U(W, H, f), gr = g.createLinearGradient(B.x, B.y, B.x + B.w, B.y + B.h);
      gr.addColorStop(0, VB.mix(f.color, -0.25)); gr.addColorStop(1, VB.mix(f.color, -0.7)); g.fillStyle = gr; g.globalAlpha *= 0.94; g.fillRect(B.x, B.y, B.w, B.h); g.globalAlpha = Math.min(1, g.globalAlpha / 0.94);
      g.fillStyle = f.accent; if (vert(W, H)) g.fillRect(B.x, B.y, B.w, u * 0.7); else g.fillRect(f.pos[1] === 'l' ? B.x + B.w - u * 0.7 : B.x, B.y, u * 0.7, B.h);
      var pad = u * 4, x = B.x + pad, y = B.y + pad * (vert(W, H) ? 1 : 2.2), mw = B.w - pad * 2;
      g.textAlign = 'left'; g.textBaseline = 'top'; g.fillStyle = '#fff';
      g.font = bold(f) + Math.round(u * 5.4) + 'px ' + fam(f);
      VB.wrap(g, f.title || '', mw).slice(0, 3).forEach(function (l) { g.fillText(l, x, y); y += u * 6.4; });
      y += u * 1.5; g.fillStyle = f.accent; g.fillRect(x, y, u * 8, u * 0.6); y += u * 3.2;
      g.font = '400 ' + Math.round(u * 3.3) + 'px Roboto, Arial';
      String(f.sub || '').split(/\n|\s*\|\s*/).filter(Boolean).slice(0, 7).forEach(function (line, i) {
        var a = clamp((t - 0.35 - i * 0.25) / 0.35, 0, 1); if (a <= 0) return;
        g.save(); g.globalAlpha *= a; g.translate((1 - VB.ease(a)) * u * 3, 0);
        g.fillStyle = f.accent; g.beginPath(); g.arc(x + u * 0.9, y + u * 1.9, u * 0.8, 0, 7); g.fill();
        g.fillStyle = 'rgba(255,255,255,.92)';
        VB.wrap(g, line, mw - u * 3.5).slice(0, 2).forEach(function (l, k) { g.fillText(l, x + u * 3.2, y + k * u * 4.2); });
        g.restore(); y += u * (VB.wrap(g, line, mw - u * 3.5).length > 1 ? 9.4 : 5.4);
      });
      if (f.logo && !vert(W, H)) { g.font = bold(f) + Math.round(u * 3.6) + 'px ' + fam(f); g.fillStyle = 'rgba(255,255,255,.75)'; g.textBaseline = 'alphabetic'; g.fillText(f.logo, x, B.y + B.h - pad * 1.5); }
    } };
  S.glass = { name: 'Glass lower third', emoji: '🪟', blurb: 'Modern frosted name tag', fields: ['title', 'sub'], pos: ['bl', 'br', 'tl', 'tr'],
    box: function (W, H, f, ctx) { var u = U(W, H, f), g = VB._measure; g.font = bold(f) + Math.round(u * 5) + 'px ' + fam(f); var w1 = g.measureText(f.title || '').width;
      g.font = '400 ' + Math.round(u * 3.1) + 'px Roboto, Arial'; var w2 = g.measureText((f.sub || '').split('\n')[0]).width;
      var w = Math.min(W * 0.86, Math.max(w1, w2) + u * 9), h = u * (f.sub ? 13 : 9), m = Math.min(W, H) * 0.05;
      return { x: f.pos[1] === 'r' ? W - m - w : m, y: f.pos[0] === 't' ? m : bottomSafe(W, H, ctx) - h, w: w, h: h }; },
    draw: function (g, W, H, f, t, ctx) {
      var B = this.box(W, H, f, ctx), u = U(W, H, f);
      g.save(); g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = u * 3; rr(g, B.x, B.y, B.w, B.h, u * 1.6); g.fillStyle = 'rgba(16,18,24,.62)'; g.fill(); g.restore();
      rr(g, B.x, B.y, B.w, B.h, u * 1.6); g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = Math.max(1, u * 0.2); g.stroke();
      var gr = g.createLinearGradient(B.x, B.y, B.x, B.y + B.h); gr.addColorStop(0, f.color); gr.addColorStop(1, f.accent);
      rr(g, B.x + u * 2, B.y + u * 2, u * 0.9, B.h - u * 4, u * 0.45); g.fillStyle = gr; g.fill();
      g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
      g.font = bold(f) + Math.round(u * 5) + 'px ' + fam(f); g.fillText(clipText(g, f.title || '', B.w - u * 7), B.x + u * 5, B.y + u * (f.sub ? 4.8 : 4.5));
      if (f.sub) { g.font = '400 ' + Math.round(u * 3.1) + 'px Roboto, Arial'; g.fillStyle = 'rgba(255,255,255,.78)'; g.fillText(clipText(g, f.sub.split('\n')[0], B.w - u * 7), B.x + u * 5, B.y + u * 9.4); }
    } };
  S.sport = { name: 'Score bug', emoji: '🏁', blurb: 'Angled blocks, sports style', fields: ['tag', 'title', 'sub'], pos: ['bl', 'tl', 'br', 'tr'],
    box: function (W, H, f, ctx) { var u = U(W, H, f), g = VB._measure, h = u * 7.5;
      g.font = '400 ' + Math.round(u * 4.2) + 'px Anton, Impact'; var a = f.tag ? g.measureText(f.tag.toUpperCase()).width + u * 7 : 0;
      g.font = bold(f) + Math.round(u * 4.4) + 'px ' + fam(f); var b = g.measureText((f.title || '').toUpperCase()).width + u * 8;
      g.font = '700 ' + Math.round(u * 3.2) + 'px Roboto, Arial'; var c = f.sub ? g.measureText(f.sub.split('\n')[0].toUpperCase()).width + u * 7 : 0;
      var w = Math.min(W * 0.92, a + b + c), m = Math.min(W, H) * 0.05;
      return { x: f.pos[1] === 'r' ? W - m - w : m, y: f.pos[0] === 't' ? m : bottomSafe(W, H, ctx) - h, w: w, h: h, parts: [a, b, c] }; },
    draw: function (g, W, H, f, t, ctx) {
      var B = this.box(W, H, f, ctx), u = U(W, H, f), sk = B.h * 0.32, x = B.x;
      function block(w, fill, txt, font, ink) {
        if (!w) return; g.beginPath(); g.moveTo(x + sk, B.y); g.lineTo(x + w + sk, B.y); g.lineTo(x + w, B.y + B.h); g.lineTo(x, B.y + B.h); g.closePath(); g.fillStyle = fill; g.fill();
        g.font = font; g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(clipText(g, txt, w - u * 3), x + w / 2 + sk / 2, B.y + B.h / 2 + u * 0.2); x += w;
      }
      g.save(); g.shadowColor = 'rgba(0,0,0,.4)'; g.shadowBlur = u * 2;
      block(B.parts[0], f.color, (f.tag || '').toUpperCase(), '400 ' + Math.round(u * 4.2) + 'px Anton, Impact', inkOn(f.color)); g.shadowColor = 'transparent';
      block(B.parts[1], '#141418', (f.title || '').toUpperCase(), bold(f) + Math.round(u * 4.4) + 'px ' + fam(f), '#fff');
      block(B.parts[2], f.accent, (f.sub || '').split('\n')[0].toUpperCase(), '700 ' + Math.round(u * 3.2) + 'px Roboto, Arial', inkOn(f.accent));
      g.restore();
    } };
  S.minimal = { name: 'Minimal line', emoji: '➖', blurb: 'An elegant line and two words', fields: ['title', 'sub'], pos: ['bl', 'br', 'tl', 'tr'],
    box: function (W, H, f, ctx) { var u = U(W, H, f), w = W * (vert(W, H) ? 0.8 : 0.42), h = u * 12, m = Math.min(W, H) * 0.06;
      return { x: f.pos[1] === 'r' ? W - m - w : m, y: f.pos[0] === 't' ? m : bottomSafe(W, H, ctx) - h, w: w, h: h }; },
    draw: function (g, W, H, f, t, ctx) {
      var B = this.box(W, H, f, ctx), u = U(W, H, f), right = f.pos[1] === 'r', grow = VB.ease(clamp(t / 0.8, 0, 1));
      // A soft dark backing, so white words read on any picture.
      var sx = right ? B.x - u * 6 : B.x - u * 4, sw = B.w + u * 10, sc = g.createLinearGradient(right ? sx + sw : sx, 0, right ? sx : sx + sw, 0);
      sc.addColorStop(0, 'rgba(0,0,0,.55)'); sc.addColorStop(0.65, 'rgba(0,0,0,.28)'); sc.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = sc; g.fillRect(sx, B.y - u * 1.5, sw, B.h + u * 2.5);
      g.textAlign = right ? 'right' : 'left'; g.textBaseline = 'alphabetic'; var ax = right ? B.x + B.w : B.x;
      g.save(); g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = u * 1.5;
      g.font = bold(f) + Math.round(u * 5.6) + 'px ' + fam(f); g.fillStyle = '#fff'; g.fillText(clipText(g, f.title || '', B.w), ax, B.y + u * 5.6);
      g.fillStyle = f.accent; var lw = B.w * 0.6 * grow; g.fillRect(right ? ax - lw : ax, B.y + u * 7.3, lw, Math.max(2, u * 0.4));
      if (f.sub) { g.font = '500 ' + Math.round(u * 2.6) + 'px Roboto, Arial'; g.fillStyle = 'rgba(255,255,255,.92)'; var st = f.sub.split('\n')[0].toUpperCase().split('').join(String.fromCharCode(8202)); g.fillText(clipText(g, st, B.w), ax, B.y + u * 11); }
      g.restore();
    } };
  S.headline = { name: 'Top headline', emoji: '🗞️', blurb: 'A strip across the top', fields: ['tag', 'title', 'logo'], pos: ['tl'],
    box: function (W, H, f) { var u = U(W, H, f); return { x: 0, y: 0, w: W, h: u * 8 }; },
    draw: function (g, W, H, f, t) {
      var B = this.box(W, H, f), u = U(W, H, f), h = B.h;
      g.fillStyle = 'rgba(255,255,255,.96)'; g.fillRect(0, 0, W, h); g.fillStyle = f.accent; g.fillRect(0, h, W, u * 0.6);
      g.font = '400 ' + Math.round(u * 4.2) + 'px Anton, Impact'; var tag = (f.tag || '').toUpperCase(), tw = tag ? g.measureText(tag).width + u * 6 : 0;
      if (tag) { g.fillStyle = f.color; g.fillRect(0, 0, tw, h); g.fillStyle = inkOn(f.color); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(tag, tw / 2, h / 2 + u * 0.2); shine(g, 0, 0, tw, h, t, 6); }
      g.font = bold(f) + Math.round(u * 3.4) + 'px ' + (f.font === 'condensed' ? 'Roboto, Arial' : fam(f)); var lw = f.logo ? g.measureText(f.logo).width + u * 5 : 0;
      if (f.logo) { g.fillStyle = f.color; g.fillRect(W - lw, 0, lw, h); g.fillStyle = inkOn(f.color); g.textAlign = 'center'; g.fillText(f.logo, W - lw / 2, h / 2); }
      fitFont(g, f.title || '', bold(f), fam(f), Math.round(u * 4.6), W - tw - lw - u * 6); g.fillStyle = '#111'; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText(clipText(g, f.title || '', W - tw - lw - u * 6), tw + u * 3, h / 2 + u * 0.1);
    } };
  S.quote = { name: 'Pull quote', emoji: '💬', blurb: 'A big quote and who said it', fields: ['title', 'sub'], pos: ['bl', 'br', 'tl', 'tr'],
    box: function (W, H, f, ctx) { var u = U(W, H, f), g = VB._measure, w = W * (vert(W, H) ? 0.86 : 0.46); g.font = '400 ' + Math.round(u * 5.4) + 'px "Instrument Serif", Georgia, serif';
      var lines = Math.min(4, VB.wrap(g, '“' + (f.title || '') + '”', w - u * 8).length), h = u * (8 + lines * 6.4 + (f.sub ? 5 : 0)), m = Math.min(W, H) * 0.05;
      return { x: f.pos[1] === 'r' ? W - m - w : m, y: f.pos[0] === 't' ? m : bottomSafe(W, H, ctx) - h, w: w, h: h }; },
    draw: function (g, W, H, f, t, ctx) {
      var B = this.box(W, H, f, ctx), u = U(W, H, f);
      g.save(); g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = u * 3; rr(g, B.x, B.y, B.w, B.h, u * 1.2); g.fillStyle = 'rgba(255,255,255,.96)'; g.fill(); g.restore();
      g.fillStyle = f.color; rr(g, B.x, B.y, u * 1.1, B.h, [u * 1.2, 0, 0, u * 1.2]); g.fill();
      g.font = '400 ' + Math.round(u * 16) + 'px "Instrument Serif", Georgia, serif'; g.fillStyle = f.accent; g.globalAlpha *= 0.3; g.textBaseline = 'top'; g.textAlign = 'left'; g.fillText('“', B.x + u * 3, B.y - u * 1.5); g.globalAlpha = Math.min(1, g.globalAlpha / 0.3);
      g.font = (f.font === 'serif' ? 'italic 400 ' : bold(f)) + Math.round(u * 5.4) + 'px ' + (f.font === 'condensed' ? '"Instrument Serif", Georgia, serif' : fam(f)); g.fillStyle = '#16181d';
      var y = B.y + u * 4.5;
      VB.wrap(g, f.title || '', B.w - u * 8).slice(0, 4).forEach(function (l) { g.fillText(l, B.x + u * 4.5, y); y += u * 6.4; });
      if (f.sub) { g.font = '700 ' + Math.round(u * 2.8) + 'px Roboto, Arial'; g.fillStyle = VB.mix(f.color, -0.2); g.fillText('— ' + f.sub.split('\n')[0], B.x + u * 4.5, y + u * 1.2); }
    } };
  S.rec = { name: 'Camera viewfinder', emoji: '🎥', blurb: 'REC, timecode and corner marks', fields: ['title', 'clock'], pos: ['tl'],
    box: function (W, H) { return { x: 0, y: 0, w: W, h: H, full: true }; },
    draw: function (g, W, H, f, t, ctx) {
      var u = U(W, H, f), m = Math.min(W, H), ins = m * 0.05, L = m * 0.06;
      g.save(); g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = u; g.strokeStyle = 'rgba(255,255,255,.92)'; g.lineWidth = Math.max(2, u * 0.45);
      [[ins, ins, 1, 1], [W - ins, ins, -1, 1], [ins, H - ins, 1, -1], [W - ins, H - ins, -1, -1]].forEach(function (c) { g.beginPath(); g.moveTo(c[0], c[1] + c[3] * L); g.lineTo(c[0], c[1]); g.lineTo(c[0] + c[2] * L, c[1]); g.stroke(); });
      g.globalAlpha *= 0.5; g.lineWidth = Math.max(1, u * 0.25); g.beginPath(); g.moveTo(W / 2 - u * 2, H / 2); g.lineTo(W / 2 + u * 2, H / 2); g.moveTo(W / 2, H / 2 - u * 2); g.lineTo(W / 2, H / 2 + u * 2); g.stroke(); g.globalAlpha = Math.min(1, g.globalAlpha * 2);
      g.shadowColor = 'transparent';
      function pill(x, y, w, h) { g.save(); g.globalAlpha *= 0.55; rr(g, x, y, w, h, h * 0.25); g.fillStyle = '#000'; g.fill(); g.restore(); }
      g.font = '700 ' + Math.round(u * 3.2) + 'px "JetBrains Mono", Consolas, monospace'; g.textBaseline = 'middle'; g.textAlign = 'left';
      var ry = ins + L * 0.62, rx = ins + L * 0.5, recW = g.measureText('REC').width + u * 5.4;
      pill(rx - u * 1.8, ry - u * 2.6, recW, u * 5.2);
      if (Math.floor(t * 1.4) % 2 === 0) { g.beginPath(); g.arc(rx, ry, u * 1.2, 0, 7); g.fillStyle = f.color; g.fill(); }
      g.fillStyle = '#fff'; g.fillText('REC', rx + u * 2.2, ry);
      if (f.clock !== false) { var tc = clockText(f, ctx), tcw = g.measureText(tc).width; pill(W - ins - L * 0.3 - tcw - u * 1.8, ry - u * 2.6, tcw + u * 3.6, u * 5.2); g.textAlign = 'right'; g.fillStyle = '#fff'; g.fillText(tc, W - ins - L * 0.3, ry); }
      var bx = W - ins - L * 0.3 - u * 7, by = ry + u * 3.6; pill(bx - u, by - u * 0.8, u * 8.6, u * 4.2);
      g.strokeStyle = '#fff'; g.lineWidth = Math.max(1, u * 0.3); g.strokeRect(bx, by, u * 6, u * 2.6); g.fillStyle = '#fff'; g.fillRect(bx + u * 6, by + u * 0.8, u * 0.6, u * 1); g.fillRect(bx + u * 0.5, by + u * 0.5, u * 4.2, u * 1.6);
      if (f.title) { g.textAlign = 'left'; g.font = '700 ' + Math.round(u * 2.8) + 'px "JetBrains Mono", Consolas, monospace'; var tw2 = g.measureText(f.title.toUpperCase()).width; pill(rx - u * 1.8, H - ins - L * 0.55 - u * 2.4, tw2 + u * 3.6, u * 4.8); g.fillStyle = '#fff'; g.fillText(f.title.toUpperCase(), rx, H - ins - L * 0.55); }
      g.restore();
    } };
  VB.FRAME_STYLES = ['desk', 'ticker', 'breaking', 'bug', 'live', 'studio', 'panel', 'glass', 'sport', 'minimal', 'headline', 'quote', 'rec'].map(function (k) { return Object.assign({ key: k }, S[k]); });
  VB.frameStyle = function (k) { return S[k] || S.desk; };
  VB.FRAME_MAX = 12;  // keep in step with Clean.MAX_FRAMES
  VB._measure = document.createElement('canvas').getContext('2d');

  VB.FRAME_TRANS = [['none', 'Cut'], ['fade', 'Fade'], ['slide_l', 'Slide from left'], ['slide_r', 'Slide from right'], ['slide_u', 'Slide up'], ['slide_d', 'Slide down'],
    ['wipe', 'Wipe'], ['split', 'Open from the middle'], ['zoom', 'Zoom'], ['pop', 'Pop'], ['blur', 'Blur'], ['flip', 'Flip'], ['drop', 'Drop & bounce']];
  function backOut(k) { var c = 1.70158; k = k - 1; return 1 + (c + 1) * k * k * k + c * k * k; }
  function bounce(k) { var n = 7.5625, d = 2.75; if (k < 1 / d) return n * k * k; if (k < 2 / d) { k -= 1.5 / d; return n * k * k + 0.75; } if (k < 2.5 / d) { k -= 2.25 / d; return n * k * k + 0.9375; } k -= 2.625 / d; return n * k * k + 0.984375; }
  /* Apply transition kind at progress p (0 hidden .. 1 fully in) around box B. Returns false when nothing should be drawn. */
  function transit(g, W, H, kind, p, B, out) {
    if (p >= 1 || kind === 'none') return true;
    if (p <= 0) return false;
    var e = VB.ease(p), cx = B.x + B.w / 2, cy = B.y + B.h / 2, dist;
    switch (kind) {
      case 'fade': g.globalAlpha *= e; break;
      case 'slide_l': dist = B.full ? W * 0.3 : B.x + B.w + W * 0.02; g.translate(-(1 - e) * dist, 0); g.globalAlpha *= Math.min(1, e * 2.5); break;
      case 'slide_r': dist = B.full ? W * 0.3 : W - B.x + W * 0.02; g.translate((1 - e) * dist, 0); g.globalAlpha *= Math.min(1, e * 2.5); break;
      case 'slide_u': dist = B.full ? H * 0.2 : H - B.y + H * 0.02; g.translate(0, (1 - e) * dist); g.globalAlpha *= Math.min(1, e * 2.5); break;
      case 'slide_d': dist = B.full ? H * 0.2 : B.y + B.h + H * 0.02; g.translate(0, -(1 - e) * dist); g.globalAlpha *= Math.min(1, e * 2.5); break;
      case 'wipe': g.beginPath(); if (out) g.rect(B.x + B.w * (1 - e), 0, B.w * e + 1, H); else g.rect(B.x - 1, 0, B.w * e + 1, H); g.clip(); break;
      case 'split': g.beginPath(); g.rect(cx - B.w * e / 2, 0, B.w * e, H); g.clip(); break;
      case 'zoom': var z = 0.55 + 0.45 * e; g.translate(cx, cy); g.scale(z, z); g.translate(-cx, -cy); g.globalAlpha *= e; break;
      case 'pop': var z2 = Math.max(0.01, backOut(p)); g.translate(cx, cy); g.scale(z2, z2); g.translate(-cx, -cy); g.globalAlpha *= Math.min(1, p * 3); break;
      case 'blur': g.filter = 'blur(' + ((1 - e) * Math.min(W, H) * 0.03).toFixed(1) + 'px)'; g.globalAlpha *= e; break;
      case 'flip': g.translate(cx, cy); g.scale(1, Math.max(0.01, e)); g.translate(-cx, -cy); g.globalAlpha *= Math.min(1, e * 2); break;
      case 'drop': var k = out ? e : bounce(p), dy = (1 - k) * (B.full ? H * 0.3 : B.y + B.h + H * 0.02); g.translate(0, out ? (1 - e) * (H - B.y + H * 0.02) : -dy); g.globalAlpha *= Math.min(1, p * 3); break;
    }
    return true;
  }
  /* Is frame f on at output time o? -> {t (seconds since it started), s, e} or null */
  function span(f, o, plan, L) {
    var s = f.all ? 0 : f.s, e = f.all ? plan.outDur : Math.min(f.e, plan.outDur);
    if (o < s || o > e) return null;
    if (!f.cards && L && L.s.type === 'card') return null;
    return { t: o - s, s: s, e: e };
  }
  /* The lowest top edge of the frames along the bottom at o (captions sit above it). */
  VB.frameFloor = function (W, H, plan, o, L) {
    var floor = H, list = plan.edit.frames || [], ctx = { o: o, progress: plan.edit.progress };
    ctx.ticker = tickerTop(W, H, list, o, plan, L, ctx);
    list.forEach(function (f) {
      if (!span(f, o, plan, L)) return;
      var st = VB.frameStyle(f.style), B = st.box(W, H, f, ctx);
      if (!B.full && B.y > H * 0.45 && B.w > W * 0.3) floor = Math.min(floor, B.y);
    });
    return floor;
  };
  /* Draw every frame that is on at output time o (bottom of the list = drawn last = on top). */
  VB.drawFrames = function (g, W, H, plan, o, L, opt) {
    var list = plan.edit.frames || []; if (!list.length) return;
    var ctx = { o: o, progress: plan.edit.progress, now: opt && opt.now };
    ctx.ticker = tickerTop(W, H, list, o, plan, L, ctx);
    list.forEach(function (f) {
      var sp = span(f, o, plan, L); if (!sp) return;
      var st = VB.frameStyle(f.style), B = st.box(W, H, f, ctx), tin = f.din || 0.6, tout = f.dout || 0.5;
      g.save();
      var ok = true;
      if (sp.t < tin && f.tin !== 'none') ok = transit(g, W, H, f.tin, sp.t / tin, B, false);
      else if (sp.e - o < tout && f.tout !== 'none') ok = transit(g, W, H, f.tout, (sp.e - o) / tout, B, true);
      if (ok) { try { st.draw(g, W, H, f, sp.t, ctx); } catch (e) { console.warn('frame draw', f.style, e); } }
      g.restore();
    });
  };
  /* A new frame layer with sensible words for this person / app. */
  VB.newFrame = function (style, who) {
    who = who || {};
    var p = who.product || {}, name = who.name || 'Your name', app = p.name || 'My app', brand = p.color && p.color !== '#cc181e' ? p.color : '#cc181e';
    var base = { id: VB.uid('f').slice(0, 20), style: style, tag: '', title: '', sub: '', ticker: '', logo: '', color: brand, accent: '#ffc400', font: 'condensed', pos: (VB.frameStyle(style).pos || ['bl'])[0],
      size: 1, clock: false, speed: 1, all: true, s: 0, e: 8, cards: false, tin: 'slide_l', tout: 'fade', din: 0.6, dout: 0.5 };
    var d = {
      desk: { tag: 'LIVE', title: name, sub: who.handle ? who.handle : 'Maker of ' + app, logo: '', clock: true, all: false, s: 1, e: 9 },
      ticker: { tag: 'LATEST', ticker: app + ' | ' + (p.tagline || 'New features this week') + ' | ' + (p.cta || 'Try it today') + (p.url ? ' | ' + p.url.replace(/^https?:\/\//, '') : ''), clock: true, tin: 'slide_u', tout: 'slide_d' },
      breaking: { tag: 'BREAKING NEWS', title: app + ' is out today', sub: p.tagline || '', all: false, s: 0.5, e: 7, tin: 'wipe', tout: 'wipe' },
      bug: { logo: p.emoji ? p.emoji + ' ' + app : app, title: who.handle || '', tin: 'fade', tout: 'fade', accent: '#ffffff' },
      live: { tag: 'LIVE', sub: 'Montréal', clock: true, color: '#e62117', tin: 'pop', tout: 'fade' },
      studio: { title: app, logo: who.handle || '', tin: 'fade', tout: 'fade' },
      panel: { title: 'In this video', sub: (p.features || 'The big idea\nHow it works\nWhat is next').split('\n').slice(0, 4).join('\n'), all: false, s: 2, e: 12, tin: 'slide_r', tout: 'slide_r', color: '#1d2433', accent: brand },
      glass: { title: name, sub: who.handle || 'Maker of ' + app, all: false, s: 1, e: 7, accent: '#3ea6ff', tin: 'slide_u', tout: 'fade' },
      sport: { tag: 'EP 1', title: app, sub: 'Devlog', all: false, s: 1, e: 8, tin: 'slide_l', tout: 'slide_l' },
      minimal: { title: name, sub: 'Maker of ' + app, all: false, s: 1, e: 7, accent: brand, tin: 'fade', tout: 'fade' },
      headline: { tag: 'TODAY', title: (p.tagline || 'What I built this week'), logo: app, tin: 'slide_d', tout: 'slide_d' },
      quote: { title: p.tagline || 'Ship small, ship often.', sub: name, all: false, s: 2, e: 9, font: 'serif', tin: 'zoom', tout: 'fade' },
      rec: { title: 'A-CAM', clock: true, color: '#e62117', tin: 'none', tout: 'none' }
    }[style] || {};
    return Object.assign(base, d);
  };
  /* Ready-made sets: several layers at once. */
  var AA = { color: '#0B1220', accent: '#2F5BFF', green: '#0E9F6E' };
  VB.FRAME_SETS = [
    { key: 'addanapp', name: 'Addanapp newsroom', emoji: '🅰️', blurb: 'Navy and blue: bug, name tag and services ticker', layers: [
      { style: 'bug', logo: 'Addanapp', title: 'triple A software delivery', color: AA.color, accent: AA.accent, font: 'serif', pos: 'tr', tin: 'fade', tout: 'fade' },
      { style: 'desk', tag: 'ADDANAPP', title: 'Your name', sub: 'Software delivery · Montréal', logo: 'addanapp.com', color: AA.accent, accent: AA.green, font: 'roboto', pos: 'bl', all: false, s: 1, e: 10, tin: 'slide_l', tout: 'slide_l', clock: false },
      { style: 'ticker', tag: 'ADDANAPP', ticker: 'Web apps, admin panels, client portals and data platforms | AI-accelerated, human-validated | Fixed quotes. Pay for results. | addanapp.com', color: AA.accent, accent: AA.green, font: 'roboto', clock: true, speed: 0.9, tin: 'slide_u', tout: 'slide_d' }] },
    { key: 'addanapp_lt', name: 'Addanapp name tag', emoji: '🔷', blurb: 'One clean lower third in Addanapp blue', layers: [
      { style: 'glass', title: 'Your name', sub: 'Addanapp · triple A software delivery', color: AA.accent, accent: AA.green, font: 'serif', pos: 'bl', all: false, s: 1, e: 8, tin: 'slide_u', tout: 'fade' }] },
    { key: 'evening', name: 'Evening news', emoji: '🌆', blurb: 'Red classic: live badge, name tag, ticker', layers: [
      { style: 'live', tag: 'LIVE', sub: 'Studio', clock: true, color: '#e62117', pos: 'tl', tin: 'pop', tout: 'fade' },
      { style: 'desk', tag: 'NEWS', title: 'Your name', sub: 'App maker', color: '#cc181e', accent: '#ffc400', all: false, s: 1, e: 9, tin: 'slide_l', tout: 'slide_l' },
      { style: 'ticker', tag: 'LATEST', ticker: 'New video every week | Subscribe for more | Links in the description', color: '#cc181e', accent: '#ffc400', clock: true, tin: 'slide_u', tout: 'slide_d' }] },
    { key: 'breaking', name: 'Breaking story', emoji: '🚨', blurb: 'For launches and big news', layers: [
      { style: 'breaking', tag: 'BREAKING NEWS', title: 'It just shipped', sub: 'Here is what changed', color: '#cc181e', all: false, s: 0.5, e: 7, tin: 'wipe', tout: 'wipe' },
      { style: 'headline', tag: 'LAUNCH', title: 'Everything new in this release', logo: 'LIVE', color: '#cc181e', accent: '#ffc400', tin: 'slide_d', tout: 'slide_d' }] },
    { key: 'tech', name: 'Tech review', emoji: '💻', blurb: 'Studio frame, glass name tag, corner bug', layers: [
      { style: 'studio', title: 'Review', logo: '', color: '#3ea6ff', accent: '#ffffff', tin: 'fade', tout: 'fade' },
      { style: 'glass', title: 'Your name', sub: 'Tech, tools and apps', color: '#3ea6ff', accent: '#a36bff', all: false, s: 1, e: 7, tin: 'slide_u', tout: 'fade' }] },
    { key: 'vlog', name: 'Vlog camera', emoji: '🎥', blurb: 'Viewfinder look with a minimal name', layers: [
      { style: 'rec', title: 'A-CAM', clock: true, color: '#e62117', tin: 'none', tout: 'none' },
      { style: 'minimal', title: 'Your name', sub: 'Day in the life', accent: '#ffc400', font: 'serif', all: false, s: 1, e: 6, tin: 'fade', tout: 'fade' }] }
  ];
  /* Layers of a set / saved preset -> fresh frames for an edit (new ids; names filled in where the set says "Your name"). */
  VB.framesFrom = function (layers, who) {
    who = who || {};
    return (layers || []).map(function (l) {
      var f = Object.assign(VB.newFrame(l.style || 'desk', who), JSON.parse(JSON.stringify(l)));
      f.id = VB.uid('f').slice(0, 20);
      if (f.title === 'Your name' && who.name) f.title = who.name;
      return f;
    });
  };
  /* The design of a frame without its timing (what a saved preset keeps). */
  VB.frameDesign = function (f) {
    var d = JSON.parse(JSON.stringify(f)); delete d.id; return d;
  };
  /* Make sure the frame fonts are ready before drawing an export (canvas text doesn't wait for web fonts). */
  VB.loadFrameFonts = function () {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all(['400 20px Anton', '400 20px "Bebas Neue"', '700 20px "Roboto Condensed"', '400 20px "Instrument Serif"', 'italic 400 20px "Instrument Serif"', '700 20px "JetBrains Mono"']
      .map(function (f) { return document.fonts.load(f)['catch'](function () {}); }));
  };
})();
