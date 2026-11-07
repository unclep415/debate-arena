(function () {
  'use strict';

  var ROUNDS = ['Opening', 'Rebuttal', 'Closing'];
  var TURNS = [];
  ROUNDS.forEach(function (round) {
    TURNS.push({ round: round, side: 'for' });
    TURNS.push({ round: round, side: 'against' });
  });

  var RANDOM_TOPICS = [
    'Is a hot dog a sandwich?',
    'Is cereal a soup?',
    'Should pineapple be allowed on pizza?',
    'Would you rather fight one horse-sized duck or a hundred duck-sized horses?',
    'Is water wet?',
    'Should socks be worn with sandals?',
    'Is a Pop-Tart a ravioli?',
    'Do cats secretly run the internet?',
    'Should dogs be allowed to vote?',
    'Is the toilet paper roll better over or under?',
    'Is it acceptable to put ketchup on steak?',
    'Would the world be better if everyone walked backwards on Tuesdays?',
    'Is a straw one hole or two?',
    'Should mornings be abolished?',
    'Is breakfast for dinner the superior meal?',
    'Are birds real or just government drones with feathers?',
    'Should every meeting be held standing on one leg?',
    'Is mayonnaise an instrument?'
  ];

  var DEFAULTS = {
    for: { name: 'Debater For', emoji: '🟦' },
    against: { name: 'Debater Against', emoji: '🟥' }
  };

  function pickTopic(rand) {
    var r = typeof rand === 'function' ? rand : Math.random;
    var i = Math.floor(r() * RANDOM_TOPICS.length);
    if (!(i >= 0)) i = 0;
    if (i >= RANDOM_TOPICS.length) i = RANDOM_TOPICS.length - 1;
    return RANDOM_TOPICS[i];
  }

  function cleanInput(str, max) {
    if (str === null || str === undefined) return '';
    var s = String(str).replace(/\s+/g, ' ').trim();
    if (typeof max === 'number' && max >= 0 && s.length > max) {
      s = s.slice(0, max);
      // don't leave half of a surrogate pair (e.g. an emoji) at the cut
      if (/[\uD800-\uDBFF]$/.test(s)) s = s.slice(0, -1);
      s = s.trim();
    }
    return s;
  }

  function isObj(x) {
    return x !== null && typeof x === 'object' && !Array.isArray(x);
  }

  function buildPersonaPrompt(topic, forText, againstText) {
    var f = cleanInput(forText, 300);
    var a = cleanInput(againstText, 300);
    var lines = [];
    lines.push('We are staging a funny debate between two characters on this topic: "' + topic + '"');
    lines.push('Side FOR argues in favor of the topic. Side AGAINST argues against it.');
    lines.push('');
    if (f) {
      lines.push('FOR character (given by the user): ' + f);
      lines.push('Keep the user\'s description exactly as the personality; only give this character a name and a single emoji.');
    } else {
      lines.push('FOR character: invent one that is funny and appropriate to the topic.');
    }
    if (a) {
      lines.push('AGAINST character (given by the user): ' + a);
      lines.push('Keep the user\'s description exactly as the personality; only give this character a name and a single emoji.');
    } else {
      lines.push('AGAINST character: invent one that is funny and appropriate to the topic.');
    }
    if (!f || !a) {
      lines.push('Invented characters must be contrasting: very different from each other in temperament and style.');
    }
    lines.push('');
    lines.push('Respond with JSON only, in exactly this shape:');
    lines.push('{"for":{"name":"...","emoji":"...","personality":"..."},"against":{"name":"...","emoji":"...","personality":"..."}}');
    lines.push('Each name is short (under 40 characters), each emoji is a single emoji, each personality is one or two sentences.');
    return lines.join('\n');
  }

  var EMOJI_RE = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20E3]/u;

  // First grapheme that is actually an emoji (handles ZWJ sequences, flags,
  // skin tones, keycaps); '' if the string has none (e.g. "smile").
  function firstGrapheme(s) {
    if (typeof s !== 'string') return '';
    s = s.trim();
    if (!s) return '';
    var parts;
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      parts = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s), function (x) { return x.segment; });
    } else {
      parts = Array.from(s);
    }
    for (var i = 0; i < parts.length; i++) {
      if (EMOJI_RE.test(parts[i])) return parts[i];
    }
    return '';
  }

  function normalizePersonas(raw, forText, againstText) {
    var user = { for: cleanInput(forText, 300), against: cleanInput(againstText, 300) };
    var out = {};
    ['for', 'against'].forEach(function (side) {
      var r = isObj(raw) && isObj(raw[side]) ? raw[side] : {};
      var name = typeof r.name === 'string' ? cleanInput(r.name, 40) : '';
      var emoji = firstGrapheme(r.emoji);
      var personality = typeof r.personality === 'string' ? cleanInput(r.personality, 300) : '';
      out[side] = {
        name: name || DEFAULTS[side].name,
        emoji: emoji || DEFAULTS[side].emoji,
        personality: user[side] || personality
      };
    });
    return out;
  }

  var ROUND_GOALS = {
    Opening: 'Make your opening statement: state your position and your strongest argument.',
    Rebuttal: 'Rebut your opponent: attack their weakest points and reinforce your own position.',
    Closing: 'Deliver your closing statement: summarize why you won and land a memorable final blow.'
  };

  function roundName(round) {
    return typeof round === 'number' ? (ROUNDS[round] || String(round)) : String(round);
  }

  function speakerName(entry, personas) {
    if (entry && typeof entry.name === 'string' && entry.name) return entry.name;
    var side = entry && entry.side;
    if (personas && personas[side] && personas[side].name) return personas[side].name;
    return side === 'against' ? 'Debater Against' : 'Debater For';
  }

  function formatTranscript(transcript, personas) {
    return (transcript || []).map(function (e) {
      return speakerName(e, personas) + ' (' + (e.side === 'against' ? 'AGAINST' : 'FOR') +
        ', ' + roundName(e.round) + '): ' + e.text;
    }).join('\n\n');
  }

  function buildTurnPrompt(persona, side, round, topic, transcript, personas) {
    var rname = roundName(round);
    var stance = side === 'against' ? 'AGAINST' : 'FOR';
    var p = persona || {};
    var lines = [];
    lines.push('You are ' + (p.name || DEFAULTS[side === 'against' ? 'against' : 'for'].name) +
      ', a character in a lighthearted debate. Your personality: ' +
      String(p.personality || 'a spirited debater').replace(/[.!?\s]+$/, '') + '.');
    lines.push('The debate topic is: "' + topic + '"');
    lines.push('You are arguing ' + stance + ' the topic.');
    lines.push('This is the ' + rname + ' round. ' + (ROUND_GOALS[rname] || ''));
    if (rname !== 'Opening') {
      lines.push('Respond directly to your opponent\'s specific points, quoting or paraphrasing what they actually said.');
    }
    lines.push('Stay in character the whole time. Use at most ~120 words. Write plain flowing prose with no headings or bullet lists. Output only your speech.');
    var t = formatTranscript(transcript, personas);
    lines.push('');
    lines.push(t ? 'Debate so far:\n\n' + t : 'The debate so far: nothing yet, you speak first.');
    lines.push('');
    lines.push('Now give your ' + rname + ' speech as ' + (p.name || DEFAULTS[side === 'against' ? 'against' : 'for'].name) +
      ', arguing ' + stance + ' the topic: in character, at most ~120 words, plain prose with no headings or bullet lists.');
    return [{ role: 'user', content: lines.join('\n') }];
  }

  function buildJudgePrompt(topic, personas, transcript) {
    var f = personas.for, a = personas.against;
    var lines = [];
    lines.push('You are a weary Supreme Court justice judging a lighthearted debate. Be dry and fair.');
    lines.push('Topic: "' + topic + '"');
    lines.push('FOR: ' + f.name + ' (' + (f.personality || '') + ')');
    lines.push('AGAINST: ' + a.name + ' (' + (a.personality || '') + ')');
    lines.push('');
    lines.push('Transcript:\n\n' + formatTranscript(transcript, personas));
    lines.push('');
    lines.push('Score each debater from 1 to 10 (integers) on logic, persuasion, and character (staying in persona).');
    lines.push('Respond with JSON only, in exactly this shape:');
    lines.push('{"scores":{"for":{"logic":0,"persuasion":0,"character":0},"against":{"logic":0,"persuasion":0,"character":0}},"winner":"for"|"against"|"tie","reasoning":"..."}');
    lines.push('Reasoning must be at most 3 sentences, in the voice of the weary justice.');
    return lines.join('\n');
  }

  function toScore(v) {
    if (typeof v === 'string') {
      if (!v.trim()) return null;
      v = Number(v);
    }
    if (typeof v !== 'number' || !isFinite(v)) return null;
    return Math.min(10, Math.max(1, Math.round(v)));
  }

  function normalizeVerdict(raw) {
    if (!isObj(raw) || !isObj(raw.scores)) return null;
    var scores = {}, totals = {};
    var sides = ['for', 'against'];
    for (var i = 0; i < sides.length; i++) {
      var s = raw.scores[sides[i]];
      if (!isObj(s)) return null;
      var l = toScore(s.logic), p = toScore(s.persuasion), c = toScore(s.character);
      if (l === null || p === null || c === null) return null;
      scores[sides[i]] = { logic: l, persuasion: p, character: c };
      totals[sides[i]] = l + p + c;
    }
    var winner = typeof raw.winner === 'string' ? raw.winner.trim().toLowerCase() : raw.winner;
    if (winner !== 'for' && winner !== 'against' && winner !== 'tie') {
      winner = totals.for > totals.against ? 'for' : totals.against > totals.for ? 'against' : 'tie';
    }
    return {
      scores: scores,
      winner: winner,
      reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : '',
      totals: totals
    };
  }

  var api = {
    ROUNDS: ROUNDS,
    TURNS: TURNS,
    RANDOM_TOPICS: RANDOM_TOPICS,
    pickTopic: pickTopic,
    cleanInput: cleanInput,
    buildPersonaPrompt: buildPersonaPrompt,
    normalizePersonas: normalizePersonas,
    buildTurnPrompt: buildTurnPrompt,
    buildJudgePrompt: buildJudgePrompt,
    normalizeVerdict: normalizeVerdict
  };

  globalThis.DebateLogic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
