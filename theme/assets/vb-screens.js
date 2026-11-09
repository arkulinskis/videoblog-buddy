/* vb-screens.js: the three editor screens that stay JavaScript (they drive the recorder, the canvas player and
   the exporter): record, video (the hub with takes, script, publish kit, thumbnail maker) and edit (the editor).
   Each registers UI.page(name, opts, mount); Components/Screen mounts it with UI.mountScreen (vb-kit.js). */

/* ===== record (was web/pages/record.html): record (#record[/videoId]): the recorder. Screen + camera bubble, screen only, or camera only; mic level; countdown; pause, chapter markers (M), stop; teleprompter; a floating always-on-top control window; takes kept per video. The extension can start it from any tab (VB.ext 'tab-stream') and sends clicks (auto-zoom later). */
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
    var cancelCount = null, quietSince = 0, unsub = null, dead = false, pendingTab = null, lastLight = 0;
    function save() { UI.store.set('rec', { mode: S.mode, camId: S.camId, micId: S.micId, quality: S.quality, systemAudio: S.systemAudio, countdown: S.countdown, prompter: S.prompter, pip: S.pip, speed: S.speed, shape: S.shape, pos: S.pos, grid: S.grid, lookPrev: S.lookPrev }); UI.store.set('rec.cam', { shape: S.shape, pos: S.pos }); }
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
          '<canvas class="rc-lookcv" data-lookcv hidden></canvas><div class="rc-grid" data-gridov hidden><i></i><span class="head">Top of your head</span><span class="eyes">Eyes on this line</span></div>' +
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
        (S.mode !== 'screen' ? studioHtml() : '') +
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
    /* ---- studio check: light meter, framing guide, look preview (the recording itself stays plain) */
    function studioHtml() {
      var def = UI.store.get('vb.look', null);
      var opts = [['', 'No preview']].concat(def ? [['default', 'My default look']] : []).concat(VB.LOOKS.filter(function (l) { return l.key !== 'none'; }).map(function (l) { return [l.key, l.emoji + ' ' + l.name]; }));
      return '<div class="rc-studio"><h3>Studio check</h3>' +
        '<div class="rc-light" data-light><i></i><b data-lightmsg>Allow the camera to check your light</b><span class="bar" title="Light on your face"><b data-lightpos style="left:0" hidden></b></span></div>' +
        '<ul class="rc-tips" data-lighttips></ul>' +
        (S.mode === 'cam' ? '<label class="ui-check"><input type="checkbox" data-gridon' + (S.grid ? ' checked' : '') + '><span>Framing guide (eyes on the top line)</span></label>' : '') +
        '<label class="ui-field"><span>Preview a look on your camera</span><select data-lookprev>' + opts.map(function (o) { return '<option value="' + o[0] + '"' + ((S.lookPrev || '') === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>' +
        '<button class="ui-btn sm" data-lightfix>' + UI.icon('wand') + 'Fix my lighting for new videos</button>' +
        '<p class="ui-hint" style="margin:0">The camera is recorded as it is. Looks are added in the editor (Look tab), so you can still change them.</p></div>';
    }
    function camVideo() {
      var a = q('[data-camfull]'), b = q('[data-bubble]');
      return [a, b].filter(function (v) { return v && v.srcObject && v.readyState >= 2 && v.videoWidth; })[0] || null;
    }
    function previewLook() {
      if (S.lookPrev === 'default') { var d = UI.store.get('vb.look', null); return d ? VB.fullLook(Object.assign({}, d, { on: true })) : null; }
      return S.lookPrev ? VB.fullLook({ on: true, lut: S.lookPrev, amt: 1 }) : null;
    }
    function studioTick(now) {
      var cv = q('[data-lookcv]'), grid = q('[data-gridov]'), v = camVideo(), look = previewLook();
      if (grid) grid.hidden = !(S.grid && S.mode === 'cam' && v);
      if (cv) {
        var show = !!(look && v && S.mode !== 'screen');
        cv.hidden = !show;
        if (show) {
          cv.className = 'rc-lookcv ' + (S.mode === 'cam' ? 'full' : 'rc-bubble ' + S.shape + ' ' + S.pos);
          var out = VB.gradeSource('rec', { img: v, w: v.videoWidth, h: v.videoHeight }, look, now / 1000);
          if (cv.width !== out.w || cv.height !== out.h) { cv.width = out.w; cv.height = out.h; }
          try { cv.getContext('2d').drawImage(out.img, 0, 0, cv.width, cv.height); } catch (e) { /* not ready */ }
        }
      }
      if (!v || now - lastLight < 700) return;
      lastLight = now;
      var lc = VB.lightCheck(v), box = q('[data-light]'); if (!lc || !box) return;
      box.className = 'rc-light ' + lc.level;
      q('[data-lightmsg]').textContent = lc.msg;
      var pos = q('[data-lightpos]'); pos.hidden = false; pos.style.left = Math.round(VB.clamp(lc.face, 0, 1) * 100) + '%';
      var tips = q('[data-lighttips]'), html = lc.tips.slice(0, 2).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
      if (tips.innerHTML !== html) tips.innerHTML = html;
      VB.lastLight = lc;
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
        if (state !== 'review') studioTick(performance.now());
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
      if (t.closest('[data-lightfix]')) {
        var cv0 = camVideo();
        if (!cv0) { UI.toast('Allow the camera first, then try again.'); return; }
        var fix = VB.lookAuto(cv0); if (!fix) return;
        var base = UI.store.get('vb.look', null) || {}, nl = VB.fullLook(Object.assign({}, base, fix, { on: true }));
        if (fix.light) nl.light = Object.assign({}, VB.fullLook(base).light, fix.light);
        UI.store.set('vb.look', nl); S.lookPrev = 'default'; save(); drawPanel(); refreshDevices();
        UI.toast('Saved as your default look: new videos start with it. The preview shows it now.', 'ok');
        return;
      }
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
      if (t.matches('[data-gridon]')) { S.grid = t.checked; save(); return; }
      if (t.matches('[data-lookprev]')) { S.lookPrev = t.value; save(); return; }
      if (t.matches('[data-import]')) importFile(t.files[0]);
    });
    function onKey(e) {
      if (/INPUT|TEXTAREA|SELECT/.test((e.target.tagName || '')) || e.ctrlKey || e.metaKey || e.altKey) return;
      var k = (e.key || '').toLowerCase();
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

/* ===== video (was web/pages/video.html): video (#video/<id>[/takes|script|publish|thumbnail]): one video's home. A player for the current edit, the details (app, format, status pipeline, publish date, YouTube link), and tabs: takes, script writer (templates, hook lab, release notes -> script, prompts for any AI, versions, script check-up, a Short from it), publish kit (titles, description with chapters, tags, captions, checklist, direct YouTube upload), thumbnail maker. */
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

/* ===== edit (was web/pages/edit.html): edit (#edit/<id>): the video editor. Scenes (takes + title cards) in a strip; the selected take's track shows the waveform, trims, cuts, zooms, text, markers and clicks. Drag on the track to select a part, then cut / zoom / add text. Inspector tabs: Scene, Style (size, layout, background, camera bubble, auto-zoom, transitions), Look (colour LUTs, Fix my lighting, light/colour/detail sliders, key light, reframe, saved looks), Frames (newsroom graphics stacked over the video, with in/out transitions, saved sets), Text (+ hide/highlight boxes), Words (captions + the transcript: cut by words, remove "um"s, .srt), Audio (Buddy beats or your music, sound effects, voice presets, remove pauses). Undo/redo, autosave, export to MP4/WebM in the browser, then upload to YouTube. */
(function () {
  var esc = UI.esc, clamp = VB.clamp;
  var CARD_STYLES = [['app', 'App'], ['classic', 'Classic'], ['bold', 'Bold'], ['minimal', 'Minimal'], ['subscribe', 'Subscribe'], ['endscreen', 'End screen']];
  var BOX_KINDS = [['blur', '🔒 Blur (hide)'], ['spot', '🔦 Spotlight'], ['box', '🟥 Red box']];
  var TEXT_STYLES = [['lower', 'Name tag'], ['callout', 'Callout'], ['caption', 'Subtitle'], ['title', 'Big title'], ['arrow', 'Sticky note']];
  var POS = [['tl', '↖'], ['tc', '↑'], ['tr', '↗'], ['c', '•'], ['bl', '↙'], ['bc', '↓'], ['br', '↘']];

  UI.page('edit', { title: 'Editor', auth: 'user' }, function (view, ctx) {
    var id = ctx.args[0], D = null, E = null, plan = null, srcs = {}, player = null, bar = null, sel = 0, tab = 'scene', dead = false;
    var hist = [], fut = [], dirty = false, saving = false, envs = {}, trackSel = null, cutSel = null, zoomSel = -1, music = null, fileMusic = null;
    var asr = null, wsel = null, lastNow = -1, presets = [], frameSel = -1;
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
      }).then(function () {
        return Promise.all([
          E.look.lut === 'cube' ? VB.loadCube(E.look.cube) : null,
          UI.apiQuiet('presets_list').then(function (r) { presets = r.presets || []; }, function () { presets = []; })]);
      }).then(function () {
        draw(); if (dirty) save(); VB.getConfig();
        if (E.frames.length || VB.lookActive(E.look)) VB.loadFrameFonts().then(function () { if (!dead && player && !player.playing) player.seek(player.o); });
      });
    }

    /* ---------------- frame */
    function draw() {
      view.innerHTML = '<div class="ui-wrap ed-wrap"><div class="ed-top"><a class="ui-btn ghost sm" href="#video/' + esc(id) + '">' + UI.icon('back') + 'Video</a>' +
        '<h1>' + esc(D.video.title) + '</h1><span class="ed-save" data-save></span>' +
        '<button class="ui-btn sm" data-undo title="Undo (Ctrl+Z)">' + UI.icon('undo') + '</button><button class="ui-btn sm" data-redo title="Redo (Ctrl+Shift+Z)">' + UI.icon('redo') + '</button>' +
        '<button class="ui-btn primary" data-export>' + UI.icon('download') + 'Export</button></div>' +
        '<div class="ed-main"><div><div class="ed-stage"><div class="cv"><canvas data-cv width="960" height="540"></canvas></div><div data-pbar></div></div></div>' +
        '<div class="ui-card ed-insp"><nav class="ui-tabs">' + [['scene', 'Scene'], ['style', 'Style'], ['look', 'Look'], ['frames', 'Frames'], ['text', 'Text'], ['words', 'Words'], ['audio', 'Audio']].map(function (t) {
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
      box.innerHTML = ({ scene: paneScene, style: paneStyle, look: paneLook, frames: paneFrames, text: paneText, words: paneWords, audio: paneAudio })[tab]();
      if (tab === 'scene') focusThumbs();
      if (tab === 'look') lookThumbs();
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
          '<div style="margin-top:8px"><span class="small">Voice sound (in the export)</span>' + seg('voice_fx', VB.VOICE_FX, E.voice_fx || 'off') +
          '<p class="small muted" style="margin:6px 0 0">' + ({ off: 'Your voice exactly as recorded.', clean: 'Less rumble, a little clearer, more even.', broadcast: 'Radio voice: tight, forward and loud, with a limiter so it never clips.',
            warm: 'Fuller and softer, like a podcast mic.' }[E.voice_fx || 'off'] || '') + '</p></div></div>' +
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

    /* ---------------- look: colour, light, key light, reframe */
    var LOOK_GROUPS = [['Light', ['exposure', 'contrast', 'highlights', 'shadows', 'fade']], ['Colour', ['temp', 'tint', 'sat', 'vib']], ['Detail', ['sharpen', 'smooth', 'grain', 'vignette']]];
    function sliderInfo(k) { return VB.SLIDERS[k] || { 'light.power': ['Brightness', 0, 1, 0.02], 'light.size': ['Size', 0.08, 1, 0.02], 'light.warm': ['Warmth', -1, 1, 0.02],
      'crop.z': ['Zoom in', 1, 2.5, 0.05], 'crop.x': ['Left ↔ right', 0, 1, 0.01], 'crop.y': ['Up ↕ down', 0, 1, 0.01], amt: ['Strength', 0, 1, 0.05] }[k]; }
    function fmtSigned(v, k) {
      v = +v || 0;
      if (k === 'exposure') return (v > 0 ? '+' : '') + v.toFixed(2) + ' EV';
      if (k === 'crop.z') return v.toFixed(2) + '×';
      var p = Math.round(v * 100); return (p > 0 && sliderInfo(k)[1] < 0 ? '+' : '') + p + (k === 'amt' ? '%' : '');
    }
    function isNeutral(k, v) { return k === 'crop.z' ? v <= 1.001 : k === 'crop.x' || k === 'crop.y' ? Math.abs(v - 0.5) < 0.004 : Math.abs(v || 0) < 0.004; }
    function slider(k, v) {
      var info = sliderInfo(k);
      return '<label class="ui-field ed-sl' + (isNeutral(k, v) ? ' zero' : '') + '"><span>' + esc(info[0]) + ' <b>' + fmtSigned(v, k) + '</b></span>' +
        '<input type="range" data-lkf="' + k + '" min="' + info[1] + '" max="' + info[2] + '" step="' + info[3] + '" value="' + (v || 0) + '"></label>';
    }
    /* A camera picture to measure / preview: the selected scene's camera, else any take with a camera. */
    function lookCam() {
      var order = [scene()].concat(E.scenes);
      for (var i = 0; i < order.length; i++) {
        var s = order[i]; if (!s || s.type !== 'take') continue;
        var t = takeById(s.take), src = srcs[s.take]; if (!t || !src || src.missing) continue;
        var img = t.mode === 'cam' ? src.main : src.cam; if (!img) continue;
        if (src.kind === 'sample') { var L = VB.locate(plan, player ? player.o : 0); src.frame(L && L.s.take && L.s.take.id === t.id ? L.srcT : (s['in'] || 0) + 4); }
        if (img.img.tagName === 'VIDEO' && img.img.readyState < 2) continue;
        return img;
      }
      return null;
    }
    var testCard = null;
    function lookSample() {  // what the look thumbnails show: your camera, or a test card with skin tones
      var cam = lookCam(), c = document.createElement('canvas'); c.width = 160; c.height = 90;
      var g = c.getContext('2d');
      if (cam) { var k = Math.max(160 / cam.w, 90 / cam.h); try { g.drawImage(cam.img, (160 - cam.w * k) / 2, (90 - cam.h * k) / 2, cam.w * k, cam.h * k); return c; } catch (e) { /* fall through */ } }
      if (!testCard) {
        testCard = c; var gr = g.createLinearGradient(0, 0, 160, 90); gr.addColorStop(0, '#2b4d7a'); gr.addColorStop(0.5, '#d9a07a'); gr.addColorStop(1, '#3a7d4c'); g.fillStyle = gr; g.fillRect(0, 0, 160, 90);
        g.fillStyle = '#c98a6a'; g.beginPath(); g.ellipse(80, 40, 22, 27, 0, 0, 7); g.fill(); g.fillStyle = '#3b2a20'; g.beginPath(); g.ellipse(80, 20, 24, 12, 0, 0, 7); g.fill();
        g.fillStyle = '#c0392b'; g.fillRect(52, 70, 56, 20); ['#fff', '#ffde00', '#00b3e6', '#111'].forEach(function (col, i) { g.fillStyle = col; g.fillRect(4 + i * 10, 78, 9, 9); });
      }
      return testCard;
    }
    function lookThumbs() {
      var base = lookSample();
      view.querySelectorAll('[data-lkthumb]').forEach(function (cv) {
        var key = cv.getAttribute('data-lkthumb'), L = Object.assign({}, E.look, { on: true, lut: key, amt: key === 'none' ? 0 : 1, crop: { z: 1, x: 0.5, y: 0.5, mirror: false }, light: { on: false } });
        var out = VB.gradeSource('thumbs', { img: base, w: base.width, h: base.height }, L, 0), g = cv.getContext('2d');
        try { g.drawImage(out.img, 0, 0, cv.width, cv.height); } catch (e) { /* not ready */ }
      });
      var pk = q('[data-lkpick]');
      if (pk) {
        var cam = lookCam(), c2 = pk.querySelector('canvas'), g2 = c2.getContext('2d'); g2.fillStyle = '#222'; g2.fillRect(0, 0, c2.width, c2.height);
        if (cam) { var gr2 = VB.gradeSource('thumbs', cam, Object.assign({}, E.look, { on: true }), 0); try { g2.drawImage(gr2.img, 0, 0, c2.width, c2.height); } catch (e) { /* not ready */ } }
        var dot = pk.querySelector('i'); dot.style.left = E.look.light.x * 100 + '%'; dot.style.top = E.look.light.y * 100 + '%';
      }
    }
    function paneLook() {
      var L = E.look, li = L.light, cr = L.crop, mine = presets.filter(function (p) { return p.kind === 'look'; }), def = UI.store.get('vb.look', null);
      var html = '<div class="ui-row between"><label class="ui-check"><input type="checkbox" data-lk="on"' + (L.on ? ' checked' : '') + '><span><b>Use a look on this video</b></span></label>' +
        '<button class="ui-btn sm ed-cmp" data-lkcmp title="Hold to see the picture without the look">' + UI.icon('eye') + 'Hold: before</button></div>' +
        (VB.webglLooks() ? '' : '<p class="ui-hint" style="margin:0">This browser has no WebGL, so looks use a simpler version (no LUTs, key light or skin smoothing).</p>') +
        seg('look.target', [['cam', 'Camera only'], ['all', 'Camera + screen']], L.target) +
        '<div><h4>Fix the light</h4><button class="ui-btn sm primary" data-lkauto' + (lookCam() ? '' : ' disabled title="Needs a take with your camera"') + '>' + UI.icon('wand') + 'Fix my lighting</button>' +
          '<div class="ed-chips" style="margin-top:8px">' + VB.QUICK_FIXES.map(function (f) { return '<button data-lkfix="' + f.key + '">' + f.emoji + ' ' + esc(f.name) + '</button>'; }).join('') +
          '<button data-lkreset>↺ Reset all</button></div></div>' +
        '<div><h4>Colour look (LUT)</h4><div class="ed-looks">' + VB.LOOKS.map(function (l) {
          return '<button data-lklut="' + l.key + '" class="' + (L.lut === l.key ? 'on' : '') + '" title="' + esc(l.blurb) + '"><canvas data-lkthumb="' + l.key + '" width="96" height="54"></canvas>' + esc(l.name) + '</button>'; }).join('') + '</div>' +
          (L.lut !== 'none' ? '<div style="margin-top:8px">' + slider('amt', L.amt) + '</div>' : '') +
          '<div class="ui-row" style="margin-top:8px"><label class="ui-btn sm" style="cursor:pointer">' + UI.icon('upload') + 'Load a .cube LUT<input type="file" accept=".cube,text/plain" data-lkcube hidden></label>' +
          (L.lut === 'cube' ? '<span class="small' + (VB.hasCube(L.cube) ? '' : ' rc-warn') + '">🎨 ' + esc(L.cube) + (VB.hasCube(L.cube) ? '' : ' isn\'t on this computer') + '</span>' : '<span class="small muted">From Resolve, Premiere or your phone app</span>') + '</div></div>';
      LOOK_GROUPS.forEach(function (gp) { html += '<div class="ed-group"><h4 style="margin:0">' + gp[0] + '</h4>' + gp[1].map(function (k) { return slider(k, L[k]); }).join('') + '</div>'; });
      html += '<div class="ed-group"><h4 style="margin:0">Key light</h4><label class="ui-check"><input type="checkbox" data-lk="light.on"' + (li.on ? ' checked' : '') + '><span>Add a soft light on your face</span></label>' +
          (li.on ? '<div class="ed-focus" data-lkpick><canvas width="320" height="180"></canvas><i></i></div><p class="small muted" style="margin:0">Click your face in the picture to aim the light.</p>' +
            slider('light.power', li.power) + slider('light.size', li.size) + slider('light.warm', li.warm) : '') + '</div>' +
        '<div class="ed-group"><h4 style="margin:0">Reframe the camera</h4>' + slider('crop.z', cr.z) +
          (cr.z > 1.001 ? '<div class="ed-2">' + slider('crop.x', cr.x) + slider('crop.y', cr.y) + '</div>' : '') +
          '<label class="ui-check"><input type="checkbox" data-lk="crop.mirror"' + (cr.mirror ? ' checked' : '') + '><span>Mirror (flip left and right)</span></label></div>' +
        '<div class="ed-group"><h4 style="margin:0">Saved looks</h4>' +
          (mine.length ? '<div class="ed-mine">' + mine.map(function (p) { return '<span class="ed-mine-i"><button data-lkmine="' + esc(p.id) + '">' + esc((p.emoji || '🎨') + ' ' + p.name) + '</button><button data-pdel="' + esc(p.id) + '" aria-label="Delete ' + esc(p.name) + '">✕</button></span>'; }).join('') + '</div>' : '<p class="small muted" style="margin:0">Save a look once, then use it on every video.</p>') +
          '<div class="ui-row"><button class="ui-btn sm" data-lksave>' + UI.icon('star2') + 'Save this look</button><button class="ui-btn sm" data-lkdefault>' + UI.icon('pin') + 'Use for new videos</button></div>' +
          (def ? '<p class="small muted" style="margin:0">New videos start with your default look. <button class="vb-link" style="background:none;border:0;padding:0;cursor:pointer;font:inherit" data-lkdefoff>Stop</button></p>' : '') + '</div>';
      return html;
    }
    function lookChange(fn, light) { change(function () { fn(E.look); E.look.on = true; }, light ? { light: true } : undefined); }
    function lookSet(path, v) {
      var parts = path.split('.'), o = E.look;
      for (var i = 0; i < parts.length - 1; i++) o = o[parts[i]];
      o[parts[parts.length - 1]] = v;
    }
    function askName(title, value) {
      return new Promise(function (res) {
        var m = UI.modal('<h2>' + esc(title) + '</h2><label class="ui-field"><span>Name</span><input type="text" data-nm maxlength="60" value="' + esc(value || '') + '"></label>' +
          '<div class="ui-row end" style="margin-top:12px"><button class="ui-btn ghost" data-close>Cancel</button><button class="ui-btn primary" data-nmok>Save</button></div>', { onclose: function () { res(null); } });
        var inp = m.el.querySelector('[data-nm]'); inp.focus(); inp.select();
        function go() { var v = inp.value.trim(); if (v.length < 2) { inp.focus(); return; } res(v); res = function () {}; m.close(); }
        m.el.querySelector('[data-nmok]').onclick = go;
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      });
    }
    function savePreset(kind, name, emoji, data) {
      return UI.api('preset_save', { kind: kind, name: name, emoji: emoji, data: data }).then(function (r) {
        presets = presets.filter(function (p) { return p.id !== r.preset.id; }); presets.unshift(r.preset);
        UI.toast('Saved “' + r.preset.name + '”. Find it under ' + (kind === 'look' ? 'Saved looks' : 'My frames') + ' in any video.', 'ok'); drawPane();
        return r.preset;
      });
    }

    /* ---------------- frames: newsroom graphics over the video */
    function who() { return { name: ctx.me && ctx.me.name, handle: D.handle, product: D.product }; }
    function addFrames(list, open) {
      var room = VB.FRAME_MAX - E.frames.length;
      if (room <= 0) { UI.toast('A video can have ' + VB.FRAME_MAX + ' frames. Delete one first.', 'error'); return false; }
      if (list.length > room) { list = list.slice(0, room); UI.toast('Only the first ' + room + ' fit (' + VB.FRAME_MAX + ' at most).'); }
      change(function () { E.frames = E.frames.concat(list); });
      frameSel = open ? E.frames.length - 1 : -1; tab = 'frames'; drawPane();
      var f0 = list[0]; if (f0 && !player.playing) player.seek(Math.min(plan.outDur, (f0.all ? 0 : f0.s) + (f0.din || 0.6) + 0.4));
      return true;
    }
    function frameField(f, k) {
      var lbl = { tag: 'Tag', title: f.style === 'quote' ? 'Quote' : f.style === 'bug' ? 'Small line under the logo' : f.style === 'rec' ? 'Camera label' : f.style === 'headline' ? 'Headline' : 'Title',
        sub: f.style === 'panel' ? 'Points (one per line)' : f.style === 'quote' ? 'Who said it' : f.style === 'live' ? 'Place' : 'Second line', logo: 'Logo (text or emoji)', ticker: 'Headlines (separate them with |)' }[k];
      if (k === 'clock') return '<label class="ui-check"><input type="checkbox" data-ff="clock"' + (f.clock ? ' checked' : '') + '><span>' + (f.style === 'rec' ? 'Show the timecode' : 'Show the time') + '</span></label>';
      if (k === 'speed') return '<label class="ui-field ed-sl"><span>Scroll speed <b>' + (f.speed || 1).toFixed(1) + '×</b></span><input type="range" data-ff="speed" min="0.3" max="3" step="0.1" value="' + (f.speed || 1) + '"></label>';
      var max = { tag: 24, title: 90, sub: 240, logo: 24, ticker: 500 }[k];
      if ((k === 'sub' && f.style === 'panel') || k === 'ticker') return '<label class="ui-field"><span>' + lbl + '</span><textarea data-ff="' + k + '" maxlength="' + max + '" rows="3">' + esc(f[k]) + '</textarea></label>';
      return '<label class="ui-field"><span>' + lbl + '</span><input type="text" data-ff="' + k + '" maxlength="' + max + '" value="' + esc(f[k]) + '"></label>';
    }
    function frameCard(f, i) {
      var st = VB.frameStyle(f.style), open = i === frameSel, when = f.all ? 'Whole video' : VB.fmtTime(f.s, true) + ' to ' + VB.fmtTime(f.e, true);
      var trans = VB.FRAME_TRANS.map(function (tr) { return '<option value="' + tr[0] + '">' + esc(tr[1]) + '</option>'; }).join('');
      var head = '<div class="ed-fr-h" data-fopen><span class="nm"><b>' + st.emoji + ' ' + esc(f.title || f.tag || f.logo || st.name) + '</b><small>' + esc(st.name) + ' · ' + when + '</small></span>' +
        '<button data-fmove="-1" title="Further back"' + (i === 0 ? ' disabled' : '') + '>▲</button><button data-fmove="1" title="Further forward"' + (i === E.frames.length - 1 ? ' disabled' : '') + '>▼</button>' +
        '<button data-fsave title="Save to My frames">' + UI.icon('star2') + '</button><button data-fdup title="Duplicate">' + UI.icon('copy') + '</button><button data-fdel title="Delete">' + UI.icon('trash') + '</button></div>';
      if (!open) return '<div class="ed-fr" data-fi="' + i + '">' + head + '</div>';
      var poss = st.pos || ['bl'], POSN = { bl: '↙ Bottom left', br: '↘ Bottom right', tl: '↖ Top left', tr: '↗ Top right' };
      return '<div class="ed-fr open" data-fi="' + i + '">' + head + '<div class="ed-fr-b">' +
        st.fields.map(function (k) { return frameField(f, k); }).join('') +
        '<div class="ed-2"><label class="ui-field"><span>Main colour</span><input type="color" data-ff="color" value="' + esc(f.color) + '" style="width:100%;height:36px;padding:2px"></label>' +
          '<label class="ui-field"><span>Accent</span><input type="color" data-ff="accent" value="' + esc(f.accent) + '" style="width:100%;height:36px;padding:2px"></label></div>' +
        '<div class="ed-2"><label class="ui-field"><span>Font</span><select data-ff="font">' + Object.keys(VB.FONTS).map(function (k) { return '<option value="' + k + '"' + (f.font === k ? ' selected' : '') + '>' + VB.FONTS[k][0] + '</option>'; }).join('') + '</select></label>' +
          '<label class="ui-field ed-sl"><span>Size <b>' + Math.round((f.size || 1) * 100) + '%</b></span><input type="range" data-ff="size" min="0.6" max="1.6" step="0.05" value="' + (f.size || 1) + '"></label></div>' +
        (poss.length > 1 ? '<div class="ed-chips">' + poss.map(function (p) { return '<button data-fpos="' + p + '" class="' + (f.pos === p ? 'on' : '') + '">' + POSN[p] + '</button>'; }).join('') + '</div>' : '') +
        '<div class="ed-group"><label class="ui-check"><input type="checkbox" data-ff="all"' + (f.all ? ' checked' : '') + '><span>Show for the whole video</span></label>' +
          (f.all ? '' : '<div class="ed-2"><label class="ui-field"><span>From (s)</span><input type="number" step="0.1" min="0" data-ff="s" value="' + f.s + '"></label><label class="ui-field"><span>To (s)</span><input type="number" step="0.1" min="0" data-ff="e" value="' + f.e + '"></label></div>' +
            '<div class="ui-row"><button class="ui-btn sm" data-fhere="s">Start at playhead</button><button class="ui-btn sm" data-fhere="e">End at playhead</button></div>') +
          '<label class="ui-check"><input type="checkbox" data-ff="cards"' + (f.cards ? ' checked' : '') + '><span>Also over title cards</span></label></div>' +
        '<div class="ed-group"><div class="ed-2"><label class="ui-field"><span>Comes in with</span><select data-ff="tin">' + trans.replace('value="' + f.tin + '"', 'value="' + f.tin + '" selected') + '</select></label>' +
          '<label class="ui-field"><span>Goes out with</span><select data-ff="tout">' + trans.replace('value="' + f.tout + '"', 'value="' + f.tout + '" selected') + '</select></label></div>' +
          '<div class="ed-2"><label class="ui-field ed-sl"><span>In <b>' + (f.din || 0.6).toFixed(1) + ' s</b></span><input type="range" data-ff="din" min="0.1" max="3" step="0.1" value="' + (f.din || 0.6) + '"></label>' +
          '<label class="ui-field ed-sl"><span>Out <b>' + (f.dout || 0.5).toFixed(1) + ' s</b></span><input type="range" data-ff="dout" min="0.1" max="3" step="0.1" value="' + (f.dout || 0.5) + '"></label></div>' +
          '<div class="ui-row"><button class="ui-btn sm" data-fprev>' + UI.icon('play') + 'Play its entrance</button>' + (f.all ? '' : '<button class="ui-btn sm" data-fprevout>' + UI.icon('play') + 'Play its exit</button>') + '</div></div>' +
        '</div></div>';
    }
    function paneFrames() {
      var list = E.frames, mine = presets.filter(function (p) { return p.kind === 'frame'; }), auto = UI.store.get('vb.frames', null);
      return '<div><h4>Add a frame</h4><div class="ed-fstyles">' + VB.FRAME_STYLES.map(function (st) { return '<button data-fadd="' + st.key + '" title="' + esc(st.blurb) + '"><b>' + st.emoji + '</b>' + esc(st.name) + '</button>'; }).join('') + '</div></div>' +
        '<div><h4>Ready-made sets</h4><div class="ed-chips">' + VB.FRAME_SETS.map(function (s) { return '<button data-fset="' + s.key + '" title="' + esc(s.blurb) + '">' + s.emoji + ' ' + esc(s.name) + '</button>'; }).join('') + '</div></div>' +
        '<div><h4>My frames</h4>' + (mine.length ? '<div class="ed-mine">' + mine.map(function (p) {
            var n = (p.data.layers || []).length;
            return '<span class="ed-mine-i"><button data-fmine="' + esc(p.id) + '" title="Add ' + UI.plural(n, 'layer') + '">' + esc((p.emoji || '⭐') + ' ' + p.name) + (n > 1 ? ' ×' + n : '') + '</button><button data-pdel="' + esc(p.id) + '" aria-label="Delete ' + esc(p.name) + '">✕</button></span>'; }).join('') + '</div>'
          : '<p class="small muted" style="margin:0">Press ' + UI.icon('star2') + ' on a frame to keep it here for every video.</p>') + '</div>' +
        '<div class="ed-group"><div class="ui-row between"><h4 style="margin:0">In this video (' + list.length + ')</h4>' +
          (list.length ? '<span><button class="ui-btn sm" data-fsaveall title="Save every frame of this video as one set">' + UI.icon('star2') + 'Save as a set</button></span>' : '') + '</div>' +
          (list.length ? '<p class="small muted" style="margin:0">They all show at once. Lower in the list = on top.</p>' + list.map(frameCard).join('') +
            '<div class="ui-row" style="margin-top:4px"><button class="ui-btn sm" data-fauto>' + UI.icon('pin') + 'Use these on new videos</button></div>'
            : '<p class="ed-empty">No frames yet. Pick a style or a set above.</p>') +
          (auto ? '<p class="small muted" style="margin:0">New videos start with “' + esc(auto.name) + '”. <button class="vb-link" style="background:none;border:0;padding:0;cursor:pointer;font:inherit" data-fautooff>Stop</button></p>' : '') + '</div>';
    }
    function frameAt(el) { var c = el.closest('[data-fi]'); return c ? +c.getAttribute('data-fi') : -1; }

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

    /* ---------------- look + frame clicks (return true when handled) */
    function presetById(id) { return presets.filter(function (p) { return p.id === id; })[0]; }
    function onLookClick(e, t) {
      var b;
      if (t.closest('[data-lkauto]')) {
        var cam = lookCam(); if (!cam) { UI.toast('Add a take with your camera first.'); return true; }
        var fix = VB.lookAuto(cam.img); if (!fix) { UI.toast('Couldn\'t read the camera picture yet. Press play for a second and try again.'); return true; }
        lookChange(function (L) { ['exposure', 'shadows', 'highlights', 'contrast', 'temp', 'tint', 'vib'].forEach(function (k) { L[k] = fix[k]; }); if (fix.light) L.light = Object.assign({}, L.light, fix.light); });
        drawPane();
        var bits = [];
        if (Math.abs(fix.exposure) >= 0.1) bits.push(fix.exposure > 0 ? 'brighter' : 'darker');
        if (fix.shadows >= 0.1) bits.push('lifted shadows');
        if (fix.highlights <= -0.1) bits.push('saved the highlights');
        if (Math.abs(fix.temp) >= 0.1) bits.push(fix.temp > 0 ? 'warmer' : 'cooler');
        if (fix.light) bits.push('a key light on your face');
        UI.toast(bits.length ? 'Fixed: ' + bits.join(', ') + '.' : 'Your light already looks good. Small touch-ups applied.', 'ok');
        return true;
      }
      if ((b = t.closest('[data-lkfix]'))) { var qf = VB.QUICK_FIXES.filter(function (x) { return x.key === b.getAttribute('data-lkfix'); })[0]; lookChange(function (L) { qf.fix(L); }); drawPane(); UI.toast(qf.emoji + ' ' + qf.name + ' applied', 'ok'); return true; }
      if (t.closest('[data-lkreset]')) { change(function () { var keep = { on: E.look.on, target: E.look.target }; E.look = Object.assign(VB.LOOK_NEUTRAL(), keep); }); drawPane(); return true; }
      if ((b = t.closest('[data-lklut]'))) { var key = b.getAttribute('data-lklut'); lookChange(function (L) { L.lut = key; if (key !== 'none' && !(L.amt > 0)) L.amt = 1; }); drawPane(); return true; }
      if ((b = t.closest('[data-lkpick]'))) {
        var r = b.getBoundingClientRect(), lx = clamp((e.clientX - r.left) / r.width, 0, 1), ly = clamp((e.clientY - r.top) / r.height, 0, 1);
        lookChange(function (L) { L.light.x = +lx.toFixed(3); L.light.y = +ly.toFixed(3); }, true); lookThumbs(); return true;
      }
      if ((b = t.closest('[data-lkmine]'))) {
        var p = presetById(b.getAttribute('data-lkmine')); if (!p) return true;
        var nl = VB.fullLook(Object.assign({}, p.data, { on: true }));
        (nl.lut === 'cube' ? VB.loadCube(nl.cube) : Promise.resolve(true)).then(function (has) {
          change(function () { E.look = nl; }); drawPane();
          UI.toast(has ? '🎨 ' + p.name + ' is on' : p.name + ' uses “' + nl.cube + '”, which isn\'t on this computer: load that .cube file again.', has ? 'ok' : 'error');
        });
        UI.apiQuiet('preset_used', p.id); return true;
      }
      if (t.closest('[data-lksave]')) {
        var nm = (VB.lookInfo(E.look.lut) || {}).name; nm = E.look.lut === 'cube' ? E.look.cube : nm && E.look.lut !== 'none' ? nm + ' (mine)' : 'My look';
        askName('Save this look', nm).then(function (n) { if (n) savePreset('look', n, (VB.lookInfo(E.look.lut) || {}).emoji || '🎨', E.look); });
        return true;
      }
      if (t.closest('[data-lkdefault]')) { UI.store.set('vb.look', JSON.parse(JSON.stringify(Object.assign({}, E.look, { on: true })))); UI.toast('New videos will start with this look.', 'ok'); drawPane(); return true; }
      if (t.closest('[data-lkdefoff]')) { UI.store.set('vb.look', null); UI.toast('New videos start without a look.'); drawPane(); return true; }
      if ((b = t.closest('[data-pdel]'))) {
        var pid = b.getAttribute('data-pdel'), pp = presetById(pid); if (!pp) return true;
        UI.confirm({ title: 'Delete “' + pp.name + '”?', text: 'Videos that already use it keep it.', ok: 'Delete', danger: true }).then(function (y) {
          if (y) UI.api('preset_delete', pid).then(function () { presets = presets.filter(function (x) { return x.id !== pid; }); drawPane(); });
        });
        return true;
      }
      return false;
    }
    function onFrameClick(e, t) {
      var b, fi;
      if ((b = t.closest('[data-fadd]'))) { addFrames([VB.newFrame(b.getAttribute('data-fadd'), who())], true); return true; }
      if ((b = t.closest('[data-fset]'))) {
        var set = VB.FRAME_SETS.filter(function (s) { return s.key === b.getAttribute('data-fset'); })[0];
        if (addFrames(VB.framesFrom(set.layers, who()), false)) UI.toast(set.emoji + ' ' + set.name + ': ' + UI.plural(set.layers.length, 'frame') + ' added', 'ok');
        return true;
      }
      if ((b = t.closest('[data-fmine]'))) { var mp = presetById(b.getAttribute('data-fmine')); if (mp && addFrames(VB.framesFrom(mp.data.layers, who()), mp.data.layers.length === 1)) UI.apiQuiet('preset_used', mp.id); return true; }
      if (t.closest('[data-fsaveall]')) {
        askName('Save these frames as a set', (D.video.title + ' frames').slice(0, 60)).then(function (n) { if (n) savePreset('frame', n, '🗂️', { layers: E.frames.map(VB.frameDesign) }); });
        return true;
      }
      if (t.closest('[data-fauto]')) {
        UI.store.set('vb.frames', { name: E.frames.map(function (f) { return VB.frameStyle(f.style).name; }).join(' + ').slice(0, 80), layers: E.frames.map(VB.frameDesign) });
        UI.toast('New videos will start with these frames.', 'ok'); drawPane(); return true;
      }
      if (t.closest('[data-fautooff]')) { UI.store.set('vb.frames', null); UI.toast('New videos start without frames.'); drawPane(); return true; }
      if (!t.closest('[data-fi]')) return false;
      fi = frameAt(t);
      if ((b = t.closest('[data-fmove]'))) {
        var d2 = +b.getAttribute('data-fmove'), to = clamp(fi + d2, 0, E.frames.length - 1);
        change(function () { var x = E.frames.splice(fi, 1)[0]; E.frames.splice(to, 0, x); });
        if (frameSel === fi) frameSel = to; drawPane(); return true;
      }
      if (t.closest('[data-fsave]')) {
        var fs = E.frames[fi], st = VB.frameStyle(fs.style);
        askName('Save this frame', (fs.title || fs.logo || st.name).slice(0, 60)).then(function (n) { if (n) savePreset('frame', n, st.emoji, { layers: [VB.frameDesign(fs)] }); });
        return true;
      }
      if (t.closest('[data-fdup]')) { var cp = JSON.parse(JSON.stringify(E.frames[fi])); cp.id = VB.uid('f').slice(0, 20); addFrames([cp], true); return true; }
      if (t.closest('[data-fdel]')) { change(function () { E.frames.splice(fi, 1); }); frameSel = -1; drawPane(); return true; }
      if ((b = t.closest('[data-fpos]'))) { var pv = b.getAttribute('data-fpos'); change(function () { E.frames[fi].pos = pv; }); drawPane(); return true; }
      if ((b = t.closest('[data-fhere]'))) {
        var which = b.getAttribute('data-fhere'), at = +player.o.toFixed(2);
        change(function () { var f = E.frames[fi]; f.all = false; f[which] = at; if (f.e - f.s < 0.5) { if (which === 's') f.e = +(at + 5).toFixed(2); else f.s = Math.max(0, +(at - 5).toFixed(2)); } });
        drawPane(); return true;
      }
      if (t.closest('[data-fprev]') || t.closest('[data-fprevout]')) {
        var fq = E.frames[fi], isOut = !!t.closest('[data-fprevout]');
        player.seek(Math.max(0, isOut ? fq.e - (fq.dout || 0.5) - 1 : (fq.all ? 0 : fq.s) - 0.3)).then(function () { player.play(); });
        return true;
      }
      if (t.closest('[data-fopen]')) {
        frameSel = frameSel === fi ? -1 : fi; drawPane();
        var ff = E.frames[frameSel];
        if (ff && !ff.all && !player.playing && (player.o < ff.s || player.o > ff.e)) player.seek(Math.min(plan.outDur, ff.s + (ff.din || 0.6) + 0.3));
        return true;
      }
      return false;
    }
    /* Hold "before" to compare without the look. */
    function compare(on) { if (!player) return; player.opt.noLook = on; if (!player.playing) player.draw(); }
    view.addEventListener('pointerdown', function (e) { if (e.target.closest && e.target.closest('[data-lkcmp]')) { e.preventDefault(); compare(true); } });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { view.addEventListener(ev, function (e) { if (player && player.opt.noLook && (ev !== 'pointerleave' || (e.target.closest && e.target.closest('[data-lkcmp]')))) compare(false); }, true); });

    /* ---------------- events */
    view.addEventListener('click', function (e) {
      var t = e.target, b;
      if ((b = t.closest('[data-sc]'))) { selectScene(+b.getAttribute('data-sc'), true); return; }
      if ((b = t.closest('[data-tab]'))) { tab = b.getAttribute('data-tab'); drawPane(); return; }
      if (t.closest('[data-undo]')) { undo(); return; }
      if (t.closest('[data-redo]')) { redo(); return; }
      if (onLookClick(e, t) || onFrameClick(e, t)) return;
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
    function frameVal(t) { return t.type === 'checkbox' ? t.checked : t.type === 'range' || t.type === 'number' ? +t.value : t.value; }
    view.addEventListener('input', function (e) {
      var t = e.target;
      if (t.matches('[data-lkf]')) {
        var lk = t.getAttribute('data-lkf'), lv = +t.value;
        lookChange(function () { lookSet(lk, lv); }, true);
        var fl = t.closest('.ed-sl'); if (fl) { fl.querySelector('b').textContent = fmtSigned(lv, lk); fl.classList.toggle('zero', isNeutral(lk, lv)); }
        var on = q('[data-lk="on"]'); if (on) on.checked = true;
        if (lk.indexOf('light.') === 0) lookThumbs();
        return;
      }
      if (t.matches('[data-ff]') && (t.type === 'text' || t.type === 'color' || t.type === 'range' || t.tagName === 'TEXTAREA')) {
        var fi = frameAt(t), fk = t.getAttribute('data-ff'), fv = frameVal(t);
        change(function () { E.frames[fi][fk] = fv; }, { light: true });
        if (t.type === 'range') { var b2 = t.closest('.ed-sl') && t.closest('.ed-sl').querySelector('b'); if (b2) b2.textContent = fk === 'size' ? Math.round(fv * 100) + '%' : fk === 'speed' ? fv.toFixed(1) + '×' : fv.toFixed(1) + ' s'; }
        if (!player.playing) player.seek(player.o);
        return;
      }
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
      if (t.matches('[data-lkf]')) { lookThumbs(); if (t.getAttribute('data-lkf') === 'crop.z') drawPane(); return; }
      if (t.matches('[data-lk]')) {
        var lp = t.getAttribute('data-lk'), lc = t.checked;
        if (lp === 'on') change(function () { E.look.on = lc; }); else lookChange(function () { lookSet(lp, lc); });
        drawPane(); return;
      }
      if (t.matches('[data-lkcube]')) {
        var cf = t.files[0]; if (!cf) return;
        VB.saveCube(cf).then(function (name) {
          lookChange(function (L) { L.lut = 'cube'; L.cube = name; L.amt = 1; }); drawPane();
          UI.toast('🎨 “' + name + '” is on. It\'s kept in this browser for your next videos too.', 'ok');
        }, function (err) { UI.toast(err.message || 'That file isn\'t a .cube LUT.', 'error'); });
        return;
      }
      if (t.matches('[data-ff]')) {
        var fi = frameAt(t), fk = t.getAttribute('data-ff'), fv = frameVal(t);
        if (t.type === 'text' || t.type === 'color' || t.type === 'range' || t.tagName === 'TEXTAREA') return;  // already applied while typing
        change(function () {
          var f = E.frames[fi];
          if (fk === 's' || fk === 'e') { f[fk] = Math.max(0, +fv || 0); if (f.e - f.s < 0.3) f.e = +(f.s + 0.3).toFixed(2); }
          else f[fk] = fv;
        });
        drawPane(); return;
      }
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
      if ((e.ctrlKey || e.metaKey) && (e.key || '').toLowerCase() === 'z') { if (typing) return; e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key || '').toLowerCase() === 'y') { if (typing) return; e.preventDefault(); redo(); return; }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && wsel && tab === 'words') { e.preventDefault(); var wc = q('[data-wcut]'); if (wc) wc.click(); return; }
      if (e.key === ' ') { e.preventDefault(); player.toggle(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); player.seek(Math.max(0, player.o - (e.shiftKey ? 5 : 1))); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); player.seek(player.o + (e.shiftKey ? 5 : 1)); }
      else if ((e.key || '').toLowerCase() === 's') split();
    }
    document.addEventListener('keydown', onKey);
    function onResize() { drawTrack(); }
    window.addEventListener('resize', onResize);
    VB._editPage = { plan: function () { return plan; }, edit: function () { return E; }, player: function () { return player; }, select: selectScene, save: save,
      tab: function (k) { tab = k; drawPane(); }, takes: function () { return D.takes; }, music: function () { return music; },
      presets: function () { return presets; }, lookCam: lookCam };
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

/* ===== the landing page's hero player (was in web/pages/landing.html): the sample tour drawn live on a canvas, on a
   loop, no sound. VB.heroPlayer(canvas, progressBar, once) returns stop(). Components/HeroPlayer calls it. */
(function () {
  VB.heroPlayer = function (canvas, prog, once) {
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
      if (dead) return;
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
  };
})();
