/* vb-words.js (was web/pages/_e_words.html): _e_words: what you said. A take's transcript is take.words = {src, lang, words: [[start, end, word], ...]} in seconds of the take (saved on the server like the script; the sound itself never leaves the browser). VB.transcribe(src, lang, onProgress) on-device speech-to-text (Whisper in a web worker; the model downloads once) VB.alignScript(script, an, a, b) quick captions from your script, spread over the parts where you speak VB.sampleWords(name) the sample takes' words (the demo needs no download) VB.cues(words, opts) words -> caption lines; VB.planCues(plan) -> subtitles on the output timeline VB.toSRT / VB.toVTT caption files for YouTube; VB.fillerCuts / VB.wordCut transcript editing */
(function () {
  'use strict';
  var VB = window.VB, clamp = VB.clamp;

  /* ------------------------------------------------------------------ words helpers */
  /* Spread a sentence over s..e, longer words taking longer. -> [[s, e, w], ...] */
  VB.spread = function (text, s, e) {
    var ws = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (!ws.length) return [];
    var tot = ws.reduce(function (a, w) { return a + w.length + 2; }, 0), t = s, out = [];
    ws.forEach(function (w) { var d = (e - s) * (w.length + 2) / tot; out.push([+t.toFixed(2), +(t + d * 0.92).toFixed(2), w.slice(0, 40)]); t += d; });
    return out;
  };
  VB.wordsOf = function (take) { return take && take.words && take.words.words || []; };
  VB.plainWord = function (w) { return String(w || '').toLowerCase().replace(/[^\p{L}\p{N}']+/gu, ''); };
  VB.FILLERS = ['um', 'umm', 'uh', 'uhh', 'uhm', 'er', 'erm', 'ah', 'ahh', 'hmm', 'mm', 'mhm'];
  VB.isFiller = function (w) { return VB.FILLERS.indexOf(VB.plainWord(w)) >= 0; };

  /* The sample takes' words, matching VB.SAMPLES speech and the sample script. */
  var SAMPLE_TEXT = {
    hello: ['Hi, I\'m Sam.', 'I kept killing my plants, so I built Pocket Garden.'],
    garden: ['Every plant gets its own card, with the next watering on it.', 'Tap a plant to see its schedule. Basil needs water tomorrow.',
      'One tap logs the watering. Done.', 'Um, adding a plant takes, uh, five seconds. Lemon tree, saved.', 'So easy.',
      'And the reminders page tells you what needs water this week.']
  };
  VB.sampleWords = function (name) {
    var S = VB.SAMPLES[name] || VB.SAMPLES.garden, lines = SAMPLE_TEXT[name] || SAMPLE_TEXT.garden, out = [];
    S.speech.forEach(function (seg, i) { if (lines[i]) out = out.concat(VB.spread(lines[i], seg[0] + 0.05, seg[1] - 0.05)); });
    return out;
  };

  /* ------------------------------------------------------------------ on-device transcription (Whisper) */
  /* transformers.js in a module worker. The model (~40-150 MB) downloads once from Hugging Face and the
     browser keeps it; the sound is decoded and transcribed here and never sent anywhere. */
  var WORKER = [
    "import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2';",
    "env.allowLocalModels = false;",
    "const cache = {};",
    "self.onmessage = async (e) => {",
    "  const { id, audio, model, language } = e.data;",
    "  try {",
    "    if (!cache[model]) cache[model] = await pipeline('automatic-speech-recognition', model, { progress_callback: (p) => self.postMessage({ id, type: 'load', p }) });",
    "    const asr = cache[model];",
    "    self.postMessage({ id, type: 'run' });",
    "    const extra = language ? { language, task: 'transcribe' } : {};",
    "    let out, level = 'word';",
    "    try { out = await asr(audio, Object.assign({ return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 }, extra)); }",
    "    catch (err) { level = 'segment'; out = await asr(audio, Object.assign({ return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 }, extra)); }",
    "    self.postMessage({ id, type: 'done', level, chunks: out.chunks || [], text: out.text || '' });",
    "  } catch (err) { self.postMessage({ id, type: 'error', error: String(err && err.message || err) }); }",
    "};"].join('\n');
  var worker = null, jobs = {}, jobSeq = 0;
  function getWorker() {
    if (worker) return worker;
    worker = new Worker(URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' })), { type: 'module' });
    worker.onmessage = function (e) { var j = jobs[e.data.id]; if (j) j(e.data); };
    worker.onerror = function (e) { Object.keys(jobs).forEach(function (k) { jobs[k]({ type: 'error', error: e.message || 'The caption helper couldn\'t start.' }); }); worker = null; };
    return worker;
  }
  VB.MODELS = {
    en: { id: 'onnx-community/whisper-tiny.en', label: 'English, fast (40 MB download)' },
    en_base: { id: 'onnx-community/whisper-base.en', label: 'English, more accurate (150 MB)' },
    multi: { id: 'onnx-community/whisper-tiny', label: 'Any language (40 MB)' }
  };
  function decodeMono(blob, rate) {
    if (blob.size > 1.6e9) return Promise.reject(new Error('This take is too big to read the sound from.'));
    return blob.arrayBuffer().then(function (buf) {
      var ac = new OfflineAudioContext(1, rate, rate);
      return new Promise(function (res, rej) { ac.decodeAudioData(buf, res, rej); });
    }).then(function (ab) {
      if (ab.numberOfChannels === 1) return ab.getChannelData(0);
      var out = new Float32Array(ab.length), n = ab.numberOfChannels;
      for (var ch = 0; ch < n; ch++) { var d = ab.getChannelData(ch); for (var i = 0; i < d.length; i++) out[i] += d[i] / n; }
      return out;
    });
  }
  /* For tests: replace with a function (audio Float32Array 16 kHz, model, language) -> Promise of {level, chunks}. */
  VB._asr = null;
  function runAsr(audio, model, language, prog) {
    if (VB._asr) return VB._asr(audio, model, language);
    return new Promise(function (res, rej) {
      var id = ++jobSeq;
      jobs[id] = function (msg) {
        if (msg.type === 'load') { if (msg.p && msg.p.status === 'progress' && msg.p.total) prog(0.08 + 0.4 * (msg.p.loaded / msg.p.total), 'Downloading the speech model (only the first time)…'); }
        else if (msg.type === 'run') prog(0.52, 'Listening and writing it down…');
        else if (msg.type === 'done') { delete jobs[id]; res(msg); }
        else if (msg.type === 'error') { delete jobs[id]; rej(new Error('Speech-to-text didn\'t work in this browser: ' + msg.error)); }
      };
      try { getWorker().postMessage({ id: id, audio: audio, model: model, language: language }, [audio.buffer]); }
      catch (e) { delete jobs[id]; rej(e); }
    });
  }
  /* src = an opened take (VB.openTake). -> Promise of {src, lang, words} ready for take_update. */
  VB.transcribe = function (src, lang, onProgress) {
    var prog = onProgress || function () {}, t = src.take;
    if (t.sample) { prog(1, 'Done'); return Promise.resolve({ src: 'sample', lang: 'en', words: VB.sampleWords(src.sample) }); }
    if (!src.blob) return Promise.reject(new Error('This take isn\'t on this computer.'));
    if (!(t.main && t.main.audio)) return Promise.reject(new Error('This take has no sound to write down.'));
    var m = VB.MODELS[lang] || VB.MODELS.en;
    prog(0.03, 'Reading the sound…');
    return decodeMono(src.blob, 16000).then(function (audio) {
      return runAsr(audio, m.id, null, prog);  // English-only models refuse a language; the multilingual one detects it
    }).then(function (msg) {
      var words = [];
      (msg.chunks || []).forEach(function (c) {
        var ts = c.timestamp || [], cs = ts[0] || 0, ce = ts[1] == null ? cs + 0.4 : ts[1], txt = String(c.text || '').trim();
        if (!txt) return;
        if (msg.level === 'word' && txt.indexOf(' ') < 0) words.push([+cs.toFixed(2), +Math.max(cs + 0.05, ce).toFixed(2), txt.slice(0, 40)]);
        else words = words.concat(VB.spread(txt, cs, Math.max(cs + 0.3, ce)));
      });
      words.sort(function (a, b) { return a[0] - b[0]; });
      prog(1, 'Done');
      return { src: 'whisper', lang: lang === 'multi' ? 'auto' : 'en', words: words };
    });
  };

  /* ------------------------------------------------------------------ captions from the script (no download) */
  /* The script's spoken lines, spread over the parts of a..b where there's sound. Approximate, instant. */
  VB.alignScript = function (script, an, a, b) {
    var text = VB.parseScript(script).filter(function (l) { return l.k === 'line'; }).map(function (l) { return l.text.replace(/\(pause\)/gi, ' '); }).join(' ');
    var ws = text.split(/\s+/).filter(Boolean);
    if (!ws.length) return [];
    var gaps = an ? VB.silences(an, a, b, { minGap: 0.4, pad: 0.04 }) : [], runs = [], t = a;
    gaps.forEach(function (g) { if (g[0] - t > 0.12) runs.push([t, g[0]]); t = g[1]; });
    if (b - t > 0.12) runs.push([t, b]);
    if (!runs.length) runs = [[a, b]];
    var talk = runs.reduce(function (s, r) { return s + r[1] - r[0]; }, 0);
    var tot = ws.reduce(function (s, w) { return s + w.length + 2; }, 0), pos = 0, out = [];
    function at(p) {  // talking time -> take time
      for (var i = 0; i < runs.length; i++) { var len = runs[i][1] - runs[i][0]; if (p <= len || i === runs.length - 1) return { t: runs[i][0] + Math.min(p, len), run: runs[i] }; p -= len; }
    }
    ws.forEach(function (w) {
      var d = talk * (w.length + 2) / tot, s0 = at(pos + 0.001), e0 = Math.min(s0.t + d * 0.92, s0.run[1]);
      out.push([+s0.t.toFixed(2), +Math.max(s0.t + 0.05, e0).toFixed(2), w.slice(0, 40)]);
      pos += d;
    });
    return out;
  };

  /* ------------------------------------------------------------------ caption lines */
  /* opts: {max: characters per line, maxWords}. -> [{s, e, hold, words, text}] (take seconds) */
  VB.cues = function (words, opts) {
    opts = opts || {};
    var max = opts.max || 42, maxWords = opts.maxWords || 9, out = [], cur = null;
    (words || []).forEach(function (w) {
      var txt = String(w[2]);
      if (cur) {
        var lastW = cur.words[cur.words.length - 1][2];
        if (w[0] - cur.e > 0.7 || cur.text.length + 1 + txt.length > max || cur.words.length >= maxWords || w[1] - cur.s > 3.6 ||
          (/[.!?]$/.test(lastW) && cur.words.length >= 2)) { out.push(cur); cur = null; }
      }
      if (!cur) cur = { s: w[0], e: w[1], words: [], text: '' };
      cur.words.push(w); cur.e = w[1]; cur.text = cur.text ? cur.text + ' ' + txt : txt;
    });
    if (cur) out.push(cur);
    out.forEach(function (c, i) { var n = out[i + 1]; c.hold = Math.min(n ? n.s : c.e + 0.7, c.e + 0.7); });
    return out;
  };
  VB.cueOpts = function (edit) {
    var c = edit.captions || {}, vert = edit.aspect === '9:16';
    if (c.style === 'bold') return { max: vert ? 16 : 20, maxWords: 3 };
    return vert ? { max: 24, maxWords: 6 } : { max: 40, maxWords: 9 };
  };
  /* Words of a plan scene that survive its cuts (VB.plan sets s.words). */
  VB.keptWords = function (s) {
    return VB.wordsOf(s.take).filter(function (w) {
      var mid = (w[0] + w[1]) / 2;
      return s.segs.some(function (g) { return mid >= g.a && mid <= g.b; });
    });
  };
  /* Subtitles on the output timeline: [{s, e, text}] */
  VB.planCues = function (plan) {
    var out = [];
    plan.scenes.forEach(function (s, si) {
      if (s.type !== 'take' || !s.words || !s.words.length) return;
      VB.cues(s.words, { max: 42, maxWords: 10 }).forEach(function (c) {
        var os = VB.outOf(plan, si, c.s), oe = VB.outOf(plan, si, c.hold);
        if (os < 0) return;
        if (oe < os) oe = VB.outOf(plan, si, c.e);
        if (oe < os) oe = os + (c.e - c.s) / s.speed;
        out.push({ s: os, e: Math.min(oe, s.start + s.dur), text: c.text });
      });
    });
    return out;
  };
  function stamp(t, sep) {
    t = Math.max(0, t);
    var h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = Math.floor(t % 60), ms = Math.round((t - Math.floor(t)) * 1000);
    if (ms === 1000) { ms = 999; }
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + sep + String(ms).padStart(3, '0');
  }
  VB.toSRT = function (cues) {
    return cues.map(function (c, i) { return (i + 1) + '\n' + stamp(c.s, ',') + ' --> ' + stamp(c.e, ',') + '\n' + c.text; }).join('\n\n') + '\n';
  };
  VB.toVTT = function (cues) {
    return 'WEBVTT\n\n' + cues.map(function (c) { return stamp(c.s, '.') + ' --> ' + stamp(c.e, '.') + '\n' + c.text; }).join('\n\n') + '\n';
  };
  VB.transcriptText = function (plan) {
    return plan.scenes.filter(function (s) { return s.words && s.words.length; }).map(function (s) { return s.words.map(function (w) { return w[2]; }).join(' '); }).join('\n\n');
  };

  /* ------------------------------------------------------------------ editing by words */
  /* Cuts that remove every filler word ("um", "uh"...) between a and b. */
  VB.fillerCuts = function (words, a, b) {
    var out = [];
    (words || []).forEach(function (w, i) {
      if (!VB.isFiller(w[2]) || w[0] < a || w[1] > b) return;
      var prev = words[i - 1], next = words[i + 1];
      var s = Math.max(prev ? prev[1] : a, w[0] - 0.06), e = Math.min(next ? next[0] : b, w[1] + 0.06);
      if (e - s >= 0.05) out.push([+s.toFixed(2), +e.toFixed(2)]);
    });
    return out;
  };
  /* The cut that removes words i..j, eating into the gaps on both sides but never the neighbours. */
  VB.wordCut = function (words, i, j) {
    var a = words[i], b = words[j], prev = words[i - 1], next = words[j + 1];
    var s = prev ? Math.max(prev[1], a[0] - 0.12) : a[0] - 0.08, e = next ? Math.min(next[0], b[1] + 0.12) : b[1] + 0.12;
    return [+Math.max(0, s).toFixed(2), +e.toFixed(2)];
  };
})();
