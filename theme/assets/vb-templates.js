/* vb-templates.js (was web/pages/_d_kit.html): _d_kit: words. Built-in script templates (VB.TEMPLATES; admins add more in Admin -> Templates), filling them from an app's details (VB.fill), video ideas per app (VB.ideasFor), the publish kit (VB.publishKit: titles, description with chapters, tags, hashtags, pinned comment, Shorts/Reels caption) and the upload checklist. */
(function () {
  'use strict';
  var VB = window.VB;

  VB.TEMPLATES = [
    { key: 'tour60', name: '60-second app tour', emoji: '⏱️', kind: 'short', blurb: 'Hook, three features, call to action. Perfect first Short.',
      body: '# Hook\nThis is {app}, and it does one thing really well: {tagline}.\n\n# Feature 1\n[SHOW: {feature1}]\nFirst, {feature1}.\n\n# Feature 2\n[SHOW: {feature2}]\nThen, {feature2}.\n\n# Feature 3\n[SHOW: {feature3}]\nAnd my favourite: {feature3}.\n\n# Call to action\n{cta}. Link in the description. {handle}' },
    { key: 'spotlight', name: 'Feature spotlight', emoji: '🔦', kind: 'reel', blurb: 'One feature, start to finish, in under 30 seconds.',
      body: '# Hook\nStop doing this by hand.\n[SHOW: the old, slow way]\n\n# The feature\nIn {app}, {feature1}.\n[SHOW: one click, the result appears]\n\n# Why it matters\nThat\'s minutes back every day for {audience}.\n\n# Call to action\n{cta}. {url}' },
    { key: 'built', name: 'I built this app', emoji: '🛠️', kind: 'devlog', blurb: 'The story: the problem, the build, the result. Great for your channel.',
      body: '# The problem\nI kept running into the same problem: (pause) so I built {app}.\n\n# What it does\n[SHOW: the home screen]\n{tagline}.\n\n# How I built it\n[SHOW: the code or the editor]\nHere\'s how it works under the hood.\n\n# Demo\n[SHOW: {feature1}]\nLet me show you {feature1}.\n[SHOW: {feature2}]\nAnd {feature2}.\n\n# What\'s next\nNext I\'m adding {feature3}. Tell me what you\'d like to see.\n\n# Call to action\nIf you\'re one of the {audience}, {cta}. Subscribe to follow the build. {handle}' },
    { key: 'problem', name: 'Problem, then solution', emoji: '💡', kind: 'reel', blurb: 'The classic reel hook: show the pain, then the fix.',
      body: '# Pain\n[SHOW: the messy way]\nIf you\'re {audience}, you know this feeling.\n\n# Twist\nThere\'s a better way.\n\n# Solution\n[SHOW: {app}]\n{app}: {tagline}.\n\n# Proof\n[SHOW: {feature1}]\n{feature1}. Done.\n\n# Call to action\n{cta}. {handle}' },
    { key: 'walkthrough', name: 'Full walkthrough', emoji: '🎓', kind: 'tutorial', blurb: 'A step-by-step tutorial with chapters. Long-form YouTube.',
      body: '# Intro\nIn this video I\'ll show you everything {app} can do, step by step.\n\n# Getting started\n[SHOW: sign up and the first screen]\nFirst, create your account. It takes a few seconds.\n\n# {feature1}\n[SHOW: {feature1}]\nLet\'s start with {feature1}.\n\n# {feature2}\n[SHOW: {feature2}]\nNext, {feature2}.\n\n# {feature3}\n[SHOW: {feature3}]\nFinally, {feature3}.\n\n# Tips\nTwo tips before you go. (pause)\n\n# Wrap up\nThat\'s {app}. {cta} at {url}, and subscribe for more tutorials.' },
    { key: 'update', name: 'What\'s new', emoji: '✨', kind: 'youtube', blurb: 'Release notes as a video. Keep your users in the loop.',
      body: '# Hook\nBig update to {app} this week.\n\n# New\n[SHOW: the new feature]\nNew: {feature1}.\n\n# Improved\n[SHOW: the improvement]\nImproved: {feature2}.\n\n# Fixed\nAnd a few fixes you asked for.\n\n# Thanks\nThanks to everyone who sent feedback. {cta}. {handle}' },
    { key: 'tips3', name: '3 quick tips', emoji: '3️⃣', kind: 'short', blurb: 'Three tips for your audience, one of them uses your app.',
      body: '# Hook\nThree tips for {audience}.\n\n# Tip 1\nOne. Keep it simple.\n\n# Tip 2\nTwo. Make it a habit.\n\n# Tip 3\n[SHOW: {app}]\nThree. Let {app} do the remembering: {feature1}.\n\n# Call to action\nFollow for more. {handle}' },
    { key: 'behind', name: 'Behind the code', emoji: '👩‍💻', kind: 'devlog', blurb: 'Show one interesting piece of how the app works.',
      body: '# Hook\nHere\'s a part of {app} nobody sees.\n\n# The challenge\n[SHOW: the feature in the app]\n{feature2} sounds simple. It wasn\'t.\n\n# The code\n[SHOW: the code]\nThe trick was this. (pause)\n\n# Result\n[SHOW: it working]\nAnd now it just works.\n\n# Call to action\nBuilding in public: subscribe to follow along. {handle}' }
  ];

  VB.fill = function (body, p, handle) {
    p = p || {};
    var f = String(p.features || '').split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    var lower = function (s) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; };
    var map = { app: p.name || 'my app', tagline: lower(p.tagline) || 'it makes life easier', audience: p.audience || 'people like you',
      feature1: lower(f[0]) || 'the main feature', feature2: lower(f[1]) || 'the second feature', feature3: lower(f[2]) || 'one more thing',
      cta: p.cta || 'Try it free', url: p.url || 'the link below', handle: handle || '' };
    return String(body || '').replace(/\{(\w+)\}/g, function (m, k) { return map[k] != null ? map[k] : m; }).replace(/[ \t]+$/gm, '');
  };

  /* Video ideas for one app -> [{title, kind, tpl}] */
  VB.ideasFor = function (p) {
    p = p || {};
    var name = p.name || 'your app', f = String(p.features || '').split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    var aud = p.audience || 'beginners', f1 = f[0] || 'the main feature', f2 = f[1] || 'a hidden feature';
    return [
      { title: name + ' in 60 seconds', kind: 'short', tpl: 'tour60' },
      { title: 'How I built ' + name, kind: 'devlog', tpl: 'built' },
      { title: f1 + ' (30-second demo)', kind: 'reel', tpl: 'spotlight' },
      { title: '3 tips for ' + aud, kind: 'short', tpl: 'tips3' },
      { title: name + ': full walkthrough', kind: 'tutorial', tpl: 'walkthrough' },
      { title: 'What\'s new in ' + name, kind: 'youtube', tpl: 'update' },
      { title: 'The problem ' + name + ' solves', kind: 'reel', tpl: 'problem' },
      { title: 'Behind the code: ' + f2, kind: 'devlog', tpl: 'behind' }
    ].map(function (i) { i.title = i.title.charAt(0).toUpperCase() + i.title.slice(1); return i; });
  };

  var STOP = ('a an and are as at be but by for from has have i in is it its of on or so that the this to was we with you your our my ' +
    'never ever every one all any can do does just more most no not only out up very what when how why who again forget get make made like use way time').split(' ');
  function words(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(function (w) { return w.length > 2 && STOP.indexOf(w) < 0; }); }
  function tagify(s) { return '#' + String(s || '').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/).map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(''); }

  /* -> {titles, title, description, tags, hashtags, pinned, caption} */
  VB.publishKit = function (o) {
    var v = o.video || {}, p = o.product || {}, chapters = o.chapters || [], handle = o.handle || '', secs = Math.round(o.outDur || v.duration || 0);
    var name = p.name || '', tag = p.tagline || '', vertical = VB.isVertical(v.kind), feats = String(p.features || '').split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    var titles = [];
    function add(t) { t = String(t || '').trim(); if (t && t.length <= 100 && titles.indexOf(t) < 0) titles.push(t); }
    add(v.title);
    if (name && tag) add(name + ': ' + tag);
    if (name && secs && secs <= 120) add(name + ' in ' + secs + ' seconds');
    if (name && p.audience) add('I built ' + name + ' for ' + p.audience);
    if (name && feats[0]) add(feats[0] + ' with ' + name);
    if (vertical && name) add(name + ' 🤯 #shorts');
    var hashtags = [];
    if (name) hashtags.push(tagify(name));
    hashtags.push(v.kind === 'devlog' ? '#BuildInPublic' : v.kind === 'tutorial' ? '#Tutorial' : '#AppDemo');
    hashtags.push('#IndieDev');
    if (v.kind === 'short') hashtags.unshift('#Shorts');
    if (v.kind === 'reel') hashtags.push('#Reels');
    var desc = [];
    desc.push(tag ? (tag.charAt(0).toUpperCase() + tag.slice(1) + (/[.!?]$/.test(tag) ? '' : '.')) : (v.title || ''));
    desc.push('');
    if (name) desc.push(name + (tag ? ' helps ' + (p.audience || 'you') + ': ' + tag.charAt(0).toLowerCase() + tag.slice(1) : '') + (/[.!?]$/.test(tag) ? '' : '.'));
    if (feats.length) { desc.push(''); desc.push('In this video:'); feats.slice(0, 5).forEach(function (f) { desc.push('• ' + f); }); }
    if (p.url || p.cta) { desc.push(''); desc.push('👉 ' + (p.cta || 'Try it') + (p.url ? ': ' + p.url : '')); }
    if (!vertical && chapters.length >= 3) {
      desc.push(''); desc.push('Chapters:');
      chapters.forEach(function (c) { desc.push(VB.fmtTime(c.t) + ' ' + c.label); });
    }
    desc.push('');
    desc.push((handle ? handle + ' · ' : '') + 'Subscribe for more videos about the apps I\'m building.');
    desc.push('');
    desc.push(hashtags.slice(0, 3).join(' '));
    var tagList = [], seen = {};
    function addTag(t) { t = String(t || '').trim().toLowerCase(); if (t && !seen[t]) { seen[t] = 1; tagList.push(t); } }
    if (name) { addTag(name); addTag(name + ' app'); addTag(name + ' demo'); }
    words(tag).slice(0, 5).forEach(addTag);
    if (p.audience) addTag(p.audience);
    feats.slice(0, 3).forEach(function (f) { addTag(words(f).slice(0, 3).join(' ')); });
    ({ devlog: ['devlog', 'build in public', 'indie hacker'], tutorial: ['tutorial', 'how to', 'step by step'], short: ['shorts', 'app demo'], reel: ['app demo', 'productivity'] }[v.kind] || ['app demo', 'web app'])
      .forEach(addTag);
    addTag('indie dev'); addTag('side project');
    var tags = '';
    tagList.forEach(function (t) { if ((tags + (tags ? ', ' : '') + t).length <= 480) tags += (tags ? ', ' : '') + t; });
    var hook = tag ? tag.charAt(0).toUpperCase() + tag.slice(1) : v.title;
    var caption = hook + (/[.!?]$/.test(hook) ? '' : '.') + (name ? ' ' + (p.emoji || '✨') + ' ' + name : '') + '\n\n' +
      (p.cta ? p.cta + (p.url ? ' → link in bio' : '') + '\n\n' : '') + hashtags.concat(['#BuildInPublic']).filter(function (h, i, a) { return a.indexOf(h) === i; }).slice(0, 6).join(' ');
    return { titles: titles.slice(0, 5), title: titles[0] || '', description: desc.join('\n').replace(/\n{3,}/g, '\n\n').trim(), tags: tags,
      hashtags: hashtags.slice(0, 5).join(' '), pinned: 'What should I build next' + (name ? ' for ' + name : '') + '? Tell me below 👇', caption: caption };
  };

  /* The upload checklist. auto(ctx) -> true/false when it can tell; manual items return null. */
  VB.checklist = function (v) {
    var vertical = VB.isVertical(v.kind);
    var items = [
      { key: 'title', label: 'Title is set and under 100 characters', auto: function (c) { var t = (c.publish && c.publish.title) || ''; return t.length > 0 && t.length <= 100; } },
      { key: 'link', label: 'Description has your link', auto: function (c) { return /https?:\/\//.test((c.publish && c.publish.description) || ''); } },
      { key: 'thumb', label: 'Custom thumbnail made (1280×720)', auto: function (c) { return !!(c.video.thumb_design && c.video.thumb_design.text); } },
      { key: 'exported', label: 'Video exported', auto: function (c) { return c.video.status === 'edited' || c.video.status === 'published'; } }
    ];
    if (!vertical) items.splice(2, 0, { key: 'chapters', label: 'Chapters start at 0:00 (at least 3, 10 s apart)', auto: function (c) { return /(^|\n)0:00 /.test((c.publish && c.publish.description) || ''); } });
    else items.push({ key: 'vertical', label: 'Vertical 9:16 and 3 minutes or less', auto: function (c) { return (c.video.edit && c.video.edit.aspect) === '9:16' && (c.video.duration || 0) <= 180; } });
    return items.concat([
      { key: 'endscreen', label: vertical ? 'Pinned the call to action in a comment' : 'End screen + cards added in YouTube Studio' },
      { key: 'captions', label: 'Checked the auto-captions' },
      { key: 'playlist', label: 'Added to a playlist for this app' },
      { key: 'share', label: 'Shared it where your users are' }
    ]);
  };
})();
