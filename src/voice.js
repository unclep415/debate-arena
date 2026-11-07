// Text-to-speech via the browser's Web Speech API. No network. Classic script: exposes
// globalThis.DebateVoice (and module.exports under Node for unit tests).
(function () {
  'use strict';
  var G = globalThis;

  // Distinct pitch/rate per speaker so voices differ even when the browser offers only one.
  var PRESETS = {
    for: { pitch: 1.1, rate: 1.05 },
    against: { pitch: 0.95, rate: 1.1 },
    judge: { pitch: 0.8, rate: 0.9 }
  };
  var MAX_CHUNK = 200;

  function isSupported() {
    return typeof G.speechSynthesis !== 'undefined' && !!G.speechSynthesis &&
      typeof G.SpeechSynthesisUtterance === 'function';
  }

  function langOf(v) { return String((v && v.lang) || '').toLowerCase().replace(/_/g, '-'); }

  // Pure: pick up to three distinct voices for the page language; never mutates `voices`.
  function assignVoices(voices, lang) {
    var list = Array.prototype.slice.call(voices || []);
    var prefix = String(lang || 'en').toLowerCase().replace(/_/g, '-').split('-')[0] || 'en';
    function matching(p) { return list.filter(function (v) { var l = langOf(v); return l === p || l.indexOf(p + '-') === 0; }); }
    var pool = matching(prefix);
    if (!pool.length) pool = matching('en');
    if (!pool.length) pool = list;
    // Default voice first, otherwise keep the browser's order.
    pool = pool.filter(function (v) { return v.default; }).concat(pool.filter(function (v) { return !v.default; }));
    function pick(i) { return pool.length ? pool[i % pool.length] : null; }
    var out = {};
    ['for', 'against', 'judge'].forEach(function (k, i) {
      out[k] = { voice: pick(i), pitch: PRESETS[k].pitch, rate: PRESETS[k].rate };
    });
    return out;
  }

  // Sentences packed into chunks of at most `max` chars (long sentences split on spaces).
  function chunk(text, max) {
    max = max || MAX_CHUNK;
    var clean = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (!clean) return [];
    var sentences = clean.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)\s*/g) || [clean];
    var parts = [];
    sentences.forEach(function (s) {
      s = s.trim();
      while (s.length > max) {
        var cut = s.lastIndexOf(' ', max);
        if (cut < max / 2) cut = max;
        parts.push(s.slice(0, cut).trim());
        s = s.slice(cut).trim();
      }
      if (s) parts.push(s);
    });
    var out = [], cur = '';
    parts.forEach(function (p) {
      if (cur && (cur + ' ' + p).length > max) { out.push(cur); cur = p; }
      else cur = cur ? cur + ' ' + p : p;
    });
    if (cur) out.push(cur);
    return out;
  }

  // Generous: well above real speaking time, in case `end` never fires (backgrounded tab etc.).
  function timeoutMs(text) {
    var words = String(text || '').split(/\s+/).filter(Boolean).length;
    return Math.round((words / 2.5 + 5) * 1000);
  }

  var epoch = 0;          // bumped by cancel(); stale speaks stop
  var pending = [];       // finish functions of in-flight speaks
  var cachedVoices = [];
  var listening = false;

  function loadVoices() {
    try {
      var v = G.speechSynthesis.getVoices();
      if (v && v.length) cachedVoices = Array.prototype.slice.call(v);
    } catch (e) { /* ignore */ }
    if (!listening && typeof G.speechSynthesis.addEventListener === 'function') {
      listening = true;
      try { G.speechSynthesis.addEventListener('voiceschanged', loadVoices); } catch (e) { /* ignore */ }
    }
    return cachedVoices;
  }

  function pageLang() {
    try { return (G.navigator && G.navigator.language) || 'en'; } catch (e) { return 'en'; }
  }

  // Resolves when done, errored, cancelled or timed out. Never rejects.
  function speak(text, speaker, opts) {
    return new Promise(function (resolve) {
      var chunks = chunk(text);
      if (!chunks.length || !isSupported()) { resolve(); return; }
      var myEpoch = epoch;
      var finished = false, timer = null, idx = 0;
      var settings;
      try { settings = assignVoices(loadVoices(), pageLang())[PRESETS[speaker] ? speaker : 'for']; }
      catch (e) { settings = { voice: null, pitch: 1, rate: 1 }; }

      function finish() {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
        var i = pending.indexOf(finish);
        if (i >= 0) pending.splice(i, 1);
        resolve();
      }
      pending.push(finish);

      function armTimer(chunkText) {
        if (timer) clearTimeout(timer);
        var ms = opts && typeof opts.timeoutMs === 'number' ? opts.timeoutMs : timeoutMs(chunkText);
        timer = setTimeout(function () {
          try { G.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
          finish();
        }, ms);
      }

      function next() {
        if (finished || myEpoch !== epoch) { finish(); return; }
        if (idx >= chunks.length) { finish(); return; }
        var t = chunks[idx++];
        var advanced = false;
        function advance() { if (advanced) return; advanced = true; next(); }
        try {
          var u = new G.SpeechSynthesisUtterance(t);
          if (settings.voice) { u.voice = settings.voice; u.lang = settings.voice.lang; }
          u.pitch = settings.pitch; u.rate = settings.rate;
          u.onend = advance;
          u.onerror = advance;
          armTimer(t);
          G.speechSynthesis.speak(u);
        } catch (e) { finish(); }
      }
      next();
    });
  }

  // Call synchronously inside a click handler: iOS Safari (and some Chrome builds) only let a page
  // speak after speech was started from a user gesture, and real turns are spoken much later.
  function prime() {
    if (!isSupported()) return;
    try { if (typeof G.speechSynthesis.resume === 'function') G.speechSynthesis.resume(); } catch (e) { /* ignore */ }
    loadVoices();
    try {
      var u = new G.SpeechSynthesisUtterance('');
      u.volume = 0;
      G.speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  }

  function cancel() {
    epoch++;
    var fns = pending.slice();
    pending = [];
    if (isSupported()) { try { G.speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
    fns.forEach(function (f) { f(); });
  }

  var api = { isSupported: isSupported, assignVoices: assignVoices, speak: speak, cancel: cancel, prime: prime, chunk: chunk, timeoutMs: timeoutMs };
  G.DebateVoice = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
