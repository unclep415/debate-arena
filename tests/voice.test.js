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

// ---- hosted engine delegation (globalThis.DebateHost, injected by the Worker on the hosted site only) ----
function fakeHost(over = {}) {
  const h = { calls: [], cancels: 0, primes: 0, enabled: true, results: [],
    speak(text, voice) { h.calls.push({ text, voice }); return Promise.resolve(h.results.length ? h.results.shift() : 'played'); },
    cancel() { h.cancels++; }, prime() { h.primes++; }, ttsEnabled() { return h.enabled; } };
  Object.assign(h, over);
  globalThis.DebateHost = h;
  return h;
}
const { afterEach } = require('node:test');
afterEach(() => { delete globalThis.DebateHost; });

test('host engine: speak with a voice key plays via DebateHost, no browser utterance', async () => {
  const h = fakeHost();
  await V.speak('Hello there.', 'for', { voice: 'callum' });
  assert.deepEqual(h.calls, [{ text: 'Hello there.', voice: 'callum' }]);
  assert.equal(utts.length, 0);
});

test('host engine: judge speaker defaults to the judge voice key', async () => {
  const h = fakeHost();
  await V.speak('Order.', 'judge');
  assert.equal(h.calls[0].voice, 'judge');
});

test('host engine: no voice key (or engine disabled) uses browser speech', async () => {
  const h = fakeHost();
  let p = V.speak('Plain.', 'for'); await tick();
  assert.equal(h.calls.length, 0); assert.equal(utts.length, 1); utts[0].onend({}); await p;
  h.enabled = false;
  p = V.speak('Off.', 'for', { voice: 'callum' }); await tick();
  assert.equal(h.calls.length, 0); assert.equal(utts.length, 2); utts[1].onend({}); await p;
});

test('host engine: long text is split into <=1400 char requests played in order', async () => {
  const h = fakeHost();
  const text = ('This is a sentence of moderate length. ').repeat(100);
  await V.speak(text, 'against', { voice: 'lily' });
  assert.ok(h.calls.length >= 3);
  h.calls.forEach((c) => assert.ok(c.text.length <= 1400));
  assert.equal(h.calls.map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim(), text.replace(/\s+/g, ' ').trim());
});

test('host engine: failed clip falls back to browser speech for the rest of the turn', async () => {
  const h = fakeHost();
  h.results = ['played', 'failed'];
  const text = ('Sentence number one is here. ').repeat(80);
  const p = V.speak(text, 'for', { voice: 'harry' });
  await tick(); await tick();
  assert.equal(h.calls.length, 2);
  assert.ok(utts.length >= 1, 'browser speech took over');
  assert.ok(utts[0].text.length > 0);
  const t = setInterval(() => { utts.forEach((u) => u.onend && u.onend({})); }, 2);
  await p; clearInterval(t);
});

test('host engine: speak never rejects when the host throws or rejects', async () => {
  fakeHost({ speak() { throw new Error('boom'); } });
  const p = V.speak('Hi.', 'for', { voice: 'callum' }); await tick();
  utts.forEach((u) => u.onend && u.onend({}));
  await p;
  fakeHost({ speak() { return Promise.reject(new Error('no')); } });
  const q = V.speak('Hi.', 'for', { voice: 'callum' }); await tick(); await tick();
  utts.forEach((u) => u.onend && u.onend({}));
  await q;
});

test('host engine: cancel stops the host and ends a pending speak; remaining chunks are not played', async () => {
  let release;
  const h = fakeHost({ speak(text, voice) { h.calls.push({ text, voice }); return new Promise((r) => { release = r; }); } });
  const p = V.speak(('A fairly long sentence goes here. ').repeat(80), 'for', { voice: 'callum' });
  await tick();
  V.cancel();
  assert.equal(h.cancels, 1);
  release('cancelled');
  await p;
  assert.equal(h.calls.length, 1);
  assert.equal(utts.length, 0);
});

test('host engine: prime primes the host audio inside the call and still primes browser speech', () => {
  const h = fakeHost();
  V.prime();
  assert.equal(h.primes, 1);
  assert.equal(utts.length, 1);
});

test('host engine: isSupported is true with only the host, false with nothing', () => {
  delete globalThis.speechSynthesis;
  assert.equal(V.isSupported(), false);
  fakeHost();
  assert.equal(V.isSupported(), true);
});
