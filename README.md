# AI Debate Arena

A single web page where two AI debaters argue a topic over three rounds and an
AI judge (a weary Supreme Court justice) scores them. Pick a topic (or roll the
🎲 for a silly one), optionally describe the For and Against debaters, press
Start, and watch it stream in.

It runs as a private claude.ai Artifact, using the **viewer's own Claude access**
through the artifact `sample` capability (`capabilities: {sample: {}}`). There is
no backend, no API key and no storage. Each viewer is asked once to allow the
page to use Claude; if Claude isn't available (or the page is opened as a plain
file), the page shows a banner and Start stays disabled.

## How it works

1. **Personas**: if either persona box is blank, one `sample.json` call invents
   contrasting, topic-appropriate characters (`{name, emoji, personality}`).
   A persona you write is kept word for word; if both are written, no call is
   made and names are derived from your text.
2. **Six streamed turns**: Opening, Rebuttal, Closing, with For speaking first
   each round. Each turn is one `sample` call streamed into its bubble via
   `onText`. The prompt asks for an in-character, ~120-word, plain-prose speech,
   and from the Rebuttal on it must answer the opponent's specific points.
3. **Judge**: one `sample.json` call returns scores (1 to 10 for logic,
   persuasion and character), a winner and short reasoning, shown as a
   scorecard. When totals differ, the higher total wins.

**Under the hood**: every bubble has a collapsible panel showing the exact
prompt that produced it. Calls are memoryless, so each turn re-sends the whole
transcript so far; that is the only way a debater "remembers" what was said and
can rebut it. All calls pass `cache: false`, so re-running the same topic gives
a fresh debate.

**Failures**: Stop aborts the current call and ends the debate (no verdict). A
failed turn keeps any partial text marked "(cut off)" with a "Retry this turn"
button; a judge that can't score offers "Retry judge"; nothing retries
automatically. Permission declined (or Claude disabled for the account/view)
shows a banner and disables Start for the rest of the view.

**Voice**: a "🔊 Voice" toggle (setup screen and debate toolbar, off by default,
remembered in `localStorage` when available) reads each turn aloud with the
browser's built-in speech synthesis, in a distinct voice (or pitch/rate) per
debater, and the judge reads the verdict. The next turn starts only after the
current one has been spoken. Turning it off, Stop or New debate cancels speech
at once. The toggle is hidden if the browser has no `speechSynthesis`.

**Premium voices (hosted site only)**: on the Cloudflare-hosted version the toggle plays
ElevenLabs voices instead (`POST /api/tts`, model `eleven_flash_v2_5`, `mp3_22050_32`; the
key is the Worker secret `ELEVENLABS_API_KEY`). Claude casts a voice per debater from the
12 curated premade voices in `worker/voices.js`; Bill is always the judge. If a clip fails
for any reason, that turn is spoken with the built-in browser voices; after a quota
(`insufficient_credits`), retired-voice, or missing/rejected-key failure ElevenLabs is
skipped for the rest of the page session. The claude.ai artifact never uses any of this.

## Files

- `src/index.html` — markup and styles (light and dark themes); loads the two scripts.
- `src/logic.js` — pure functions: topics, input cleanup, prompt builders
  (`buildPersonaPrompt`, `buildTurnPrompt`, `buildJudgePrompt`), persona and
  verdict normalization. Works in the browser and in Node.
- `src/voice.js` — text-to-speech wrapper (`DebateVoice`: voice assignment, `speak`, `cancel`).
- `worker/` — the Cloudflare Worker (`index.js` routing/auth, `session.js` passcode cookie,
  `sample.js` Claude proxy, `cap.js` daily cap Durable Object, `tts.js`/`voices.js` ElevenLabs,
  `inject.js` adds `hosted.js` to the page). `src/hosted.js` — hosted-only adapter and audio engine.
- `wrangler.jsonc` — Worker config (no secrets).
- `src/app.js` — DOM wiring and the debate engine (all `sample` calls).
- `tests/logic.test.js` — unit tests for `logic.js`.
- `tests/voice.test.js`, `tests/app-voice.test.js` — voice unit and Playwright tests.
- `tests/app.test.js` — Playwright tests that open `src/index.html` with a
  stubbed `window.claude`.
- `docs/` — design spec, build plan and the `sample` API type definitions.

## Tests

