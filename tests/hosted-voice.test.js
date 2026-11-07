const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const SRC = path.join(__dirname, '..', 'src');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });

const VOICES = [
  { key: 'callum', label: 'Callum', description: 'husky trickster' }, { key: 'lily', label: 'Lily', description: 'velvety actress' },
  { key: 'harry', label: 'Harry', description: 'fierce warrior' }, { key: 'bill', label: 'Bill', description: 'old judge', judge: true },
];
const VERDICT = { scores: { for: { logic: 8, persuasion: 7, character: 6 }, against: { logic: 5, persuasion: 5, character: 5 } }, winner: 'for', reasoning: 'For won.' };
const PERSONAS = { for: { name: 'Gen For', emoji: '🦊', personality: 'sly', voice: 'harry' }, against: { name: 'Gen Against', emoji: '🐢', personality: 'slow', voice: 'lily' } };
const sse = (res, o) => res.write('data: ' + JSON.stringify(o) + '\n\n');

function wav(ms) { // 8 kHz 8-bit mono silence
  const n = Math.round(8 * ms), b = Buffer.alloc(44 + n, 0x80);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  return b;
}

// opts.tts: 'ok' | 500 | 'quota' | 'novoice' | 'unauth'; opts.clipMs
async function serve(opts = {}) {
  const st = { ttsBodies: [], sampleBodies: [], sampleN: 0, voicesReq: 0 };
  const server = http.createServer(async (req, res) => {
    const url = req.url.split('?')[0];
    const body = async () => { let b = ''; for await (const c of req) b += c; return b; };
    const json = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (url === '/api/session') return json(200, { ok: true });
    if (url === '/api/voices') { st.voicesReq++; return opts.novoices ? json(500, { code: 'unavailable', message: 'x' }) : json(200, { voices: VOICES }); }
    if (url === '/api/tts') {
      st.ttsBodies.push(JSON.parse(await body()));
      if (opts.tts === 500) return json(502, { code: 'unavailable', message: 'down' });
      if (opts.tts === 'quota') return json(429, { code: 'rate_limited', reason: 'quota', message: 'Premium voices are out of credits right now.' });
      if (opts.tts === 'daily') return json(429, { code: 'rate_limited', reason: 'daily', message: 'Daily premium-voice limit reached — try again tomorrow.' });
      if (opts.tts === 'busy') return json(503, { code: 'unavailable', message: 'The voice service is unavailable.' });
      if (opts.tts === 'novoice') return json(502, { code: 'voice_not_found', message: 'gone' });
      if (opts.tts === 'unauth') return json(401, { code: 'not_granted', message: 'x' });
      const data = wav(opts.clipMs || 150);
      res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': data.length });
      return res.end(data);
    }
    if (url === '/api/sample') {
      const b = JSON.parse(await body());
      st.sampleBodies.push(b);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (b.json) {
        sse(res, { done: true, json: /Supreme Court/.test(JSON.stringify(b.input)) ? VERDICT : PERSONAS });
        return res.end();
      }
      const n = st.sampleN++;
      const text = 'Turn ' + (n + 1) + ' text here.';
      sse(res, { delta: text }); sse(res, { done: true, text });
      return res.end();
    }
    const file = url === '/' ? '/index.html' : url;
    const fp = path.join(SRC, path.normalize(file));
    if (!fp.startsWith(SRC) || !fs.existsSync(fp)) { res.writeHead(404); return res.end(); }
    let data = fs.readFileSync(fp);
    if (file === '/index.html') data = Buffer.from(data.toString().replace(/<script\s+src=(["'])app\.js\1[^>]*>/, (m) => '<script src="hosted.js"></script>' + m));
    res.writeHead(200, { 'content-type': TYPES[path.extname(fp)] || 'text/plain' });
    res.end(data);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  st.url = 'http://127.0.0.1:' + server.address().port + '/';
  st.close = () => new Promise((r) => { server.closeAllConnections(); server.close(r); });
  return st;
}

async function open(opts = {}, viewport) {
  const st = await serve(opts);
  const ctx = await browser.newContext(viewport ? { viewport } : {});
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__gesture = false; window.__plays = []; window.__utts = []; window.__cancels = 0; window.__els = [];
    window.addEventListener('click', () => { window.__gesture = true; setTimeout(() => { window.__gesture = false; }, 0); }, true);
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      window.__plays.push({ gesture: window.__gesture, silent: /^data:/.test(this.src) });
      if (window.__els.indexOf(this) < 0) window.__els.push(this);
      return play.apply(this, arguments);
    };
    window.SpeechSynthesisUtterance = function (t) { this.text = t; };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [], resume() {}, addEventListener() {}, removeEventListener() {},
      speak: (u) => { if (u.text === '') return; window.__utts.push(u.text); setTimeout(() => u.onend && u.onend({}), 15); },
      cancel: () => { window.__cancels++; },
    } });
  });
  await page.goto(st.url);
  st.page = page; st.errors = errors;
  st.close2 = st.close;
  st.close = async () => { await ctx.close(); await st.close2(); };
  return st;
}
const start = async (page, both = false) => {
  await page.fill('#topic', 'Cats vs dogs');
  if (both) { await page.fill('#forPersona', 'A pirate'); await page.fill('#againstPersona', 'A poet'); }
  await page.waitForSelector('#start:not([disabled])');
  await page.click('#start');
};
const over = (page) => page.waitForFunction(() => document.querySelector('.scorecard') && !document.querySelector('#stop:not([hidden])'), null, { timeout: 20000 });
const utts = (page) => page.evaluate(() => window.__utts);

