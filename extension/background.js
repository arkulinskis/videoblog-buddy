/* VideoBlog Buddy extension: service worker.
   - Pairing: the app page says hello through content.js; the user connects its site once in the popup.
     Only connected sites ("paired origins") can start/stop overlays or receive clicks.
   - While the app records, every tab shows click rings / key badges, and clicks in the recorded tab are
     relayed to the app (position + time only).
   - Tab recording: the popup gets a tabCapture stream id for the current tab and we hand it to the studio tab.
   - Keyboard commands (Alt+Shift+R/P/M/D) are relayed to the studio or the active tab. */
'use strict';
const VERSION = chrome.runtime.getManifest().version;
const DEFAULT_OPTS = { rings: true, keys: true };

const local = {
  get: async () => Object.assign({ paired: [], opts: DEFAULT_OPTS }, await chrome.storage.local.get(['paired', 'opts'])),
  set: (o) => chrome.storage.local.set(o)
};
const session = {
  get: async () => Object.assign({ studioTabId: null, targetTabId: null, rec: false, paused: false, recStarted: 0, appTabs: {} },
    await chrome.storage.session.get(['studioTabId', 'targetTabId', 'rec', 'paused', 'recStarted', 'appTabs'])),
  set: (o) => chrome.storage.session.set(o)
};
function originOf(url) { try { return new URL(url).origin; } catch (e) { return ''; } }
async function isPaired(origin) { return !!origin && (await local.get()).paired.includes(origin); }
async function tabAlive(id) { if (id == null) return null; try { return await chrome.tabs.get(id); } catch (e) { return null; } }
function toApp(tabId, msg) { return chrome.tabs.sendMessage(tabId, { t: 'to-app', msg }).catch(() => {}); }
async function broadcast(msg) {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) chrome.tabs.sendMessage(t.id, msg).catch(() => {});
}
async function setBadge(rec, paused) {
  await chrome.action.setBadgeBackgroundColor({ color: paused ? '#777777' : '#e62117' });
  await chrome.action.setBadgeText({ text: rec ? (paused ? 'II' : 'REC') : '' });
}
const waiters = [];  // popups waiting for a studio tab to say hello

