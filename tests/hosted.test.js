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

const VERDICT = { scores: { for: { logic: 8, persuasion: 7, character: 6 }, against: { logic: 5, persuasion: 5, character: 5 } }, winner: 'for', reasoning: 'For won.' };
const PERSONAS = { for: { name: 'Gen For', emoji: '🦊', personality: 'sly' }, against: { name: 'Gen Against', emoji: '🐢', personality: 'slow' } };
const sse = (res, o) => res.write('data: ' + JSON.stringify(o) + '\n\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fake hosted server: static src/ with hosted.js injected like worker/inject.js, plus /api/*.
async function serve(opts = {}) {
  const st = { authed: !!opts.authed, sessionPosts: [], sampleBodies: [], aborted: 0, sampleN: 0 };
  const server = http.createServer(async (req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/api/session') {
      if (req.method === 'GET') {
        res.writeHead(st.authed ? 200 : 401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(st.authed ? { ok: true } : { code: 'not_granted', message: 'x' }));
      }
      let b = ''; for await (const c of req) b += c;
      const { passcode } = JSON.parse(b);
      st.sessionPosts.push(passcode);
      const ok = passcode === 'open-sesame';
      if (ok) st.authed = true;
      res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(ok ? { ok: true } : { code: 'bad_passcode', message: 'Wrong passcode.' }));
    }
    if (url === '/api/sample') {
      let b = ''; for await (const c of req) b += c;
      const body = JSON.parse(b);
      st.sampleBodies.push(body);
      const n = st.sampleN++;
      res.on('close', () => { if (!res.writableEnded) st.aborted++; });
      if (!st.authed) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"code":"not_granted","message":"no"}'); }
      if (opts.cap && body.debateStart) { res.writeHead(429, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ code: 'rate_limited', message: 'Daily debate limit reached — try again tomorrow.' })); }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (body.json) {
        const isJudge = /Supreme Court/.test(JSON.stringify(body.input));
        sse(res, { done: true, json: isJudge ? VERDICT : PERSONAS });
        return res.end();
      }
      if (opts.errorAt === n) { sse(res, { delta: 'part' }); sse(res, { error: { code: 'unavailable', message: 'Down.' } }); return res.end(); }
      const text = 'Turn ' + (n + 1) + ' text here';
      const mid = Math.floor(text.length / 2);
      sse(res, { delta: text.slice(0, mid) });
      if (opts.hang) await new Promise((r) => { res.on('close', r); }); else await sleep(60);
      if (res.destroyed) return;
      sse(res, { delta: text.slice(mid) });
      sse(res, { done: true, text });
      return res.end();
    }
    let file = url === '/' ? '/index.html' : url;
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
  await page.goto(st.url);
  st.page = page; st.errors = errors;
  const orig = st.close;
  st.close = async () => { await ctx.close(); await orig(); };
  return st;
}
const startDebate = async (page, both = true) => {
  await page.fill('#topic', 'Cats vs dogs');
  if (both) { await page.fill('#forPersona', 'A pirate'); await page.fill('#againstPersona', 'A poet'); }
  await page.waitForSelector('#start:not([disabled])');
  await page.click('#start');
};

test('unauthenticated: passcode screen appears, focused, labelled, Start disabled behind it', async () => {
  const st = await open();
  const { page } = st;
  await page.waitForSelector('#passcodeScreen:not([hidden])');
  const input = page.locator('#passcodeScreen input[type=password]');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.type), 'password');
  assert.ok(await page.locator('#passcodeScreen label').count() >= 1);
  const labelFor = await page.$eval('#passcodeScreen label', (l) => l.htmlFor);
  assert.equal(labelFor, await input.getAttribute('id'));
  assert.equal(await page.locator('#passcodeScreen button').textContent(), 'Enter');
  assert.equal(await page.isDisabled('#start'), true);
  assert.deepEqual(st.errors, []);
  await st.close();
});

test('wrong passcode shows error, right passcode dismisses and enables Start', async () => {
  const st = await open();
  const { page } = st;
  await page.waitForSelector('#passcodeScreen:not([hidden])');
  await page.fill('#passcodeScreen input', 'nope');
  await page.press('#passcodeScreen input', 'Enter');
  await page.waitForFunction(() => /Wrong passcode/.test(document.querySelector('#passcodeScreen').textContent));
  assert.equal(await page.isVisible('#passcodeScreen'), true);
  assert.equal(await page.evaluate(() => document.activeElement.type), 'password');
  await page.fill('#passcodeScreen input', 'open-sesame');
  await page.click('#passcodeScreen button');
  await page.waitForSelector('#passcodeScreen', { state: 'hidden' });
  await page.fill('#topic', 'x');
  await page.waitForSelector('#start:not([disabled])');
  assert.deepEqual(st.sessionPosts, ['nope', 'open-sesame']);
  assert.deepEqual(st.errors, []);
  await st.close();
});

