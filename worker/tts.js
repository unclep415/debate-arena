// POST /api/tts: ElevenLabs streaming text-to-speech. The key comes only from env.ELEVENLABS_API_KEY
// and is never logged or echoed; upstream error text is never forwarded.
import { jsonError } from "./sample.js";
import { publicVoices, resolveVoice } from "./voices.js";

export const MAX_TEXT = 1500;
// Flash v2.5: cheapest (0.5 credit/char) and lowest latency (~75 ms); 22.05 kHz 32 kbps MP3 is the smallest format.
export const MODEL_ID = "eleven_flash_v2_5";
export const OUTPUT_FORMAT = "mp3_22050_32";
const ENDPOINT = "https://api.elevenlabs.io/v1/text-to-speech/";

// No ElevenLabs key: an empty list, so the page casts no voices and speaks with browser voices.
export function handleVoices(env = {}) {
  return Response.json({ voices: env.ELEVENLABS_API_KEY ? publicVoices() : [] });
}

// Upstream status + detail.code -> our status/code. Quota is rate_limited; a missing voice is
// voice_not_found; everything else is a generic, retry-later "unavailable".
function mapError(status, code) {
  // Only real quota exhaustion is "rate_limited" (reason "quota"); a transient upstream 429
  // (rate_limit_exceeded / concurrent_limit_exceeded / system_busy) is a retry-later "unavailable".
  if (status === 402 || code === "insufficient_credits" || code === "quota_exceeded") return [429, "rate_limited", "Premium voices are out of credits right now.", "quota"];
  if (code === "voice_not_found" || code === "voice_access_denied") return [502, "voice_not_found", "That voice is not available."];
  // Bad/revoked key: permanent until the owner fixes the secret, so the page stops asking.
  if (status === 401 || code === "invalid_api_key") return [502, "not_configured", "The voice service rejected the server's API key."];
  return [status === 429 ? 503 : 502, "unavailable", "The voice service is unavailable."];
}

export async function handleTts(request, env, fetchImpl = fetch) {
  if (request.method !== "POST") return jsonError(405, "invalid_request", "Method not allowed.");
  let body = null;
  try { body = await request.json(); } catch { /* invalid */ }
  if (!body || typeof body !== "object") return jsonError(400, "invalid_request", "Invalid JSON body.");
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return jsonError(400, "invalid_request", "Text is required.");
  if (text.length > MAX_TEXT) return jsonError(400, "invalid_request", `Text is over ${MAX_TEXT} characters.`);
  const voiceKey = body.voice == null ? "judge" : body.voice;
  const voiceId = resolveVoice(voiceKey);
  if (!voiceId) return jsonError(400, "invalid_request", "Unknown voice.");
  if (!env.ELEVENLABS_API_KEY) return jsonError(500, "not_configured", "Premium voices are not configured (no ELEVENLABS_API_KEY).");
  let upstream;
  try {
    upstream = await fetchImpl(`${ENDPOINT}${voiceId}/stream?output_format=${OUTPUT_FORMAT}`, {
      method: "POST",
      headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: MODEL_ID }),
      signal: request.signal,
    });
  } catch { return jsonError(503, "unavailable", "The voice service is unavailable."); }
  if (!upstream.ok || !upstream.body) {
    let code = "";
    try { const j = await upstream.json(); code = j && j.detail && typeof j.detail.code === "string" ? j.detail.code : ""; } catch { /* not JSON */ }
    try { if (upstream.body && !upstream.bodyUsed) await upstream.body.cancel(); } catch { /* ignore */ }
    const [status, c, message, reason] = mapError(upstream.status, code);
    return reason ? Response.json({ code: c, reason, message }, { status }) : jsonError(status, c, message);
  }
  return new Response(upstream.body, { status: 200, headers: { "content-type": "audio/mpeg" } });
}
