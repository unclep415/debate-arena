(function () {
  'use strict';
  var L = globalThis.DebateLogic;
  var V = globalThis.DebateVoice;
  var $ = function (id) { return document.getElementById(id); };

  var sample = null;      // resolved sample capability
  var connecting = true;  // claude.use("sample") pending
  var running = false;
  var stopped = false;
  var controller = null;
  var runId = 0;
  var blocked = false;    // a permanent refusal (e.g. not_granted): never ask again in this view

  var els = {
    banner: $('banner'), setup: $('setup'), topic: $('topic'), dice: $('dice'),
    forP: $('forPersona'), againstP: $('againstPersona'), start: $('start'),
    arena: $('arena'), topicBanner: $('topicBanner'), status: $('status'),
    stop: $('stop'), retryPersonas: $('retryPersonas'), newDebate: $('newDebate'), transcript: $('transcript')
  };

  // Voice (text-to-speech). Default off; remembered in localStorage when it is available.
  var VOICE_KEY = 'debate-voice';
  var voiceSupported = !!(V && V.isSupported());
  var voiceOn = false;
  if (voiceSupported) {
    try { voiceOn = localStorage.getItem(VOICE_KEY) === '1'; } catch (e) { voiceOn = false; }
  }
  var voiceBtns = [$('voiceSetup'), $('voiceArena')];
  function renderVoice() {
    voiceBtns.forEach(function (b) {
      b.hidden = !voiceSupported;
      b.setAttribute('aria-pressed', voiceOn ? 'true' : 'false');
      b.textContent = '🔊 Voice: ' + (voiceOn ? 'on' : 'off');
    });
  }
  function setVoice(on) {
    voiceOn = !!on;
    try { localStorage.setItem(VOICE_KEY, voiceOn ? '1' : '0'); } catch (e) { /* storage unavailable */ }
    if (voiceSupported) { if (voiceOn) V.prime(); else V.cancel(); }
    renderVoice();
  }
  function cancelSpeech() { if (voiceSupported) V.cancel(); }
  // Speak only for the current, un-stopped run; resolves when speech ends or is cancelled.
  async function say(id, text, speaker, name, voice) {
    if (!voiceOn || !voiceSupported || aborted(id)) return;
    setStatus(name + ' is speaking aloud…');
    await V.speak(text, speaker, voice ? { voice: voice } : undefined);
  }

  function showBanner(msg) { els.banner.textContent = msg; els.banner.hidden = false; }

  function refreshStart() {
    var blank = !L.cleanInput(els.topic.value, 200);
    els.start.disabled = connecting || !sample || blocked || running || blank;
    els.start.textContent = connecting ? 'Connecting…' : 'Start debate';
  }

  function setInputsDisabled(d) {
    [els.topic, els.dice, els.forP, els.againstP].forEach(function (e) { e.disabled = d; });
  }

  function setStatus(msg) { els.status.textContent = msg; }

  function makeBubble(turn, persona) {
    var b = document.createElement('article');
    b.className = 'bubble';
    b.dataset.side = turn.side;
    b.dataset.round = turn.round;
    var who = document.createElement('div'); who.className = 'who';
    var em = document.createElement('span'); em.className = 'emoji'; em.textContent = persona.emoji;
    var nm = document.createElement('span'); nm.className = 'name'; nm.textContent = persona.name;
    var rd = document.createElement('span'); rd.className = 'round'; rd.textContent = turn.round;
    who.appendChild(em); who.appendChild(nm); who.appendChild(rd);
    var tx = document.createElement('p'); tx.className = 'text cursor';
    var d = document.createElement('details'); d.className = 'hood';
    var s = document.createElement('summary'); s.textContent = 'Under the hood';
    d.appendChild(s);
    b.appendChild(who); b.appendChild(tx); b.appendChild(d);
    els.transcript.appendChild(b);
    return { root: b, text: tx, hood: d };
  }

  function fillHood(hood, messages) {
    messages.forEach(function (m) {
      var wrap = document.createElement('div'); wrap.className = 'hood-msg';
      var role = document.createElement('span'); role.className = 'hood-role'; role.textContent = m.role;
      var pre = document.createElement('pre'); pre.textContent = m.content;
      wrap.appendChild(role); wrap.appendChild(pre);
      hood.appendChild(wrap);
    });
  }

  function aborted(id) { return stopped || id !== runId; }

  // Hosted site only: the first model call of a debate is flagged so the server can count it
  // against the daily cap. Never added on claude.ai (the real sample API may reject unknown options).
  var hostStart = true;
  function startOpts(o) {
    if (globalThis.DebateHost && hostStart) o.debateStart = true;
    return o;
  }
  // Keep the flag until a call actually reached the model (not refused by the cap or auth).
  // Only the daily-cap HTTP 429 (err.daily) is uncounted; an upstream rate_limited line came after the count.
  function startSettled(err) {
    if (!err || !((err.code === 'rate_limited' && err.daily) || err.code === 'session_expired' || err.code === 'cancelled')) hostStart = false;
  }

  // Hosted site only: the curated voice list ([] when unavailable or when premium voices are off).
  async function getVoices() {
    var H = globalThis.DebateHost;
    if (!H || typeof H.voices !== 'function') return [];
    try { var v = await H.voices(); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }

  async function getPersonas(topic, forText, againstText) {
    var voices = await getVoices();
    // Both personas typed: no model call (claude.ai always; hosted with voice off or no voice list).
    // Hosted with voice on still asks Claude to cast fitting voices (and a name/emoji) for the typed characters.
    if (forText && againstText && !(voiceOn && L.castable(voices).length)) return L.normalizePersonas(null, forText, againstText, voices);
    controller = new AbortController();
    var raw;
    try {
      raw = await sample.json(L.buildPersonaPrompt(topic, forText, againstText, voices), startOpts({ signal: controller.signal, cache: false }));
    } catch (e) { startSettled(e); throw e; }
    startSettled(null);
    return L.normalizePersonas(raw, forText, againstText, voices);
  }

  function endDebate(msg) {
    running = false;
    controller = null;
    els.stop.hidden = true;
    els.newDebate.hidden = false;
    setStatus(msg);
  }

  var DECLINED = 'Permission was declined, so Claude can’t run this debate. Reload and allow access to try again.';
  // Codes the platform says are permanent for this view: hide the feature, never re-ask.
  var PERMANENT = { not_granted: 1, sampling_disabled: 1, not_declared: 1, capability_disabled: 1, capability_removed: 1 };
  function isPermanent(err) { return !!(err && PERMANENT[err.code]); }
  function blockFor(err) {
    blocked = true;
    showBanner(err.code === 'not_granted' ? DECLINED : 'Claude isn’t available for this account or view, so the debate can’t run.');
  }
  function errorCopy(err) {
    var code = err && err.code;
    if (code === 'rate_limited' && err.daily) return err.message;
    if (code === 'rate_limited') return 'Claude is rate limited right now. Wait a moment, then retry.';
    if (code === 'session_expired' && globalThis.DebateHost && err.message) return err.message;
    if (code === 'session_expired') return 'Your Claude session expired. Sign in again, then retry.';
    if (code === 'refused') return 'Claude declined to write this turn. Retrying may go differently, or start a new debate with a different topic.';
    var m = err && typeof err.message === 'string' && err.message ? err.message : 'unknown error';
    return 'Something went wrong: ' + m;
  }

  // At most one retry prompt exists at a time; Stop / a new run dismisses it.
  var pending = null;
  function cancelPending() {
    if (!pending) return;
    var p = pending; pending = null;
    p.box.remove();
    p.resolve(false);
  }
  // Resolves true when the viewer clicks retry for the CURRENT run, false if dismissed.
  function askRetry(id, host, message, label) {
    return new Promise(function (resolve) {
      cancelPending();
      var box = document.createElement('div'); box.className = 'notice'; box.setAttribute('role', 'alert');
      var msg = document.createElement('p'); msg.textContent = message;
      var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'retry'; btn.textContent = label;
      box.appendChild(msg); box.appendChild(btn);
      host.appendChild(box);
      var me = { box: box, resolve: resolve };
      pending = me;
      btn.addEventListener('click', function () {
        if (pending !== me || id !== runId || stopped) return;
        pending = null; box.remove(); resolve(true);
      });
    });
  }

  function sideCard(side, persona, scores, total, win) {
    var c = document.createElement('div'); c.className = 'score-side' + (win ? ' winner' : '');
    c.dataset.side = side;
    var who = document.createElement('div'); who.className = 'who';
    var em = document.createElement('span'); em.className = 'emoji'; em.textContent = persona.emoji;
    var nm = document.createElement('span'); nm.className = 'name'; nm.textContent = persona.name;
    who.appendChild(em); who.appendChild(nm);
    c.appendChild(who);
    var dl = document.createElement('dl'); dl.className = 'marks';
    ['logic', 'persuasion', 'character'].forEach(function (k) {
      var row = document.createElement('div');
      var dt = document.createElement('dt'); dt.textContent = k;
      var dd = document.createElement('dd'); dd.textContent = String(scores[k]);
      row.appendChild(dt); row.appendChild(dd); dl.appendChild(row);
    });
    c.appendChild(dl);
    var tot = document.createElement('p'); tot.className = 'total-row';
    var tl = document.createElement('span'); tl.textContent = 'Total ';
    var tv = document.createElement('strong'); tv.className = 'total'; tv.textContent = String(total);
    tot.appendChild(tl); tot.appendChild(tv);
    c.appendChild(tot);
    if (win) {
      var badge = document.createElement('p'); badge.className = 'badge'; badge.textContent = 'Winner';
      c.appendChild(badge);
    }
    return c;
  }

  function renderScorecard(personas, v) {
    var sc = document.createElement('section'); sc.className = 'scorecard';
    sc.setAttribute('aria-label', 'Verdict');
    var h = document.createElement('h2'); h.textContent = 'The verdict';
    sc.appendChild(h);
    var grid = document.createElement('div'); grid.className = 'score-grid';
    grid.appendChild(sideCard('for', personas.for, v.scores.for, v.totals.for, v.winner === 'for'));
    grid.appendChild(sideCard('against', personas.against, v.scores.against, v.totals.against, v.winner === 'against'));
    sc.appendChild(grid);
    if (v.winner === 'tie') {
      var t = document.createElement('p'); t.className = 'tie'; t.textContent = 'Tie'; sc.appendChild(t);
    }
    if (v.reasoning) {
      var r = document.createElement('p'); r.className = 'reasoning'; r.textContent = v.reasoning; sc.appendChild(r);
    }
    els.transcript.appendChild(sc);
  }

  async function runDebate() {
    var myRun;
    var isAbort = function () { return aborted(myRun); };
    // A superseded run (Stop -> New debate -> Start before its call settled) must not touch the UI.
    var stopOrStale = function () { return myRun === runId ? endDebate('Debate stopped.') : undefined; };
    var topic = L.cleanInput(els.topic.value, 200);
    var forText = L.cleanInput(els.forP.value, 300);
    var againstText = L.cleanInput(els.againstP.value, 300);
    if (!topic || !sample || running) return;
    cancelPending();
    cancelSpeech();
    if (voiceOn && voiceSupported) V.prime(); // still inside the Start click: unlocks later speech
    running = true; stopped = false; myRun = ++runId;
    hostStart = true;
    refreshStart();
    setInputsDisabled(true);
    els.transcript.textContent = '';
    els.topicBanner.textContent = topic;
    els.banner.hidden = true;
    els.retryPersonas.hidden = true;
    els.setup.hidden = true;
    els.arena.hidden = false;
    els.newDebate.hidden = true;
    els.stop.hidden = false;

    var personas;
    try {
      setStatus('Casting the debaters…');
      personas = await getPersonas(topic, forText, againstText);
    } catch (err) {
      if (isAbort()) return stopOrStale();
      if (err && err.code === 'cancelled') return endDebate('Debate stopped.');
      if (isPermanent(err)) blockFor(err);
      else showBanner('Could not set up the debaters. ' + errorCopy(err));
      running = false; controller = null; els.arena.hidden = true; els.setup.hidden = false;
      els.retryPersonas.hidden = isPermanent(err);
      setInputsDisabled(false); refreshStart();
      return;
    }
    if (isAbort()) return stopOrStale();

    var transcript = [];
    for (var i = 0; i < L.TURNS.length; i++) {
      var turn = L.TURNS[i];
      var persona = personas[turn.side];
      var bubble = makeBubble(turn, persona);
      var messages = L.buildTurnPrompt(persona, turn.side, turn.round, topic, transcript, personas);
      fillHood(bubble.hood, messages);
      var text = null;
      while (text === null) {
        bubble.text.textContent = '';
        bubble.text.classList.add('cursor');
        setStatus(persona.name + ' is speaking (' + turn.round + ', turn ' + (i + 1) + ' of ' + L.TURNS.length + ')');
        controller = new AbortController();
        try {
          var res = await sample(messages, startOpts({
            signal: controller.signal,
            cache: false,
            onText: function (u) { if (myRun === runId) bubble.text.textContent = u.text; }
          }));
          startSettled(null);
          text = (res && typeof res.text === 'string') ? res.text : bubble.text.textContent;
        } catch (err) {
          startSettled(err);
          if (isAbort()) { bubble.text.classList.remove('cursor'); return stopOrStale(); }
          bubble.text.classList.remove('cursor');
          if (err && err.code === 'cancelled') return endDebate('Debate stopped.');
          // `refused` withdraws any partial (the platform sends no text); otherwise keep what streamed.
          var partial = err && err.code === 'refused' ? ''
            : (err && typeof err.text === 'string') ? err.text : bubble.text.textContent;
          bubble.text.textContent = partial ? partial + ' ' : '';
          var cut = document.createElement('span'); cut.className = 'cutoff'; cut.textContent = '(cut off)';
          bubble.text.appendChild(cut);
          if (isPermanent(err)) {
            blockFor(err);
            return endDebate('Debate ended.');
          }
          setStatus('Paused: this turn failed.');
          var again = await askRetry(myRun, bubble.root, errorCopy(err), 'Retry this turn');
          if (!again || isAbort()) return stopOrStale();
        }
      }
      bubble.text.textContent = text;
      bubble.text.classList.remove('cursor');
      transcript.push({ side: turn.side, round: turn.round, name: persona.name, text: text });
      if (isAbort()) return stopOrStale();
      await say(myRun, text, turn.side, persona.name, persona.voice);
      if (isAbort()) return stopOrStale();
    }

    while (true) {
      setStatus('The judge is deliberating…');
      controller = new AbortController();
      var verdict = null, failMsg = null, raw = null;
      try {
        raw = await sample.json(L.buildJudgePrompt(topic, personas, transcript), { signal: controller.signal, cache: false });
        verdict = L.normalizeVerdict(raw);
      } catch (err) {
        if (isAbort()) return stopOrStale();
        if (err && err.code === 'cancelled') return endDebate('Debate stopped.');
        if (isPermanent(err)) { blockFor(err); return endDebate('Debate ended.'); }
        if (!err || err.code !== 'invalid_json') failMsg = errorCopy(err);
      }
      if (isAbort()) return stopOrStale();
      if (verdict) {
        renderScorecard(personas, verdict);
        var spoken = verdict.winner === 'tie' ? 'It’s a tie.' : 'Winner: ' + personas[verdict.winner].name + '.';
        await say(myRun, spoken + (verdict.reasoning ? ' ' + verdict.reasoning : ''), 'judge', 'The judge');
        if (isAbort()) return stopOrStale();
        return endDebate('The debate is over.');
      }
      setStatus('Paused: the judge needs another go.');
      // Unusable scores but some reasoning: show what the judge did say.
      var said = raw && typeof raw === 'object' && typeof raw.reasoning === 'string' ? L.cleanInput(raw.reasoning, 600) : '';
      var judgeMsg = failMsg || ((said ? 'The judge said: “' + said + '” But ' : 'The ') + 'judge couldn’t score this one.');
      var retryJudge = await askRetry(myRun, els.transcript, judgeMsg, 'Retry judge');
      if (!retryJudge || isAbort()) return stopOrStale();
    }
  }

  els.setup.addEventListener('submit', function (e) { e.preventDefault(); runDebate(); });
  els.topic.addEventListener('input', refreshStart);
  els.dice.addEventListener('click', function () { els.topic.value = L.pickTopic(); refreshStart(); });
  els.stop.addEventListener('click', function () {
    stopped = true;
    cancelPending();
    cancelSpeech();
    if (controller) controller.abort();
    endDebate('Debate stopped.');
  });
  els.newDebate.addEventListener('click', function () {
    cancelPending();
    cancelSpeech();
    els.arena.hidden = true; els.setup.hidden = false;
    setInputsDisabled(false); refreshStart();
  });
  els.retryPersonas.addEventListener('click', function () { runDebate(); });

  voiceBtns.forEach(function (b) { b.addEventListener('click', function () { setVoice(!voiceOn); }); });
  renderVoice();
  refreshStart();
  var p;
  try { p = Promise.resolve(globalThis.DebateHost ? globalThis.DebateHost.sample() : window.claude && window.claude.use('sample')); } catch (e) { p = Promise.resolve(null); }
  p.then(function (s) { return s; }, function () { return null; }).then(function (s) {
    connecting = false;
    sample = s || null;
    if (!sample) showBanner("Claude isn't available in this view.");
    refreshStart();
  });
})();
