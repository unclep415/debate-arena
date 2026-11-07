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

  // Keys of the voices a debater may be cast with (hosted site only): a list of {key, description, judge?}.
  function castable(voices) {
    if (!Array.isArray(voices)) return [];
    return voices.filter(function (v) { return isObj(v) && typeof v.key === 'string' && v.key && !v.judge; });
  }

  function buildPersonaPrompt(topic, forText, againstText, voices) {
    var f = cleanInput(forText, 300);
    var a = cleanInput(againstText, 300);
    var cast = castable(voices);
    var giveVoice = cast.length ? ' (and a voice, below)' : '';
    var lines = [];
    lines.push('We are staging a funny debate between two characters on this topic: "' + topic + '"');
    lines.push('Side FOR argues in favor of the topic. Side AGAINST argues against it.');
    lines.push('');
    if (f) {
      lines.push('FOR character (given by the user): ' + f);
      lines.push('Keep the user\'s description exactly as the personality; only give this character a name and a single emoji' + giveVoice + '.');
    } else {
      lines.push('FOR character: invent one that is funny and appropriate to the topic.');
    }
    if (a) {
      lines.push('AGAINST character (given by the user): ' + a);
      lines.push('Keep the user\'s description exactly as the personality; only give this character a name and a single emoji' + giveVoice + '.');
    } else {
      lines.push('AGAINST character: invent one that is funny and appropriate to the topic.');
    }
    if (!f || !a) {
      lines.push('Invented characters must be contrasting: very different from each other in temperament and style.');
    }
    lines.push('');
    if (cast.length) {
      lines.push('Each character is spoken aloud in a voice. Pick the voice key that best fits each character; the two characters must use different voices. Available voices:');
      cast.forEach(function (v) { lines.push('- ' + v.key + ': ' + cleanInput(v.description || v.label || '', 120)); });
      lines.push('');
    }
    lines.push('Respond with JSON only, in exactly this shape:');
    if (cast.length) {
      lines.push('{"for":{"name":"...","emoji":"...","personality":"...","voice":"<voice key>"},"against":{"name":"...","emoji":"...","personality":"...","voice":"<voice key>"}}');
    } else {
      lines.push('{"for":{"name":"...","emoji":"...","personality":"..."},"against":{"name":"...","emoji":"...","personality":"..."}}');
    }
    lines.push('Each name is short (under 40 characters), each emoji is a single emoji, each personality is one or two sentences.' + (cast.length ? ' Each voice is one of the keys listed above.' : ''));
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

  // Short display name from a user-written persona, no model call:
  // "a grumpy 1800s pirate, hates rum" -> "Grumpy 1800s Pirate".
  // Cuts at the first clause punctuation, drops a leading article, keeps up to
  // 4 words, title-cases each word's first letter, never exceeds 40 chars.
  function nameFromDescription(text) {
    var s = cleanInput(text, 300).split(/[,.;:!?()\[\]{}"\u201C\u201D]/)
      .map(function (x) { return x.trim(); }).filter(Boolean)[0] || '';
    var words = s.split(' ').filter(Boolean);
    while (words.length > 1 && /^(a|an|the)$/i.test(words[0])) words.shift();
    if (words.length === 1 && /^(a|an|the)$/i.test(words[0])) return '';
    var out = '';
    for (var i = 0; i < words.length && i < 4; i++) {
      var w = Array.from(words[i]);
      w[0] = w[0].toUpperCase();
      var next = (out ? out + ' ' : '') + w.join('');
      if (next.length > 40) {
        if (!out) out = cleanInput(next, 40);
        break;
      }
      out = next;
    }
    return out;
  }

  function normalizePersonas(raw, forText, againstText, voices) {
    var user = { for: cleanInput(forText, 300), against: cleanInput(againstText, 300) };
    var out = {};
    ['for', 'against'].forEach(function (side) {
      var r = isObj(raw) && isObj(raw[side]) ? raw[side] : {};
      var name = typeof r.name === 'string' ? cleanInput(r.name, 40) : '';
      var emoji = firstGrapheme(r.emoji);
      var personality = typeof r.personality === 'string' ? cleanInput(r.personality, 300) : '';
      out[side] = {
        name: name || nameFromDescription(user[side]) || DEFAULTS[side].name,
        emoji: emoji || DEFAULTS[side].emoji,
        personality: user[side] || personality
      };
    });
    var cast = castable(voices).map(function (v) { return v.key; });
    if (cast.length) {
      var picked = {};
      ['for', 'against'].forEach(function (side) {
        var r = isObj(raw) && isObj(raw[side]) ? raw[side] : {};
        var want = typeof r.voice === 'string' ? r.voice : '';
        var ok = cast.indexOf(want) >= 0 && !(side === 'against' && want === picked['for']);
        var key = ok ? want : (cast.filter(function (k) { return k !== picked['for']; })[0] || cast[0]);
        picked[side] = key;
        out[side].voice = key;
      });
    }
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
    var oppSide = side === 'against' ? 'for' : 'against';
    var opp = personas && personas[oppSide] && personas[oppSide].name;
    lines.push('You are arguing ' + stance + ' the topic' +
      (opp ? '; your opponent, ' + opp + ', is arguing ' + oppSide.toUpperCase() + ' it.' : '.'));
    lines.push('This is the ' + rname + ' round. ' + (ROUND_GOALS[rname] || ''));
    if (rname !== 'Opening') {
      lines.push('Respond directly to your opponent\'s specific points, quoting or paraphrasing what they actually said, and say why they are wrong. Do not just repeat your earlier arguments.');
    } else if (transcript && transcript.length) {
      lines.push('You may take one quick jab at what your opponent just said, but mostly make your own case.');
    }
    lines.push('Stay in character the whole time. Use at most ~120 words. Write plain flowing prose with no headings or bullet lists and no markdown (no asterisks, no bold, no stage directions). Do not start with your name or a label. Output only your speech.');
    var t = formatTranscript(transcript, personas);
    lines.push('');
    lines.push(t ? 'Debate so far:\n\n' + t : 'The debate so far: nothing yet, you speak first.');
    lines.push('');
    lines.push('Now give your ' + rname + ' speech as ' + (p.name || DEFAULTS[side === 'against' ? 'against' : 'for'].name) +
      ', arguing ' + stance + ' the topic: in character, at most ~120 words, plain prose with no headings, bullet lists or markdown.');
    return [{ role: 'user', content: lines.join('\n') }];
  }

  function buildJudgePrompt(topic, personas, transcript) {
    var f = personas.for, a = personas.against;
    var lines = [];
    lines.push('You are a weary Supreme Court justice judging a lighthearted debate. Be dry and fair: judge how well each debater argued their assigned side, not which side you agree with.');
    lines.push('Topic: "' + topic + '"');
    lines.push('FOR: ' + f.name + (f.personality ? ' (' + f.personality + ')' : ''));
    lines.push('AGAINST: ' + a.name + (a.personality ? ' (' + a.personality + ')' : ''));
    lines.push('');
    lines.push('Transcript:\n\n' + formatTranscript(transcript, personas));
    lines.push('');
    lines.push('Score each debater from 1 to 10 (integers) on: logic (how sound and well supported their arguments were), persuasion (how convincing they were, including how well they answered their opponent\'s actual points), and character (how well they stayed in persona).');
    lines.push('The winner is the side with the higher total score; use "tie" only if the totals are equal.');
    lines.push('Respond with JSON only, in exactly this shape (replace the example numbers with your own scores):');
    lines.push('{"scores":{"for":{"logic":7,"persuasion":6,"character":8},"against":{"logic":5,"persuasion":7,"character":6}},"winner":"for","reasoning":"..."}');
    lines.push('"winner" must be exactly "for", "against" or "tie".');
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
    // The scorecard must never crown the lower total: when totals differ they decide;
    // when they are equal the judge's valid call breaks the tie (else "tie").
    var winner = typeof raw.winner === 'string' ? raw.winner.trim().toLowerCase() : raw.winner;
    if (totals.for !== totals.against) {
      winner = totals.for > totals.against ? 'for' : 'against';
    } else if (winner !== 'for' && winner !== 'against' && winner !== 'tie') {
      winner = 'tie';
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
    castable: castable,
    nameFromDescription: nameFromDescription,
    buildTurnPrompt: buildTurnPrompt,
    buildJudgePrompt: buildJudgePrompt,
    normalizeVerdict: normalizeVerdict
  };

  globalThis.DebateLogic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
