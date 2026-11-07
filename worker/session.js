// Passcode session: HMAC-signed cookie token, constant-time comparisons, brute-force brake.
export const COOKIE_NAME = "da_session";
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const enc = new TextEncoder();

const b64u = (bytes) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64u = (str) => {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

const hmacKey = (secret, usage) =>
  crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usage);

// Hash both sides to a fixed length, then compare every byte without early exit.
export async function constantTimeEqual(a, b) {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(String(a))),
    crypto.subtle.digest("SHA-256", enc.encode(String(b))),
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function makeToken(secret, now = Date.now()) {
  const payload = b64u(enc.encode(JSON.stringify({ exp: now + SESSION_TTL_MS })));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret, ["sign"]), enc.encode(payload));
  return payload + "." + b64u(new Uint8Array(sig));
}

export async function verifyToken(secret, token, now = Date.now()) {
  try {
    if (!secret || typeof token !== "string") return false;
    const parts = token.split(".");
    if (parts.length !== 2) return false;
    const [payload, sig] = parts;
    const sigBytes = unb64u(sig);
    if (b64u(sigBytes) !== sig) return false; // canonical encoding only
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret, ["verify"]), sigBytes, enc.encode(payload));
    if (!ok) return false;
    const { exp } = JSON.parse(new TextDecoder().decode(unb64u(payload)));
    return typeof exp === "number" && exp > now;
  } catch {
    return false;
  }
}

export function sessionCookie(token) {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

// In-memory per-isolate brake: 5 failures per IP in 10 minutes. Best effort, not a global lock.
export function createLimiter({ max = 5, windowMs = 10 * 60 * 1000 } = {}) {
  const fails = new Map();
  const recent = (ip, now) => {
    const list = (fails.get(ip) || []).filter((t) => now - t < windowMs);
    if (list.length) fails.set(ip, list); else fails.delete(ip);
    return list;
  };
  return {
    isBlocked: (ip, now = Date.now()) => recent(ip, now).length >= max,
    fail(ip, now = Date.now()) { const l = recent(ip, now); l.push(now); fails.set(ip, l); },
    clear: (ip) => void fails.delete(ip),
  };
}
