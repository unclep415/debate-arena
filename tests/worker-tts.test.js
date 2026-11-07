const test = require("node:test");
const assert = require("node:assert");

const loadTts = () => import("../worker/tts.js");
const loadVoices = () => import("../worker/voices.js");
const loadIndex = () => import("../worker/index.js");
const loadCap = () => import("../worker/cap.js");

const KEY = "xi-secret-key-123";
const post = (body, headers = {}) => new Request("https://x.test/api/tts", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const mp3 = () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([0xff, 0xfb, 1, 2])); c.enqueue(new Uint8Array([3, 4])); c.close(); } }), { status: 200, headers: { "content-type": "application/octet-stream" } });
const upErr = (status, code) => async () => Response.json({ detail: { type: "x", code, message: "secret " + KEY } }, { status });

test("voices: <=12 entries, required voices present, bill is judge, ids unique, public list has no ids", async () => {
  const { VOICES, publicVoices, resolveVoice, JUDGE_KEY } = await loadVoices();
  assert.ok(VOICES.length <= 12 && VOICES.length >= 10);
  const keys = VOICES.map((v) => v.key);
  for (const k of ["callum", "harry", "charlie", "laura", "george", "lily", "bill"]) assert.ok(keys.includes(k), k);
  assert.strictEqual(JUDGE_KEY, "bill");
  assert.strictEqual(new Set(VOICES.map((v) => v.id)).size, VOICES.length);
  assert.strictEqual(resolveVoice("judge"), resolveVoice("bill"));
  assert.strictEqual(resolveVoice("nope"), null);
  assert.strictEqual(resolveVoice("__proto__"), null);
  const pub = JSON.stringify(publicVoices());
  for (const v of VOICES) assert.ok(!pub.includes(v.id));
  assert.deepStrictEqual(publicVoices().filter((v) => v.judge).map((v) => v.key), ["bill"]);
});

test("tts: calls Flash v2.5 stream endpoint with mp3_22050_32, key only in header, streams audio/mpeg back", async () => {
  const { handleTts } = await loadTts();
  const { resolveVoice } = await loadVoices();
  let seen;
  const f = async (url, init) => { seen = { url: String(url), init }; return mp3(); };
  const r = await handleTts(post({ text: "Order, order!", voice: "callum" }), { ELEVENLABS_API_KEY: KEY }, f);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get("content-type"), "audio/mpeg");
  assert.deepStrictEqual([...new Uint8Array(await r.arrayBuffer())], [0xff, 0xfb, 1, 2, 3, 4]);
  const u = new URL(seen.url);
  assert.strictEqual(u.origin + u.pathname, "https://api.elevenlabs.io/v1/text-to-speech/" + resolveVoice("callum") + "/stream");
  assert.strictEqual(u.searchParams.get("output_format"), "mp3_22050_32");
  assert.strictEqual(seen.init.method, "POST");
  assert.strictEqual(seen.init.headers["xi-api-key"], KEY);
  assert.ok(!seen.url.includes(KEY));
  const body = JSON.parse(seen.init.body);
  assert.deepStrictEqual(body, { text: "Order, order!", model_id: "eleven_flash_v2_5" });
});

test("tts: missing voice defaults to the judge; 'judge' alias works", async () => {
  const { handleTts } = await loadTts();
  const { resolveVoice } = await loadVoices();
  const urls = [];
  const f = async (url) => { urls.push(String(url)); return mp3(); };
  await handleTts(post({ text: "hi" }), { ELEVENLABS_API_KEY: KEY }, f);
  await handleTts(post({ text: "hi", voice: "judge" }), { ELEVENLABS_API_KEY: KEY }, f);
  for (const u of urls) assert.ok(u.includes("/" + resolveVoice("bill") + "/stream"));
});

