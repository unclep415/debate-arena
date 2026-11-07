// Hosted-site adapter: injected by the Worker before app.js; never referenced by index.html.
// Defines globalThis.DebateHost.sample(): a Promise of the same `sample` shape claude.use("sample") gives.
(function () {
  'use strict';

  function fail(code, message, text) {
    var e = { code: code, message: message };
    if (typeof text === 'string') e.text = text;
    return e;
  }

  // ---------- passcode screen ----------
  var screen = null, authPromise = null;
  var STYLE = [
    '#passcodeScreen{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--bg);color:var(--fg);font-family:var(--font-body,system-ui,sans-serif);overflow:auto}',
    '#passcodeScreen form{width:100%;max-width:360px;background:var(--surface);border:2px solid var(--line);border-radius:14px;padding:20px;display:flex;flex-direction:column;gap:12px}',
    '#passcodeScreen h2{margin:0;font-family:var(--font-display,inherit);font-size:1.3rem}',
    '#passcodeScreen label{font-weight:600}',
    '#passcodeScreen input{width:100%;min-width:0;font:inherit;padding:10px 12px;border:2px solid var(--line);border-radius:10px;background:var(--bg);color:var(--fg)}',
    '#passcodeScreen button{font:inherit;font-weight:700;padding:10px 14px;border:0;border-radius:10px;background:var(--for);color:var(--on-accent);cursor:pointer}',
    '#passcodeScreen button:disabled{opacity:.6;cursor:default}',
    '#passcodeScreen .pc-error{margin:0;min-height:1.2em;color:var(--danger)}'
  ].join('\n');

  function post(passcode) {
    return fetch('/api/session', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      credentials: 'same-origin', body: JSON.stringify({ passcode: passcode })
    });
  }

  // Shows the screen (once, shared by concurrent callers); resolves after a correct passcode,
  // rejects `cancelled` if the caller's signal aborts first (the screen stays for the next call).
  function askPasscode() {
    if (authPromise) return authPromise;
    authPromise = new Promise(function (resolve) {
      var style = document.createElement('style');
      style.textContent = STYLE;
      var root = document.createElement('div');
      root.id = 'passcodeScreen';
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'true');
      root.setAttribute('aria-labelledby', 'passcodeTitle');
      var form = document.createElement('form');
      var h = document.createElement('h2'); h.id = 'passcodeTitle'; h.textContent = 'AI Debate Arena';
      var label = document.createElement('label'); label.htmlFor = 'passcodeInput'; label.textContent = 'Passcode';
      var input = document.createElement('input');
      input.id = 'passcodeInput'; input.type = 'password'; input.autocomplete = 'current-password'; input.required = true;
      var btn = document.createElement('button'); btn.type = 'submit'; btn.textContent = 'Enter';
      var msg = document.createElement('p'); msg.className = 'pc-error'; msg.setAttribute('role', 'alert');
      form.append(h, label, input, btn, msg);
      root.append(style, form);
      document.body.appendChild(root);
      screen = root;
      input.focus();
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        if (btn.disabled || !input.value) return;
        btn.disabled = true; msg.textContent = '';
        post(input.value).then(function (res) {
          if (res.ok) { root.remove(); screen = null; authPromise = null; resolve(); return null; }
          return res.json().catch(function () { return {}; }).then(function (b) {
            msg.textContent = (b && typeof b.message === 'string' && b.message) ||
              (res.status === 429 ? 'Too many tries. Wait a few minutes.' : 'Wrong passcode.');
          });
        }, function () { msg.textContent = 'Could not reach the server. Try again.'; })
          .then(function () {
            if (!screen) return;
            btn.disabled = false; input.value = ''; input.focus();
          });
      });
    });
    return authPromise;
  }

  // Wait for auth, but let `signal` abandon the wait.
  function waitForAuth(signal) {
    var p = askPasscode();
    if (!signal) return p;
    return new Promise(function (resolve, reject) {
      if (signal.aborted) return reject(fail('cancelled', 'The call was cancelled.'));
      signal.addEventListener('abort', function () { reject(fail('cancelled', 'The call was cancelled.')); }, { once: true });
      p.then(resolve);
    });
  }

  // ---------- SSE call ----------
  async function call(input, json, opts) {
    opts = opts || {};
    var signal = opts.signal;
    if (signal && signal.aborted) throw fail('cancelled', 'The call was cancelled.');
    var text = '';
    var body = { input: input };
    if (json) body.json = true;
    if (opts.debateStart) body.debateStart = true;
    var res;
    try {
      res = await fetch('/api/sample', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        credentials: 'same-origin', body: JSON.stringify(body), signal: signal
      });
    } catch (e) {
      if (signal && signal.aborted) throw fail('cancelled', 'The call was cancelled.');
      throw fail('unavailable', 'Could not reach the server. Check your connection and retry.');
    }
    if (res.status === 401) {
      try { if (res.body) res.body.cancel(); } catch (e) {}
      await waitForAuth(signal);
      // Signed in again; the caller's retry UI re-sends the request.
      throw fail('session_expired', 'Your passcode session expired. You are signed in again, so retry.');
    }
    if (!res.ok) {
      var b = await res.json().catch(function () { return {}; });
      var code = (b && b.code) || (res.status === 429 ? 'rate_limited' : res.status >= 500 ? 'unavailable' : 'invalid_request');
      var err = fail(code, (b && b.message) || 'The request failed.');
      // HTTP 429 here is the server's daily cap (upstream rate limits arrive as SSE error lines).
      if (res.status === 429 && b && b.message) err.daily = true;
      throw err;
    }
    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var buf = '';
    var result, failure;
    function handle(block) {
      var data = '';
      block.split('\n').forEach(function (l) { if (l.indexOf('data:') === 0) data += l.slice(5).replace(/^ /, ''); });
      if (!data) return;
      var ev;
      try { ev = JSON.parse(data); } catch (e) { return; }
      if (typeof ev.delta === 'string') {
        text += ev.delta;
        if (opts.onText) { try { opts.onText({ text: text, delta: ev.delta }); } catch (e) { if (globalThis.console) console.error(e); } }
      } else if (ev.error) {
        failure = fail(ev.error.code || 'unavailable', ev.error.message || 'The request failed.', text);
      } else if (ev.done) {
        result = ev;
      }
    }
    try {
      while (!result && !failure) {
        var r = await reader.read();
        if (r.done) break;
        // Normalize on the whole buffer so a CRLF split across chunks is still joined.
        buf = (buf + dec.decode(r.value, { stream: true })).replace(/\r\n/g, '\n');
        var i;
        while (!result && !failure && (i = buf.indexOf('\n\n')) !== -1) {
          var blk = buf.slice(0, i); buf = buf.slice(i + 2); handle(blk);
        }
      }
    } catch (e) {
      if (signal && signal.aborted) throw fail('cancelled', 'The call was cancelled.', text);
      throw fail('unavailable', 'The connection was interrupted.', text);
    }
    try { reader.cancel(); } catch (e) {}
    if (signal && signal.aborted) throw fail('cancelled', 'The call was cancelled.', text);
    if (failure) throw failure;
    if (!result) throw fail('unavailable', 'The connection ended early.', text);
    return result;
  }

  var sample = async function (messages, opts) {
    var r = await call(messages, false, opts);
    return { text: typeof r.text === 'string' ? r.text : '', truncated: false };
  };
  sample.json = async function (prompt, opts) {
    var r = await call(prompt, true, opts);
    return r.json;
  };


  // ---------- premium voices (ElevenLabs via /api/tts) ----------
  // speak(text, voiceKey) resolves 'played' | 'cancelled' | 'failed' and never rejects or hangs; the
  // caller (voice.js) speaks the turn with browser voices on 'failed'. After a quota or missing-voice
  // failure the engine switches itself off for the rest of the page session.
  var SILENT = 'data:audio/wav;base64,UklGRuwAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YcgAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';
  var FETCH_MS = 20000;
  var ttsOff = false, ttsEpoch = 0, current = null, audio = null, voiceList = null;

  function ensureAudio() {
    if (!audio) audio = new Audio();
    return audio;
  }

  // Call synchronously inside a click: playing a silent clip unlocks this element for later turns.
  function primeAudio() {
    if (ttsOff) return;
    try {
      var a = ensureAudio();
      a.src = SILENT;
      var p = a.play();
      if (p && typeof p.catch === 'function') p.catch(function () {});
    } catch (e) { /* ignore */ }
  }

  function cancelSpeech() {
    ttsEpoch++;
    if (current) current.finish('cancelled');
  }

  function speakTts(text, voice) {
    return new Promise(function (resolve) {
      if (ttsOff) { resolve('failed'); return; }
      var epoch = ttsEpoch, done = false, timer = null, url = null, a;
      var ctl = typeof AbortController === 'function' ? new AbortController() : null;
      var me = { finish: finish };
      function finish(result) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (current === me) current = null;
        if (a) { a.onended = null; a.onerror = null; try { a.pause(); } catch (e) {} }
        if (url) { try { URL.revokeObjectURL(url); } catch (e) {} url = null; }
        if (ctl) { try { ctl.abort(); } catch (e) {} }
        resolve(result);
      }
      if (current) current.finish('cancelled');
      current = me;
      timer = setTimeout(function () { finish('failed'); }, FETCH_MS);
      try { a = ensureAudio(); } catch (e) { finish('failed'); return; }
      fetch('/api/tts', {
        method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ text: text, voice: voice }), signal: ctl ? ctl.signal : undefined
      }).then(function (res) {
        if (done) return null;
        if (res.ok) return res.blob();
        return res.json().catch(function () { return {}; }).then(function (b) {
          // ElevenLabs out of credits or our daily TTS budget used up (both rate_limited), or a retired voice:
          // stop asking for the rest of this page session. Transient upstream 429s arrive as 503 unavailable.
          if (b && (b.code === 'rate_limited' || b.code === 'voice_not_found')) ttsOff = true;
          finish('failed');
          return null;
        });
      }).then(function (blob) {
        if (done || !blob) return;
        if (epoch !== ttsEpoch) { finish('cancelled'); return; }
        url = URL.createObjectURL(blob);
        a.onended = function () { finish('played'); };
        a.onerror = function () { finish('failed'); };
        clearTimeout(timer);
        var words = String(text).split(/\s+/).filter(Boolean).length;
        // Generous: if neither `ended` nor `error` ever fires, treat it as played rather than hang.
        timer = setTimeout(function () { finish('played'); }, Math.round((words / 2.5 + 15) * 1000));
        a.src = url;
        var p = a.play();
        if (p && typeof p.catch === 'function') p.catch(function () { finish('failed'); });
      }).catch(function () { finish(epoch !== ttsEpoch ? 'cancelled' : 'failed'); });
    });
  }

  // Curated voices for casting, fetched once. [] when unavailable or after premium voices went off,
  // so the persona prompt then asks for no voice keys.
  function getVoiceList() {
    if (ttsOff) return Promise.resolve([]);
    if (voiceList) return Promise.resolve(voiceList);
    return fetch('/api/voices', { credentials: 'same-origin' }).then(function (res) {
      return res.ok ? res.json() : null;
    }).then(function (b) {
      if (b && Array.isArray(b.voices)) voiceList = b.voices;
      return voiceList || [];
    }, function () { return []; });
  }

  globalThis.DebateHost = {
    speak: speakTts, cancel: cancelSpeech, prime: primeAudio, voices: getVoiceList,
    ttsEnabled: function () { return !ttsOff; },
    sample: function () {
      return fetch('/api/session', { credentials: 'same-origin' }).then(function (res) {
        return res.status === 401 ? askPasscode() : undefined;
      }, function () { /* offline: calls will report unavailable */ }).then(function () { return sample; });
    }
  };
})();
