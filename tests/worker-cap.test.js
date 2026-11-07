const test = require("node:test");
const assert = require("node:assert");

const load = () => import("../worker/cap.js");

function fakeStorage() {
  const m = new Map();
  return { get: async (k) => m.get(k), put: async (k, v) => void m.set(k, v), _m: m };
}
const hit = (limit, date) => new Request(`https://cap/hit?limit=${limit}&date=${date}`, { method: "POST" });

test("applyCap: allows up to the limit, blocks beyond", async () => {
  const { applyCap } = await load();
  let st = null;
  for (let i = 1; i <= 20; i++) {
    const r = applyCap(st, "2026-11-07", 20);
    assert.strictEqual(r.allowed, true, "hit " + i);
    st = r.state;
  }
  assert.strictEqual(st.count, 20);
  const r21 = applyCap(st, "2026-11-07", 20);
  assert.strictEqual(r21.allowed, false);
  assert.strictEqual(r21.state.count, 20, "blocked hit is not counted");
});

test("applyCap: resets when the UTC date changes", async () => {
  const { applyCap } = await load();
  const r = applyCap({ date: "2026-11-07", count: 20 }, "2026-11-08", 20);
  assert.strictEqual(r.allowed, true);
  assert.deepStrictEqual(r.state, { date: "2026-11-08", count: 1 });
});

test("applyCap: bad limit falls back to default 20", async () => {
  const { applyCap, parseLimit } = await load();
  assert.strictEqual(parseLimit("abc"), 20);
  assert.strictEqual(parseLimit(undefined), 20);
  assert.strictEqual(parseLimit("5"), 5);
  assert.strictEqual(applyCap(null, "d", parseLimit("0")).allowed, true);
});

test("utcDate formats as YYYY-MM-DD in UTC", async () => {
  const { utcDate } = await load();
  assert.strictEqual(utcDate(new Date("2026-11-07T23:59:59Z")), "2026-11-07");
  assert.strictEqual(utcDate(new Date("2026-11-08T00:00:00Z")), "2026-11-08");
});

test("DailyCap DO: 20th allowed, 21st blocked, next day resets", async () => {
  const { DailyCap } = await load();
  const cap = new DailyCap({ storage: fakeStorage() }, {});
  for (let i = 1; i <= 20; i++) {
    const res = await cap.fetch(hit(20, "2026-11-07"));
    const body = await res.json();
    assert.strictEqual(body.allowed, true, "hit " + i);
  }
  const blocked = await (await cap.fetch(hit(20, "2026-11-07"))).json();
  assert.strictEqual(blocked.allowed, false);
  const next = await (await cap.fetch(hit(20, "2026-11-08"))).json();
  assert.strictEqual(next.allowed, true);
});

test("DailyCap DO: rejects non-POST", async () => {
  const { DailyCap } = await load();
  const cap = new DailyCap({ storage: fakeStorage() }, {});
  const res = await cap.fetch(new Request("https://cap/hit", { method: "GET" }));
  assert.strictEqual(res.status, 405);
});
