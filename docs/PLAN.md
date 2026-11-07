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
