const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const V = require('../src/voice.js');

function voice(name, lang, extra = {}) { return Object.assign({ name, lang, default: false }, extra); }

// Fake speechSynthesis on globalThis; tests decide when utterances end.
let utts, cancels, voicesList;
function install() {
  utts = []; cancels = 0; voicesList = [];
  globalThis.SpeechSynthesisUtterance = function (t) { this.text = t; };
  globalThis.speechSynthesis = {
    getVoices: () => voicesList,
    speak: (u) => { utts.push(u); },
    cancel: () => { cancels++; },
    addEventListener() {}, removeEventListener() {},
  };
}
beforeEach(install);
const tick = () => new Promise((r) => setTimeout(r, 5));

test('isSupported reflects presence of speechSynthesis', () => {
  assert.equal(V.isSupported(), true);
  delete globalThis.speechSynthesis;
  assert.equal(V.isSupported(), false);
  install();
  delete globalThis.SpeechSynthesisUtterance;
  assert.equal(V.isSupported(), false);
});

test('assignVoices: prefers distinct voices matching the page language', () => {
  const vs = [voice('De1', 'de-DE'), voice('En1', 'en-US'), voice('En2', 'en-GB'), voice('En3', 'en_AU'), voice('Fr', 'fr-FR')];
  const a = V.assignVoices(vs, 'en-US');
  const names = [a.for.voice.name, a.against.voice.name, a.judge.voice.name];
  assert.deepEqual(names.slice().sort(), ['En1', 'En2', 'En3']);
  assert.equal(new Set(names).size, 3);
});

test('assignVoices: falls back to en, then to anything', () => {
  const a = V.assignVoices([voice('En1', 'en-US'), voice('En2', 'en-GB'), voice('En3', 'en-AU')], 'ja-JP');
  assert.ok(/^En/.test(a.for.voice.name));
  const b = V.assignVoices([voice('Only', 'de-DE')], 'ja-JP');
  assert.equal(b.for.voice.name, 'Only');
});

test('assignVoices: always distinct pitch/rate combos, judge low and slow', () => {
  for (const vs of [[], [voice('A', 'en-US')], [voice('A', 'en-US'), voice('B', 'en-US'), voice('C', 'en-US')]]) {
    const a = V.assignVoices(vs, 'en');
    const combos = ['for', 'against', 'judge'].map((k) => a[k].pitch + '/' + a[k].rate);
    assert.equal(new Set(combos).size, 3);
    assert.ok(a.judge.pitch < a.for.pitch && a.judge.pitch < a.against.pitch);
    assert.ok(a.judge.rate < a.for.rate && a.judge.rate < a.against.rate);
  }
});

test('assignVoices: no voices gives null voices; one voice is shared', () => {
  const a = V.assignVoices([], 'en');
  assert.equal(a.for.voice, null); assert.equal(a.judge.voice, null);
  const b = V.assignVoices([voice('A', 'en-US')], undefined);
  assert.equal(b.for.voice.name, 'A'); assert.equal(b.judge.voice.name, 'A');
});

test('assignVoices: pure (does not mutate input)', () => {
  const vs = [voice('A', 'en-US'), voice('B', 'en-US', { default: true })];
  const copy = JSON.stringify(vs);
  V.assignVoices(vs, 'en');
  assert.equal(JSON.stringify(vs), copy);
});

test('speak resolves on end and applies voice settings', async () => {
  let done = false;
  const p = V.speak('Hello there.', 'judge').then(() => { done = true; });
  await tick();
  assert.equal(utts.length, 1);
  assert.equal(utts[0].text, 'Hello there.');
  assert.ok(utts[0].pitch < 1);
  assert.equal(done, false);
  utts[0].onend({});
  await p;
  assert.equal(done, true);
});

test('speak resolves on error and never rejects', async () => {
  const p = V.speak('Oops.', 'for');
  await tick();
  utts[0].onerror({ error: 'synthesis-failed' });
  await p;
});

