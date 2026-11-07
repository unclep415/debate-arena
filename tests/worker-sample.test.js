const test = require("node:test");
const assert = require("node:assert");

const load = () => import("../worker/sample.js");

function sse(events) {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({
    start(c) { for (const [n, d] of events) c.enqueue(enc.encode(`event: ${n}\ndata: ${JSON.stringify(d)}\n\n`)); c.close(); },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
}
const delta = (t) => ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } }];
const ok = (...parts) => [["message_start", { type: "message_start" }], ...parts.map(delta), ["message_stop", { type: "message_stop" }]];

async function lines(res) {
  const t = await res.text();
  return t.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
}

test("validateInput: string, messages, limits", async () => {
  const { validateInput } = await load();
  assert.deepStrictEqual(validateInput("hi").messages, [{ role: "user", content: "hi" }]);
  const m = [{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }];
  assert.strictEqual(validateInput(m).ok, true);
  assert.strictEqual(validateInput([{ role: "user", content: "a" }, { role: "assistant", content: "b" }]).ok, false, "must end on user");
  assert.strictEqual(validateInput([{ role: "system", content: "a" }]).ok, false);
  assert.strictEqual(validateInput([{ role: "user", content: 5 }]).ok, false);
  assert.strictEqual(validateInput([]).ok, false);
  assert.strictEqual(validateInput("").ok, false);
  assert.strictEqual(validateInput(undefined).ok, false);
  assert.strictEqual(validateInput({}).ok, false);
  assert.strictEqual(validateInput("x".repeat(40000)).ok, true);
  assert.strictEqual(validateInput("x".repeat(40001)).ok, false);
  assert.strictEqual(validateInput([{ role: "user", content: "x".repeat(20000) }, { role: "assistant", content: "x".repeat(20001) }, { role: "user", content: "y" }]).ok, false, "total across messages");
});

test("buildUpstreamRequest: headers, model, max_tokens, stream, json system", async () => {
  const { buildUpstreamRequest, MODEL } = await load();
  assert.strictEqual(MODEL, "claude-sonnet-5-5");
  const r = buildUpstreamRequest("KEY", [{ role: "user", content: "x" }], true);
  assert.strictEqual(r.url, "https://api.anthropic.com/v1/messages");
  assert.strictEqual(r.init.headers["x-api-key"], "KEY");
  assert.ok(r.init.headers["anthropic-version"]);
  const b = JSON.parse(r.init.body);
  assert.strictEqual(b.model, MODEL);
  assert.strictEqual(b.max_tokens, 1024);
  assert.strictEqual(b.stream, true);
  assert.match(b.system, /JSON/);
  assert.strictEqual("temperature" in b, false);
  assert.strictEqual("system" in JSON.parse(buildUpstreamRequest("K", [{ role: "user", content: "x" }], false).init.body), false);
});

test("handleSample: relays deltas then done with full text; sends key upstream", async () => {
  const { handleSample } = await load();
  let seen;
  const f = async (url, init) => { seen = { url, init }; return sse(ok("Hel", "lo")); };
  const res = await handleSample({ input: "hi" }, { ANTHROPIC_API_KEY: "sk-test" }, f);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/event-stream/);
  assert.strictEqual(seen.init.headers["x-api-key"], "sk-test");
  assert.deepStrictEqual(await lines(res), [{ delta: "Hel" }, { delta: "lo" }, { done: true, text: "Hello" }]);
});

test("handleSample: handles chunk boundaries splitting SSE lines", async () => {
  const { handleSample } = await load();
  const full = `event: content_block_delta\ndata: ${JSON.stringify(delta("Hi")[1])}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n`;
  const enc = new TextEncoder();
  const f = async () => new Response(new ReadableStream({ start(c) { for (let i = 0; i < full.length; i += 7) c.enqueue(enc.encode(full.slice(i, i + 7))); c.close(); } }));
  const res = await handleSample({ input: "hi" }, { ANTHROPIC_API_KEY: "k" }, f);
  assert.deepStrictEqual(await lines(res), [{ delta: "Hi" }, { done: true, text: "Hi" }]);
});

test("handleSample json mode: valid, fenced, invalid", async () => {
  const { handleSample } = await load();
  const run = async (txt) => lines(await handleSample({ input: "p", json: true }, { ANTHROPIC_API_KEY: "k" }, async () => sse(ok(txt))));
  const good = await run('{"a":1}');
  assert.deepStrictEqual(good[good.length - 1], { done: true, json: { a: 1 } });
  const fenced = await run('```json\n{"a":2}\n```');
  assert.deepStrictEqual(fenced[fenced.length - 1], { done: true, json: { a: 2 } });
  const bad = await run("not json at all");
  assert.strictEqual(bad[bad.length - 1].error.code, "invalid_json");
});

test("handleSample: upstream HTTP error mapping", async () => {
  const { handleSample } = await load();
  const cases = { 429: "rate_limited", 401: "not_granted", 403: "not_granted", 400: "invalid_request", 500: "unavailable", 529: "unavailable", 503: "unavailable" };
  for (const [status, code] of Object.entries(cases)) {
    const res = await handleSample({ input: "hi" }, { ANTHROPIC_API_KEY: "sk-secret" }, async () => new Response('{"error":{"message":"sk-secret leaked"}}', { status: Number(status) }));
    const out = await lines(res);
    assert.strictEqual(out.length, 1, status);
    assert.strictEqual(out[0].error.code, code, status);
    assert.ok(!JSON.stringify(out).includes("sk-secret"), "no upstream text echoed");
    assert.ok(out[0].error.message);
  }
});

test("handleSample: mid-stream error event and fetch failure", async () => {
  const { handleSample } = await load();
  const res = await handleSample({ input: "hi" }, { ANTHROPIC_API_KEY: "k" }, async () => sse([delta("a"), ["error", { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }]]));
  const out = await lines(res);
  assert.deepStrictEqual(out[0], { delta: "a" });
  assert.strictEqual(out[1].error.code, "unavailable");
  const res2 = await handleSample({ input: "hi" }, { ANTHROPIC_API_KEY: "k" }, async () => { throw new Error("net"); });
  assert.strictEqual((await lines(res2))[0].error.code, "unavailable");
});

test("handleSample: stream ending without message_stop is an error", async () => {
  const { handleSample } = await load();
  const out = await lines(await handleSample({ input: "hi" }, { ANTHROPIC_API_KEY: "k" }, async () => sse([delta("a")])));
  assert.strictEqual(out[out.length - 1].error.code, "unavailable");
});

test("handleSample: invalid input returns 400 JSON", async () => {
  const { handleSample } = await load();
  const res = await handleSample({ input: "x".repeat(40001) }, { ANTHROPIC_API_KEY: "k" }, async () => assert.fail("no upstream call"));
  assert.strictEqual(res.status, 400);
  assert.strictEqual((await res.json()).code, "invalid_request");
});

test("mapUpstreamErrorType", async () => {
  const { mapErrorType } = await load();
  assert.strictEqual(mapErrorType("rate_limit_error"), "rate_limited");
  assert.strictEqual(mapErrorType("authentication_error"), "not_granted");
  assert.strictEqual(mapErrorType("permission_error"), "not_granted");
  assert.strictEqual(mapErrorType("invalid_request_error"), "invalid_request");
  assert.strictEqual(mapErrorType("overloaded_error"), "unavailable");
  assert.strictEqual(mapErrorType("api_error"), "unavailable");
});
