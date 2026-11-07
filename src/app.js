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
    stop: $('stop'), newDebate: $('newDebate'), transcript: $('transcript')
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

  async function runDebate() {
    var myRun;
    var isAbort = function () { return aborted(myRun); };
    // A superseded run (Stop -> New debate -> Start before its call settled) must not touch the UI.
    var stopOrStale = function () { return myRun === runId ? endDebate('Debate stopped.') : undefined; };
    var topic = L.cleanInput(els.topic.value, 200);
    var forText = L.cleanInput(els.forP.value, 300);
    var againstText = L.cleanInput(els.againstP.value, 300);
    if (!topic || !sample || running) return;
    running = true; stopped = false; myRun = ++runId;
    refreshStart();
    setInputsDisabled(true);
    els.transcript.textContent = '';
    els.topicBanner.textContent = topic;
    els.banner.hidden = true;
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
      // Persona-failure recovery UI belongs to a later task; return to setup with inputs kept.
      showBanner('Could not set up the debaters: ' + ((err && err.message) || 'unknown error'));
      running = false; els.arena.hidden = true; els.setup.hidden = false;
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
      setStatus(persona.name + ' is speaking (' + turn.round + ', turn ' + (i + 1) + ' of ' + L.TURNS.length + ')');
      controller = new AbortController();
      var text;
      try {
        var res = await sample(messages, {
          signal: controller.signal,
          onText: function (u) { bubble.text.textContent = u.text; }
        });
        text = (res && typeof res.text === 'string') ? res.text : bubble.text.textContent;
      } catch (err) {
        bubble.text.classList.remove('cursor');
        if (isAbort()) return stopOrStale();
        // Retry UI is a later task; for now end the debate and show the error.
        return endDebate('Something went wrong: ' + ((err && err.message) || 'unknown error'));
      }
      bubble.text.textContent = text;
      bubble.text.classList.remove('cursor');
      transcript.push({ side: turn.side, round: turn.round, name: persona.name, text: text });
      if (isAbort()) return stopOrStale();
    }
    endDebate('The debate is over.');
  }

  els.setup.addEventListener('submit', function (e) { e.preventDefault(); runDebate(); });
  els.topic.addEventListener('input', refreshStart);
  els.dice.addEventListener('click', function () { els.topic.value = L.pickTopic(); refreshStart(); });
  els.stop.addEventListener('click', function () {
    stopped = true;
    if (controller) controller.abort();
    endDebate('Debate stopped.');
  });
  els.newDebate.addEventListener('click', function () {
    els.arena.hidden = true; els.setup.hidden = false;
    setInputsDisabled(false); refreshStart();
  });

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