test("tts: validation (bad json, text, length, unknown voice) never reaches upstream", async () => {
  const { handleTts } = await loadTts();
  let calls = 0;
  const f = async () => { calls++; return mp3(); };
  const env = { ELEVENLABS_API_KEY: KEY };
  const cases = [
    "not json", { voice: "callum" }, { text: "" }, { text: "   " }, { text: 5 }, { text: "x".repeat(1501) },
    { text: "hi", voice: "nope" }, { text: "hi", voice: "pNInz6obpgDQGcFmaJgB" }, { text: "hi", voice: 7 }, { text: "hi", voice: "../x" },
  ];
  for (const c of cases) {
    const r = await handleTts(post(c), env, f);
    assert.strictEqual(r.status, 400, JSON.stringify(c).slice(0, 40));
    assert.strictEqual((await r.json()).code, "invalid_request");
  }
  assert.strictEqual(calls, 0);
  const ok = await handleTts(post({ text: "x".repeat(1500), voice: "harry" }), env, f);
  assert.strictEqual(ok.status, 200);
});

test("tts: upstream error mapping; key and upstream messages never leak", async () => {
  const { handleTts } = await loadTts();
  const env = { ELEVENLABS_API_KEY: KEY };
  const rows = [
    [402, "insufficient_credits", 429, "rate_limited"],
    [404, "voice_not_found", 502, "voice_not_found"],
    [403, "voice_access_denied", 502, "voice_not_found"],
    [401, "invalid_api_key", 502, "not_configured"],
    [429, "rate_limit_exceeded", 503, "unavailable"],
    [429, "concurrent_limit_exceeded", 503, "unavailable"],
    [429, "system_busy", 503, "unavailable"],
    [500, "internal", 502, "unavailable"],
    [422, "invalid_parameters", 502, "unavailable"],
  ];
  for (const [us, uc, status, code] of rows) {
    const r = await handleTts(post({ text: "hi", voice: "callum" }), env, upErr(us, uc));
    const t = await r.text();
    assert.strictEqual(r.status, status, uc);
    assert.strictEqual(JSON.parse(t).code, code, uc);
    // only real credit exhaustion is flagged as quota; transient 429s never are
    assert.strictEqual(JSON.parse(t).reason, uc === "insufficient_credits" ? "quota" : undefined, uc);
    assert.ok(typeof JSON.parse(t).message === "string");
    assert.ok(!t.includes(KEY) && !t.includes("secret"), uc);
  }
  const garbage = await handleTts(post({ text: "hi" }), env, async () => new Response("<html>bad gateway</html>", { status: 502 }));
  assert.strictEqual(garbage.status, 502);
  assert.strictEqual((await garbage.json()).code, "unavailable");
  const net = await handleTts(post({ text: "hi" }), env, async () => { throw new Error("boom " + KEY); });
  assert.strictEqual(net.status, 503);
  const t = await net.text();
  assert.ok(!t.includes(KEY));
  assert.strictEqual(JSON.parse(t).code, "unavailable");
});

test("tts: no key configured -> 500 not_configured without calling upstream", async () => {
  const { handleTts } = await loadTts();
  let calls = 0;
  const r = await handleTts(post({ text: "hi" }), {}, async () => { calls++; return mp3(); });
  assert.strictEqual(r.status, 500);
  assert.strictEqual((await r.json()).code, "not_configured");
  assert.strictEqual(calls, 0);
});

// ---- through the Worker entry ----
async function makeEnv(over = {}) {
  const { DailyCap } = await loadCap();
  const caps = new Map();
  const capFor = (n) => {
    if (!caps.has(n)) { const s = new Map(); caps.set(n, new DailyCap({ storage: { get: async (k) => s.get(k), put: async (k, v) => void s.set(k, v) } }, {})); }
    return caps.get(n);
  };
  return {
    ACCESS_PASSCODE: "open sesame", SESSION_SECRET: "s3cret", ANTHROPIC_API_KEY: "a", ELEVENLABS_API_KEY: KEY, DAILY_CAP: "1",
    ASSETS: { fetch: async () => new Response("x") },
    CAP: { idFromName: (n) => n, get: (id) => ({ fetch: (req) => capFor(id).fetch(req) }) },
    ...over,
  };
}
async function login(w, env) {
  const r = await w.fetch(new Request("https://x.test/api/session", { method: "POST", headers: { "content-type": "application/json", "CF-Connecting-IP": "1.1.1.1" }, body: JSON.stringify({ passcode: "open sesame" }) }), env);
  return r.headers.get("set-cookie").split(";")[0];
}

