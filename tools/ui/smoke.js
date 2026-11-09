/* Smoke test (tools/ui_test.py --only smoke.js): opens every page address signed out, as a signed-in member and as
   admin, opens the main dialogs once, and fails on an empty page or a page that didn't load. JavaScript and Python
   errors are caught by ui_test.py from the browser log. Resolves to {ok, log}. Keep log lines ASCII. */
(async function () {
  const log = [], bad = [], t0 = Date.now();
  const say = (m) => log.push(((Date.now() - t0) / 1000).toFixed(1) + 's ' + m);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(fn, what, ms) {
    const end = Date.now() + (ms || 20000);
    while (Date.now() < end) { try { const v = fn(); if (v) return v; } catch (e) {} await sleep(150); }
    throw new Error('timed out waiting for: ' + what);
  }
  const q = (s) => document.querySelector(s);
  const qq = (s) => Array.from(document.querySelectorAll(s));
  const byText = (sel, text) => qq(sel).find((e) => e.textContent.trim().replace(/\s+/g, ' ') === text);
  function type(input, value) {
    input.focus(); input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  async function call(fn, ...args) {
    const r = JSON.parse(await window.VB_BRIDGE('call', JSON.stringify({ fn: fn, args: args, quiet: true })));
    if (r.error) throw new Error(fn + ': ' + r.error);
    return r.result;
  }
  async function visit(hash, root) {
    if (location.hash !== hash) window.UI_READY = false;
    location.hash = hash;
    try {
      await until(() => window.UI_READY && location.hash === hash, hash, 45000);
    } catch (e) { bad.push(hash + ' never finished loading'); say('FAIL ' + hash + ' (timeout)'); return; }
    await sleep(900);
    const box = q(root || '.ui-main') || document.body;
    const text = (box.innerText || '').trim();
    if (/didn't load/.test(text)) { bad.push(hash + ': "This page didn\'t load"'); say('FAIL ' + hash + ' (did not load)'); return; }
    if (text.length < 40) { bad.push(hash + ' looks empty (' + text.length + ' chars)'); say('FAIL ' + hash + ' (empty)'); return; }
    say('ok   ' + hash + ' (' + text.length + ' chars)');
  }
  async function closeDialog() {
    const x = q('.anvil-modal .anvil-close, .modal .close, [data-dismiss="modal"]');
    if (x) x.click(); else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await until(() => !q('.anvil-modal.in, .modal.in'), 'dialog closed', 8000).catch(() => {});
    await sleep(400);
  }
  async function signOut() {
    const b = byText('.ui-menu button', 'Sign out');
    b.click();
    await until(() => location.hash === '#landing' && window.UI_READY && q('.lp-hero'), 'signed out', 20000);
    await sleep(500);
  }
  async function authForm(mode) {
    location.hash = mode === 'signup' ? '#auth/signup' : '#auth';
    await until(() => window.UI_READY && qq('.au-card input').filter((i) => i.offsetParent).length >= 2, 'auth form ' + mode);
    await sleep(300);
    return qq('.au-card input[type=text], .au-card input[type=email], .au-card input[type=password]').filter((i) => i.offsetParent);
  }
  async function signUp(name, email, pw) {
    const inputs = await authForm('signup');
    type(inputs[0], name); type(inputs[1], email); type(inputs[2], pw);
    const tick = q('.au-card input[type=checkbox]'); if (tick && !tick.checked) tick.click();
    byText('.anvil-role-btn-block button', 'Create account').click();
  }
  async function signIn(email, pw) {
    const inputs = await authForm('login');
    type(inputs[0], email); type(inputs[1], pw);
    byText('.anvil-role-btn-block button', 'Sign in').click();
  }

  try {
    // ---- signed out
    for (const h of ['#landing', '#auth', '#auth/signup', '#extension']) await visit(h);

    // ---- a member
    await signUp('Smoke Tester', 'smoke' + Date.now() + '@example.com', 'Vb-' + Math.random().toString(36).slice(2) + '-Kq7');
    await until(() => location.hash === '#home' && window.UI_READY && q('.st-card'), 'signed in on the studio with the sample', 45000);
    say('ok   signed up; the studio shows the sample project');
    const d = await call('planner_get');
    const vid = d.videos[0].id, pid = d.products.length ? d.products[0].id : '';
    const enc = encodeURIComponent;
    for (const h of ['#home', '#record', '#record/' + enc(vid), '#video/' + enc(vid), '#video/' + enc(vid) + '/script',
      '#video/' + enc(vid) + '/publish', '#video/' + enc(vid) + '/thumbnail', '#edit/' + enc(vid), '#planner', '#apps',
      pid ? '#apps/' + enc(pid) : '#apps', '#profile', '#extension']) await visit(h);
    await visit('#prompter/' + enc(vid), '.pp-wrap');
    // planner calendar view
    await visit('#planner');
    byText('.ui-seg button', 'Calendar').click();
    await until(() => q('.pl-day'), 'calendar days');
    say('ok   planner calendar (' + qq('.pl-day').length + ' days)');
    byText('.ui-seg button', 'Board').click();
    await until(() => q('.pl-col'), 'board columns');
    // dialogs on the studio
    await visit('#home');
    byText('.anvil-role-btn button', 'New video').click();
    await until(() => q('.nv-dialog'), 'New video dialog');
    say('ok   New video dialog');
    await closeDialog();
    q('.anvil-role-st-more button').click();
    await until(() => q('.vm-dialog'), 'video menu');
    say('ok   video menu (' + qq('.vm-dialog .anvil-role-vm-item button').filter((b) => b.offsetParent).length + ' actions)');
    await closeDialog();
    await signOut();
    say('ok   signed out');

    // ---- the admin (arkulinskis@gmail.com becomes admin on first sign-in)
    const pw = 'Vb-smoke-admin-Kq7-2026';
    await signIn('arkulinskis@gmail.com', pw);
    await sleep(2500);
    if (location.hash !== '#home') {
      await signUp('The Admin', 'arkulinskis@gmail.com', pw);
    }
    await until(() => location.hash === '#home' && window.UI_READY, 'admin signed in', 45000);
    for (const t of ['overview', 'templates', 'settings', 'feedback', 'users', 'demo']) await visit('#admin/' + t);

    log.push(bad.length ? 'PROBLEMS: ' + bad.join(' | ') : 'PASSED');
    return { ok: !bad.length, log: log };
  } catch (e) {
    log.push('ERROR ' + String(e && e.message || e));
    return { ok: false, log: log };
  }
})();
