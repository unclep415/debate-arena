# ElevenLabs API notes (AI Debate Arena)

**Source status.** The official docs at `elevenlabs.io` could NOT be fetched: in this session the host did not resolve (`getaddrinfo ENOTFOUND elevenlabs.io`). `elevenlabs.io` must be added to the session's allowed network domains before these notes can be verified page-by-page. Everything below comes from one of two places:

- **[snippet]** = text returned by a web search restricted to `elevenlabs.io`. The page body was not read, so re-check before relying on it.
- **UNCONFIRMED** = not found in any official source gathered here. Do not build on it without checking.

Date of research: 2026-11-07.

---

## 1. Text-to-speech endpoints

- **Non-streaming:** `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}` [snippet: https://elevenlabs.io/docs/api-reference/text-to-speech/convert]
- **Streaming:** path not confirmed. The stream reference page was not returned by search. Expected form `POST /v1/text-to-speech/{voice_id}/stream` is UNCONFIRMED. Check https://elevenlabs.io/docs/api-reference/text-to-speech/stream.
- **Auth header:** `xi-api-key: <key>` [snippet: https://elevenlabs.io/docs/eleven-api/resources/errors]
- **Body JSON fields:** `text`, `model_id`, `voice_settings` [snippet: convert page]. `voice_settings` sub-fields: `stability`, `similarity_boost`, `style`, `use_speaker_boost`, `speed` [snippet: https://elevenlabs.io/docs/developers/guides/cookbooks/text-to-speech/streaming]. Per-request `voice_settings` overrides the voice's stored settings for that request only [snippet: convert page]. Types, ranges and the full field list: UNCONFIRMED.
- **`output_format` (query param):** format string is `codec_sample_rate_bitrate`. Default `mp3_44100_128` [snippet: convert page]. Low-bandwidth MP3 candidate: **`mp3_22050_32`** [snippet: convert page]. Some high-quality formats are plan-gated [snippet]. `ulaw_8000` is suggested for telephony [snippet: https://elevenlabs.io/blog/text-to-speech-api-integration]. Full allowed-value list: UNCONFIRMED.
- **Response content type:** for MP3 output `audio/mpeg` is expected but UNCONFIRMED.
- **Max characters per request:** `eleven_flash_v2_5` up to 40,000 [snippet: help.elevenlabs.io models article]. Other models: see section 2 (conflicting). Global maximum: UNCONFIRMED.

Example (built from the facts above; verify before use):

```
curl -X POST "https://api.elevenlabs.io/v1/text-to-speech/VOICE_ID?output_format=mp3_22050_32" \
  -H "xi-api-key: $ELEVENLABS_API_KEY" -H "Content-Type: application/json" \
  -d '{"text":"Order, order!","model_id":"eleven_flash_v2_5"}' --output line.mp3
```

---

## 2. Models

Recommended for low-latency, expressive speech:

| Model ID | Notes | Source |
|---|---|---|
| `eleven_flash_v2_5` | Recommended low-latency model. 32 languages. About 50% lower API price per character than the older model. | [snippet: https://help.elevenlabs.io/hc/en-us/articles/17883183930129-What-models-do-you-offer-and-what-is-the-difference-between-them] |
| `eleven_v3` | Most expressive model. API price is discounted vs. website. Character limit conflicts between sources: 3,000 vs. 5,000. | [snippet: same help article; https://help.elevenlabs.io/hc/en-us/articles/35869113958801-How-much-does-it-cost-to-generate-using-Eleven-v3] |
| `eleven_turbo_v2_5` | Deprecated. Help article says it is "outclassed by Flash models" and points to `eleven_flash_v2_5`. | [snippet: help article above] |
| `eleven_v4` | Mentioned in the integration guide examples and in a pricing snippet. Not verified against a model page. | UNCONFIRMED |

**Credits per character.**
- Flash v2.5 through the API: about **0.5 credit per character** ("half the credits per character") [snippet: https://elevenlabs.io/docs/overview/models]. Older text says "1 credit per 2 characters", which is the same rate. Confirm on the pricing page.
- Other models: sources conflict. Treat as UNCONFIRMED until checked on https://elevenlabs.io/pricing/api.

**Free-plan availability per model:** UNCONFIRMED. The free plan's API access is covered in section 3.

---

## 3. Free plan

- **Allowance:** 10,000 credits per month, roughly 10 minutes of audio, no credit card [snippet: https://elevenlabs.io/pricing, https://elevenlabs.io/pricing/api].
- **Rollover:** unused credits roll over for up to two months [snippet: developer docs].
- **API access on free:** a snippet implies yes (a Free row appears in the concurrency table) but this is an inference. UNCONFIRMED.
- **Terms:** free plan is for personal, non-commercial use and requires attribution to ElevenLabs [snippet: https://elevenlabs.io/pricing]. **Check this before a public deployment of the Arena.**
- **Premade/default voices via API on free:** UNCONFIRMED.
- **Voice Library (community) voices need a paid plan:** UNCONFIRMED.
- **Default voices expire:** a help article snippet says all Default voices expire on **December 31, 2026**, and legacy voice IDs are routed to replacement Default voice IDs [snippet: https://help.elevenlabs.io/hc/en-us/articles/26942950589969-What-are-Default-voices]. Today is 2026-11-07, so do not hard-code voice IDs. Fetch them at build time.

---

## 4. Errors

- **401 (invalid/missing key):** [snippet: https://elevenlabs.io/docs/eleven-api/resources/errors; https://help.elevenlabs.io/hc/en-us/articles/19572237925521-API-Error-Code-400-or-401]. Body shape: a JSON `detail` object is referenced; exact inner keys UNCONFIRMED. Use the `detail.status` value to branch.
- **Quota exceeded:** conflicting. A changelog snippet says 401 with a "quota exceeded" message [snippet: https://elevenlabs.io/docs/changelog/2025/5/5]. The help center lists a `quota_exceeded` code [snippet: help article]. UNCONFIRMED which is current.
- **429 (rate/concurrency):** docs name `rate_limit_exceeded` (per-endpoint) and `concurrent_limit_exceeded` [snippet: errors page]. Help center names `too_many_concurrent_requests` and `system_busy` [snippet: https://help.elevenlabs.io/hc/en-us/articles/19571824571921-API-Error-Code-429]. Use exponential backoff. Responses carry concurrency headers that can be logged [snippet].
- **Invalid voice ID:** status and body UNCONFIRMED.
- **Text too long:** the limits are in section 1 and 2. The status code is UNCONFIRMED.

Rule for the code: log the full JSON response body on any non-2xx and branch on `detail.status`. Do not assume the names above.

---

## 5. Premade / default voices

Lookup: `GET /v2/voices` with a category filter (`premade`); up to 100 IDs per lookup [snippet: https://elevenlabs.io/docs/api-reference/voices/search]. The older `GET /v1/voices/{voice_id}` also exists [snippet].

Voice descriptions (gender/age/accent) are UNCONFIRMED for every entry. Listen to each preview from the list endpoint before casting.

| Role idea | Name | voice_id | Status |
|---|---|---|---|
| Versatile female narrator | Rachel | `21m00Tcm4TlvDq8ikWAM` | ID [snippet: convert/voice docs]; premade category [snippet]; description UNCONFIRMED |
| Legacy male (old) | Charlie | `IKne3meq5aSn9XLyUdCD` | Legacy ID [snippet: help article]. Replacement "Baxter - Dry Calm Aussie"; replacement ID UNCONFIRMED. Prefer the replacement. |
| Legacy male (British) | George | `JBFqnCBsd6RMkjVDRZzb` | Legacy ID [snippet]. Replacement "Eldrin - Crisp British Baritone"; replacement ID UNCONFIRMED. |
| Legacy male (trickster) | Callum | `N2lVS1w4EtoT3dr4eOWO` | Legacy ID [snippet]. Replacement "Callum - Husky Trickster"; replacement ID UNCONFIRMED. |
| Male (replaces Antoni) | Adam | UNCONFIRMED | Adam is named as Antoni's replacement [snippet]. ID not found. |
| Weary old judge | UNCONFIRMED | UNCONFIRMED | Search the list by description. Not found. |
| Gruff/bright/young/accent entries (x6) | UNCONFIRMED | UNCONFIRMED | Not found in any source gathered here. Pull from `GET /v2/voices?category=premade`. |

Summary: only Rachel's ID is confirmed by a snippet. The others need the list endpoint.

---

## 6. CORS

UNCONFIRMED. Not needed for the planned server-side call from a Cloudflare Worker.

---

## Open items

1. Allow `elevenlabs.io` in the session network settings, then re-run the research against the pages listed above.
2. Confirm the streaming path and `output_format` allowed values.
3. Confirm free-plan API access per model and the quota/429 error names.
4. Pull the premade voice list and cast the debate characters from it, storing IDs in config, not in code.
