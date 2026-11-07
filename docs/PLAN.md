# AI Debate Arena — Build Plan

## Goal
Implement the spec in `docs/superpowers/specs/2026-11-07-debate-arena-design.md`
(read it first — it is the source of truth for behavior). A single web page,
published as a private claude.ai Artifact, where two AI debaters argue a topic
over 3 rounds and an AI judge scores them.

## Current state
Empty repo with the spec. No code yet.

## Constraints
- **No dependencies, no build step.** Plain HTML/CSS/vanilla JS. Tests use only
  Node 22 built-ins (`node:test`, `node:assert`) and the pre-installed
  `playwright` (`require('playwright')`, `chromium.launch()` with no options —
  never run `playwright install` or `npm install`).
- **Model access** only via `const sample = await claude.use("sample")`.
  Type definitions: `docs/research/claude.d.ts`, `docs/research/sample.d.ts`
  (authoritative — read them). Key facts: `sample(input, opts)` →
  `{text, truncated}`; `sample.json(input, opts)` → parsed value; `input` is a
  string or `[{role, content}]` ending on `user`; calls are memoryless;
  `opts.onText({text, delta})` streams (`text` = whole answer so far);
  `opts.signal` for abort (new AbortController per call); rejections are
  `{code, message, text?}` (`not_granted`, `rate_limited`, …).
  `claude.use()` resolves later (not synchronously) and may resolve `null`.
- **Page design contract:** before writing HTML/CSS, invoke the `artifact-design`
  skill and follow it (title of 2–4 words, color tokens on `:root` with dark
  mode via `prefers-color-scheme` guarded by `:root:not([data-theme="light"])`
  and `:root[data-theme="dark"]`, explicit `body` background, 16px side gutter,
  no horizontal scroll at 375px width). External scripts: none needed.
- **Security:** all model/user text rendered with `textContent`, never `innerHTML`.
- **No secrets** anywhere. No network calls besides `sample`.

## File layout
- `src/index.html` — markup + `<style>`; loads `logic.js` then `app.js` via
  relative `<script src>` (published together as artifact supporting files).
- `src/logic.js` — pure functions, no DOM. Exposes its API on
  `globalThis.DebateLogic` and also via `module.exports` when `module` exists.
- `src/app.js` — DOM wiring, debate engine, calls to `sample`.
- `tests/logic.test.js` — `node --test tests/logic.test.js`
- `tests/app.test.js` — `node --test tests/app.test.js`; Playwright opens
  `src/index.html` via `file://` with `page.addInitScript` installing a fake
  `window.claude` whose `use("sample")` returns a scripted stub
  (deterministic text, simulated streaming, injectable failures).
- Test command for everything: `node --test tests/*.test.js` (plain `node --test tests/` fails on Node 22.23)

## Tasks

### T1 — Pure logic (`src/logic.js`, `tests/logic.test.js`)
API (exact names):
- `ROUNDS = ["Opening", "Rebuttal", "Closing"]`; `TURNS` = 6 entries
  `{round, side}` in order For, Against per round (`side` is `"for"|"against"`).
- `RANDOM_TOPICS` — ≥15 silly debate topics; `pickTopic(rand = Math.random)`.
- `cleanInput(str, max)` — trim, collapse whitespace, cap length
  (topic 200 chars, persona 300).
- `buildPersonaPrompt(topic, forText, againstText)` → string asking for JSON
  `{for:{name,emoji,personality}, against:{...}}`; blank sides are invented
  (contrasting, funny, topic-appropriate); given sides keep the user's
  description as personality and only get a name + emoji.
- `normalizePersonas(raw, forText, againstText)` → always-valid
  `{for, against}`: missing/invalid fields fall back to defaults
  (`"Debater For"`/🟦, `"Debater Against"`/🟥); user-supplied text always wins
  as `personality`; name ≤40 chars; emoji = first grapheme or default.
- `buildTurnPrompt(persona, side, round, topic, transcript)` → messages array
  ending on a `user` message. Includes: persona name+personality, side
  (arguing FOR / AGAINST the topic), round goal, "stay in character",
  "max ~120 words", "no headings or bullet lists"; for Rebuttal/Closing,
  "respond directly to your opponent's specific points". Full transcript of
  prior turns included with speaker names. Empty transcript works.
- `buildJudgePrompt(topic, personas, transcript)` → string requesting JSON
  `{scores:{for:{logic,persuasion,character},against:{...}},winner,reasoning}`,
  scores integers 1–10, reasoning ≤3 sentences, judge persona "a weary
  Supreme Court justice".
