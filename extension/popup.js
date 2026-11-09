/* VideoBlog Buddy extension popup: connect the app's site, record the current tab in one click, control a recording. */
'use strict';
const $ = (s) => document.querySelector(s);
const send = (m) => new Promise((res) => chrome.runtime.sendMessage(m, (r) => res(chrome.runtime.lastError ? {} : (r || {}))));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let tab = null, st = null, timer = 0;

function fmt(ms) { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

function draw(error) {
  const app = $('#app'), h = st.here;
  let html = '';
  if (error) html += '<div class="err">' + esc(error) + '</div>';
  if (!st.paired.length && !h.isApp) {
    html += '<h2>Connect VideoBlog Buddy</h2><p class="muted">Open your VideoBlog Buddy app in this browser, then click this icon on that tab and press <b>Connect this site</b>.</p>';
  } else if (h.isApp && !h.paired) {
    html += '<h2>This is VideoBlog Buddy</h2><p class="muted">Connect <b>' + esc(h.origin) + '</b> so it can record tabs and receive your clicks while you record. Nothing is sent anywhere else.</p>' +
      '<button class="primary big" id="connect">Connect this site</button>';
  } else if (st.rec) {
    html += '<div class="live' + (st.paused ? ' paused' : '') + '"><i></i><span id="t">' + fmt(Date.now() - st.recStarted) + '</span><span class="muted" style="font-weight:400">' + (st.paused ? 'paused' : 'recording') + '</span></div>' +
      '<div class="row"><button id="pause">' + (st.paused ? '▶ Resume' : '❚❚ Pause') + '</button><button id="marker">⚑ Marker</button><button class="primary" id="stop">■ Stop</button></div>' +
      '<p class="muted">Alt+Shift+R stops, Alt+Shift+P pauses, Alt+Shift+M adds a marker, Alt+Shift+D draws, from any tab.</p>';
  } else if (h.isStudio) {
    html += '<h2>Ready to record</h2><p class="muted">Go to the tab you want to show (your app, a website, a doc), click this icon there and press <b>Record this tab</b>. Or press Record in the studio to pick a window or screen.</p>';
  } else {
    html += '<button class="primary big" id="record"' + (h.capturable ? '' : ' disabled') + '><span class="dot"></span>Record this tab</button>' +
      (h.capturable ? '<p class="muted">Your camera and mic come from the studio' + (st.studioOpen ? '' : ' (it opens in the background)') + '. Allow them once on its Record page first.</p>'
        : '<p class="muted">Browser pages like this one can\'t be recorded. Open a website or your app.</p>');
  }
  if (st.paired.length) {
    html += '<div class="box"><label class="opt"><input type="checkbox" id="rings"' + (st.opts.rings !== false ? ' checked' : '') + '> Red ring where I click</label>' +
      '<label class="opt"><input type="checkbox" id="keys"' + (st.opts.keys !== false ? ' checked' : '') + '> Show shortcut keys (never what I type)</label></div>' +
      '<div class="row"><button id="studio">Open studio</button></div>' +
      '<div class="sites"><span class="muted">Connected:</span>' + st.paired.map((o) => '<div><span>' + esc(o) + '</span><button data-off="' + esc(o) + '">Disconnect</button></div>').join('') + '</div>';
  }
  app.innerHTML = html;
  clearInterval(timer);
  if (st.rec && !st.paused) timer = setInterval(() => { const t = $('#t'); if (t) t.textContent = fmt(Date.now() - st.recStarted); }, 500);
}

async function refresh(error) {
  st = await send({ t: 'popup-state', tabId: tab.id });
  if (!st.here) st = { paired: [], opts: {}, here: {} };
  draw(error);
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('button, a'); if (!b) return;
  if (b.id === 'shortcuts') { e.preventDefault(); chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); return; }
  if (b.id === 'connect') { await send({ t: 'connect', tabId: tab.id }); return refresh(); }
  if (b.dataset.off) { await send({ t: 'disconnect', origin: b.dataset.off }); return refresh(); }
  if (b.id === 'studio') { await send({ t: 'open-studio' }); window.close(); return; }
  if (b.id === 'pause' || b.id === 'marker' || b.id === 'stop') {
    await send({ t: 'command', name: b.id });
    if (b.id === 'stop') { window.close(); return; }
    setTimeout(refresh, 300); return;
  }
  if (b.id === 'record') {
    b.disabled = true; b.textContent = 'Getting the studio ready…';
    const s = await send({ t: 'ensure-studio' });
    if (s.tabId == null) return refresh('Couldn\'t open VideoBlog Buddy. Open it yourself, then try again.');
    try {
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id, consumerTabId: s.tabId });
      const r = await send({ t: 'start-tab', tabId: tab.id, streamId, title: tab.title });
      if (!r.ok) return refresh(r.error || 'The studio didn\'t answer.');
      window.close();
    } catch (err) {
      refresh('Chrome wouldn\'t share this tab: ' + (err && err.message || err));
    }
  }
});
document.addEventListener('change', async (e) => {
  if (e.target.id === 'rings' || e.target.id === 'keys') {
    const opts = {}; opts[e.target.id] = e.target.checked;
    const r = await send({ t: 'opts', opts }); if (r.opts) st.opts = r.opts;
  }
});

(async function () {
  $('#ver').textContent = 'v' + chrome.runtime.getManifest().version;
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  refresh();
})();