test('voice off by default: no /api/tts calls, no audio', async () => {
  const st = await open();
  await start(st.page);
  await over(st.page);
  assert.equal(st.ttsBodies.length, 0);
  assert.equal(await st.page.evaluate(() => window.__plays.length), 0);
  assert.deepEqual(st.errors, []);
  await st.close();
});

test('voice on: persona prompt lists voices; 7 clips in order with each persona\'s voice; judge uses the judge voice; no browser speech', async () => {
  const st = await open({ clipMs: 700 });
  const { page } = st;
  await page.click('#voiceSetup');
  await start(page);
  await page.waitForFunction(() => window.__plays.filter((p) => !p.silent).length === 1);
  await page.waitForTimeout(250);
  assert.equal(st.sampleBodies.filter((b) => !b.json).length, 1, 'turn 2 must wait for clip 1 to finish');
  assert.match(st.sampleBodies[0].input, /- callum: husky trickster/);
  assert.ok(!/- bill:/.test(st.sampleBodies[0].input), 'judge voice is not offered for casting');
  await over(page);
  assert.deepEqual(st.ttsBodies.map((b) => b.voice), ['harry', 'lily', 'harry', 'lily', 'harry', 'lily', 'judge']);
  assert.deepEqual(st.ttsBodies.slice(0, 6).map((b) => b.text), [1, 2, 3, 4, 5, 6].map((n) => 'Turn ' + n + ' text here.'));
  assert.match(st.ttsBodies[6].text, /^Winner: Gen For\. For won\./);
  assert.deepEqual(await utts(page), []);
  assert.deepEqual(st.errors, []);
  await st.close();
});

test('user-written personas (voice on): Claude still casts fitting voices; typed text stays the personality; debateStart on that call', async () => {
  const st = await open();
  const { page } = st;
  await page.click('#voiceSetup');
  await start(page, true);
  await over(page);
  const v = st.ttsBodies.map((b) => b.voice);
  assert.deepEqual(v, ['harry', 'lily', 'harry', 'lily', 'harry', 'lily', 'judge']);
  const p = st.sampleBodies[0];
  assert.equal(p.json, true);
  assert.match(p.input, /FOR character \(given by the user\): A pirate/);
  assert.match(p.input, /AGAINST character \(given by the user\): A poet/);
  assert.match(p.input, /- callum: husky trickster/);
  assert.deepEqual(st.sampleBodies.map((b) => !!b.debateStart), [true, false, false, false, false, false, false, false]);
  assert.equal(st.sampleBodies.filter((b) => b.json).length, 2, 'persona call + judge call');
  assert.equal(await page.textContent('.bubble[data-side="for"] .name'), 'Gen For');
  assert.deepEqual(st.errors, []);
  await st.close();
});

test('user-written personas (voice off): no persona call; first turn carries debateStart', async () => {
  const st = await open();
  const { page } = st;
  await start(page, true);
  await over(page);
  assert.equal(st.sampleBodies.filter((b) => b.json).length, 1, 'only the judge call');
  assert.equal(st.sampleBodies[0].json, undefined);
  assert.deepEqual(st.sampleBodies.map((b) => !!b.debateStart), [true, false, false, false, false, false, false]);
  assert.equal(await page.textContent('.bubble[data-side="for"] .name'), 'Pirate');
  await st.close();
});

