/* vb-write.js (was web/pages/_g_write.html): _g_write: help with the words. VB.hooks(product, handle) first lines that make people stay (filled from the app's details) VB.doctor(script, kind) a check-up of a script: score + what to fix VB.aiPrompt(task, ctx) a ready prompt to paste into any AI chat (no AI runs here, nothing is sent) VB.fromNotes(notes, product) release notes / commit messages -> a "What's new" script VB.shortVersion(script) the same script cut down to about a minute */
(function () {
  'use strict';
  var VB = window.VB;
  function lower(s) { s = String(s || '').trim(); return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
  function upper(s) { s = String(s || '').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function feats(p) { return String(p && p.features || '').split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean); }

  /* ------------------------------------------------------------------ hooks */
  VB.hooks = function (p) {
    p = p || {};
    var app = p.name || 'my app', tag = lower(p.tagline) || 'get it done faster', aud = p.audience || 'people like you', f = feats(p);
    var f1 = lower(f[0]) || 'the main feature', f2 = lower(f[1]) || 'a hidden feature';
    return [
      ['Pain', 'Stop doing this by hand. ' + app + ' does it for you.'],
      ['Story', 'I got tired of doing it the slow way, so I built ' + app + '.'],
      ['Audience', 'If you\'re one of the ' + aud + ', you need to see this.'],
      ['Speed', 'This used to take me ten minutes. Now it takes ten seconds.'],
      ['Demo', 'Watch me ' + f1.replace(/^(you can |it |lets you )/i, '') + ' in under 30 seconds.'],
      ['Promise', 'Here\'s the easiest way to ' + tag.replace(/^(it |to )/i, '') + '.'],
      ['Secret', 'Nobody talks about this part of ' + app + ': ' + f2 + '.'],
      ['List', '3 things ' + app + ' does that ' + aud + ' will love.'],
      ['Question', 'What if you never had to think about it again?'],
      ['Proof', 'One click. That\'s it. Here\'s ' + app + '.'],
      ['POV', 'POV: you\'re one of the ' + aud + ' and you just found ' + app + '.'],
      ['Build', 'I built ' + app + ' on my own. Here\'s what it does, and how.']
    ].map(function (h) { return { kind: h[0], text: h[1] }; });
  };

  /* ------------------------------------------------------------------ script doctor */
  var TARGETS = { short: [15, 60, 180], reel: [15, 45, 90], square: [15, 60, 120], youtube: [90, 480, 1200], tutorial: [180, 720, 2400], devlog: [180, 600, 1800] };
  var WEAK = ['basically', 'actually', 'literally', 'really', 'very', 'just', 'kind of', 'sort of', 'you know', 'i mean', 'super', 'pretty much'];
  VB.doctor = function (text, kind) {
    var lines = VB.parseScript(text), spoken = lines.filter(function (l) { return l.k === 'line'; }).map(function (l) { return l.text.replace(/\(pause\)/gi, ' ').trim(); });
    var st = VB.scriptStats(text), all = spoken.join(' '), items = [], tg = TARGETS[kind] || TARGETS.youtube;
    function add(state, title, tip) { items.push({ state: state, title: title, tip: tip || '' }); }
    if (!spoken.length) return { score: 0, items: [{ state: 'bad', title: 'Nothing to say yet', tip: 'Write a line, pick a template, or try the Hook lab.' }], stats: st };
    var first = spoken[0], fw = first.split(/\s+/).length;
    if (/^(hi|hey|hello)\b|in this video|today i('|’)?m going|welcome (back )?to/i.test(first)) add('warn', 'The first line warms up instead of hooking', 'Skip "Hi" and "In this video". Open with the payoff or the problem, then say hello.');
    else if (fw > 20) add('warn', 'Your hook is ' + fw + ' words long', 'Get to the point in under 20 words: viewers decide in the first 3 seconds.');
    else add('ok', 'Strong, short first line', '“' + first.slice(0, 70) + (first.length > 70 ? '…' : '') + '”');
    var sec = st.seconds;
    if (sec < tg[0]) add('warn', 'Very short: about ' + VB.fmtTime(sec), 'That\'s fine for a teaser; add a demo beat or a reason to care.');
    else if (sec > tg[2]) add('bad', 'Too long for a ' + VB.kind(kind).label + ': about ' + VB.fmtTime(sec), (kind === 'short' ? 'Shorts can be at most 3 minutes. ' : '') + 'Aim for about ' + VB.fmtTime(tg[1]) + '. Try "Trim to a Short" or cut a section.');
    else if (sec > tg[1] * 1.25) add('warn', 'A bit long: about ' + VB.fmtTime(sec), 'The sweet spot for this format is about ' + VB.fmtTime(tg[1]) + '.');
    else add('ok', 'Good length: about ' + VB.fmtTime(sec), 'Spoken at a relaxed 150 words a minute.');
    var cta = /\b(try|link|subscribe|follow|sign up|download|comment|check (it )?out|visit|join|get it|free)\b/i;
    if (cta.test(spoken.slice(-3).join(' '))) add('ok', 'Ends with a call to action', 'People know what to do next.');
    else if (cta.test(all)) add('warn', 'The call to action isn\'t at the end', 'Put "try it / link below / subscribe" in the last lines too.');
    else add('bad', 'No call to action', 'Tell viewers what to do: try the app, click the link, subscribe.');
    var sentences = all.split(/(?<=[.!?])\s+/).filter(function (s) { return s.split(/\s+/).length > 25; });
    if (sentences.length) add('warn', UI.plural(sentences.length, 'long sentence'), 'Split it: “' + sentences[0].split(/\s+/).slice(0, 12).join(' ') + '…”');
    else add('ok', 'Easy to say out loud', 'No sentence is longer than 25 words.');
    var low = ' ' + all.toLowerCase().replace(/[^a-z' ]+/g, ' ') + ' ', weak = [];
    WEAK.forEach(function (w) { var n = low.split(' ' + w + ' ').length - 1; if (n) weak.push(w + (n > 1 ? ' ×' + n : '')); });
    var weakN = weak.reduce(function (a, w) { var m = w.match(/×(\d+)/); return a + (m ? +m[1] : 1); }, 0);
    if (weakN > Math.max(2, st.words / 60)) add('warn', 'Filler words: ' + weak.slice(0, 5).join(', '), 'Cut most of them: the script gets shorter and sounds more sure.');
    else add('ok', 'Few filler words', weak.length ? 'Only ' + weak.join(', ') + '.' : 'Crisp.');
    var you = (low.match(/ (you|your|you're|yours) /g) || []).length, me = (low.match(/ (i|me|my|i'm|i've|mine) /g) || []).length;
    if (you >= me * 0.6 || st.words < 40) add('ok', 'Talks to the viewer', 'You: ' + you + ' · I: ' + me);
    else add('warn', 'More about you than the viewer', 'Turn some "I built…" into "you can…" (you: ' + you + ', I: ' + me + ').');
    var shows = lines.filter(function (l) { return l.k === 'show'; }).length, heads = lines.filter(function (l) { return l.k === 'h'; }).length;
    if (!shows && spoken.length > 3) add('warn', 'No [SHOW: …] notes', 'Add what\'s on screen for each part, so recording is easy.');
    if (!VB.isVertical(kind) && kind !== 'square') {
      if (heads >= 3) add('ok', UI.plural(heads, 'section') + ': chapters ready', 'Each # heading can become a YouTube chapter.');
      else add('warn', 'Only ' + UI.plural(heads, 'section'), 'Long videos with 3+ chapters keep viewers longer. Add # headings.');
    }
    var pts = items.reduce(function (a, it) { return a + (it.state === 'ok' ? 1 : it.state === 'warn' ? 0.5 : 0); }, 0);
    return { score: Math.round(pts / items.length * 100), items: items, stats: st };
  };

  /* ------------------------------------------------------------------ prompts for any AI chat */
  VB.AI_TASKS = [
    ['script', 'Write the whole script', '📝'], ['hook', '10 better hooks', '🪝'], ['tighten', 'Tighten my script', '✂️'],
    ['short', 'Turn it into a Short', '📱'], ['titles', 'Titles + thumbnail words', '🏷️'], ['ideas', '10 video ideas', '💡']
  ];
  VB.aiPrompt = function (task, c) {
    c = c || {};
    var p = c.product || {}, v = c.video || {}, k = VB.kind(v.kind), script = String(c.script || '').trim(), f = feats(p);
    var about = p.name ? ['The app: ' + p.name + (p.tagline ? ' — ' + p.tagline : ''), p.audience ? 'Made for: ' + p.audience : '', f.length ? 'Features:\n' + f.map(function (x) { return '- ' + x; }).join('\n') : '',
      p.url ? 'Link: ' + p.url : '', p.cta ? 'Call to action: ' + p.cta : ''].filter(Boolean).join('\n') : 'The app: (describe it here)';
    var fmt = 'Format the script like this: a line starting with "# " for each section, a line "[SHOW: what is on screen]" before each part of the screen recording, short spoken lines, and "(pause)" for a beat. Write in plain, friendly spoken English, talking to "you". Reply with only the script.';
    var target = { short: '45 seconds (about 110 words), vertical', reel: '30 seconds (about 75 words), vertical', square: '45 seconds', youtube: '4 minutes (about 600 words)', tutorial: '8 minutes with clear steps', devlog: '6 minutes, personal and honest' }[v.kind] || '3 minutes';
    var out;
    if (task === 'hook') out = 'I make videos about the apps I build. Give me 10 opening lines (hooks) for a ' + k.label + ' about my app. Each under 15 words, no "Hi" or "In this video". Mix styles: a pain, a surprising fact, a quick result, a question, a story.\n\n' + about + (script ? '\n\nMy current first lines:\n' + script.split('\n').slice(0, 6).join('\n') : '');
    else if (task === 'tighten') out = 'Tighten this video script for a ' + k.label + ' to about ' + target + '. Keep my voice, keep the sections, cut filler words and repetition, make every sentence easy to say out loud, and end with a clear call to action. ' + fmt + '\n\n' + about + '\n\nScript:\n' + (script || '(paste the script)');
    else if (task === 'short') out = 'Turn this script into a 45-second vertical Short (YouTube Shorts / Instagram Reels). Hook in the first 2 seconds, one idea, fast pace, a call to action at the end. ' + fmt + '\n\n' + about + '\n\nScript:\n' + (script || '(paste the script)');
    else if (task === 'titles') out = 'Give me 10 YouTube titles for this video (under 60 characters, honest, curiosity without clickbait) and, for each, 2-4 big words for the thumbnail.\n\nVideo: ' + (v.title || '') + ' (' + k.label + ')\n' + about + (script ? '\n\nScript:\n' + script : '');
    else if (task === 'ideas') out = 'I build apps and make YouTube videos and Shorts about them. Give me 10 video ideas for this app: a title, the format (Short, tutorial, devlog...), and the hook line for each. Make them useful for the audience, not just ads.\n\n' + about;
    else out = 'Write a script for a ' + k.label + ' about my app, about ' + target + ' long. Start with a strong hook (no "Hi, in this video"), show the app in action, and end with a call to action. ' + fmt + '\n\nVideo title: ' + (v.title || '(untitled)') + '\n' + about + (c.handle ? '\nMy channel: ' + c.handle : '') + (script ? '\n\nWhat I have so far:\n' + script : '');
    return out;
  };

  /* ------------------------------------------------------------------ release notes -> "What's new" script */
  VB.parseNotes = function (text) {
    var out = { added: [], improved: [], fixed: [] };
    String(text || '').split(/\n/).forEach(function (raw) {
      var l = raw.trim();
      if (!l || /^#{1,6}\s/.test(l)) return;  // headings like "## v1.4"
      l = l.replace(/^[-*•+]\s*/, '').replace(/^[0-9a-f]{7,40}\s+/i, '').replace(/^\d+[.)]\s+/, '').replace(/\s*\(#\d+\)\s*$/, '').replace(/\s*#\d+\s*$/, '');
      var m = l.match(/^(\w+)(\([^)]*\))?!?:\s*(.+)$/), kind = null;
      if (m) { var k = m[1].toLowerCase(); l = m[3]; kind = /^(fix|bug|hotfix)/.test(k) ? 'fixed' : /^(perf|refactor|improve|style|polish|tweak)/.test(k) ? 'improved' : /^(feat|add|new)/.test(k) ? 'added' : /^(chore|docs?|test|ci|build|bump|merge|wip|release|revert)/.test(k) ? 'skip' : null; }
      if (/^(merge (branch|pull)|bump version|update readme|wip\b)/i.test(l) || kind === 'skip') return;
      if (/^#{1,6}\s/.test(l)) return;
      if (!kind) kind = /\b(fix(ed|es)?|bug|crash|error|broken|typo)\b/i.test(l) ? 'fixed' : /\b(improv|faster|better|speed|polish|clean|tweak|updat|smoother|redesign)/i.test(l) ? 'improved' : 'added';
      l = upper(l.replace(/\.$/, '')).slice(0, 140);
      if (l.length > 2) out[kind].push(l);
    });
    return out;
  };
  VB.fromNotes = function (text, p, handle) {
    var n = VB.parseNotes(text), app = (p && p.name) || 'the app', total = n.added.length + n.improved.length + n.fixed.length;
    if (!total) return '';
    var s = ['# Hook', app + ' just got ' + (total === 1 ? 'an upgrade' : total + ' upgrades') + '. Here\'s what\'s new.', ''];
    n.added.slice(0, 5).forEach(function (a, i) { s.push('# New: ' + a.slice(0, 60)); s.push('[SHOW: ' + a + ']'); s.push((i ? 'Also new: ' : 'First, ') + lower(a) + '.'); s.push(''); });
    if (n.added.length > 5) { s.push('# More new things'); s.push('Plus ' + (n.added.length - 5) + ' more: ' + n.added.slice(5, 8).map(lower).join(', ') + '.'); s.push(''); }
    if (n.improved.length) { s.push('# Improved'); s.push('[SHOW: ' + n.improved[0] + ']'); n.improved.slice(0, 4).forEach(function (a) { s.push(upper(a) + '.'); }); s.push(''); }
    if (n.fixed.length) { s.push('# Fixed'); s.push(n.fixed.length === 1 ? 'And one fix: ' + lower(n.fixed[0]) + '.' : 'And ' + n.fixed.length + ' fixes, including ' + lower(n.fixed[0]) + '.'); s.push(''); }
    s.push('# Thanks'); s.push('Thanks for all the feedback. ' + ((p && p.cta) || 'Try it') + ((p && p.url) ? ': ' + p.url : '') + '. ' + (handle ? 'Subscribe ' + handle + ' for the next update.' : 'Subscribe for the next update.'));
    return s.join('\n');
  };

  /* ------------------------------------------------------------------ a ~1 minute version */
  VB.shortVersion = function (text) {
    var secs = [], cur = null;
    VB.parseScript(text).forEach(function (l) { if (l.k === 'h' || !cur) { cur = { h: l.k === 'h' ? l.text : '', show: [], lines: [] }; secs.push(cur); if (l.k === 'h') return; } if (l.k === 'show') cur.show.push(l.text); else cur.lines.push(l.text); });
    if (!secs.length) return '';
    function wc(s) { return s.split(/\s+/).filter(Boolean).length; }
    var first = secs[0], last = secs.length > 1 ? secs[secs.length - 1] : null, mid = secs.slice(1, last ? -1 : undefined);
    var keep = [{ h: first.h || 'Hook', show: first.show.slice(0, 1), lines: first.lines.slice(0, 2) }];
    mid.forEach(function (s) { if (s.lines.length || s.show.length) keep.push({ h: s.h, show: s.show.slice(0, 1), lines: s.lines.slice(0, 1).map(function (l) { return l.split(/(?<=[.!?])\s+/)[0]; }) }); });
    if (last) keep.push({ h: last.h, show: last.show.slice(0, 1), lines: last.lines.slice(0, 2) });
    var total = function () { return keep.reduce(function (a, s) { return a + s.lines.reduce(function (b, l) { return b + wc(l); }, 0); }, 0); };
    while (total() > 140 && keep.length > 3) keep.splice(keep.length - 2, 1);
    return keep.map(function (s) { return ['# ' + (s.h || 'Part')].concat(s.show.map(function (x) { return '[SHOW: ' + x + ']'; }), s.lines).join('\n'); }).join('\n\n');
  };
})();
