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

## Files

- `src/index.html` — markup and styles (light and dark themes); loads the two scripts.
- `src/logic.js` — pure functions: topics, input cleanup, prompt builders
  (`buildPersonaPrompt`, `buildTurnPrompt`, `buildJudgePrompt`), persona and
  verdict normalization. Works in the browser and in Node.
- `src/voice.js` — text-to-speech wrapper (`DebateVoice`: voice assignment, `speak`, `cancel`).
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
