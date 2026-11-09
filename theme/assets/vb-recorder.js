/* vb-recorder.js (was web/pages/_c_recorder.html): _c_recorder: recording in the browser. VB.Recorder(opts) screen (or a tab from the extension) + camera + mic. The screen (with the mixed sound) and the camera are recorded as two files, so the camera bubble can be moved, resized or hidden later. Every second is saved to IndexedDB (VB.vault.chunk): a crash or closed tab loses at most a second. VB.pip the floating "picture-in-picture" control window (Chrome/Edge 116+): timer, pause, marker, stop, camera preview and teleprompter, always on top while you record another tab. VB.Prompter(el) the teleprompter (record page, floating window, #prompter page). */
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