- `normalizeVerdict(raw)` → `{scores, winner, reasoning, totals}` or `null`
  when scores are unusable. Clamp/round scores to 1–10; `totals` = sums;
  if `winner` is not `for|against|tie`, derive from totals (equal → tie).
  Keep `reasoning` as string ('' if missing).
Acceptance:
- Unit tests for every function, including: whitespace-only input → '';
  over-long input capped; one persona given + one blank; judge returns
  strings like `"8"`, out-of-range `15`, missing `winner`, garbage → `null`.
- `node --test tests/*.test.js` passes.

### T2 — Page + debate flow (`src/index.html`, `src/app.js`, `tests/app.test.js`)
- Setup screen per spec: topic, 🎲 (fills topic via `pickTopic`), For/Against
  persona boxes, Start. Start disabled while topic is blank (after `cleanInput`).
- On load: `claude.use("sample")`; while pending, Start shows it's connecting;
  if `null` → banner "Claude isn't available in this view" and Start stays disabled.
- Start → personas (call `sample.json` only if a persona box is blank;
  otherwise build via `normalizePersonas` with no call) → 6 turns in order,
  each streamed into its bubble via `onText`. For bubbles left, Against right,
  each with emoji, name, round label.
- Each bubble has a collapsed `<details>` "Under the hood" showing the exact
  messages sent for that turn (role + content).
- Stop button visible during a debate: aborts the in-flight call, marks the
  debate stopped, no verdict; New debate returns to setup with inputs kept.
- Inputs disabled during a debate; double-clicking Start can't start two.
Acceptance (Playwright, with stub):
- Full happy path renders 6 bubbles in correct order/sides with stubbed text.
- Prompt for turn 3+ contains earlier turns' text (verify via the under-the-hood panel).
- Both personas given → zero persona calls; one blank → one `sample.json` call.
- `use` → null shows the banner and Start disabled.
- Model text containing `<img src=x onerror=...>` renders as literal text.
- Stop mid-turn ends the debate with no further calls.
- No horizontal scroll at 375px width.

### T3 — Verdict + error handling (`src/app.js`, `src/index.html`, tests)
- After turn 6: judge call via `sample.json`, result through
  `normalizeVerdict`; scorecard shows both personas, the three scores each,
  totals, winner highlight (or "Tie"), reasoning.
- `normalizeVerdict` → null: show "The judge couldn't score this one" + Retry judge.
- Turn failure (any rejection other than abort): keep partial text marked
  "(cut off)", show error message + "Retry this turn"; retry re-runs that turn
  only and the debate continues. `rate_limited` message says to wait a moment.
  `not_granted` → banner explaining permission was declined; debate ends.
- Persona-call failure → error with Retry on the setup step.
- No automatic retries anywhere.
Acceptance (Playwright, with stub):
- Happy path shows scorecard with correct winner and totals.
- Garbage judge output → fallback message; Retry judge then succeeds.
- Failure on turn 4 → error shown, Retry completes the debate to a verdict
  with exactly 6 bubbles.
- `not_granted` on first call → banner, no further calls.

### T4 — Final review + publish (lead)
Whole-app review (security, spec coverage, mobile layout), then publish
`src/index.html` with files `{logic.js, app.js}` and `capabilities: {sample: {}}`.

## Process
Lead plans and verifies; one Sonnet builder per task (tests first); an Opus
reviewer gates each task and fixes issues with tests. Commits are local only
(no remote). Builders and reviewers do not edit `docs/`.

### T5 — Voice (text-to-speech) (`src/voice.js`, `src/app.js`, `src/index.html`, tests)
Browser Web Speech API (`window.speechSynthesis`, `SpeechSynthesisUtterance`) only; no network.
- `src/voice.js` (classic script, exposes `globalThis.DebateVoice`; Node `module.exports` for unit tests):
  - `isSupported()` → boolean.
  - `assignVoices(voices, lang)` → `{for, against, judge}` each `{voice|null, pitch, rate}`: prefer
    distinct voices matching the page language (`navigator.language` prefix, fallback `en`);
    if fewer than 3 distinct voices, differentiate by pitch/rate (judge low & slow, e.g. pitch 0.8
    rate 0.9; For 1.1/1.05; Against 0.95/1.1 — distinct combos). Pure, unit-tested.
  - `speak(text, speaker)` → Promise resolving when the utterance ends (or errors/cancels — never
    rejects, never hangs: also resolve on `error`, and on `cancel()`). Voices may load async
    (`voiceschanged`); assign lazily on first speak.
  - `cancel()` → stops all speech and resolves any pending `speak` promise.
