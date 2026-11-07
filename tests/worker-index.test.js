const test = require("node:test");
const assert = require("node:assert");

const loadIndex = () => import("../worker/index.js");
const loadCap = () => import("../worker/cap.js");
const loadSession = () => import("../worker/session.js");

async function makeEnv(over = {}) {
  const { DailyCap } = await loadCap();
  const store = new Map();
  const cap = new DailyCap({ storage: { get: async (k) => store.get(k), put: async (k, v) => void store.set(k, v) } }, {});
  return {
    ACCESS_PASSCODE: "open sesame", SESSION_SECRET: "s3cret", ANTHROPIC_API_KEY: "sk-ant-test", DAILY_CAP: "20",
    ASSETS: { fetch: async (req) => {
      const p = new URL(req.url).pathname;
      if (p === "/" || p === "/index.html") return new Response('<script src="app.js"></script>', { headers: { "content-type": "text/html" } });
      return new Response("asset " + p, { headers: { "content-type": "text/plain" } });
    } },
    CAP: { idFromName: (n) => n, get: () => ({ fetch: (req) => cap.fetch(req) }) },
    ...over,
  };
}
const post = (path, body, headers = {}) => new Request("https://x.test" + path, { method: "POST", headers: { "content-type": "application/json", "CF-Connecting-IP": "9.9.9.9", ...headers }, body: JSON.stringify(body) });
async function login(worker, env) {
  const r = await worker.fetch(post("/api/session", { passcode: "open sesame" }), env);
  assert.strictEqual(r.status, 200);
  return r.headers.get("set-cookie").split(";")[0];
}
function upstream(text) {
  const enc = new TextEncoder();
  return async () => new Response(new ReadableStream({ start(c) {
    c.enqueue(enc.encode(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n`)); c.close(); } }));
}

test("session: right passcode sets secure cookie; GET /api/session ok", async () => {
  const { default: w } = await loadIndex();
  const env = await makeEnv();
  const r = await w.fetch(post("/api/session", { passcode: "open sesame" }), env);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(await r.json(), { ok: true });
  const sc = r.headers.get("set-cookie");
  for (const p of ["da_session=", "HttpOnly", "Secure", "SameSite=Strict", "Path=/"]) assert.ok(sc.includes(p), p);
  const g = await w.fetch(new Request("https://x.test/api/session", { headers: { cookie: sc.split(";")[0] } }), env);
  assert.strictEqual(g.status, 200);
  assert.deepStrictEqual(await g.json(), { ok: true });
});

test("session: wrong passcode 401, never echoed; GET without cookie 401", async () => {
  const { default: w } = await loadIndex();
  const env = await makeEnv();
  const r = await w.fetch(post("/api/session", { passcode: "guess-xyz" }), env);
  assert.strictEqual(r.status, 401);
  const t = await r.text();
  assert.strictEqual(JSON.parse(t).code, "bad_passcode");
  assert.ok(!t.includes("guess-xyz") && !t.includes("open sesame"));
  assert.strictEqual(r.headers.get("set-cookie"), null);
  const g = await w.fetch(new Request("https://x.test/api/session"), env);
  assert.strictEqual(g.status, 401);
  const bad = await w.fetch(new Request("https://x.test/api/session", { method: "POST", body: "not json" }), env);
  assert.strictEqual(bad.status, 401);
});

test("session: brute-force brake after 5 wrong tries (429), per IP", async () => {
  const { default: w } = await loadIndex();
  const env = await makeEnv();
  const ip = { "CF-Connecting-IP": "7.7.7.7" };
  for (let i = 0; i < 5; i++) assert.strictEqual((await w.fetch(post("/api/session", { passcode: "no" + i }, ip), env)).status, 401);
  const r = await w.fetch(post("/api/session", { passcode: "open sesame" }, ip), env);
  assert.strictEqual(r.status, 429, "even correct passcode blocked while braked");
  assert.strictEqual((await r.json()).code, "rate_limited");
  const other = await w.fetch(post("/api/session", { passcode: "open sesame" }, { "CF-Connecting-IP": "8.8.8.8" }), env);
  assert.strictEqual(other.status, 200);
});

test("protected routes need a valid cookie (missing, tampered, expired)", async () => {
  const { default: w } = await loadIndex();
  const { makeToken } = await loadSession();
  const env = await makeEnv();
  const cookie = await login(w, env);
  const tampered = cookie.slice(0, -3) + "AAA";
  const expired = "da_session=" + (await makeToken("s3cret", Date.now() - 40 * 24 * 3600 * 1000));
  for (const c of [null, tampered, expired, "da_session=garbage"]) {
    const h = c ? { cookie: c } : {};
    const r = await w.fetch(post("/api/sample", { input: "hi" }, h), env);
    assert.strictEqual(r.status, 401);
    assert.strictEqual((await r.json()).code, "not_granted");
  }
  const unknown = await w.fetch(new Request("https://x.test/api/whatever"), env);
  assert.strictEqual(unknown.status, 401);
  const authed = await w.fetch(new Request("https://x.test/api/whatever", { headers: { cookie } }), env);
  assert.strictEqual(authed.status, 404);
});

test("sample: streams via mocked upstream; sets api headers; key never in response", async () => {
  const { default: w } = await loadIndex();
  const env = await makeEnv();
  const cookie = await login(w, env);
  const orig = globalThis.fetch;
  globalThis.fetch = upstream("Hi there");
  try {
    const r = await w.fetch(post("/api/sample", { input: "hello" }, { cookie }), env);
    assert.strictEqual(r.status, 200);
    assert.match(r.headers.get("content-type"), /text\/event-stream/);
    assert.match(r.headers.get("cache-control"), /no-store/);
    assert.strictEqual(r.headers.get("x-content-type-options"), "nosniff");
    const t = await r.text();
    assert.ok(t.includes('data: {"delta":"Hi there"}') && t.includes('"done":true'));
    assert.ok(!t.includes("sk-ant-test"));
  } finally { globalThis.fetch = orig; }
});

test("sample: validation 400, wrong method 405", async () => {
  const { default: w } = await loadIndex();
  const env = await makeEnv();
  const cookie = await login(w, env);
  const r = await w.fetch(post("/api/sample", { input: [{ role: "bot", content: "x" }] }, { cookie }), env);
  assert.strictEqual(r.status, 400);
  const big = await w.fetch(post("/api/sample", { input: "x".repeat(40001) }, { cookie }), env);
  assert.strictEqual(big.status, 400);
  const notJson = await w.fetch(new Request("https://x.test/api/sample", { method: "POST", headers: { cookie }, body: "zzz" }), env);
  assert.strictEqual(notJson.status, 400);
  const g = await w.fetch(new Request("https://x.test/api/sample", { headers: { cookie } }), env);
  assert.strictEqual(g.status, 405);
});

test("daily cap: 20th debateStart allowed, 21st 429; non-start calls uncounted", async () => {
  const { default: w } = await loadIndex();
  const env = await makeEnv();
  const cookie = await login(w, env);
  const orig = globalThis.fetch;
  globalThis.fetch = upstream("x");
  try {
    for (let i = 1; i <= 20; i++) {
      const r = await w.fetch(post("/api/sample", { input: "hi", debateStart: true }, { cookie }), env);
      assert.strictEqual(r.status, 200, "debate " + i);
      await r.text();
    }
    for (let i = 0; i < 3; i++) assert.strictEqual((await w.fetch(post("/api/sample", { input: "hi" }, { cookie }), env)).status, 200);
    const r = await w.fetch(post("/api/sample", { input: "hi", debateStart: true }, { cookie }), env);
    assert.strictEqual(r.status, 429);
    const b = await r.json();
    assert.strictEqual(b.code, "rate_limited");
    assert.match(b.message, /Daily debate limit reached/);
  } finally { globalThis.fetch = orig; }
});

test("daily cap honours DAILY_CAP var and resets on UTC date change", async () => {
  const { default: w } = await loadIndex();
  const env = await makeEnv({ DAILY_CAP: "1" });
  const cookie = await login(w, env);
  const orig = globalThis.fetch, RealDate = Date;
  globalThis.fetch = upstream("x");
  try {
    const go = async () => (await w.fetch(post("/api/sample", { input: "hi", debateStart: true }, { cookie }), env)).status;
    assert.strictEqual(await go(), 200);
    assert.strictEqual(await go(), 429);
    const real = Date.now();
    globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [real + 24 * 3600 * 1000])); } static now() { return real + 24 * 3600 * 1000; } };
    assert.strictEqual(await go(), 200, "next day");
  } finally { globalThis.fetch = orig; globalThis.Date = RealDate; }
});

test("static: assets proxied, / gets hosted.js injected before app.js, security headers", async () => {
  const { default: w } = await loadIndex();
  const env = await makeEnv();
  const home = await w.fetch(new Request("https://x.test/"), env);
  const html = await home.text();
  assert.ok(html.indexOf("hosted.js") !== -1 && html.indexOf("hosted.js") < html.indexOf("app.js"));
  assert.strictEqual(home.headers.get("x-content-type-options"), "nosniff");
  const idx = await (await w.fetch(new Request("https://x.test/index.html"), env)).text();
  assert.ok(idx.includes("hosted.js"));
  const js = await w.fetch(new Request("https://x.test/app.js"), env);
  assert.strictEqual(await js.text(), "asset /app.js");
  assert.strictEqual(js.headers.get("x-content-type-options"), "nosniff");
});

test("no CORS headers are ever added", async () => {
  const { default: w } = await loadIndex();
  const env = await makeEnv();
  const r = await w.fetch(post("/api/session", { passcode: "no" }), env);
  assert.strictEqual(r.headers.get("access-control-allow-origin"), null);
});

test("missing secrets: fails closed", async () => {
  const { default: w } = await loadIndex();
  const env = await makeEnv({ SESSION_SECRET: undefined });
  const r = await w.fetch(post("/api/session", { passcode: "open sesame" }), env);
  assert.ok(r.status >= 500 || r.status === 401);
  assert.strictEqual(r.headers.get("set-cookie"), null);
});
