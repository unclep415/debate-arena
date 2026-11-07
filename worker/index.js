// Worker entry: routing, auth, cap, static assets. Secrets are never logged or echoed.
import { COOKIE_NAME, constantTimeEqual, createLimiter, makeToken, readCookie, sessionCookie, verifyToken } from "./session.js";
import { handleSample, jsonError, validateInput } from "./sample.js";
import { parseLimit, utcDate } from "./cap.js";
import { handleTts, handleVoices } from "./tts.js";
import { isHtmlEntry, rewriteHtmlResponse } from "./inject.js";

export { DailyCap } from "./cap.js";

const limiter = createLimiter();
const CAP_MESSAGE = "Daily debate limit reached — try again tomorrow.";
// Our own per-day /api/tts backstop (not ElevenLabs credits, which answer reason "quota").
const TTS_CAP_MESSAGE = "Daily premium-voice limit reached — try again tomorrow.";
// Server-side backstop: debateStart is client-controlled, so every /api/sample call also counts
// against a coarse per-day call budget (a debate is ~8 calls; the rest leaves room for retries).
export const CALLS_PER_DEBATE = 10;
// Same idea for /api/tts: a debate is 7 spoken clips (long turns are split into a few requests each).
export const TTS_PER_DEBATE = 16;
const TEXT_TYPES = /^(text\/html|text\/css|text\/javascript|application\/javascript)\b/i;

// Static text assets must declare UTF-8 (index.html has no <meta charset>; the JS has emoji).
function withCharset(headers) {
  const t = headers.get("content-type");
  if (t && TEXT_TYPES.test(t) && !/charset=/i.test(t)) headers.set("content-type", t + "; charset=utf-8");
}

function secure(res, isApi) {
  const headers = new Headers(res.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-frame-options", "DENY");
  if (isApi) headers.set("cache-control", "no-store");
  else withCharset(headers);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

async function isGranted(request, env) {
  return verifyToken(env.SESSION_SECRET, readCookie(request.headers.get("cookie"), COOKIE_NAME));
}

async function postSession(request, env) {
  if (!env.ACCESS_PASSCODE || !env.SESSION_SECRET) return jsonError(503, "unavailable", "Server is not configured.");
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (limiter.isBlocked(ip)) return jsonError(429, "rate_limited", "Too many attempts. Try again in a few minutes.");
  const body = await readJson(request);
  const given = body && typeof body.passcode === "string" ? body.passcode : "";
  if (!(await constantTimeEqual(given, env.ACCESS_PASSCODE))) {
    limiter.fail(ip);
    return jsonError(401, "bad_passcode", "That passcode is not right.");
  }
  limiter.clear(ip);
  const res = Response.json({ ok: true });
  res.headers.set("set-cookie", sessionCookie(await makeToken(env.SESSION_SECRET)));
  return res;
}

async function takeSlot(env, name, limit) {
  const stub = env.CAP.get(env.CAP.idFromName(name));
  const url = `https://cap/hit?limit=${limit}&date=${utcDate(new Date())}`;
  const res = await stub.fetch(new Request(url, { method: "POST" }));
  return (await res.json()).allowed === true;
}

async function postSample(request, env) {
  if (request.method !== "POST") return jsonError(405, "invalid_request", "Method not allowed.");
  const body = await readJson(request);
  if (!body || typeof body !== "object") return jsonError(400, "invalid_request", "Invalid JSON body.");
  const v = validateInput(body.input);
  if (!v.ok) return jsonError(400, "invalid_request", v.message);
  const limit = parseLimit(env.DAILY_CAP);
  try {
    if (body.debateStart === true && !(await takeSlot(env, "global", limit))) return jsonError(429, "rate_limited", CAP_MESSAGE);
    if (!(await takeSlot(env, "global-calls", limit * CALLS_PER_DEBATE))) return jsonError(429, "rate_limited", CAP_MESSAGE);
  } catch { return jsonError(503, "unavailable", "Usage counter unavailable. Please try again."); }
  return handleSample(body, env);
}

async function postTts(request, env) {
  if (request.method !== "POST") return jsonError(405, "invalid_request", "Method not allowed.");
  try {
    if (!(await takeSlot(env, "global-tts", parseLimit(env.DAILY_CAP) * TTS_PER_DEBATE))) return Response.json({ code: "rate_limited", reason: "daily", message: TTS_CAP_MESSAGE }, { status: 429 });
  } catch { return jsonError(503, "unavailable", "Usage counter unavailable. Please try again."); }
  return handleTts(request, env);
}

async function handleApi(request, env, path) {
  if (path === "/api/session") {
    if (request.method === "POST") return postSession(request, env);
    if (request.method === "GET") {
      return (await isGranted(request, env)) ? Response.json({ ok: true }) : jsonError(401, "not_granted", "Passcode required.");
    }
    return jsonError(405, "invalid_request", "Method not allowed.");
  }
  if (!(await isGranted(request, env))) return jsonError(401, "not_granted", "Passcode required.");
  if (path === "/api/sample") return postSample(request, env);
  if (path === "/api/tts") return postTts(request, env);
  if (path === "/api/voices") return request.method === "GET" ? handleVoices() : jsonError(405, "invalid_request", "Method not allowed.");
  return jsonError(404, "invalid_request", "Not found.");
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === "/api" || path.startsWith("/api/")) return secure(await handleApi(request, env, path), true);
    let res = await env.ASSETS.fetch(request);
    if (isHtmlEntry(path)) res = await rewriteHtmlResponse(res);
    return secure(res, false);
  },
};
