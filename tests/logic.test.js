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
  assert.strictEqual(r.for.name, 'Debater For');
  assert.strictEqual(r.for.personality, 'mine');
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
  assert.strictEqual(L.normalizeVerdict({ scores: s, winner: 'tie' }).winner, 'tie');
  assert.strictEqual(L.normalizeVerdict({ scores: s, winner: 'for' }).winner, 'for');
  const eq = { for: { logic: 5, persuasion: 5, character: 5 }, against: { logic: 5, persuasion: 5, character: 5 } };
  assert.strictEqual(L.normalizeVerdict({ scores: eq }).winner, 'tie');
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
  const v = L.normalizeVerdict({ scores: { for: sc, against: { logic: 9, persuasion: 9, character: 9 } }, winner: ' For ' });
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