/* The studio tab: the one we last heard from, or any open tab of a connected site, or a new one. */
async function findStudio(open) {
  const s = await session.get(), l = await local.get();
  const t = await tabAlive(s.studioTabId);
  if (t && l.paired.includes(originOf(t.url))) return t.id;
  for (const o of l.paired) {
    const found = await chrome.tabs.query({ url: o + '/*' });
    if (found.length) { await session.set({ studioTabId: found[0].id }); return found[0].id; }
  }
  if (!open || !l.paired.length) return null;
  const nt = await chrome.tabs.create({ url: l.paired[0] + '/#record', active: false });
  return new Promise((res) => {
    const w = { tabId: nt.id, res };
    waiters.push(w);
    setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); res(null); } }, 25000);
  });
}

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  (async () => {
    const tab = sender.tab, origin = sender.origin || (tab && originOf(tab.url)) || '';
    const l = await local.get();
    switch (m.t) {
      /* ---- from pages (content.js) */
      case 'app-hello': {
        const paired = l.paired.includes(origin), s = await session.get();
        s.appTabs[tab.id] = origin;
        const upd = { appTabs: s.appTabs };
        if (paired) {
          upd.studioTabId = tab.id;
          for (const w of waiters.slice()) if (w.tabId === tab.id) { waiters.splice(waiters.indexOf(w), 1); setTimeout(() => w.res(tab.id), 1200); }
        }
        await session.set(upd);
        return reply({ paired, version: VERSION, opts: l.opts });
      }
      case 'app-rec': {
        if (!(await isPaired(origin))) return reply({ ok: false });
        const s = await session.get();
        const upd = { rec: !!m.on, paused: !!m.paused, studioTabId: tab.id };
        if (m.on && !s.rec) upd.recStarted = Date.now();
        if (!m.on) { upd.targetTabId = null; upd.recStarted = 0; }
        await session.set(upd);
        await setBadge(!!m.on, !!m.paused);
        await broadcast({ t: 'rec', on: !!m.on, paused: !!m.paused, opts: l.opts, studio: tab.id });
        return reply({ ok: true });
      }
      case 'app-countdown': {
        if (!(await isPaired(origin))) return reply({ ok: false });
        const s = await session.get();
        let target = await tabAlive(s.targetTabId);
        if (!target) { const [a] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); if (a && a.id !== tab.id) target = a; }
        if (target) chrome.tabs.sendMessage(target.id, { t: 'countdown', n: m.n | 0 }).catch(() => {});
        return reply({ ok: true });
      }
      case 'app-test': {
        if (!(await isPaired(origin))) return reply({ ok: false });
        toApp(tab.id, { type: 'test-ok', version: VERSION });
        return reply({ ok: true });
      }
      case 'get-rec': {
        const s = await session.get();
        return reply({ on: s.rec, paused: s.paused, opts: l.opts, studio: s.studioTabId });
      }
      case 'click': {
        const s = await session.get();
        if (!s.rec || s.paused || !tab || tab.id === s.studioTabId) return reply({});
        if (s.targetTabId != null ? tab.id !== s.targetTabId : !tab.active) return reply({});
        if (s.studioTabId != null) toApp(s.studioTabId, { type: 'click', ts: +m.ts || Date.now(), x: +m.x, y: +m.y });
        return reply({});
      }
      /* ---- from the popup */
      case 'popup-state': {
        const s = await session.get(), t = await tabAlive(m.tabId);
        const o = t ? originOf(t.url) : '';
        const studio = await findStudio(false);
        return reply({ version: VERSION, paired: l.paired, opts: l.opts, rec: s.rec, paused: s.paused, recStarted: s.recStarted,
          here: { origin: o, isApp: !!s.appTabs[m.tabId], paired: l.paired.includes(o), isStudio: studio != null && studio === m.tabId,
            capturable: !!t && /^(https?|file):/.test(t.url || '') }, studioOpen: studio != null });
      }
      case 'connect': {
        const t = await tabAlive(m.tabId), o = t && originOf(t.url);
        if (!o || !/^https?:/.test(o)) return reply({ ok: false });
        if (!l.paired.includes(o)) l.paired.push(o);
        await local.set({ paired: l.paired });
        await session.set({ studioTabId: t.id });
        toApp(t.id, { type: 'paired', paired: true, version: VERSION, opts: l.opts });
        return reply({ ok: true });
      }
      case 'disconnect': {
        await local.set({ paired: l.paired.filter((x) => x !== m.origin) });
        return reply({ ok: true });
      }
      case 'opts': {
        const opts = Object.assign({}, l.opts, m.opts || {});
        await local.set({ opts });
        const s = await session.get();
        if (s.rec) await broadcast({ t: 'rec', on: true, paused: s.paused, opts, studio: s.studioTabId });
        return reply({ ok: true, opts });
      }
      case 'ensure-studio': return reply({ tabId: await findStudio(true) });
      case 'start-tab': {
        const studio = await findStudio(false);
        if (studio == null) return reply({ ok: false, error: 'Open VideoBlog Buddy first.' });
        await session.set({ targetTabId: m.tabId });
        toApp(studio, { type: 'tab-stream', streamId: m.streamId, title: m.title || '', tabId: m.tabId });
        return reply({ ok: true });
      }
      case 'command': {
        const s = await session.get();
        if (s.studioTabId != null) toApp(s.studioTabId, { type: 'command', name: m.name });
        return reply({ ok: true });
      }
      case 'open-studio': {
        const id = await findStudio(false);
        if (id != null) { const t = await chrome.tabs.update(id, { active: true }); await chrome.windows.update(t.windowId, { focused: true }); }
        else if (l.paired.length) await chrome.tabs.create({ url: l.paired[0] + '/#home' });
        return reply({ ok: true });
      }
    }
    reply({});
  })();
  return true;  // answer asynchronously
});

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd === 'draw') {
    const [a] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (a) chrome.tabs.sendMessage(a.id, { t: 'draw-toggle' }).catch(() => {});
    return;
  }
  const name = { 'stop-recording': 'stop', 'pause-recording': 'pause', 'add-marker': 'marker' }[cmd];
  const s = await session.get();
  if (name && s.studioTabId != null) toApp(s.studioTabId, { type: 'command', name });
});

chrome.tabs.onRemoved.addListener(async (id) => {
  const s = await session.get();
  if (s.appTabs[id]) { delete s.appTabs[id]; await session.set({ appTabs: s.appTabs }); }
  if (id === s.studioTabId && s.rec) { await session.set({ rec: false, paused: false, targetTabId: null }); await setBadge(false, false); await broadcast({ t: 'rec', on: false }); }
});
