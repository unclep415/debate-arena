# Hosted Debate Arena with Premium Voices — Design

Date: 2026-11-07

## Purpose
A self-hosted version of the Debate Arena on Cloudflare Workers that uses
ElevenLabs character voices, so debates sound human. The claude.ai artifact
version stays as-is (free, uses each viewer's own Claude access, built-in voices).

**Stated by user:** deploy to Cloudflare; use ElevenLabs.
**Assumed (user may change):** passcode-protected; daily debate cap; owner pays
for Anthropic + ElevenLabs usage.

## Success criteria
- Visiting the site asks for a passcode; with it, the full debate works exactly
  like the artifact (setup, personas, 3 rounds streamed, judge scorecard,
  under-the-hood, stop/retry).
- With Voice on, every turn and the verdict play in ElevenLabs voices that fit
  each persona; each speaker sounds different.
- No API key ever reaches the browser or the git repo.
- A daily cap (default 20 debates/day, configurable) stops runaway costs; the
  page shows a friendly "daily limit reached" message.
- Reviewed pushes to `main` redeploy automatically.

## Architecture
One Cloudflare Worker project serving:
- **Static assets:** the existing `src/` page files, reused unchanged except for
  one swap point (below).
- **`POST /api/sample`:** streams a Claude reply via the Anthropic Messages API
  (server holds `ANTHROPIC_API_KEY`). Accepts the same input the page already
  builds (messages array or prompt string) plus `json: true` for persona/judge
  calls. Model: current Sonnet (confirm exact id from the claude-api reference
  at build time). Server enforces max_tokens and input size limits.
- **`POST /api/tts`:** sends `{text, voiceId}` to ElevenLabs (server holds
  `ELEVENLABS_API_KEY`) and streams back MP3. Rejects voiceIds not in the
  curated list and text over ~1,500 chars.
- **`POST /api/session`:** checks the passcode (`ACCESS_PASSCODE` secret) and
  sets a signed, HttpOnly session cookie; all `/api/*` routes require it.
- **Daily cap:** counted per day in Workers KV (or a Durable Object if KV
  consistency is insufficient); a debate is counted when its persona/first turn
  call starts.

## Page changes (shared code, both versions)
- **Model adapter:** `app.js` keeps calling a `sample` object with the same
  shape (`sample(messages,{onText,signal})`, `sample.json(...)`, rejections
  `{code,message,text?}`). On claude.ai it comes from `claude.use("sample")`;
  on the hosted site a new `src/hosted-sample.js` provides it over `/api/sample`.
  So the debate logic stays one codebase.
- **Voice adapter:** `voice.js` gains a second engine: on the hosted site,
  `speak()` fetches `/api/tts` and plays the MP3 (same never-reject /
  cancel / timeout contract). The built-in browser voices remain the fallback
  if TTS fails.
- **Casting voices:** a curated list of ~8–12 ElevenLabs voices with short
  descriptions (e.g. "gravelly old man", "bright young woman"). The persona
  prompt asks Claude to pick a `voice` key for each debater from that list;
  the judge has a fixed voice. User-written personas get a voice chosen too.
- **Passcode screen** on the hosted site only.

## Error handling
- Wrong passcode → message, no lockout beyond simple rate limiting.
- Daily cap hit → `{code:"rate_limited"}` with a "daily limit reached" message.
- Anthropic/ElevenLabs errors map to the existing rejection codes so current
  retry UI works; TTS failure falls back to browser voices for that turn.

## Deployment
- `wrangler.toml` in repo (no secrets). Secrets set in the Cloudflare dashboard:
  `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `ACCESS_PASSCODE`, `SESSION_SECRET`.
- Cloudflare Workers Builds connected to `unclep415/debate-arena` → deploys `main`.

## Testing
- Worker routes unit-tested with mocked Anthropic/ElevenLabs (no real keys in CI).
- Existing 95 page tests keep passing; new tests for the adapters and passcode screen.
- Live check after deploy is done by the user (keys exist only in their account).

## Out of scope
User accounts, per-user quotas, voice cloning, saving debates.
