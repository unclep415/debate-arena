const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const URL_ = pathToFileURL(path.join(__dirname, '..', 'src', 'index.html')).href;
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });

// Fake claude.sample + fake speechSynthesis. Tests end utterances via window.__end(i).
async function open(cfg = {}, viewport, existingCtx) {
  const ctx = existingCtx || await browser.newContext(viewport ? { viewport } : {});
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((cfg) => {
    window.__log = []; window.__utts = []; window.__cancels = 0; window.__samples = 0;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const sample = async (input, opts = {}) => {
      const idx = window.__samples++;
      window.__log.push('sample:' + idx);
      await sleep(10);
      const text = 'Turn ' + (idx + 1) + ' text.';
      if (opts.onText) opts.onText({ text, delta: text });
      return { text, truncated: false };
    };
    sample.json = async () => ({
      scores: { for: { logic: 8, persuasion: 7, character: 6 }, against: { logic: 5, persuasion: 5, character: 5 } },
      winner: 'for', reasoning: 'For was funnier. Case closed.',
    });
    window.claude = { use: () => sleep(10).then(() => sample) };
    if (cfg.noSpeech !== true) {
      window.SpeechSynthesisUtterance = function (t) { this.text = t; };
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: {
        getVoices: () => [],
        speak: (u) => {
          const i = window.__utts.length;
          window.__utts.push({ text: u.text, pitch: u.pitch, rate: u.rate, u, ended: false });
          window.__log.push('utt:' + i);
          if (cfg.auto) setTimeout(() => window.__end(i), 15);
        },
        cancel: () => { window.__cancels++; },
        addEventListener() {}, removeEventListener() {},
      } });
      window.__end = (i) => { const r = window.__utts[i]; if (!r.ended) { r.ended = true; window.__log.push('end:' + i); r.u.onend && r.u.onend({}); } };
    }
    else { delete window.SpeechSynthesisUtterance; Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: undefined }); }
    if (cfg.badStorage) {
      Object.defineProperty(window, 'localStorage', { get() { throw new Error('denied'); } });
    }
  }, cfg);
  await page.goto(URL_);
  return { page, ctx, errors };
}

async function start(page) {
  await page.fill('#topic', 'Cats vs dogs');
  await page.fill('#forPersona', 'A pirate');
  await page.fill('#againstPersona', 'A poet');
  await page.waitForSelector('#start:not([disabled])');
  await page.click('#start');
}
const over = (page) => page.waitForFunction(() => document.querySelector('.scorecard') && !document.querySelector('#stop:not([hidden])'));
const nUtts = (page) => page.evaluate(() => window.__utts.length);
const nSamples = (page) => page.evaluate(() => window.__samples);
const pressed = (page, sel) => page.getAttribute(sel, 'aria-pressed');

