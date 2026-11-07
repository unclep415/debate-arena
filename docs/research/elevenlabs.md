# ElevenLabs API notes (AI Debate Arena)

Re-verified 2026-11-07 against official pages on `elevenlabs.io` (reachable via the agent proxy). Replaces the earlier snippet-only notes.

**Legend.** Each fact cites its official URL. **UNCONFIRMED** = not found on an official page we could read. Do not build on UNCONFIRMED items without checking.

**Access note.** `help.elevenlabs.io` is blocked in this session (`connect_rejected`). Help-center pages were read via their mirrors under `elevenlabs.io/docs/help-center/...`. WebFetch cannot resolve `elevenlabs.io`; the pages were fetched with curl.

---

## 1. Streaming TTS endpoint

- **Method and path:** `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream` (path shown in the example at https://elevenlabs.io/docs/api-reference/text-to-speech/stream).
- **Auth header:** `xi-api-key: <key>` (same page; the header is listed as optional in the reference, but the example sends it and it is required in practice).
- **Query params:** `output_format` (default `mp3_44100_128`), `optimize_streaming_latency` (deprecated), `enable_logging` (default true; `false` = zero-retention, enterprise only). Source: stream page.
- **Body fields:** `text`, `model_id`, `voice_settings` (per-request override, applied to that request only), plus optional `language_code`, `previous_text`/`next_text`, `pronunciation_dictionary_locators`, `apply_text_normalization`, and others. Source: https://elevenlabs.io/docs/api-reference/text-to-speech/stream and /convert.
- **voice_settings sub-fields:** `stability`, `similarity_boost`, `use_speaker_boost`, `style`, `speed`. Source: `settings` object in https://elevenlabs.io/docs/api-reference/voices/search. The per-request type and range list is collapsed on the reference page: UNCONFIRMED.
- **output_format values:** `codec_sample_rate_bitrate`. Full enum (21 values) from the stream page HTML: `mp3_22050_32`, `mp3_24000_48`, `mp3_44100_32/64/96/128/192`, `opus_48000_32/64/96/128/192`, `pcm_8000/16000/22050/24000/32000/44100/48000`, `ulaw_8000`, `alaw_8000`. Source: https://elevenlabs.io/docs/api-reference/text-to-speech/stream (the docs say "Show 21 enum values").
  - **Recommended low-bandwidth MP3: `mp3_22050_32`.** Valid per the enum above; the docs' own example of this format is at the same URL.
  - Gated: MP3 192 kbps needs Creator or above; PCM 44.1 kHz needs Pro or above (same page).
- **Response content type:** the page says "Streaming audio data" but gives no media type. `audio/mpeg` for MP3: UNCONFIRMED.
- **Max characters per request:** per model (section 2). Global maximum: not stated.

Example (verified against the documented path and parameters; not yet run with a live key):

```
curl -X POST "https://api.elevenlabs.io/v1/text-to-speech/VOICE_ID/stream?output_format=mp3_22050_32" \
  -H "xi-api-key: $ELEVENLABS_API_KEY" -H "Content-Type: application/json" \
  -d '{"text":"Order, order!","model_id":"eleven_flash_v2_5"}' --output line.mp3
```

---

## 2. Models

Source for the table: https://elevenlabs.io/docs/overview/models (sections "Flagship models", "Character limits", "Deprecated models").

| Model ID | Use | Char limit / request | Notes |
|---|---|---|---|
| `eleven_v4` | Highest quality, most emotive | 10,000 (about 10 min) | 90+ languages. Recommended for quality. |
| `eleven_v4_turbo` | Real-time, expressive | UNCONFIRMED (not in the limits table) | Median latency about 100 ms; audio tags supported. |
| `eleven_flash_v2_5` | Fast, cheap, low latency | 40,000 (about 40 min) | About 100 ms latency; 32 languages; "50% lower price per character for API generations". |
| `eleven_v3` | Expressive, dramatic | 5,000 (about 5 min) | Older generation. Earlier note said 3,000 - the docs now say 5,000. |
| `eleven_multilingual_v2` | Stable long-form | 10,000 | 29 languages. Better number normalization than Flash. |
| `eleven_turbo_v2_5` | - | - | **Deprecated** (listed under "Deprecated models"); docs say use Flash. |

Source for the v4 entries: https://elevenlabs.io/docs/overview/models (Flagship models).

**Credits per character (API):**
- Flash v2.5 and Flash/Turbo v2: discounted, **0.5 to 1 credit per character** for API use (https://elevenlabs.io/pricing, FAQ "How do text characters and credits work?").
- Multilingual v2: **1 credit per character** (same FAQ).
- Text to Speech generally: 1 credit per character (same FAQ).
- Eleven v4 / v4 Turbo / v3 credit rate: UNCONFIRMED (the FAQ names only the groups above).

**Free-plan API access per model:** UNCONFIRMED. No page lists model-by-model free-tier eligibility.

**Recommendation for the Arena:** `eleven_flash_v2_5` for cheapest low latency; `eleven_v4` if quality matters more than latency and the free allowance (section 3) covers it.

---

## 3. Free plan

Source: https://elevenlabs.io/pricing and its FAQ.

- **Credits:** Free plan = **10,000 credits per month** ("Free $0 (10,000 credits)").
- **Rollover:** "Rollover does not apply to the Free plan." (FAQ). Earlier note saying rollover applies is **wrong for Free**.
- **Per-request credit cap:** exists for Free and paid plans; the number is not stated (UNCONFIRMED).
- **API access on Free:** not stated as a yes or no on the pricing page. The voices docs warn "Voice Library voices are not available via the API to free tier users" (https://elevenlabs.io/docs/eleven-creative/voices/voice-library), which implies free users can call the API. Treat as implied, not confirmed.
- **Commercial use:** the pricing comparison lists "Commercial License" under **Starter** ("Everything in free, plus Commercial License"). So the Free plan does not include a commercial license. Free use is therefore non-commercial. Source: https://elevenlabs.io/pricing.
- **Attribution requirement:** the earlier note said the free plan requires attribution. Not found on the pricing page or the voice pages we read: UNCONFIRMED. Check the Terms of Service before any public deployment: https://elevenlabs.io/terms-of-use.

---

## 4. Default voices: what expires, and what replaces them

**Official statement** (the earlier "expire 2026-12-31" claim is correct):

> "Our Default voices are being replaced with new voices that you will be able to use in perpetuity. All our Default voices will expire on December 31, 2026, and they will no longer be accessible after this date." (https://elevenlabs.io/docs/overview/capabilities/voices.md, Warning block; also https://elevenlabs.io/docs/help-center/product/voices/my-voices/what-are-default-voices.md)

- **What is retired:** all **Default** voices, on **December 31, 2026**.
- **Scope:** "Default voices are only available for accounts that were created before March 2026." So a new account (or any account made after March 2026) has no Default voices at all. Our account's eligibility is UNCONFIRMED.
- **Legacy voices** (the older Antoni, Charlie, George, Callum, etc.) are "fully deprecated and removed from all products." API calls with a legacy voice ID "will automatically route to their replacement voice IDs" (https://elevenlabs.io/docs/help-center/product/voices/my-voices/what-are-legacy-voices.md).
- **Replacements:** the Default-to-new table (https://elevenlabs.io/docs/help-center/product/voices/my-voices/what-are-default-voices.md) maps each old Default voice to a **Voice Library** voice (`elevenlabs.io/app/voice-library?voiceId=...`). The replacements are "not a strict 1-to-1 replacement."

**Which voices a FREE-plan API user can use going forward:**

- Voice Library voices: **"Voice Library voices are not available via the API to free tier users."** (https://elevenlabs.io/docs/overview/capabilities/voices.md, Warning). This is a blanket statement.
- Per voice, the API returns `sharing.free_users_allowed` and `available_for_tiers` (https://elevenlabs.io/docs/api-reference/voices/search). A voice can be checked at runtime.
- Some library voices are paid-only ("This voice is not available for free users", https://elevenlabs.io/docs/eleven-creative/voices/voice-library).
- Premade voices: the API filters by `category=premade` (https://elevenlabs.io/docs/api-reference/voices/search). Whether any premade voice is free-tier usable: UNCONFIRMED.
- Voice Design and Voice Cloning on Free: UNCONFIRMED.

**Answer to item 4:** no voice is officially confirmed as usable by a free-plan API user that also stays available permanently. The official "perpetuity" promise covers the replacement voices, but the free-tier API restriction on library voices conflicts with that for our use case. Filter voices at runtime with `GET /v2/voices?category=premade` (or the search endpoint) and check `sharing.free_users_allowed` and `available_for_tiers`.

---

## 5. Errors

Source: https://elevenlabs.io/docs/eleven-api/resources/errors

**Body shape** (exact example from the page):

```json
{"detail": {"type": "validation_error", "code": "invalid_parameters",
  "message": "...", "status": "invalid_parameters", "request_id": "...", "param": "keyterms"}}
```

Fields: `type`, `code`, `message`, `status` (legacy, do not use), `request_id`, `param`. Branch on `detail.code`.

| Case | HTTP | `detail.type` | `detail.code` |
|---|---|---|---|
| Invalid API key | 401 | `authentication_error` | `invalid_api_key` (also `missing_api_key`, `invalid_authorization_header`) |
| Quota / credits exhausted | 402 | `payment_required` | `insufficient_credits` |
| Rate limit | 429 | `rate_limit_error` | `rate_limit_exceeded` |
| Concurrency limit | 429 | `rate_limit_error` | `concurrent_limit_exceeded` |
| System busy | 429 | `rate_limit_error` | `system_busy` |
| Invalid voice ID | 404 | `not_found` | `voice_not_found` |
| Text too long | 400 (per type table) | `validation_error` | `text_too_long` |
| Feature/model not on plan | 403 | `authorization_error` | `feature_not_available` / `model_access_denied` / `voice_access_denied` |

- The earlier note's "quota exceeded" with a 401 and the code `quota_exceeded`: **not found** on the official errors page. Quota exhaustion is `insufficient_credits` (402).
- The `text_too_long` code is listed under `validation_error`. The page's type table maps `validation_error` to 400.
- 429: back off exponentially on `rate_limit_exceeded`; wait for in-flight requests on `concurrent_limit_exceeded` (page text).

Rule for the code: log the full JSON on any non-2xx and branch on `detail.code`.

---

## 6. Voices for the Arena

**Caveat.** The official replacement table (section 4) gives IDs and names only. It gives no gender, age, or accent. Descriptors below come from the names. Listen to each voice in the Voice Library before casting. Free-tier API access for each voice is UNCONFIRMED (section 4).

Source for all IDs: https://elevenlabs.io/docs/help-center/product/voices/my-voices/what-are-default-voices.md (replacement column).

| # | Name | voice_id | Name-based descriptor (UNCONFIRMED gender/age/accent) | Suggested role |
|---|---|---|---|---|
| 1 | Darian - Warm Grounded Storyteller | `gOupLcAkjEnguROwi4oS` | Warm, grounded | Host / narrator |
| 2 | Talia - Warm Soft Guide | `OZ0L6eISlOejga3XjDFt` | Warm, soft | Moderator |
| 3 | Elara - Crisp Pro Narrator | `WQP7cQUF5aAS6Axh5yaa` | Crisp, professional | Neutral narrator |
| 4 | Baxter - Dry Calm Aussie | `jSuBIjxMKhqIfb0wCK1F` | Dry, calm, Australian accent | Dry-wit debater |
| 5 | Eldrin - Crisp British Baritone | `6WwXjDDEMyNmFG95zycZ` | British baritone | Pompous debater |
| 6 | Callum - Husky Trickster | `fs2OqxduwXgp9foh2xjK` | Husky, sly | Trickster debater |
| 7 | Kaelen - Amateur Warrior | `10NkTYmU7tSz3Kkl3Lex` | Earnest, bombastic | Overconfident debater |
| 8 | Lawrence - Bright and Informative | `ktkP7Nsj67dw2zcplQYt` | Bright, earnest | Eager-nerd debater |
| 9 | Wyatt - Seasoned Mentor | `FrS6cKLB1wg4WYgPa9GW` | Seasoned, mentor-like | **Weary old judge (best name fit; UNCONFIRMED)** |
| 10 | Jade - Upbeat and Natural | `g7LVvkPWALzPxOQbF6OE` | Upbeat | Chirpy debater |
| 11 | Warren - Effortless and Cool | `7QN34D2r3hCNwbOYIeK0` | Laid-back | Smug debater |
| 12 | Maisie - Friendly Casual Neighbor | `QtY3JBOUKEB5xzrRfOKc` | Friendly, casual | Gossip / commentator |

- **Weary old judge:** no voice is named as old or weary. Wyatt (#9) is the closest name match. Eldrin (#5) is an alternative. Both UNCONFIRMED.
- Adam (Antoni's replacement) and Rachel: IDs not found on any official page we read. Do not use until confirmed.

**Action before use:** pull each ID's metadata with `GET /v2/voices` (filter `category`, `search`) and confirm `sharing.free_users_allowed` and `available_for_tiers` for the free plan.

---

## Open items

1. Confirm free-tier API eligibility for each voice in section 6 (runtime check or the Voice Library).
2. Confirm the `audio/*` Content-Type of streamed MP3.
3. Confirm the attribution requirement in the Terms of Service, if any.
4. Confirm credit cost and free-plan access for `eleven_v4` and `eleven_v4_turbo`.
5. Confirm the per-request credit cap on the Free plan.
6. Check the account creation date: Default voices are available only for accounts created before March 2026.