Requires Node 22 and Playwright (Chromium) available to `require('playwright')`.

```
node --test tests/*.test.js
```

## Publishing

Publish `src/index.html` as the artifact page with `logic.js`, `voice.js` and `app.js` as
supporting files at the same relative paths, and `capabilities: {sample: {}}`.

## Deploy to Cloudflare (hosted version)

The hosted site is a Cloudflare Worker (`worker/index.js`) that serves the files in `src/`
(and only those) and adds a passcode screen, a Claude proxy, a daily debate cap and
ElevenLabs voices. Everything below is free-plan friendly; config is in `wrangler.jsonc`.

### 1. Connect the repository (one time)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository**
   (connect GitHub if asked) → pick **unclep415/debate-arena**.
2. On the configure screen:
   - **Project name**: `debate-arena` (must match `"name"` in `wrangler.jsonc`).
   - **Production branch**: `main`.
   - **Build command**: leave empty (there is nothing to build; dependencies from
     `package-lock.json` are installed automatically).
   - **Deploy command**: `npx wrangler deploy` (the default).
   - **Non-production branch deploy command**: leave the default (`npx wrangler versions upload`).
   - **Root directory**: `/` (the default).
3. **Deploy**. The first deploy goes live without secrets; until you add them the site
   stays locked (signing in answers "Server is not configured…").

After this, every push to `main` redeploys automatically.

### 2. Add the four secrets

Workers & Pages → **debate-arena** → **Settings** → **Variables and Secrets** → **Add**.
Choose type **Secret** for each (plain-text variables are wiped by the next deploy):

| Name | Value |
| --- | --- |
| `ANTHROPIC_API_KEY` | Your Anthropic API key (console.anthropic.com). |
| `ELEVENLABS_API_KEY` | Your ElevenLabs API key (optional, see below). |
| `ACCESS_PASSCODE` | The passcode you give to people allowed to use the site. |
| `SESSION_SECRET` | A long random string used to sign the login cookie. |

To make `SESSION_SECRET`, run `openssl rand -hex 32` in a terminal, or open any browser's
developer console (F12 → Console) and paste
`[...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('')`.
Copy the 64-character result. Changing it later signs everyone out.

Secrets take effect right away and survive future deploys. They are never sent to the
browser or written to logs.

What happens if one is missing:
- `ACCESS_PASSCODE` or `SESSION_SECRET` missing: nobody can get in (the passcode screen
  shows "Server is not configured…"). The site never opens without both.
- `ANTHROPIC_API_KEY` missing: after the passcode, Start shows "Server is not configured:
  … ANTHROPIC_API_KEY …" (no debate is counted). A wrong key shows "The server's Anthropic
  API key was rejected…".
- `ELEVENLABS_API_KEY` missing or rejected: the Voice toggle quietly uses the browser's
  built-in voices instead.

### 3. Daily cap (`DAILY_CAP`)

`DAILY_CAP` in `wrangler.jsonc` (default `"20"`) is the number of debates per UTC day for
the whole site; the 21st start that day gets "Daily debate limit reached — try again
tomorrow." Coarser server backstops also limit Claude calls (10 × cap) and voice clips
(16 × cap) per day. To change it, edit `wrangler.jsonc` and push (a value edited in the
dashboard is reset to the file's value on the next deploy).

### ElevenLabs free plan reality

- The free plan has 10,000 credits a month (no rollover). One voiced debate is roughly
  4,000–5,000 characters of speech, and Flash v2.5 costs 0.5–1 credit per character, so
  expect only **about 2–5 voiced debates a month**. Debates without voice cost no credits.
- The 12 curated voices are ElevenLabs "Default" (premade) voices, which ElevenLabs retires
  on **2026-12-31**. After that, or once credits run out, clips fail and the app
  **falls back automatically** to the browser's built-in voices (Claude and the debate keep
  working). To keep premium voices, update the voice ids in `worker/voices.js`.
- The free plan is for non-commercial use.

### Logs and troubleshooting

Workers & Pages → **debate-arena** → **Logs** shows each request (path, status, errors);
Workers Logs is enabled in `wrangler.jsonc`. Build/deploy output is under
**Deployments** (or the build's **View details**). The Worker logs no secrets, passcodes or
debate text.

Check a deploy locally without an account: `npm install` then
`npx wrangler deploy --dry-run --outdir /tmp/wrangler-out`.