test('voice off by default: zero utterances, debate behaves as before', async () => {
  const { page, ctx, errors } = await open({ auto: true });
  assert.equal(await pressed(page, '#voiceSetup'), 'false');
  await start(page);
  await over(page);
  assert.equal(await nUtts(page), 0);
  assert.equal(await page.locator('.bubble').count(), 6);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('voice on: 7 utterances in order; next turn waits for the previous utterance to end', async () => {
  const { page, ctx, errors } = await open();
  await page.click('#voiceSetup');
  assert.equal(await pressed(page, '#voiceSetup'), 'true');
  await start(page);
  for (let n = 0; n < 7; n++) {
    await page.waitForFunction((n) => window.__utts.length === n + 1, n);
    await page.waitForTimeout(150);
    assert.equal(await nUtts(page), n + 1);
    if (n < 6) assert.equal(await nSamples(page), n + 1, 'turn ' + (n + 2) + ' must not start before utterance ' + n + ' ends');
    assert.match(await page.textContent('#status'), /speaking aloud/);
    await page.evaluate((n) => window.__end(n), n);
  }
  await over(page);
  const utts = await page.evaluate(() => window.__utts.map((u) => u.text));
  assert.deepEqual(utts.slice(0, 6), [1, 2, 3, 4, 5, 6].map((n) => 'Turn ' + n + ' text.'));
  assert.match(utts[6], /^Winner: Pirate\./);
  assert.match(utts[6], /For was funnier\. Case closed\./);
  const log = await page.evaluate(() => window.__log);
  for (let n = 0; n < 5; n++) assert.ok(log.indexOf('end:' + n) < log.indexOf('sample:' + (n + 1)));
  const pr = await page.evaluate(() => window.__utts.map((u) => u.pitch + '/' + u.rate));
  assert.notEqual(pr[0], pr[1]); assert.notEqual(pr[6], pr[0]); assert.notEqual(pr[6], pr[1]);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('toggling off mid-utterance cancels speech and the debate completes as text', async () => {
  const { page, ctx } = await open();
  await page.click('#voiceSetup');
  await start(page);
  await page.waitForFunction(() => window.__utts.length === 1);
  await page.click('#voiceArena');
  assert.equal(await pressed(page, '#voiceArena'), 'false');
  await over(page);
  assert.equal(await nUtts(page), 1);
  assert.ok(await page.evaluate(() => window.__cancels) >= 1);
  assert.equal(await page.locator('.bubble').count(), 6);
  await ctx.close();
});

test('Stop during speech cancels it and stops the debate', async () => {
  const { page, ctx } = await open();
  await page.click('#voiceSetup');
  await start(page);
  await page.waitForFunction(() => window.__utts.length === 1);
  await page.click('#stop');
  await page.waitForTimeout(200);
  assert.ok(await page.evaluate(() => window.__cancels) >= 1);
  assert.equal(await nSamples(page), 1);
  assert.equal(await nUtts(page), 1);
  assert.match(await page.textContent('#status'), /stopped/i);
  assert.equal(await page.locator('.scorecard').count(), 0);
  await ctx.close();
});

test('superseded run never speaks (Stop, New debate, Start while old speech pending)', async () => {
  const { page, ctx } = await open();
  await page.click('#voiceSetup');
  await start(page);
  await page.waitForFunction(() => window.__utts.length === 1);
  await page.click('#stop');
  await page.click('#newDebate');
  await page.click('#start');
  await page.waitForFunction(() => window.__utts.length === 2);
  await page.evaluate(() => window.__end(0)); // late end from the cancelled utterance
  await page.waitForTimeout(200);
  assert.equal(await nUtts(page), 2);
  assert.equal(await nSamples(page), 2);
  assert.equal(await page.evaluate(() => window.__utts[1].text), 'Turn 2 text.');
  await ctx.close();
});

test('New debate cancels speech', async () => {
  const { page, ctx } = await open();
  await page.click('#voiceSetup');
  await start(page);
  await page.waitForFunction(() => window.__utts.length === 1);
  const before = await page.evaluate(() => window.__cancels);
  await page.click('#stop');
  await page.click('#newDebate');
  assert.ok(await page.evaluate(() => window.__cancels) > before);
  await ctx.close();
});

test('no speechSynthesis: toggles hidden and debate works', async () => {
  const { page, ctx, errors } = await open({ noSpeech: true });
  assert.equal(await page.isVisible('#voiceSetup'), false);
  await start(page);
  await over(page);
  assert.equal(await page.isVisible('#voiceArena'), false);
  assert.equal(await page.locator('.bubble').count(), 6);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('storage throwing: page still works and toggle still toggles', async () => {
  const { page, ctx, errors } = await open({ badStorage: true, auto: true });
  await page.click('#voiceSetup');
  assert.equal(await pressed(page, '#voiceSetup'), 'true');
  await start(page);
  await over(page);
  assert.equal(await nUtts(page), 7);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('toggle state persists across reload and toggles stay in sync', async () => {
  const { page, ctx } = await open({ auto: true });
  await page.click('#voiceSetup');
  await start(page);
  assert.equal(await pressed(page, '#voiceArena'), 'true');
  await page.reload();
  assert.equal(await pressed(page, '#voiceSetup'), 'true');
  await page.click('#voiceSetup');
  await page.reload();
  assert.equal(await pressed(page, '#voiceSetup'), 'false');
  await ctx.close();
});

test('toggle uses text labels, not emoji-only, and is a real button', async () => {
  const { page, ctx } = await open();
  assert.equal(await page.$eval('#voiceSetup', (b) => b.tagName), 'BUTTON');
  assert.match(await page.textContent('#voiceSetup'), /Voice/);
  await ctx.close();
});

test('no horizontal scroll at 375px with voice toggles on both screens', async () => {
  const { page, ctx } = await open({ auto: true }, { width: 375, height: 700 });
  await page.click('#voiceSetup');
  const sw = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  assert.ok(await sw());
  await start(page);
  await over(page);
  assert.ok(await sw());
  await ctx.close();
});
