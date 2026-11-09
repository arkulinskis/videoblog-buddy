/* vb-youtube.js (was web/pages/_f_youtube.html): _f_youtube: settings the admin made (VB.config: the Google OAuth client id + the extension's store page) and the direct YouTube upload. The upload goes straight from this browser to YouTube with the person's own Google sign-in (Google Identity Services token, kept in memory for this tab only): the video never touches our server. VB.getConfig() -> Promise of {google_client_id, extension_store_url} (cached) VB.yt.connect(withCaptions) -> Promise of an access token (opens Google's consent popup the first time) VB.yt.upload(blob, meta, onProgress, signal) resumable upload -> Promise of {id} VB.yt.thumbnail(id, jpegBlob) / VB.yt.captions(id, srtText, lang) VB.lastExport[videoId] the file the editor made in this tab, ready to upload */
(function () {
  'use strict';
  var VB = window.VB;
  var cfgP = null;
  VB.getConfig = function (fresh) {
    if (!cfgP || fresh) cfgP = UI.apiQuiet('public_config').then(function (c) { VB.config = c || {}; return VB.config; }, function () { cfgP = null; return VB.config || {}; });
    return cfgP;
  };
  VB.config = { google_client_id: '', extension_store_url: '' };
  VB.lastExport = {};

  var UPLOAD = 'https://www.googleapis.com/auth/youtube.upload', CAPS = 'https://www.googleapis.com/auth/youtube.force-ssl';
  var gis = null, tok = null;
  function loadGis() {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
    if (gis) return gis;
    gis = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = function () { res(); }; s.onerror = function () { gis = null; rej(new Error('Couldn\'t reach Google sign-in. Check your connection or ad blocker.')); };
      document.head.appendChild(s);
    });
    return gis;
  }
  VB.yt = {
    CATEGORIES: [['28', 'Science & Technology'], ['27', 'Education'], ['22', 'People & Blogs'], ['26', 'Howto & Style'], ['24', 'Entertainment'], ['20', 'Gaming']],
    connected: function (withCaptions) { return !!(tok && tok.exp > Date.now() + 60000 && (!withCaptions || tok.caps)); },
    /* Ask Google for a token (a popup the first time; quick after that). */
    connect: function (withCaptions) {
      if (VB.yt.connected(withCaptions)) return Promise.resolve(tok.value);
      if (VB.yt._fake) return VB.yt._fake.connect(withCaptions).then(function (v) { tok = { value: v, exp: Date.now() + 3e6, caps: !!withCaptions }; return v; });
      var cid = VB.config.google_client_id;
      if (!cid) return Promise.reject(new Error('YouTube upload isn\'t set up yet. An admin adds the Google client ID in Admin → Settings.'));
      return loadGis().then(function () {
        return new Promise(function (res, rej) {
          var scope = UPLOAD + (withCaptions ? ' ' + CAPS : '');
          var client = window.google.accounts.oauth2.initTokenClient({
            client_id: cid, scope: scope, include_granted_scopes: true,
            callback: function (r) {
              if (r.error) { rej(new Error(r.error === 'access_denied' ? 'Google sign-in was cancelled.' : 'Google said: ' + r.error)); return; }
              var caps = window.google.accounts.oauth2.hasGrantedAllScopes(r, CAPS);
              tok = { value: r.access_token, exp: Date.now() + (r.expires_in || 3600) * 1000, caps: caps };
              res(tok.value);
            },
            error_callback: function (e) { rej(new Error(e && e.type === 'popup_closed' ? 'The Google window was closed.' : 'Google sign-in didn\'t open (allow pop-ups for this site).')); }
          });
          client.requestAccessToken({ prompt: '' });
        });
      });
    },
    disconnect: function () {
      if (tok && window.google && window.google.accounts && window.google.accounts.oauth2) { try { window.google.accounts.oauth2.revoke(tok.value, function () {}); } catch (e) { /* gone */ } }
      tok = null;
    },
    /* YouTube refuses < and > in titles and descriptions; titles max 100, description 5000, tags 500 in total. */
    clean: function (meta) {
      function nolt(s) { return String(s || '').replace(/[<>]/g, ''); }
      var tags = [], len = 0;
      String(meta.tags || '').split(',').map(function (t) { return nolt(t).trim(); }).filter(Boolean).forEach(function (t) {
        var add = t.length + (t.indexOf(' ') >= 0 ? 2 : 0) + (tags.length ? 1 : 0); if (len + add <= 500) { tags.push(t); len += add; } });
      var desc = nolt(meta.description).slice(0, 5000);
      if (meta.vertical && !/#shorts/i.test(desc + ' ' + meta.title)) desc = (desc + '\n\n#Shorts').trim().slice(0, 5000);
      var body = { snippet: { title: nolt(meta.title).trim().slice(0, 100) || 'Untitled video', description: desc, tags: tags, categoryId: meta.category || '28' },
        status: { privacyStatus: meta.publishAt ? 'private' : (meta.privacy || 'private'), selfDeclaredMadeForKids: !!meta.kids, embeddable: true } };
      if (meta.publishAt) body.status.publishAt = meta.publishAt;
      if (meta.language) { body.snippet.defaultLanguage = meta.language; body.snippet.defaultAudioLanguage = meta.language; }
      return body;
    },
    /* Resumable upload with progress. -> Promise of the YouTube video resource ({id, ...}) */
    upload: function (blob, meta, onProgress, signal) {
      var body = VB.yt.clean(meta), type = blob.type || 'video/mp4';
      if (VB.yt._fake) return VB.yt._fake.upload(blob, body, onProgress);
      return VB.yt.connect(meta.captions).then(function (token) {
        return fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
          method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(blob.size), 'X-Upload-Content-Type': type },
          body: JSON.stringify(body)
        }).then(function (r) {
          if (!r.ok) return r.json().then(function (j) { throw new Error(ytError(j, r.status)); }, function () { throw new Error('YouTube said no (' + r.status + ').'); });
          var where = r.headers.get('Location');
          if (!where) throw new Error('YouTube didn\'t give an upload address.');
          return new Promise(function (res, rej) {
            var x = new XMLHttpRequest(); x.open('PUT', where); x.setRequestHeader('Content-Type', type);
            x.upload.onprogress = function (e) { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
            x.onload = function () {
              var j = null; try { j = JSON.parse(x.responseText); } catch (e) { /* not json */ }
              if (x.status >= 200 && x.status < 300 && j && j.id) res(j); else rej(new Error(ytError(j, x.status)));
            };
            x.onerror = function () { rej(new Error('The upload stopped (network). Try again.')); };
            x.onabort = function () { rej(Object.assign(new Error('Upload cancelled.'), { cancelled: true })); };
            if (signal) signal.abort = function () { x.abort(); };
            x.send(blob);
          });
        });
      });
    },
    thumbnail: function (id, jpeg) {
      if (VB.yt._fake) return VB.yt._fake.thumbnail(id, jpeg);
      return VB.yt.connect().then(function (token) {
        return fetch('https://www.googleapis.com/upload/youtube/v3/thumbnails/set?uploadType=media&videoId=' + encodeURIComponent(id), {
          method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'image/jpeg' }, body: jpeg });
      }).then(function (r) { if (!r.ok) return r.json().then(function (j) { throw new Error(ytError(j, r.status)); }, function () { throw new Error('The thumbnail wasn\'t accepted (' + r.status + ').'); }); return true; });
    },
    captions: function (id, srt, lang) {
      if (VB.yt._fake) return VB.yt._fake.captions(id, srt, lang);
      return VB.yt.connect(true).then(function (token) {
        var b = 'vbb' + Math.random().toString(36).slice(2), meta = { snippet: { videoId: id, language: lang || 'en', name: 'Captions', isDraft: false } };
        var body = '--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n--' + b + '\r\nContent-Type: application/octet-stream\r\n\r\n' + srt + '\r\n--' + b + '--';
        return fetch('https://www.googleapis.com/upload/youtube/v3/captions?uploadType=multipart&part=snippet', {
          method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'multipart/related; boundary=' + b }, body: body });
      }).then(function (r) { if (!r.ok) return r.json().then(function (j) { throw new Error(ytError(j, r.status)); }, function () { throw new Error('The captions weren\'t accepted (' + r.status + ').'); }); return true; });
    },
    _fake: null   // tests: {connect, upload, thumbnail, captions}
  };
  function ytError(j, status) {
    var e = j && j.error, reason = e && e.errors && e.errors[0] && e.errors[0].reason;
    if (reason === 'quotaExceeded') return 'YouTube\'s daily upload allowance for this app is used up. Try again tomorrow, or upload in YouTube Studio.';
    if (reason === 'uploadLimitExceeded') return 'Your channel has hit YouTube\'s upload limit for today.';
    if (reason === 'youtubeSignupRequired') return 'That Google account has no YouTube channel yet. Create one at youtube.com first.';
    if (reason === 'forbidden' || status === 403) return 'YouTube refused this (' + ((e && e.message) || 'forbidden') + '). For custom thumbnails, verify your phone number at youtube.com/verify.';
    if (status === 401) { tok = null; return 'Your Google sign-in ran out. Press Upload again.'; }
    return 'YouTube said: ' + ((e && e.message) || 'error ' + status);
  }
})();
