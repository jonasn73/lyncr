# AI receptionist (Telnyx Voice AI)

lyncr uses **Telnyx** for telephony and **Telnyx Voice AI** for the no-answer fallback. There is **no Vapi or ElevenLabs** in the app path.

## How to confirm AI is active **for a specific business number**

lyncr saves **per-number** routing (or a **default** row that applies when there is no row for that DID). To see what actually applies:

1. **Dashboard** — Under “Calls Are Being Routed”, each business line shows a chip:
   - **AI fallback live** — Effective `fallback_type` is `ai` for that line **and** `users.telnyx_ai_assistant_id` is set (callers should get Voice AI after no-answer).
   - **AI — finish setup** — Line is set to AI but no assistant is linked yet; open **AI fallback** and **Save**.
   - **Voicemail fallback** / **Ring phone fallback** — No AI on no-answer for that line.
2. **Settings → Business numbers** — The same labels appear next to **Active** (data from `GET /api/routing?all=true` + `GET /api/ai-assistant`).
3. **API** — `GET /api/numbers/mine` returns each number with `routing_summary`: `fallback_type`, `ai_fallback_selected`, `telnyx_assistant_linked`, `ai_fallback_live`.

## What the business owner does (in lyncr only)

1. In **Fallback Settings**, choose **AI receptionist**. lyncr immediately calls **Telnyx `POST /v2/ai/assistants`** (via `PUT /api/routing`), stores the assistant id, and returns `voiceAi` in the JSON response — **no separate “Activate” step**.
2. Open **AI call flow** (same sheet or full page) to tune the playbook, greeting, and optional **Voice & model** — **Save** pushes updates to Telnyx (`POST /v2/ai/assistants/{id}`).
3. **Play preview** calls **`POST /api/ai-assistant/voice-preview`**, which uses Telnyx **`POST /v2/text-to-speech/speech`** (not `/text-to-speech`, which 404s). If TTS still fails, the UI falls back to the **browser’s text-to-speech**. **Live calls** use Telnyx Voice AI on the phone. Under **Voice & model**, expand the section and use **Sample** / **Use** next to each listed voice to compare speaking voices before you Save.
4. Voice AI handoff is usually **two fetches**: **`/incoming`** then **`/ai-bridge`**. Putting `<Say>` and `<Connect><AIAssistant>` in one document often results in **no audio** on Telnyx. The **`/ai-bridge`** URL returns **only** `<Connect><AIAssistant id="…"/>`. Telnyx expects **`assistant-{uuid}`**; lyncr normalizes bare UUIDs in `buildTelnyxAiAssistantTexml`.
5. **Default inbound (AI + no receptionist):** `/incoming` returns a **silent** **`<Redirect method="GET">`** to **`/api/voice/telnyx/ai-bridge/u/{userId}`** (no `<Say>`). That avoids **dead air** that can happen if `<Connect>` is returned from `/incoming` — including when Telnyx’s first webhook already shows **`CallStatus`** like **in-progress** / **answered**. Optional: **`ZING_AI_HANDOFF_TWO_STEP=true`** — Say + Pause + Redirect. Optional: **`ZING_AI_CONNECT_DIRECT=true`** — `<Connect>` on `/incoming` (experimental; may go quiet).
6. **Ring your phone before AI:** Dashboard → **Fallback Settings** → **AI receptionist** → turn on **Ring my phone first** (no active receptionist). The flag is stored on your **default** routing row (applies to every business line). Your cell rings first; if you don’t answer, Voice AI runs. Optional: **`ZING_AI_RING_OWNER_FIRST=true`** in Vercel. Requires Neon **`015`**. In Vercel logs, search **`telnyx-incoming-routing-flags`** — `useDirectAiWhenNoReceptionist` should be **false** when ring-first is on.
7. **“Vercel shows `/incoming` but never `/fallback`”:** Telnyx did not request the Dial `action` URL — you will **not** see `telnyx-fallback-diagnostic` logs. Use the **default** (direct AI, item 5) or fix TeXML/Telnyx routing for your number.
8. **Ring-first path (`ZING_AI_RING_OWNER_FIRST`):** `/fallback` uses **`/fallback/u/{userId}/n/{digits}/{mode}`**, path **`mode=owner-ai`**, **`zingFbMode=`** fallback, and safe merge rules. For **`owner-ai`**, if your cell leg **never bridged** (no-answer / busy), the caller is offered **Voice AI**. If Telnyx reports **`completed`** with a real PSTN **`DialBridgedTo`** (you answered and the B-leg ended — including when you hang up first), lyncr **hangs up** the caller’s leg so they do **not** hear the AI handoff. **`recv` / `recv-ai`** use the same “bridged + completed → hang up” rule for the receptionist leg.

No Telnyx Mission Control account is required for the business owner.

## Voice & model (power users)

