const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const URL_ = pathToFileURL(path.join(__dirname, '..', 'src', 'index.html')).href;
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });

// cfg is serialized into the page. Functions are passed as source strings.
async function open(cfg = {}, viewport) {
  const ctx = await browser.newContext(viewport ? { viewport } : {});
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((cfg) => {
    window.__calls = [];
    window.__cfg = cfg;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const sample = async (input, opts = {}) => {
      const idx = window.__calls.filter((c) => c.kind === 'sample').length;
      window.__calls.push({ kind: 'sample', input });
      const text = cfg.textFor ? new Function('i', 'return (' + cfg.textFor + ')(i)')(idx) : 'Turn ' + (idx + 1) + ' text';
      const half = Math.ceil(text.length / 2);
      const abortErr = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
      if (opts.signal && opts.signal.aborted) throw abortErr();
      await sleep(cfg.delay || 10);
      if (opts.onText) opts.onText({ text: text.slice(0, half), delta: text.slice(0, half) });
      if (cfg.hangAt === idx) {
        await new Promise((_, rej) => opts.signal && opts.signal.addEventListener('abort', () => rej(abortErr())));
      }
      await sleep(cfg.delay || 10);
      if (opts.signal && opts.signal.aborted) throw abortErr();
      if (opts.onText) opts.onText({ text, delta: text.slice(half) });
      return { text, truncated: false };
    };
    sample.json = async (input, opts = {}) => {
      window.__calls.push({ kind: 'json', input });
      await sleep(cfg.delay || 10);
      return {
        for: { name: 'Gen For', emoji: '🦊', personality: 'sly' },
        against: { name: 'Gen Against', emoji: '🐢', personality: 'slow' },
      };
    };
    window.claude = {
      use: (name) => sleep(cfg.useDelay || 20).then(() => (cfg.useNull ? null : sample)),
    };
  }, cfg);
  await page.goto(URL_);
  return { page, ctx, errors };
}

const calls = (page, kind) => page.evaluate((k) => window.__calls.filter((c) => !k || c.kind === k).length, kind);

async function fillAndStart(page, { topic = 'Cats vs dogs', f = 'A pirate', a = 'A poet' } = {}) {
  await page.fill('#topic', topic);
  await page.fill('#forPersona', f);
  await page.fill('#againstPersona', a);
  await page.waitForSelector('#start:not([disabled])');
  await page.click('#start');
}

test('start is disabled while topic blank and enabled once typed', async () => {
  const { page, ctx } = await open();
  await page.waitForSelector('#start:not([disabled]) , #start[disabled]');
  await page.fill('#topic', '   ');
  await page.waitForTimeout(100);
  assert.equal(await page.isDisabled('#start'), true);
  await page.fill('#topic', 'Pineapple');
  await page.waitForSelector('#start:not([disabled])');
  await ctx.close();
});

test('start shows connecting while use() pending', async () => {
  const { page, ctx } = await open({ useDelay: 400 });
  await page.fill('#topic', 'Pineapple');
  assert.match(await page.textContent('#start'), /connecting/i);
  assert.equal(await page.isDisabled('#start'), true);
  await page.waitForSelector('#start:not([disabled])');
  assert.doesNotMatch(await page.textContent('#start'), /connecting/i);
  await ctx.close();
});

test('dice fills the topic', async () => {
  const { page, ctx } = await open();
  await page.click('#dice');
  assert.ok((await page.inputValue('#topic')).length > 3);
  await ctx.close();
});