test('cancel resolves pending speak and calls speechSynthesis.cancel', async () => {
  let done = false;
  const p = V.speak('A long thing. And more.', 'for').then(() => { done = true; });
  await tick();
  V.cancel();
  await p;
  assert.equal(done, true);
  assert.ok(cancels >= 1);
  // late events from cancelled utterance are harmless and nothing further is spoken
  const n = utts.length;
  utts[0].onend && utts[0].onend({});
  await tick();
  assert.equal(utts.length, n);
});

test('long text is split into sentence-sized chunks; resolves once after the last', async () => {
  const sentence = 'This is a reasonably long sentence that goes on for a while. ';
  const text = sentence.repeat(12).trim();
  let resolved = 0;
  const p = V.speak(text, 'against').then(() => { resolved++; });
  let i = 0;
  while (true) {
    await tick();
    if (i >= utts.length) break;
    assert.equal(resolved, 0);
    assert.ok(utts[i].text.length <= 260, 'chunk too long: ' + utts[i].text.length);
    utts[i].onend({}); i++;
  }
  await p;
  assert.ok(utts.length > 1);
  assert.equal(resolved, 1);
  assert.equal(utts.map((u) => u.text).join(' ').replace(/\s+/g, ' '), text.replace(/\s+/g, ' '));
});

test('short text is a single utterance', async () => {
  const p = V.speak('Winner: Bob. Bob was funnier. Case closed.', 'judge');
  await tick();
  assert.equal(utts.length, 1);
  utts[0].onend({}); await p;
});

test('safety timeout resolves even if end never fires', async () => {
  const t0 = Date.now();
  await V.speak('Never ends.', 'for', { timeoutMs: 60 });
  assert.ok(Date.now() - t0 < 1000);
  assert.ok(cancels >= 1);
});

test('timeoutMs scales with word count and is generous', () => {
  assert.ok(V.timeoutMs('word '.repeat(100)) >= (100 / 2.5 + 5) * 1000);
  assert.ok(V.timeoutMs('hi') >= 5000);
});

test('speak resolves immediately when unsupported', async () => {
  delete globalThis.speechSynthesis;
  await V.speak('x', 'for');
});

test('speak resolves if speechSynthesis.speak throws', async () => {
  globalThis.speechSynthesis.speak = () => { throw new Error('nope'); };
  await V.speak('x', 'for');
});

test('empty text resolves without utterance', async () => {
  await V.speak('   ', 'for');
  assert.equal(utts.length, 0);
});

test('prime: resumes and speaks a silent empty utterance synchronously (gesture unlock)', () => {
  let resumed = 0;
  globalThis.speechSynthesis.resume = () => { resumed++; };
  V.prime();
  assert.equal(resumed, 1);
  assert.equal(utts.length, 1, 'must speak synchronously, not after an await');
  assert.equal(utts[0].text, '');
  assert.equal(utts[0].volume, 0);
  delete globalThis.speechSynthesis;
  V.prime(); // unsupported: no throw
});

test('voices that load late (voiceschanged) are used; empty list is not locked in', async () => {
  // voice.js registers its listener once per module; capture it whichever fake it was added to.
  const listeners = [];
  globalThis.speechSynthesis.addEventListener = (type, fn) => { if (type === 'voiceschanged') listeners.push(fn); };
  delete require.cache[require.resolve('../src/voice.js')];
  const V2 = require('../src/voice.js');
  let p = V2.speak('First.', 'for');
  await tick();
  assert.equal(utts[0].voice, undefined, 'no voices yet');
  utts[0].onend({}); await p;
  voicesList = [voice('Late', 'en-US')];
  listeners.forEach((fn) => fn());
  p = V2.speak('Second.', 'for');
  await tick();
  assert.equal(utts[1].voice && utts[1].voice.name, 'Late');
  utts[1].onend({}); await p;
});