test('TTS transient 503 (upstream 429 busy): falls back per turn only, ElevenLabs retried every turn', async () => {
  const st = await open({ tts: 'busy' });
  const { page } = st;
  await page.click('#voiceSetup');
  await start(page);
  await over(page);
  assert.equal(st.ttsBodies.length, 7);
  assert.equal((await utts(page)).length, 7);
  assert.equal(await page.evaluate(() => globalThis.DebateHost.ttsEnabled()), true);
  await st.close();
});

test('prime: the Start/toggle click unlocks the audio element with a silent clip inside the gesture', async () => {
  const st = await open();
  const { page } = st;
  await page.click('#voiceSetup');
  const plays = await page.evaluate(() => window.__plays);
  assert.equal(plays.length, 1);
  assert.deepEqual(plays[0], { gesture: true, silent: true });
  await st.close();
});

test('Stop cancels playback immediately and ends the debate', async () => {
  const st = await open({ clipMs: 5000 });
  const { page } = st;
  await page.click('#voiceSetup');
  await start(page);
  await page.waitForFunction(() => window.__els.some((a) => !a.paused && !/^data:/.test(a.src)));
  await page.click('#stop');
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.__els.every((a) => a.paused)), true);
  assert.equal(st.sampleBodies.filter((b) => !b.json).length, 1);
  assert.match(await page.textContent('#status'), /stopped/i);
  assert.equal(st.ttsBodies.length, 1);
  await page.waitForTimeout(300);
  assert.equal(st.ttsBodies.length, 1);
  await st.close();
});

test('New debate after Stop: late clip of the old run never plays', async () => {
  const st = await open({ clipMs: 3000 });
  const { page } = st;
  await page.click('#voiceSetup');
  await start(page);
  await page.waitForFunction(() => window.__els.some((a) => !a.paused && !/^data:/.test(a.src)));
  await page.click('#stop');
  await page.click('#newDebate');
  assert.equal(await page.evaluate(() => window.__els.every((a) => a.paused)), true);
  await st.close();
});

test('TTS 500: that turn falls back to browser speech, every turn still tries ElevenLabs, debate completes', async () => {
  const st = await open({ tts: 500 });
  const { page } = st;
  await page.click('#voiceSetup');
  await start(page);
  await over(page);
  assert.equal(st.ttsBodies.length, 7);
  const u = await utts(page);
  assert.equal(u.length, 7);
  assert.equal(u[0], 'Turn 1 text here.');
  assert.deepEqual(st.errors, []);
  await st.close();
});

for (const mode of ['quota', 'daily', 'novoice']) {
  test('TTS ' + mode + ': falls back seamlessly and ElevenLabs is skipped for the rest of the page session', async () => {
    const st = await open({ tts: mode });
    const { page } = st;
    await page.click('#voiceSetup');
    await start(page);
    await over(page);
    assert.equal(st.ttsBodies.length, 1);
    assert.equal((await utts(page)).length, 7);
    assert.equal(await page.locator('.bubble').count(), 6);
    // a second debate does not retry ElevenLabs and no longer asks Claude for voice keys
    await page.click('#newDebate');
    await start(page);
    await over(page);
    assert.equal(st.ttsBodies.length, 1);
    assert.ok(!/- callum:/.test(st.sampleBodies[st.sampleBodies.length - 8].input || ''));
    assert.deepEqual(st.errors, []);
    await st.close();
  });
}

test('TTS 401 (session) falls back for the turn without a passcode prompt', async () => {
  const st = await open({ tts: 'unauth' });
  const { page } = st;
  await page.click('#voiceSetup');
  await start(page);
  await over(page);
  assert.equal((await utts(page)).length, 7);
  assert.equal(await page.locator('#passcodeScreen').count(), 0);
  await st.close();
});

test('voices list unavailable: casting has no voice keys, debaters use browser speech (judge keeps the judge voice)', async () => {
  const st = await open({ novoices: true });
  const { page } = st;
  await page.click('#voiceSetup');
  await start(page);
  await over(page);
  assert.deepEqual(st.ttsBodies.map((b) => b.voice), ['judge']);
  assert.equal((await utts(page)).length, 6);
  assert.ok(!/voice key/.test(st.sampleBodies[0].input));
  await st.close();
});

test('no horizontal scroll at 375px with voice on', async () => {
  const st = await open({}, { width: 375, height: 700 });
  const { page } = st;
  await page.click('#voiceSetup');
  await start(page);
  await over(page);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await st.close();
});
