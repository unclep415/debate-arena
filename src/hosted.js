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

  globalThis.DebateHost = {
    sample: function () {
      return fetch('/api/session', { credentials: 'same-origin' }).then(function (res) {
        return res.status === 401 ? askPasscode() : undefined;
      }, function () { /* offline: calls will report unavailable */ }).then(function () { return sample; });
    }
  };
})();
