# AI Debate Arena — Design

Date: 2026-11-07

## Purpose

A fun, shareable web page where two AI debaters with user-chosen personas argue
a topic and an AI judge picks a winner. Secondary goal: learn how AI handles
personas, multi-turn context, and AI-as-judge.

**Stated by user:** web page, shareable; topic + optional personas (no live
audience interjection); 3 rounds; include the "under the hood" view.

**Assumptions:** for fun, not serious debate training; no persistence; English.

## Success criteria

- Enter a topic (personas optional), press Start, and watch a complete
  3-round debate stream in, ending with a judge's scorecard.
- Blank personas get auto-generated, contrasting, topic-appropriate characters.
- Debaters visibly respond to each other's specific points in rebuttals.
- Each message can reveal the exact prompt that produced it.
- Works at phone width; failures show a clear message, never a broken page.

## Platform

Single self-contained HTML page published as a private claude.ai Artifact.
All model calls go through the artifact `sample` capability
(`capabilities: {sample: {}}`). No backend, no API key, no storage.
Calls run as the viewer: each viewer consents once; viewers without access see
the setup screen with an explanation and a disabled Start button.

## User flow

1. **Setup screen**: topic text box, 🎲 random-topic button (picks from a
   built-in list of silly topics, no model call), "For" persona box,
   "Against" persona box (both optional), Start button.
2. **Persona generation** (only if a persona box is blank): one
   `sample.json` call returns `{for: {name, emoji, personality}, against: {...}}`.
   User-written personas are passed through; the model only gives them a
   name and emoji.
3. **Debate**: rounds Opening → Rebuttal → Closing; For speaks first each
   round. 6 streamed turns total.
4. **Verdict**: judge persona ("a weary Supreme Court justice") returns a
   scorecard; displayed as a card below the transcript.
5. **New debate** button resets to setup (keeps last inputs).

## Components (inside the one page)

- **Setup form**: collects inputs, validates topic is non-empty.
- **Persona maker**: `makePersonas(topic, forText, againstText) → {for, against}`.
- **Prompt builder**: `buildTurnPrompt(persona, side, round, topic, transcript)`
  → messages array. System-style instructions (persona, side, round goal,
  stay in character, ~120 words max, respond to opponent's points in
  rebuttal/closing) + the full transcript so far. Pure function; its output
  is also what the under-the-hood panel shows.
- **Debate engine**: sequential loop over 6 turns calling `sample` with
  `onText` for streaming and an `AbortController` for Stop. Holds the
  transcript array `[{side, round, text, prompt}]`.
- **Judge**: `sample.json` with transcript; returns
  `{scores: {for: {logic, persuasion, character}, against: {...}}, winner: "for"|"against"|"tie", reasoning}`
  with scores 1–10. Displayed as a scorecard.
- **Chat view**: For bubbles on the left, Against on the right, each with
  emoji avatar, name, round label, and a collapsible "Under the hood"
  section showing the prompt for that turn. Text set via `textContent`.

## Error handling

- `claude.use("sample")` returns null → banner "Claude isn't available in
  this view", Start disabled.
- `not_granted` → same banner explaining permission was declined.
- `rate_limited` or other rejection mid-debate → pause, show error on that
  turn with a "Retry this turn" button; no automatic retry loop. Partial
  streamed text is kept but marked incomplete.
- Judge JSON malformed/missing fields → show the reasoning text if any,
  "Judge couldn't score this one" otherwise, with a Retry button.
- Stop button aborts the in-flight call and ends the debate (no verdict).

## Design / UI

Follows the artifact-design contract: color tokens on `:root` with dark mode,
16px mobile gutters, no horizontal scroll. Playful but readable — a clear
"arena" header, distinct colors for For vs Against.

## Testing

- Prompt builder and judge-result parsing kept as pure functions; spot-check
  in a headless browser with a stubbed `sample`.
- After publishing, run one real debate end-to-end in the published page
  and report what was exercised.

## Out of scope

Audience interjection, saving/sharing debate transcripts, more than 2
debaters, configurable round count, model selection.