test("index: /api/tts and /api/voices need the session cookie; voices list has no ids", async () => {
  const { default: w } = await loadIndex();
  const { VOICES } = await loadVoices();
  const env = await makeEnv();
  assert.strictEqual((await w.fetch(post({ text: "hi" }), env)).status, 401);
  assert.strictEqual((await w.fetch(new Request("https://x.test/api/voices"), env)).status, 401);
  const cookie = await login(w, env);
  const r = await w.fetch(new Request("https://x.test/api/voices", { headers: { cookie } }), env);
  assert.strictEqual(r.status, 200);
  const t = await r.text();
  assert.strictEqual(JSON.parse(t).voices.length, VOICES.length);
  for (const v of VOICES) assert.ok(!t.includes(v.id));
  assert.strictEqual(r.headers.get("cache-control"), "no-store");
  const wrong = await w.fetch(new Request("https://x.test/api/voices", { method: "POST", headers: { cookie } }), env);
  assert.strictEqual(wrong.status, 405);
  const get = await w.fetch(new Request("https://x.test/api/tts", { headers: { cookie } }), env);
  assert.strictEqual(get.status, 405);
});

test("index: /api/tts streams through the worker and a daily TTS call budget stops runaway spend", async () => {
  const { default: w, TTS_PER_DEBATE } = await loadIndex();
  const env = await makeEnv({ DAILY_CAP: "1" });
  const cookie = await login(w, env);
  const orig = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async () => { n++; return mp3(); };
  try {
    let last;
    for (let i = 0; i < TTS_PER_DEBATE; i++) {
      last = await w.fetch(post({ text: "hi", voice: "laura" }, { cookie }), env);
      assert.strictEqual(last.status, 200);
      assert.match(last.headers.get("content-type"), /audio\/mpeg/);
      await last.arrayBuffer();
    }
    const over = await w.fetch(post({ text: "hi", voice: "laura" }, { cookie }), env);
    assert.strictEqual(over.status, 429);
    const ob = await over.json();
    assert.strictEqual(ob.code, "rate_limited");
    assert.strictEqual(ob.reason, "daily", "our own backstop, distinct from ElevenLabs quota");
    assert.doesNotMatch(ob.message, /credits/);
    assert.strictEqual(n, TTS_PER_DEBATE);
  } finally { globalThis.fetch = orig; }
});

test("index: no ELEVENLABS_API_KEY -> empty voice list, /api/tts 500 not_configured, no TTS slot used", async () => {
  const { default: w } = await loadIndex();
  const env = await makeEnv({ ELEVENLABS_API_KEY: undefined });
  const cookie = await login(w, env);
  const v = await w.fetch(new Request("https://x.test/api/voices", { headers: { cookie } }), env);
  assert.deepStrictEqual(await v.json(), { voices: [] });
  const orig = globalThis.fetch;
  globalThis.fetch = async () => assert.fail("no upstream call");
  try {
    for (let i = 0; i < 20; i++) {
      const r = await w.fetch(post({ text: "hi", voice: "laura" }, { cookie }), env);
      assert.strictEqual(r.status, 500);
      const b = await r.json();
      assert.strictEqual(b.code, "not_configured");
      assert.match(b.message, /ELEVENLABS_API_KEY/);
    }
  } finally { globalThis.fetch = orig; }
});