On **AI call flow**, expand **Voice & model (power users)** to set:

- **LLM model** — Telnyx model id (datalist from `GET /api/ai-assistant/models`); empty = `TELNYX_AI_DEFAULT_MODEL` / built-in default (`openai/gpt-4o`). Some ids (e.g. `openai/gpt-4o-mini`) may be rejected for Voice AI — lyncr retries with fallbacks on create.
- **Speaking voice** — Telnyx TTS voice id (from `GET /api/ai-assistant/voices`); empty = `TELNYX_AI_VOICE` / built-in default.
- **Extra instructions** — appended to the playbook in Telnyx under “Additional instructions (from lyncr)”.

On **Save** / **Activate**, lyncr syncs instructions; if model/voice are set, they are pushed on update too (create always applies resolved defaults or your overrides).

## Advanced (support / migrations)

- **AI call flow → Advanced — link an existing assistant id** can paste a Telnyx assistant instead of creating one.
- **`TELNYX_AI_ASSISTANT_ID`** — optional shared id used only if **programmatic creation** fails (502 path). Prefer fixing API permissions instead of relying on this long-term.

## Debugging with evidence (not guessing)

1. **Redirect loop / give-up message:** Telnyx may re-POST **`/incoming`** many times after **`/ai-bridge`** (`incomingHitCount` in logs). Flow: hit **1** silent redirect; **2** one “One moment” + redirect; **3+** silent redirect until **`incomingHitCount` > 8** (give-up starts on the **9th** POST by default). **Do not** return **`<Connect>` on `/incoming`** by default — Telnyx often responds with **“We’re sorry, an application error has occurred”** (log shows `handoff: connect-aiassistant-last-resort-incoming`). **`ZING_AI_LAST_RESORT_CONNECT_HIT`** is **off** unless you set it (e.g. `5`) for experiments. Run **`013`** + **`014`** in Neon.
2. **`/fallback` diagnostics** apply when **Ring my phone first** / **`ZING_AI_RING_OWNER_FIRST`** is on, or when a **receptionist** `<Dial>` runs. The **default** direct-AI path hits **`/incoming`** then **`/ai-bridge`** (silent redirect). With **`ZING_AI_HANDOFF_TWO_STEP`** you still hit **`/ai-bridge`** after the Say. Search logs for **`telnyx-incoming-ai-direct`**. Set **`ZING_TELNYX_FALLBACK_DIAGNOSTIC=true`** when debugging `/fallback`.
3. Locally run **`npm run test`** — Vitest replays fixtures in **`tests/fixtures/telnyx-fallback/`**. Add a scenario when you capture a real Dial `action` body (see **`tests/fixtures/telnyx-fallback/README.md`**).

## Operator env (Vercel)

| Variable | Purpose |
|----------|---------|
| `TELNYX_API_KEY` | Required — must allow **AI Assistants** API on your Telnyx project. |
| `TELNYX_AI_DEFAULT_MODEL` | Optional — default `openai/gpt-4o`; use Telnyx **GET /v2/ai/models** for ids. |
| `TELNYX_AI_VOICE` | Optional — default `Telnyx.KokoroTTS.af_heart`. |
| `ZING_AI_HANDOFF_TWO_STEP` | Optional — Say + Pause + Redirect → `/ai-bridge` instead of **silent** redirect (can repeat if Telnyx re-fetches `/incoming`). |
| `ZING_AI_CONNECT_DIRECT` | Optional — `<Connect><AIAssistant>` on **`/incoming`** (may cause **quiet** on some Telnyx setups). |
| `ZING_AI_LAST_RESORT_CONNECT_HIT` | Optional — **default off**. Set **`5`** (etc.) only to experiment with **`<Connect>` on `/incoming`**; often triggers Telnyx application error. **`0`** / unset = silent redirects then lyncr’s give-up when **`incomingHitCount` > 8** (9th POST+). |
| `ZING_AI_RING_OWNER_FIRST` | Optional global — same as dashboard **Ring my phone first**; **`/fallback`** after no-answer. Prefer the app toggle + migration **`015`**. |

## API notes

- `GET /api/ai-assistant` returns `hasAssistant`, `assistantId`, and intake JSON.
- `POST /api/ai-assistant` saves intake and **creates** a Telnyx assistant unless `telnyxAiAssistantId` is sent (advanced).
- `PATCH /api/ai-assistant` updates intake/routing and **syncs** instructions to Telnyx when an assistant is linked.
- `GET /api/ai-assistant/voices` lists Telnyx TTS voices (`provider=telnyx`) for the **Voice & model** datalist; if the list is empty, type a voice id or leave empty for `TELNYX_AI_VOICE` / built-in default.

## Database

Run **`scripts/012-telnyx-ai-assistant.sql`** in Neon so `users.telnyx_ai_assistant_id` exists.