test('already authed: no passcode screen; full debate streams through adapter, debateStart only once', async () => {
  const st = await open({ authed: true });
  const { page } = st;
  await startDebate(page, true);
  await page.waitForFunction(() => document.querySelectorAll('.bubble').length === 6 && !document.querySelector('#stop:not([hidden])'), null, { timeout: 15000 });
  const texts = await page.$$eval('.bubble .text', (t) => t.map((x) => x.textContent));
  assert.deepEqual(texts, [1, 2, 3, 4, 5, 6].map((n) => 'Turn ' + n + ' text here'));
  assert.ok(await page.locator('.scorecard, #arena').count());
  assert.equal(await page.isVisible('#passcodeScreen').catch(() => false), false);
  assert.deepEqual(st.sampleBodies.map((b) => !!b.debateStart), [true, false, false, false, false, false, false]);
  assert.equal(st.sampleBodies[6].json, true);
  assert.deepEqual(st.errors, []);
  await st.close();
});

test('personas generated: debateStart on the persona call only', async () => {
  const st = await open({ authed: true });
  await startDebate(st.page, false);
  await st.page.waitForFunction(() => document.querySelectorAll('.bubble').length === 6 && !document.querySelector('#stop:not([hidden])'), null, { timeout: 15000 });
  assert.equal(st.sampleBodies[0].json, true);
  assert.deepEqual(st.sampleBodies.map((b) => !!b.debateStart), [true, false, false, false, false, false, false, false]);
  await st.close();
});

test('streaming: partial text visible before the turn completes', async () => {
  const st = await open({ authed: true, hang: true });
  await startDebate(st.page, true);
  await st.page.waitForFunction(() => { const t = document.querySelector('.bubble .text'); return t && /Turn 1/.test(t.textContent); });
  assert.notEqual(await st.page.textContent('.bubble .text'), 'Turn 1 text here');
  await st.close();
});

test('Stop aborts the fetch and ends the debate', async () => {
  const st = await open({ authed: true, hang: true });
  const { page } = st;
  await startDebate(page, true);
  await page.waitForFunction(() => { const t = document.querySelector('.bubble .text'); return t && t.textContent.length > 0; });
  await page.click('#stop');
  await page.waitForFunction(() => /Debate stopped/.test(document.querySelector('#status').textContent));
  await page.waitForFunction(() => !document.querySelector('#newDebate').hidden);
  for (let i = 0; i < 40 && !st.aborted; i++) await sleep(50);
  assert.ok(st.aborted >= 1);
  assert.deepEqual(st.errors, []);
  await st.close();
});

test('daily cap 429 shows the friendly message', async () => {
  const st = await open({ authed: true, cap: true });
  const { page } = st;
  await startDebate(page, true);
  await page.waitForFunction(() => /Daily debate limit reached — try again tomorrow\./.test(document.body.textContent));
  assert.doesNotMatch(await page.textContent('body'), /rate limited right now/);
  await st.close();
});

test('daily cap on persona call shows the friendly message too', async () => {
  const st = await open({ authed: true, cap: true });
  await startDebate(st.page, false);
  await st.page.waitForFunction(() => /Daily debate limit reached/.test(document.querySelector('#banner').textContent));
  await st.close();
});

test('server error line mid-turn: cut off + retry UI works with partial text', async () => {
  const st = await open({ authed: true, errorAt: 0 });
  const { page } = st;
  await startDebate(page, true);
  await page.waitForSelector('.cutoff');
  assert.match(await page.textContent('.bubble .text'), /^part/);
  await page.getByRole('button', { name: /Retry this turn/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.bubble').length === 6 && !document.querySelector('#stop:not([hidden])'), null, { timeout: 15000 });
  // retry of turn 1 must not count the debate twice
  assert.equal(st.sampleBodies.filter((b) => b.debateStart).length, 1);
  await st.close();
});

test('401 mid-session re-shows the passcode screen and is retryable, not permanent', async () => {
  const st = await open({ authed: true });
  const { page } = st;
  st.authed = false;
  // session was valid on load; cookie now invalid
  await startDebate(page, true);
  await page.waitForSelector('#passcodeScreen:not([hidden])');
  await page.fill('#passcodeScreen input', 'open-sesame');
  await page.press('#passcodeScreen input', 'Enter');
  await page.waitForSelector('#passcodeScreen', { state: 'hidden' });
  await page.waitForSelector('.cutoff');
  assert.doesNotMatch(await page.textContent('body'), /Permission was declined/);
  await page.getByRole('button', { name: /Retry this turn/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.bubble').length === 6 && !document.querySelector('#stop:not([hidden])'), null, { timeout: 15000 });
  await st.close();
});

test('passcode screen: no horizontal scroll at 375px, dark mode tokens, textContent only', async () => {
  const st = await open({}, { width: 375, height: 700 });
  const { page } = st;
  await page.waitForSelector('#passcodeScreen:not([hidden])');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  const bg = await page.$eval('#passcodeScreen', (e) => getComputedStyle(e).backgroundColor);
  await page.emulateMedia({ colorScheme: 'dark' });
  const bg2 = await page.$eval('#passcodeScreen', (e) => getComputedStyle(e).backgroundColor);
  assert.notEqual(bg, bg2);
  const src = fs.readFileSync(path.join(SRC, 'hosted.js'), 'utf8');
  assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|document\.write/);
  await st.close();
});

test('index.html never references hosted.js', () => {
  assert.doesNotMatch(fs.readFileSync(path.join(SRC, 'index.html'), 'utf8'), /hosted\.js/);
});
