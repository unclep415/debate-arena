const test = require('node:test');
const assert = require('node:assert');
const L = require('../src/logic.js');

test('constants', () => {
  assert.deepStrictEqual(L.ROUNDS, ['Opening', 'Rebuttal', 'Closing']);
  assert.strictEqual(L.TURNS.length, 6);
  assert.deepStrictEqual(L.TURNS.map(t => t.side), ['for', 'against', 'for', 'against', 'for', 'against']);
  assert.deepStrictEqual(L.TURNS.map(t => t.round), ['Opening', 'Opening', 'Rebuttal', 'Rebuttal', 'Closing', 'Closing']);
  assert.ok(L.RANDOM_TOPICS.length >= 15);
  assert.ok(L.RANDOM_TOPICS.every(t => typeof t === 'string' && t.trim()));
});

test('browser global exposure', () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const ctx = {};
  ctx.globalThis = ctx;
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/logic.js'), 'utf8'), ctx);
  assert.strictEqual(typeof ctx.DebateLogic.pickTopic, 'function');
});

test('pickTopic', () => {
  assert.strictEqual(L.pickTopic(() => 0), L.RANDOM_TOPICS[0]);
  assert.strictEqual(L.pickTopic(() => 0.999999), L.RANDOM_TOPICS[L.RANDOM_TOPICS.length - 1]);
  assert.ok(L.RANDOM_TOPICS.includes(L.pickTopic()));
});

test('cleanInput', () => {
  assert.strictEqual(L.cleanInput('   \n\t ', 200), '');
  assert.strictEqual(L.cleanInput('  a \n\n b\t c  ', 200), 'a b c');
  assert.strictEqual(L.cleanInput('x'.repeat(500), 200).length, 200);
  assert.strictEqual(L.cleanInput('abcdef', 3), 'abc');
  assert.strictEqual(L.cleanInput(null, 10), '');
  assert.strictEqual(L.cleanInput(undefined, 10), '');
  assert.strictEqual(L.cleanInput(42, 10), '42');
  assert.strictEqual(L.cleanInput('ab  cd', 3), 'ab');
});

test('buildPersonaPrompt: both blank', () => {
  const p = L.buildPersonaPrompt('Is cereal soup?', '', '');
  assert.strictEqual(typeof p, 'string');
  assert.match(p, /Is cereal soup\?/);
  assert.match(p, /JSON/);
  for (const k of ['for', 'against', 'name', 'emoji', 'personality']) assert.match(p, new RegExp(k));
  assert.match(p, /invent/i);
  assert.match(p, /contrast/i);
});

test('buildPersonaPrompt: one given', () => {
  const p = L.buildPersonaPrompt('Topic', 'a grumpy pirate', '');
  assert.match(p, /a grumpy pirate/);
  assert.match(p, /invent/i);
  assert.match(p, /only/i);
});

test('buildPersonaPrompt: both given, no inventing', () => {
  const p = L.buildPersonaPrompt('Topic', 'pirate', 'ninja');
  assert.match(p, /pirate/);
  assert.match(p, /ninja/);
  assert.doesNotMatch(p, /invent/i);
});

test('normalizePersonas defaults', () => {
  for (const raw of [null, undefined, 'junk', 5, {}, { for: 3, against: [] }]) {
    const r = L.normalizePersonas(raw, '', '');
    assert.strictEqual(r.for.name, 'Debater For');
    assert.strictEqual(r.for.emoji, '🟦');
    assert.strictEqual(r.against.name, 'Debater Against');
    assert.strictEqual(r.against.emoji, '🟥');
    assert.strictEqual(typeof r.for.personality, 'string');
    assert.strictEqual(typeof r.against.personality, 'string');
  }
});

test('normalizePersonas valid, user text wins, caps, grapheme', () => {
  const raw = {
    for: { name: 'N'.repeat(100), emoji: '🦆🦆', personality: 'model for' },
    against: { name: ' Bob ', emoji: '', personality: 'model against' },
  };
  const r = L.normalizePersonas(raw, '', 'user against');
  assert.strictEqual(r.for.name.length, 40);
  assert.strictEqual(r.for.emoji, '🦆');
  assert.strictEqual(r.for.personality, 'model for');
  assert.strictEqual(r.against.name, 'Bob');
  assert.strictEqual(r.against.emoji, '🟥');
  assert.strictEqual(r.against.personality, 'user against');
});

