(function () {
  'use strict';
  var L = globalThis.DebateLogic;
  var $ = function (id) { return document.getElementById(id); };

  var sample = null;      // resolved sample capability
  var connecting = true;  // claude.use("sample") pending
  var running = false;
  var stopped = false;
  var controller = null;
  var runId = 0;

  var els = {
    banner: $('banner'), setup: $('setup'), topic: $('topic'), dice: $('dice'),
    forP: $('forPersona'), againstP: $('againstPersona'), start: $('start'),
    arena: $('arena'), topicBanner: $('topicBanner'), status: $('status'),
    stop: $('stop'), retryPersonas: $('retryPersonas'), newDebate: $('newDebate'), transcript: $('transcript')
  };

  function showBanner(msg) { els.banner.textContent = msg; els.banner.hidden = false; }

  function refreshStart() {
    var blank = !L.cleanInput(els.topic.value, 200);
    els.start.disabled = connecting || !sample || running || blank;
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

  async function getPersonas(topic, forText, againstText) {
    if (forText && againstText) return L.normalizePersonas(null, forText, againstText);
    controller = new AbortController();
    var raw = await sample.json(L.buildPersonaPrompt(topic, forText, againstText), { signal: controller.signal });
    return L.normalizePersonas(raw, forText, againstText);
  }

  function endDebate(msg) {
    running = false;
    controller = null;
    els.stop.hidden = true;
    els.newDebate.hidden = false;
    setStatus(msg);
  }

  var DECLINED = 'Permission was declined, so Claude can’t run this debate. Reload and allow access to try again.';
  function errorCopy(err) {
    var code = err && err.code;
    if (code === 'rate_limited') return 'Claude is rate limited right now. Wait a moment, then retry.';
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
    running = true; stopped = false; myRun = ++runId;
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
      showBanner(err && err.code === 'not_granted' ? DECLINED
        : 'Could not set up the debaters. ' + errorCopy(err));
      running = false; controller = null; els.arena.hidden = true; els.setup.hidden = false;
      els.retryPersonas.hidden = !!(err && err.code === 'not_granted');
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
          var res = await sample(messages, {
            signal: controller.signal,
            onText: function (u) { if (myRun === runId) bubble.text.textContent = u.text; }
          });
          text = (res && typeof res.text === 'string') ? res.text : bubble.text.textContent;
        } catch (err) {
          if (isAbort()) { bubble.text.classList.remove('cursor'); return stopOrStale(); }
          bubble.text.classList.remove('cursor');
          if (err && err.code === 'cancelled') return endDebate('Debate stopped.');
          var partial = (err && typeof err.text === 'string') ? err.text : bubble.text.textContent;
          bubble.text.textContent = partial ? partial + ' ' : '';
          var cut = document.createElement('span'); cut.className = 'cutoff'; cut.textContent = '(cut off)';
          bubble.text.appendChild(cut);
          if (err && err.code === 'not_granted') {
            showBanner(DECLINED);
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
    }

    while (true) {
      setStatus('The judge is deliberating…');
      controller = new AbortController();
      var verdict = null, failMsg = null;
      try {
        verdict = L.normalizeVerdict(await sample.json(L.buildJudgePrompt(topic, personas, transcript), { signal: controller.signal }));
      } catch (err) {
        if (isAbort()) return stopOrStale();
        if (err && err.code === 'cancelled') return endDebate('Debate stopped.');
        if (err && err.code === 'not_granted') { showBanner(DECLINED); return endDebate('Debate ended.'); }
        if (!err || err.code !== 'invalid_json') failMsg = errorCopy(err);
      }
      if (isAbort()) return stopOrStale();
      if (verdict) {
        renderScorecard(personas, verdict);
        return endDebate('The debate is over.');
      }
      setStatus('Paused: the judge needs another go.');
      var retryJudge = await askRetry(myRun, els.transcript, failMsg || 'The judge couldn’t score this one.', 'Retry judge');
      if (!retryJudge || isAbort()) return stopOrStale();
    }
  }

  els.setup.addEventListener('submit', function (e) { e.preventDefault(); runDebate(); });
  els.topic.addEventListener('input', refreshStart);
  els.dice.addEventListener('click', function () { els.topic.value = L.pickTopic(); refreshStart(); });
  els.stop.addEventListener('click', function () {
    stopped = true;
    cancelPending();
    if (controller) controller.abort();
    endDebate('Debate stopped.');
  });
  els.newDebate.addEventListener('click', function () {
    cancelPending();
    els.arena.hidden = true; els.setup.hidden = false;
    setInputsDisabled(false); refreshStart();
  });
  els.retryPersonas.addEventListener('click', function () { runDebate(); });

  refreshStart();
  var p;
  try { p = Promise.resolve(window.claude && window.claude.use('sample')); } catch (e) { p = Promise.resolve(null); }
  p.then(function (s) { return s; }, function () { return null; }).then(function (s) {
    connecting = false;
    sample = s || null;
    if (!sample) showBanner("Claude isn't available in this view.");
    refreshStart();
  });
})();
