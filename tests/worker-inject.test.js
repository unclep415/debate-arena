const test = require("node:test");
const assert = require("node:assert");

const load = () => import("../worker/inject.js");
const HTML = '<body><script src="logic.js"></script>\n<script src="voice.js"></script>\n<script src="app.js"></script></body>';

test("injectHostedScript puts hosted.js immediately before app.js", async () => {
  const { injectHostedScript } = await load();
  const out = injectHostedScript(HTML);
  assert.ok(out.includes('<script src="hosted.js"></script><script src="app.js"></script>'));
  assert.ok(out.indexOf("hosted.js") < out.indexOf("app.js"));
  assert.ok(out.indexOf("voice.js") < out.indexOf("hosted.js"));
  assert.strictEqual(out.split("hosted.js").length, 2, "exactly once");
});

test("injectHostedScript tolerates attribute variants and leaves other html alone", async () => {
  const { injectHostedScript } = await load();
  assert.ok(injectHostedScript("<script  src='app.js' defer></script>").startsWith('<script src="hosted.js"></script>'));
  assert.strictEqual(injectHostedScript("<p>no scripts</p>"), "<p>no scripts</p>");
  assert.strictEqual(injectHostedScript('<script src="myapp.js"></script>'), '<script src="myapp.js"></script>');
});

test("isHtmlEntry matches / and /index.html only", async () => {
  const { isHtmlEntry } = await load();
  assert.ok(isHtmlEntry("/") && isHtmlEntry("/index.html"));
  assert.ok(!isHtmlEntry("/app.js") && !isHtmlEntry("/api/x") && !isHtmlEntry("/index.html/x"));
});

test("rewriteHtmlResponse: string fallback when HTMLRewriter undefined", async () => {
  const { rewriteHtmlResponse } = await load();
  assert.strictEqual(typeof globalThis.HTMLRewriter, "undefined");
  const res = new Response(HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8", etag: "x", "content-length": "5" } });
  const out = await rewriteHtmlResponse(res);
  const text = await out.text();
  assert.ok(text.includes('hosted.js"></script><script src="app.js"'));
  assert.strictEqual(out.headers.get("content-type"), "text/html; charset=utf-8");
  assert.strictEqual(out.headers.get("content-length"), null);
});

test("rewriteHtmlResponse uses HTMLRewriter when present", async () => {
  const { rewriteHtmlResponse } = await load();
  const calls = [];
  globalThis.HTMLRewriter = class {
    on(sel, h) { calls.push(sel); this.h = h; return this; }
    transform(res) { const el = { before: (s, o) => calls.push(["before", s, o]) }; this.h.element(el); return res; }
  };
  try {
    const res = new Response(HTML, { headers: { "content-type": "text/html" } });
    await rewriteHtmlResponse(res);
    assert.strictEqual(calls[0], 'script[src="app.js"]');
    assert.deepStrictEqual(calls[1], ["before", '<script src="hosted.js"></script>', { html: true }]);
  } finally { delete globalThis.HTMLRewriter; }
});

test("rewriteHtmlResponse passes non-OK or non-html through", async () => {
  const { rewriteHtmlResponse } = await load();
  const r404 = new Response("nope", { status: 404, headers: { "content-type": "text/html" } });
  assert.strictEqual(await rewriteHtmlResponse(r404), r404);
});