test('normalizePersonas multi-codepoint grapheme and non-string fields', () => {
  const r = L.normalizePersonas({ for: { name: 5, emoji: '👨‍👩‍👧x', personality: null } }, 'mine', '');
  assert.strictEqual(r.for.emoji, '👨‍👩‍👧');
  assert.strictEqual(r.for.name, 'Mine');
  assert.strictEqual(r.for.personality, 'mine');
});

test('nameFromDescription: title-cased first words, article stripped, <=40 chars', () => {
  const n = L.nameFromDescription;
  assert.strictEqual(n('a grumpy 1800s pirate'), 'Grumpy 1800s Pirate');
  assert.strictEqual(n('  An   angry poet  '), 'Angry Poet');
  assert.strictEqual(n('The NASA engineer, very smart'), 'NASA Engineer');
  assert.strictEqual(n('a pirate who loves rum and also cats'), 'Pirate Who Loves Rum');
  assert.strictEqual(n('über-cool ninja'), 'Über-cool Ninja');
  assert.strictEqual(n('(pirate) yarr'), 'Pirate');
  assert.ok(n('Supercalifragilisticexpialidocious Mary Poppins Nanny').length <= 40);
  assert.strictEqual(n('x'.repeat(60)).length, 40);
  for (const blank of ['', '   ', 'a', 'The', '...', null, undefined]) assert.strictEqual(n(blank), '');
});

test('normalizePersonas: user text without model name gets a derived name and default emoji', () => {
  const r = L.normalizePersonas(null, 'a grumpy 1800s pirate', 'the cheerful robot');
  assert.deepStrictEqual([r.for.name, r.for.emoji], ['Grumpy 1800s Pirate', '🟦']);
  assert.deepStrictEqual([r.against.name, r.against.emoji], ['Cheerful Robot', '🟥']);
  assert.strictEqual(r.for.personality, 'a grumpy 1800s pirate');
  // a model-supplied name still wins
  assert.strictEqual(L.normalizePersonas({ for: { name: 'Cap\'n Grump' } }, 'a grumpy pirate', '').for.name, "Cap'n Grump");
  // underivable user text falls back to the default name
  assert.strictEqual(L.normalizePersonas(null, '...', '').for.name, 'Debater For');
});

const personas = {
  for: { name: 'Captain Crunch', emoji: '🦜', personality: 'a salty pirate' },
  against: { name: 'Sir Soup', emoji: '🍲', personality: 'a pompous knight' },
};

test('buildTurnPrompt opening, empty transcript', () => {
  const m = L.buildTurnPrompt(personas.for, 'for', 'Opening', 'Is cereal soup?', []);
  assert.ok(Array.isArray(m) && m.length >= 1);
  assert.strictEqual(m[m.length - 1].role, 'user');
  const all = m.map(x => x.content).join('\n');
  assert.match(all, /Captain Crunch/);
  assert.match(all, /a salty pirate/);
  assert.match(all, /FOR/);
  assert.match(all, /Is cereal soup\?/);
  assert.match(all, /Opening/);
  assert.match(all, /stay in character/i);
  assert.match(all, /120 words/);
  assert.match(all, /no headings or bullet lists/i);
  assert.doesNotMatch(all, /respond directly to your opponent/i);
  for (const x of m) assert.ok(['user', 'assistant'].includes(x.role));
});

