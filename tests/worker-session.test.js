const test = require("node:test");
const assert = require("node:assert");

const load = () => import("../worker/session.js");
const SECRET = "test-secret-value";

test("constantTimeEqual", async () => {
  const { constantTimeEqual } = await load();
  assert.strictEqual(await constantTimeEqual("abc", "abc"), true);
  assert.strictEqual(await constantTimeEqual("abc", "abd"), false);
  assert.strictEqual(await constantTimeEqual("abc", "abcd"), false);
  assert.strictEqual(await constantTimeEqual("", ""), true);
});

test("token round trip, tamper, expiry, wrong secret", async () => {
  const { makeToken, verifyToken } = await load();
  const now = 1_700_000_000_000;
  const t = await makeToken(SECRET, now);
  assert.strictEqual(await verifyToken(SECRET, t, now + 1000), true);
  assert.strictEqual(await verifyToken("other", t, now + 1000), false);
  assert.strictEqual(await verifyToken(SECRET, t, now + 31 * 24 * 3600 * 1000), false, "expired");
  const [p, s] = t.split(".");
  const forged = Buffer.from(JSON.stringify({ exp: now + 10 * 365 * 24 * 3600 * 1000 })).toString("base64url");
  assert.strictEqual(await verifyToken(SECRET, forged + "." + s, now), false, "payload tampered");
  assert.strictEqual(await verifyToken(SECRET, p + "." + s.slice(0, -2) + "AA", now), false, "sig tampered");
  for (const bad of ["", "x", "a.b.c", undefined, null, "..", "%%%.%%%"]) {
    assert.strictEqual(await verifyToken(SECRET, bad, now), false);
  }
  assert.strictEqual(await verifyToken("", t, now), false, "empty secret never verifies");
});

test("cookie helpers", async () => {
  const { sessionCookie, readCookie } = await load();
  const c = sessionCookie("tok123");
  for (const part of ["da_session=tok123", "HttpOnly", "Secure", "SameSite=Strict", "Path=/", "Max-Age=2592000"]) {
    assert.ok(c.includes(part), part);
  }
  assert.strictEqual(readCookie("a=1; da_session=tok123; b=2", "da_session"), "tok123");
  assert.strictEqual(readCookie("a=1", "da_session"), null);
  assert.strictEqual(readCookie(null, "da_session"), null);
});

test("limiter: 5 wrong tries then blocked; window expires; success clears", async () => {
  const { createLimiter } = await load();
  const l = createLimiter();
  const t0 = 1000;
  for (let i = 0; i < 5; i++) {
    assert.strictEqual(l.isBlocked("1.1.1.1", t0), false);
    l.fail("1.1.1.1", t0);
  }
  assert.strictEqual(l.isBlocked("1.1.1.1", t0), true);
  assert.strictEqual(l.isBlocked("2.2.2.2", t0), false, "per IP");
  assert.strictEqual(l.isBlocked("1.1.1.1", t0 + 10 * 60 * 1000 + 1), false, "window passes");
  l.fail("3.3.3.3", t0);
  l.clear("3.3.3.3");
  assert.strictEqual(l.isBlocked("3.3.3.3", t0), false);
});

test("createLimiter: memory stays bounded (sweeps expired, caps tracked IPs and timestamps)", async () => {
  const { createLimiter } = await load();
  const l = createLimiter({ maxIps: 100 });
  for (let i = 0; i < 1000; i++) l.fail("10.0." + i, 1000);
  assert.ok(l.size() <= 100, "capped at maxIps, got " + l.size());
  // Later, after the window, a new IP sweeps all expired entries.
  const later = 1000 + 10 * 60 * 1000 + 1;
  l.fail("9.9.9.9", later);
  assert.strictEqual(l.size(), 1);
  for (let i = 0; i < 50; i++) l.fail("8.8.8.8", later);
  assert.strictEqual(l.isBlocked("8.8.8.8", later), true, "still blocks after many failures");
});