test('use() null shows banner and keeps Start disabled', async () => {
  const { page, ctx } = await open({ useNull: true });
  await page.waitForFunction(() => /isn't available in this view/.test(document.body.textContent));
  await page.fill('#topic', 'Pineapple');
  assert.equal(await page.isDisabled('#start'), true);
  await ctx.close();
});

test('happy path: 6 bubbles in order and sides, no persona call', async () => {
  const { page, ctx, errors } = await open();
  await fillAndStart(page);
  await page.waitForFunction(() => document.querySelectorAll('.bubble').length === 6 && !document.querySelector('#stop:not([hidden])'));
  const info = await page.$$eval('.bubble', (bs) => bs.map((b) => [b.dataset.side, b.dataset.round, b.querySelector('.text').textContent]));
  assert.deepEqual(info.map((x) => x[0]), ['for', 'against', 'for', 'against', 'for', 'against']);
  assert.deepEqual(info.map((x) => x[1]), ['Opening', 'Opening', 'Rebuttal', 'Rebuttal', 'Closing', 'Closing']);
  assert.deepEqual(info.map((x) => x[2]), [1, 2, 3, 4, 5, 6].map((n) => 'Turn ' + n + ' text'));
  assert.equal(await calls(page, 'json'), 0);
  assert.equal(await calls(page, 'sample'), 6);
  // layout: For left of Against
  const xs = await page.$$eval('.bubble', (bs) => bs.slice(0, 2).map((b) => b.getBoundingClientRect().left));
  assert.ok(xs[0] < xs[1]);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('turn 3 prompt contains earlier turns; under the hood is collapsed', async () => {
  const { page, ctx } = await open();
  await fillAndStart(page);
  await page.waitForFunction(() => document.querySelectorAll('.bubble').length === 6);
  await page.waitForFunction(() => !document.querySelector('#stop:not([hidden])'));
  const open_ = await page.$$eval('.bubble details', (ds) => ds.map((d) => d.open));
  assert.ok(open_.every((o) => o === false));
  const hood = await page.$eval('.bubble:nth-of-type(3) details', (d) => d.textContent);
  assert.match(hood, /Turn 1 text/);
  assert.match(hood, /Turn 2 text/);
  assert.match(hood, /user/);
  assert.match(hood, /A pirate/);
  await ctx.close();
});

test('speakers are named from personas (generated names)', async () => {
  const { page, ctx } = await open();
  await fillAndStart(page, { f: '', a: 'A poet' });
  await page.waitForFunction(() => document.querySelectorAll('.bubble').length === 6);
  await page.waitForFunction(() => !document.querySelector('#stop:not([hidden])'));
  const hood = await page.$eval('.bubble:nth-of-type(2) details', (d) => d.textContent);
  assert.match(hood, /Gen For \(FOR/);
  await ctx.close();
});

test('both personas given: zero json calls; one blank: exactly one', async () => {
  let r = await open();
  await fillAndStart(r.page);
  await r.page.waitForSelector('.bubble');
  assert.equal(await calls(r.page, 'json'), 0);
  await r.ctx.close();
  r = await open();
  await fillAndStart(r.page, { f: '', a: 'A poet' });
  await r.page.waitForFunction(() => document.querySelectorAll('.bubble').length === 6);
  assert.equal(await calls(r.page, 'json'), 1);
  await r.ctx.close();
});

test('model text with HTML renders literally', async () => {
  const { page, ctx } = await open({ textFor: '(i) => i === 0 ? "<img src=x onerror=window.__pwn=1> hi" : "ok"' });
  await fillAndStart(page);
  await page.waitForFunction(() => document.querySelectorAll('.bubble').length === 6);
  const t = await page.$eval('.bubble .text', (e) => e.textContent);
  assert.match(t, /<img src=x onerror/);
  assert.equal(await page.$$eval('.bubble img', (x) => x.length), 0);
  assert.equal(await page.evaluate(() => window.__pwn), undefined);
  await ctx.close();
});

test('inputs disabled during debate; double-click Start starts one debate', async () => {
  const { page, ctx } = await open({ delay: 40 });
  await page.fill('#topic', 'Pineapple');
  await page.waitForSelector('#start:not([disabled])');
  await page.dblclick('#start');
  await page.waitForSelector('.bubble');
  assert.equal(await page.isDisabled('#topic'), true);
  assert.equal(await page.isDisabled('#forPersona'), true);
  assert.equal(await page.isDisabled('#dice'), true);
  await page.waitForFunction(() => document.querySelectorAll('.bubble').length === 6 && !document.querySelector('#stop:not([hidden])'));
  assert.equal(await calls(page, 'sample'), 6);
  assert.equal(await calls(page, 'json'), 1);
  await ctx.close();
});

test('stop mid-turn: no further calls, no verdict, New debate keeps inputs', async () => {
  const { page, ctx, errors } = await open({ hangAt: 1 });
  await fillAndStart(page, { topic: 'Stop me' });
  await page.waitForFunction(() => window.__calls.length === 2);
  await page.click('#stop');
  await page.waitForSelector('#newDebate:not([hidden])');
  await page.waitForTimeout(200);
  assert.equal(await calls(page, 'sample'), 2);
  assert.match(await page.textContent('#status'), /stopped/i);
  assert.equal(await page.$$eval('.scorecard', (x) => x.length), 0);
  assert.equal(await page.isHidden('#stop'), true);
  await page.click('#newDebate');
  assert.equal(await page.isVisible('#start'), true);
  assert.equal(await page.inputValue('#topic'), 'Stop me');
  assert.equal(await page.inputValue('#forPersona'), 'A pirate');
  assert.equal(await page.isDisabled('#topic'), false);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('no horizontal scroll at 375px, even with a long unbroken word', async () => {
  const { page, ctx } = await open({ textFor: '(i) => "x".repeat(300) + " word"' }, { width: 375, height: 700 });
  await fillAndStart(page);
  await page.waitForFunction(() => document.querySelectorAll('.bubble').length === 6);
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  assert.ok(w[0] <= w[1], JSON.stringify(w));
  await ctx.close();
});