test('buildTurnPrompt rebuttal includes transcript and directive', () => {
  const t = [
    { side: 'for', round: 'Opening', text: 'Cereal is obviously soup because MILKY.' },
    { side: 'against', round: 'Opening', text: 'Soup is hot, you fool.' },
  ];
  const m = L.buildTurnPrompt(personas.for, 'for', 'Rebuttal', 'Is cereal soup?', t);
  const all = m.map(x => x.content).join('\n');
  assert.match(all, /MILKY/);
  assert.match(all, /Soup is hot/);
  assert.match(all, /AGAINST|FOR/);
  assert.match(all, /respond directly to your opponent's specific points/i);
  assert.strictEqual(m[m.length - 1].role, 'user');
});

test('buildTurnPrompt uses persona names for speakers, against side, closing', () => {
  const t = [{ side: 'for', round: 'Opening', text: 'hello there' }];
  const m = L.buildTurnPrompt(personas.against, 'against', 'Closing', 'T', t, personas);
  const all = m.map(x => x.content).join('\n');
  assert.match(all, /arguing AGAINST/i);
  assert.match(all, /Captain Crunch/);
  assert.match(all, /respond directly to your opponent's specific points/i);
});

test('buildJudgePrompt', () => {
  const t = [{ side: 'for', round: 'Opening', text: 'unique-for-text' }, { side: 'against', round: 'Opening', text: 'unique-against-text' }];
  const p = L.buildJudgePrompt('Is cereal soup?', personas, t);
  assert.strictEqual(typeof p, 'string');
  assert.match(p, /weary Supreme Court justice/);
  assert.match(p, /Is cereal soup\?/);
  assert.match(p, /Captain Crunch/);
  assert.match(p, /Sir Soup/);
  assert.match(p, /unique-for-text/);
  assert.match(p, /unique-against-text/);
  for (const k of ['scores', 'logic', 'persuasion', 'character', 'winner', 'reasoning', 'tie']) assert.match(p, new RegExp(k));
  assert.match(p, /1.{1,4}10/);
  assert.match(p, /3 sentences/);
  assert.match(p, /JSON/);
});

test('normalizeVerdict happy path', () => {
  const v = L.normalizeVerdict({
    scores: { for: { logic: 8, persuasion: 7, character: 9 }, against: { logic: 5, persuasion: 6, character: 7 } },
    winner: 'for', reasoning: 'Because.',
  });
  assert.deepStrictEqual(v.totals, { for: 24, against: 18 });
  assert.strictEqual(v.winner, 'for');
  assert.strictEqual(v.reasoning, 'Because.');
  assert.deepStrictEqual(v.scores.for, { logic: 8, persuasion: 7, character: 9 });
});

test('normalizeVerdict coercion, clamp, derive winner', () => {
  const v = L.normalizeVerdict({
    scores: { for: { logic: '8', persuasion: 15, character: 0 }, against: { logic: 7.6, persuasion: '3', character: -4 } },
  });
  assert.deepStrictEqual(v.scores.for, { logic: 8, persuasion: 10, character: 1 });
  assert.deepStrictEqual(v.scores.against, { logic: 8, persuasion: 3, character: 1 });
  assert.deepStrictEqual(v.totals, { for: 19, against: 12 });
  assert.strictEqual(v.winner, 'for');
  assert.strictEqual(v.reasoning, '');
});

test('normalizeVerdict winner handling', () => {
  const s = { for: { logic: 5, persuasion: 5, character: 5 }, against: { logic: 9, persuasion: 9, character: 9 } };
  assert.strictEqual(L.normalizeVerdict({ scores: s, winner: 'banana' }).winner, 'against');
  // totals differ: they decide, even against a contradictory winner
  assert.strictEqual(L.normalizeVerdict({ scores: s, winner: 'tie' }).winner, 'against');
  assert.strictEqual(L.normalizeVerdict({ scores: s, winner: 'for' }).winner, 'against');
  const eq = { for: { logic: 5, persuasion: 5, character: 5 }, against: { logic: 5, persuasion: 5, character: 5 } };
  assert.strictEqual(L.normalizeVerdict({ scores: eq }).winner, 'tie');
  // equal totals: the judge's valid call breaks the tie
  assert.strictEqual(L.normalizeVerdict({ scores: eq, winner: 'against' }).winner, 'against');
  assert.strictEqual(L.normalizeVerdict({ scores: eq, winner: 'nope' }).winner, 'tie');
  assert.strictEqual(L.normalizeVerdict({ scores: eq, reasoning: 42 }).reasoning, '');
});

test('normalizeVerdict garbage -> null', () => {
  for (const raw of [null, undefined, 'x', 3, [], {}, { scores: 'a' }, { scores: { for: {} } },
    { scores: { for: { logic: 'a', persuasion: 1, character: 1 }, against: { logic: 1, persuasion: 1, character: 1 } } },
    { scores: { for: { logic: 1, persuasion: 1, character: 1 } } },
    { scores: { for: { logic: null, persuasion: 1, character: 1 }, against: { logic: 1, persuasion: 1, character: 1 } } },
  ]) assert.strictEqual(L.normalizeVerdict(raw), null);
});

test('review fix: cleanInput never leaves a lone surrogate at the cut', () => {
  const s = L.cleanInput('a'.repeat(199) + '😀tail', 200);
  assert.strictEqual(s, 'a'.repeat(199));
  assert.ok(!/[\uD800-\uDBFF]$/.test(s));
});

test('review fix: emoji must be an emoji; ZWJ, flags, skin tone, keycap kept whole', () => {
  const e = (x) => L.normalizePersonas({ for: { name: 'n', emoji: x } }, '', '').for.emoji;
  assert.strictEqual(e('👩‍⚖️'), '👩‍⚖️');
  assert.strictEqual(e('🇫🇷'), '🇫🇷');
  assert.strictEqual(e('👍🏽'), '👍🏽');
  assert.strictEqual(e('1️⃣'), '1️⃣');
  assert.strictEqual(e('Lawyer 👩‍⚖️'), '👩‍⚖️');
  assert.strictEqual(e('smile'), '🟦');
});

test('review fix: winner is case/space-insensitive', () => {
  const sc = { logic: 1, persuasion: 1, character: 1 };
  const v = L.normalizeVerdict({ scores: { for: sc, against: sc }, winner: ' For ' });
  assert.strictEqual(v.winner, 'for');
});

test('review fix: turn prompt has no double period and ends with a constraint reminder', () => {
  const m = L.buildTurnPrompt({ name: 'Bob', personality: 'grumpy.' }, 'against', 'Closing', 't', []);
  const c = m[m.length - 1].content;
  assert.ok(!c.includes('grumpy..'));
  const last = c.trim().split('\n').pop();
  assert.match(last, /Bob/);
  assert.match(last, /AGAINST/);
  assert.match(last, /120 words/);
});

test('final review: turn prompt bans markdown/name labels, names the opponent, pushes real rebuttal', () => {
  const t = [{ side: 'for', round: 'Opening', text: 'x' }, { side: 'against', round: 'Opening', text: 'y' }];
  const c = L.buildTurnPrompt(personas.for, 'for', 'Rebuttal', 'T', t, personas)[0].content;
  assert.match(c, /no markdown/i);
  assert.match(c, /do not start with your name/i);
  assert.match(c, /your opponent, Sir Soup, is arguing AGAINST/);
  assert.match(c, /say why they are wrong/i);
  assert.match(c, /do not just repeat/i);
  const o = L.buildTurnPrompt(personas.against, 'against', 'Opening', 'T', t.slice(0, 1), personas)[0].content;
  assert.match(o, /quick jab/);
  const first = L.buildTurnPrompt(personas.for, 'for', 'Opening', 'T', [], personas)[0].content;
  assert.doesNotMatch(first, /quick jab/);
});

test('final review: judge prompt example is valid JSON in range and ties winner to totals', () => {
  const p = L.buildJudgePrompt('T', personas, []);
  const ex = p.split('\n').find((l) => l.startsWith('{"scores"'));
  const j = JSON.parse(ex);
  const v = L.normalizeVerdict(j);
  assert.ok(v);
  for (const side of ['for', 'against']) for (const k of ['logic', 'persuasion', 'character']) assert.strictEqual(v.scores[side][k], j.scores[side][k]);
  assert.match(p, /higher total/);
  assert.match(p, /not which side you agree with/);
  assert.doesNotMatch(L.buildJudgePrompt('T', { for: { name: 'A' }, against: { name: 'B' } }, []), /\(\)/);
});


// ---- hosted voice casting (optional 4th argument; claude.ai never passes it) ----
const VOICES_ = [
  { key: 'callum', description: 'husky trickster' }, { key: 'lily', description: 'velvety actress' },
  { key: 'harry', description: 'fierce warrior' }, { key: 'bill', description: 'old judge', judge: true },
];
test('persona prompt without voices is unchanged (no voice key requested)', () => {
  const p = L.buildPersonaPrompt('t', '', '');
  assert.ok(!/voice/i.test(p));
  assert.strictEqual(p, L.buildPersonaPrompt('t', '', '', undefined));
  assert.strictEqual(p, L.buildPersonaPrompt('t', '', '', []));
});
test('persona prompt with voices lists castable keys (not the judge) and asks for a voice per debater', () => {
  const p = L.buildPersonaPrompt('t', '', '', VOICES_);
  assert.match(p, /- callum: husky trickster/);
  assert.match(p, /- harry: fierce warrior/);
  assert.ok(!/- bill:/.test(p));
  assert.match(p, /"voice":"<voice key>"/);
});
test('normalizePersonas without voices adds no voice field', () => {
  const r = L.normalizePersonas({ for: { name: 'A', voice: 'callum' }, against: { name: 'B' } }, '', '');
  assert.ok(!('voice' in r.for) && !('voice' in r.against));
});
test('normalizePersonas keeps valid distinct voice keys', () => {
  const r = L.normalizePersonas({ for: { name: 'A', voice: 'harry' }, against: { name: 'B', voice: 'lily' } }, '', '', VOICES_);
  assert.strictEqual(r.for.voice, 'harry'); assert.strictEqual(r.against.voice, 'lily');
});
test('normalizePersonas replaces invalid/missing/judge voices with distinct defaults; For differs from Against', () => {
  for (const raw of [null, {}, { for: { voice: 'nope' }, against: { voice: 7 } }, { for: { voice: 'bill' }, against: { voice: 'bill' } },
    { for: { voice: 'lily' }, against: { voice: 'lily' } }, { for: { voice: '__proto__' }, against: { voice: 'toString' } }]) {
    const r = L.normalizePersonas(raw, '', '', VOICES_);
    for (const side of ['for', 'against']) assert.ok(['callum', 'lily', 'harry'].includes(r[side].voice), JSON.stringify(raw));
    assert.notStrictEqual(r.for.voice, r.against.voice, JSON.stringify(raw));
  }
  const dup = L.normalizePersonas({ for: { voice: 'lily' }, against: { voice: 'lily' } }, '', '', VOICES_);
  assert.strictEqual(dup.for.voice, 'lily');
});
test('normalizePersonas with a single castable voice still returns it for both', () => {
  const r = L.normalizePersonas(null, 'a', 'b', [{ key: 'x', description: 'd' }]);
  assert.strictEqual(r.for.voice, 'x'); assert.strictEqual(r.against.voice, 'x');
});
test('persona prompt with both personas typed + voices: keeps user text, asks for a voice; without voices identical to the claude.ai prompt', () => {
  const p = L.buildPersonaPrompt('Cats', 'a grumpy pirate', 'a poet', VOICES_);
  assert.match(p, /FOR character \(given by the user\): a grumpy pirate/);
  assert.match(p, /only give this character a name and a single emoji \(and a voice, below\)\./);
  assert.match(p, /"voice":"<voice key>"/);
  const plain = L.buildPersonaPrompt('Cats', 'a grumpy pirate', 'a poet');
  assert.ok(!/voice/i.test(plain));
  assert.match(plain, /only give this character a name and a single emoji\.$/m);
  const r = L.normalizePersonas({ for: { name: 'Cap', personality: 'ignored', voice: 'harry' }, against: { name: 'Bard', voice: 'lily' } }, 'a grumpy pirate', 'a poet', VOICES_);
  assert.equal(r.for.personality, 'a grumpy pirate');
  assert.equal(r.for.voice, 'harry');
  assert.equal(r.against.voice, 'lily');
});
test('castable is exported and excludes the judge voice', () => {
  assert.deepEqual(L.castable(VOICES_).map((v) => v.key), VOICES_.filter((v) => !v.judge).map((v) => v.key));
  assert.deepEqual(L.castable(undefined), []);
});
