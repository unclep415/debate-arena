// POST /api/sample: validates input, streams Claude (Anthropic Messages API) back as SSE.
export const MODEL = "claude-sonnet-5-5";
export const MAX_TOKENS = 1024;
export const MAX_INPUT_CHARS = 40000;
const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2026-10-21";
// Server-side refusal fallback ("default" routing by refusal category; Claude API only).
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const JSON_SYSTEM = "Respond with a single valid JSON value only. No markdown fences, no commentary before or after.";

const MESSAGES = {
  rate_limited: "The AI service is busy or rate limited. Please try again shortly.",
  not_granted: "The server is not authorized to reach the AI service.",
  invalid_request: "The request was not accepted.",
  invalid_json: "The model did not return valid JSON.",
  refused: "The AI declined to answer this request.",
  unavailable: "The AI service is temporarily unavailable. Please try again.",
};
const err = (code) => ({ error: { code, message: MESSAGES[code] } });
// A refusal (stop_reason "refusal") is surfaced with the spec's invalid_request code.
const refusedErr = () => ({ error: { code: "invalid_request", message: MESSAGES.refused } });

export function validateInput(input) {
  const bad = { ok: false, message: "Invalid input." };
  let messages;
  if (typeof input === "string") messages = [{ role: "user", content: input }];
  else if (Array.isArray(input)) messages = input;
  else return bad;
  if (!messages.length) return bad;
  let total = 0;
  for (const m of messages) {
    if (!m || typeof m !== "object" || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string" || !m.content) return bad;
    total += m.content.length;
  }
  if (total > MAX_INPUT_CHARS) return { ok: false, message: "Input too large." };
  if (messages[messages.length - 1].role !== "user") return bad;
  return { ok: true, messages: messages.map((m) => ({ role: m.role, content: m.content })) };
}

export function mapErrorType(type) {
  switch (type) {
    case "rate_limit_error": return "rate_limited";
    case "authentication_error": case "permission_error": return "not_granted";
    case "invalid_request_error": case "not_found_error": case "request_too_large": return "invalid_request";
    default: return "unavailable";
  }
}

function mapStatus(status) {
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "not_granted";
  if (status >= 400 && status < 500) return "invalid_request";
  return "unavailable";
}

export function buildUpstreamRequest(apiKey, messages, json) {
  // between_tools = lowest thinking setting on claude-sonnet-5-5 (no extended thinking), so the
  // 1024 max_tokens go to the reply. It is accepted only at effort high or below and takes no
  // other field, so effort is pinned explicitly. No sampling params: API version 2026-10-21
  // rejects temperature/top_p/top_k at any value. fallbacks "default" retries cyber/frontier_llm
  // refusals server-side (a between_tools request falls back with thinking disabled).
  const body = {
    model: MODEL, max_tokens: MAX_TOKENS, stream: true, messages,
    thinking: { type: "between_tools" }, output_config: { effort: "high" }, fallbacks: "default",
  };
  if (json) body.system = JSON_SYSTEM;
  return {
    url: API_URL,
    init: {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": API_VERSION, "anthropic-beta": FALLBACK_BETA },
      body: JSON.stringify(body),
    },
  };
}

export function parseJsonText(text) {
  let t = String(text).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return { ok: true, value: JSON.parse(t) }; } catch {}
  const s = t.search(/[{[]/);
  const e = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (s !== -1 && e > s) { try { return { ok: true, value: JSON.parse(t.slice(s, e + 1)) }; } catch {} }
  return { ok: false };
}

const line = (obj) => new TextEncoder().encode("data: " + JSON.stringify(obj) + "\n\n");
const SSE_HEADERS = { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" };
const sseResponse = (obj) => new Response(line(obj), { status: 200, headers: SSE_HEADERS });

export function jsonError(status, code, message) {
  return Response.json({ code, message }, { status });
}

export async function handleSample(body, env, fetchImpl = fetch) {
  const v = validateInput(body && body.input);
  if (!v.ok) return jsonError(400, "invalid_request", v.message);
  if (!env.ANTHROPIC_API_KEY) return sseResponse(err("unavailable"));
  const wantJson = !!(body && body.json);
  const up = buildUpstreamRequest(env.ANTHROPIC_API_KEY, v.messages, wantJson);
  let upstream;
  try { upstream = await fetchImpl(up.url, up.init); } catch { return sseResponse(err("unavailable")); }
  if (!upstream.ok || !upstream.body) {
    try { await upstream.body?.cancel(); } catch {}
    return sseResponse(err(mapStatus(upstream.status)));
  }

  const reader = upstream.body.getReader();
  const dec = new TextDecoder();
  let buf = "", text = "", finished = false, stopReason = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (o) => controller.enqueue(line(o));
      const fail = (code) => { finished = true; send(err(code)); };
      const handle = (block) => {
        let data = "";
        for (const l of block.split("\n")) if (l.startsWith("data:")) data += l.slice(5).trimStart();
        if (!data) return;
        let ev;
        try { ev = JSON.parse(data); } catch { return; }
        if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta" && ev.delta.text) {
          text += ev.delta.text;
          send({ delta: ev.delta.text });
        } else if (ev.type === "message_delta" && ev.delta && ev.delta.stop_reason) {
          stopReason = ev.delta.stop_reason;
        } else if (ev.type === "error") {
          fail(mapErrorType(ev.error && ev.error.type));
        } else if (ev.type === "message_stop") {
          finished = true;
          // Whole chain declined (after any server-side fallback): discard partial output.
          if (stopReason === "refusal") send(refusedErr());
          else if (wantJson) {
            const p = parseJsonText(text);
            send(p.ok ? { done: true, json: p.value } : err("invalid_json"));
          } else send({ done: true, text });
        }
      };
      try {
        while (!finished) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          let i;
          while (!finished && (i = buf.indexOf("\n\n")) !== -1) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            handle(block);
          }
        }
        if (!finished) fail("unavailable"); // stream ended without message_stop
      } catch {
        if (!finished) fail("unavailable");
      } finally {
        try { await reader.cancel(); } catch {}
        controller.close();
      }
    },
    cancel() { return reader.cancel().catch(() => {}); },
  });
  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}