- UI: a 🔊 Voice toggle (a real button with `aria-pressed`) on the setup screen and in the debate
  toolbar, kept in sync; default off; persisted in `localStorage` wrapped in try/catch (page must
  work if storage throws). Hidden entirely when `isSupported()` is false.
- Flow: when on, after each turn finishes streaming, speak it in that speaker's voice and await it
  before starting the next turn. The verdict is spoken by the judge: "Winner: <name>." (or "It's a
  tie.") then the reasoning. Turning voice off mid-speech cancels speech and the debate continues
  as text. Stop, New debate and a superseded run cancel speech immediately; a superseded run must
  never speak. Status line shows "<name> is speaking aloud…" while speaking.
- Acceptance (Playwright with a fake `speechSynthesis` installed via addInitScript, recording
  utterances and letting tests end them): voice off → zero utterances and same behavior as before;
  voice on → 7 utterances in order (6 turns + verdict) and turn N+1's model call does not start
  until utterance N ends; toggling off mid-utterance cancels and the debate completes; Stop cancels
  speech; no speechSynthesis → toggle hidden, debate works; storage throwing → page still works;
  toggle state persists across reload; no horizontal scroll at 375px. Unit tests for assignVoices.

---

# Phase 2 — Hosted version with ElevenLabs voices (Cloudflare Workers)

Spec: `docs/superpowers/specs/2026-11-07-hosted-premium-voices-design.md` (source of truth).
Approved by user: passcode, daily cap 20 debates/day, claude.ai artifact unchanged in behavior.

## Phase 2 constraints
- Worker code lives in `worker/` as ES modules (`worker/index.js` default export `{ fetch }`).
  Deploy config `wrangler.jsonc` at repo root: `main: "worker/index.js"`, static assets from
  `./src` with binding `ASSETS`, a SQLite-backed Durable Object class `DailyCap` (declared with
  `new_sqlite_classes` migration — works on the free plan, no dashboard setup), and
  `compatibility_date` within the last year. `package.json` may add `wrangler` as a devDependency
  (deploy only); tests must NOT need wrangler.
- Tests: Node 22 `node:test` only, importing worker modules directly and mocking `fetch`
  (global Request/Response/crypto.subtle exist in Node 22). Test command stays
  `node --test tests/*.test.js` (worker tests are `tests/worker-*.test.js`; use `.mjs` or dynamic
  import as needed — the glob must still pick them up).
- Secrets (never in repo, never logged): `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`,
  `ACCESS_PASSCODE`, `SESSION_SECRET`. Var (non-secret, in wrangler.jsonc): `DAILY_CAP = "20"`.
- Anthropic model: use the `claude-api` skill to confirm the current Sonnet model id and the
  streaming Messages API event format before writing code. Do not guess.
- ElevenLabs facts: read `docs/research/elevenlabs.md` (written by the researcher).
- The claude.ai artifact must keep working with zero behavior change: all 95 existing tests
  keep passing; hosted-only code is injected by the Worker, never referenced by `src/index.html`.

## Tasks

### T6 — Worker core: passcode session, Claude proxy, daily cap
- `POST /api/session` `{passcode}` → constant-time compare with `ACCESS_PASSCODE`; on success
  set cookie `da_session` = HMAC-SHA256(`SESSION_SECRET`) signed token with expiry 30 days,
  `HttpOnly; Secure; SameSite=Strict; Path=/`. Wrong → 401 `{code:"bad_passcode"}`.
  Simple brute-force brake: after 5 wrong tries from one IP (`CF-Connecting-IP`) in 10 min → 429.
- `GET /api/session` → 200 `{ok:true}` if cookie valid else 401.
- All other `/api/*` require a valid cookie (401 `{code:"not_granted"}` otherwise).
- `POST /api/sample` `{input, json?:bool, debateStart?:bool}` — `input` is a string or
  `[{role,content}]` ending on user (validate: ≤ 40,000 chars total, roles user/assistant).
  Calls Anthropic Messages API with streaming, max_tokens 1024. Response: `text/event-stream`
  relaying text deltas as `data: {"delta":"..."}` lines, then `data: {"done":true,"text":"..."}`;
  upstream errors → one `data: {"error":{"code","message"}}` line (map 429→rate_limited,
  401/403→not_granted, 400→invalid_request, 5xx/overloaded→unavailable). For `json:true`, the
  server instructs JSON-only output and returns the parsed JSON in the done event as
  `{"done":true,"json":...}` or error code `invalid_json`.
- Daily cap: when `debateStart` is true, increment the `DailyCap` DO counter keyed by UTC date;
  if it would exceed `DAILY_CAP` → 429 `{code:"rate_limited", message:"Daily debate limit reached — try again tomorrow."}`.
- Non-`/api` requests → `env.ASSETS.fetch(request)`; for `/` and `/index.html` use HTMLRewriter
  to inject `<script src="hosted.js"></script>` immediately before the `app.js` script tag.
- Security headers on all responses (no-store on /api, nosniff). No key or passcode ever in
  logs or responses.
Acceptance (unit tests with mocked fetch/env/DO): session ok/bad/brute-force; protected
routes 401 without cookie; tampered/expired cookie rejected; stream relay + done; json mode
valid/invalid; error mapping; cap allows 20th, blocks 21st, resets next UTC day; HTML injection
places hosted.js before app.js; input validation rejects oversize/bad roles.

### T7 — Hosted page adapter + passcode screen (`src/hosted.js`, small `src/app.js` change)
- `app.js`: obtain the model via `globalThis.DebateHost ? DebateHost.sample() : claude.use("sample")`
  (DebateHost.sample() returns a Promise of the same `sample` shape or null). Debate start
  (persona call, or first turn when both personas are given) must pass `debateStart: true`
  through a third opts field the adapter understands; the claude.ai path ignores it.
- `src/hosted.js` (only loaded on the hosted site): defines `globalThis.DebateHost`.
  `sample(messages, {onText, signal, debateStart})` and `sample.json(prompt, {signal, debateStart})`
  over `fetch('/api/sample')`, parsing the SSE stream, calling `onText({text, delta})` with the
  WHOLE text so far, honoring `signal` (abort → reject `{code:'cancelled'}`), rejecting with
  `{code, message, text?}` using the server's codes. Before resolving `sample()`, checks
  `GET /api/session`; if 401, shows a passcode screen (overlay with a labelled password input +
  Enter button, error text on wrong passcode, matches page design tokens light/dark, 375px ok),
  posts to `/api/session`, then resolves.
- Acceptance (Playwright, page served via a tiny Node test server or route interception that
  fakes /api/*): passcode screen appears when unauthenticated, wrong then right passcode, full
  stubbed debate completes through the adapter with streaming, Stop aborts the fetch, daily-cap
  429 shows the friendly message, all 95 existing tests unchanged and passing.

### T8 — ElevenLabs voices: `/api/tts`, casting, hosted voice engine
- Worker `POST /api/tts` `{text, voice}` where `voice` is a key from the curated list in
  `worker/voices.js` (≤ 12 entries `{key, id, label, description}` from docs/research/elevenlabs.md,
  all usable on the free plan; plus `judge` default). Text ≤ 1,500 chars. Calls ElevenLabs
  streaming TTS (model and output format per research doc), streams `audio/mpeg` back. Errors →
  JSON `{code,message}` with mapped status (quota exceeded → rate_limited).
- `GET /api/voices` → the curated list without ids (keys, labels, descriptions).
- Casting: on the hosted site the persona prompt includes the voice list and asks for a `voice`
  key per debater; `normalizePersonas` keeps a valid `voice` key (else assigns distinct defaults,
  For ≠ Against). Claude.ai path unaffected (no voice key requested there).
- Hosted voice engine: `DebateHost.speak(text, speaker, persona)` plays `/api/tts` audio via an
  `<audio>` element / MediaSource or blob URL; `voice.js` uses it when present, keeping its
  contract (never rejects, resolves on end/error/cancel/timeout, cancel stops playback, prime()
  unlocks audio inside the click). On TTS failure for a turn, falls back to built-in browser
  speech for that turn.
- Acceptance: worker unit tests (validation, unknown voice rejected, error mapping, streaming
  passthrough); Playwright tests with faked /api/tts returning a short silent MP3/WAV: 7 clips in
  order, waits between turns, Stop cancels playback, fallback to browser speech on 500.

### T9 — Final review + deploy readiness (lead + Opus reviewer)
Whole-system review (secrets never exposed, cookie security, cap correctness, CORS not opened,
artifact unaffected), README "Deploy to Cloudflare" section accurate to config, then user
performs Part 2 (connect repo, add secrets) and the live test.
