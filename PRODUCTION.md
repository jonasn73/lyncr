# Running Zing on your live domain

For the app to work in production (sign up, login, settings, call routing), you need a database and env vars set in Vercel.

## 1. Database (Neon)

1. Go to [neon.tech](https://neon.tech) and create a project (free tier is fine).
2. In the Neon dashboard, open **SQL Editor** and run migrations **in order**. See **`scripts/MIGRATE-ALL.md`** for the full checklist (001 → 016). At minimum for a new project: **`001`**, **`002`**, then **`010`**, **`011`**, **`012`**, **`013`**, **`014`**, **`015`** if you use Telnyx Voice AI and the dashboard **“Ring my phone first”** toggle (015 adds `ai_ring_owner_first`). Run **`016`** if you want **in-app transfer / porting notifications** (stores Telnyx port-in webhook events; `NEXT_PUBLIC_APP_URL` must match your deployed origin for `webhook_url` on new port orders).
3. In Neon, go to **Connection details** and copy the connection string (URI). It looks like:
   `postgresql://USER:PASSWORD@ep-xxx.region.aws.neon.tech/neondb?sslmode=require`

## 2. Vercel environment variables

In your Vercel project: **Settings → Environment Variables**. Add:

| Variable           | Description |
|--------------------|-------------|
| `DATABASE_URL`     | The Neon connection string from step 1. |
| `SESSION_SECRET`   | Random string for signing cookies (e.g. run `openssl rand -base64 32` and paste). |
| `TELNYX_API_KEY`   | Your Telnyx API key (for numbers and voice). |
| `NEXT_PUBLIC_APP_URL` | Your live site base URL (e.g. `https://your-app.vercel.app`) — used for Telnyx voice webhooks. |
| `TELNYX_AI_ASSISTANT_ID` | Optional **fallback** only if **creating** an assistant via API fails. **Remove it** (or update it) if that id was **deleted** in Telnyx — otherwise Save call flow can keep re-linking a **404** assistant. Prefer leaving unset so Zing creates per-user assistants. |
| `TELNYX_AI_DEFAULT_MODEL` | Optional: LLM id for auto-created assistants (default `openai/gpt-4o`). List: Telnyx **GET /v2/ai/models**. Avoid `openai/gpt-4o-mini` if Telnyx says it is not available for AI assistants. |
| `TELNYX_AI_VOICE` | Optional: Telnyx Voice AI **assistant** voice id for **new** assistants (default **`Telnyx.NaturalHD.astra`**). Per-user override: AI call flow saves `telnyxVoice` in intake. |
| `TELNYX_MESSAGING_FROM_E164` | Optional: your Telnyx number in E.164, enabled for **outbound SMS** — sends **AI lead** alerts to the owner’s main line. |
| `ZING_AI_RING_OWNER_FIRST` | Optional global override (same as dashboard **Ring my phone first**). Stored on the **default** `routing_config` row (`business_number` null) so it applies even when you use **per-number** routing. Run **`015`**. **Default:** straight to Voice AI when off. |
| `ZING_AI_HANDOFF_TWO_STEP` | Optional. If `true` / `1`: **Say + Pause + Redirect** to **`/ai-bridge`** from `/incoming`. Default is a **silent** Redirect (no Say) to **`/ai-bridge`** — avoids **dead air** from `<Connect>` on the first `/incoming` response and avoids a **repeating hold line** if Telnyx re-requests `/incoming`. |
| `ZING_AI_CONNECT_DIRECT` | Optional. If `true` / `1`: return **`<Connect><AIAssistant>`** on **`/incoming`** (skip silent redirect). **Experimental** — Telnyx may go **quiet**; prefer unset (default). |
| `ZING_AI_LAST_RESORT_CONNECT_HIT` | Optional. **Default: unset (= off).** If set to e.g. **`5`**, on that **`/incoming`** POST count Zing returns **`<Connect><AIAssistant>`** on `/incoming` (experimental — Telnyx often plays **“application error, goodbye”** instead of attaching AI). **`0`** / **`false`** explicitly disables. When off, when **`incomingHitCount` > 8** (9th POST onward) Zing plays its **own** give-up message (not Telnyx’s error). |
| `ZING_AI_DIRECT_NO_RECEPTIONIST` | Legacy no-op (still accepted). Direct-to-AI is now the **default** when AI fallback + no receptionist; use **`ZING_AI_RING_OWNER_FIRST`** if you need the old ring-first behavior. |
| `ZING_TELNYX_FALLBACK_DIAGNOSTIC` | Optional. If `true` / `1`: log **`zing: telnyx-fallback-diagnostic`** per Dial `action` request (PII-redacted form fields + routing snapshot). Use when debugging; turn off after. See **`tests/fixtures/telnyx-fallback/README.md`**. |
| `ZING_INBOUND_RECEPTIONIST_WHISPER` | Optional **global** kill switch. Set to **`0`**, **`false`**, or **`no`** to disable the short callee-only whisper for **all** accounts on this deployment. Per-user default is **on** in Settings unless turned off there. Whisper text is **account business name** (from Settings) **then** the line label / friendly number / last four digits. |
| `ZING_TEXML_SAY_VOICE` | Optional. Twilio-style **Polly / Google neural** voice id for TeXML `<Say>` (whisper, voicemail prompts, IVR). Default **`Polly.Joanna-Neural`**. Set e.g. `Polly.Matthew-Neural` or `Google.en-US-Neural2-F` if Telnyx accepts it on your account. |
| `ZING_TEXML_SAY_LANGUAGE` | Optional. BCP-47 language for `<Say>` (default **`en-US`**). |
| `ZING_TEXML_SAY_RATE` | Optional. SSML prosody rate for `<Say>` plain TTS (default **`1.08`** = slightly faster). Set **`1`** or **`off`** to disable prosody wrapper. |
| `ZING_TEXML_SAY_SSML` | Optional. Set **`0`** / **`false`** to send **plain text only** (no `<prosody>`), if a carrier mis-reads SSML. |
| `TELNYX_AI_VOICE_SPEED` | Optional. Assistant **`voice_speed`** for Telnyx Natural / NaturalHD / Kokoro voices (default **`1.08`**, range about **0.9–1.25**). |
| `TELNYX_AI_EXPRESSIVE` | Optional. Set **`0`** / **`false`** to skip **`expressive_mode`** when using **`Telnyx.Ultra.*`** voices. Default enables expressive for Ultra. |

Save and **redeploy** the project (Deployments → … → Redeploy).

### AI receptionist (Telnyx Voice AI)

- **Owners do not use Mission Control.** **AI call flow → Activate** creates a Telnyx assistant via API from their playbook. Saving updates that assistant.
- Advanced / support can still paste an existing assistant id; `TELNYX_AI_ASSISTANT_ID` is only an emergency fallback if creation fails.
- **AI + no receptionist:** `/incoming` **redirects** to `/ai-bridge`, which returns `<Connect><AIAssistant id="…"/></Connect>` (same call leg; second HTTP fetch).
- See **`docs/AI-RECEPTIONIST.md`**. Lead webhooks from tools are **not** wired to Vapi anymore; use Telnyx tool/webhook features when you need structured lead capture.

## 3. Sign up on the live site

After redeploying, open your live URL and use **Sign up** (not the dev login). Enter:

- Your real **email**
- Your **cell phone** (main line — calls default here)
- A **password** (at least 8 characters)
- Name and business name

Then you can log in with that email and password on the live app. You do **not** need to “re-sign up” if you already have a user in the database; just use the same email/password to log in.

## Troubleshooting

- **“DATABASE_URL is not set”** — Add `DATABASE_URL` in Vercel and redeploy.
- **“Invalid email or password”** — Either no user exists yet (sign up first) or the password is wrong.
- **Login works but dashboard errors** — Ensure you ran both `001-create-schema.sql` and `002-add-password-hash.sql` so `users` has `password_hash` and `routing_config` exists.
- **Logged out on every refresh** — Ensure the app is served over **HTTPS** in production (so the secure session cookie is stored). Keep **SESSION_SECRET** set in Vercel and avoid changing it (changing it invalidates existing sessions).
- **“Spam Risk” / “Scam Likely” on forwarded calls** — Zing sets outbound `callerId` to your **Telnyx business DID** (not the caller’s number) so STIR/SHAKEN can attest an owned number. Zing also sets TeXML **`fromDisplayName`** from your **account business name** (Settings → Account business name) when Telnyx forwards the leg, so cell phones can show a proper name instead of only digits. Carriers still apply their own spam analytics; if labels persist: in **Telnyx Mission Control** set **CNAM / caller name** on the number, register the TN at **[Free Caller Registry](https://www.freecallerregistry.com/fcr/)**, and allow a few days of normal traffic for reputation to improve. See Telnyx: [How to handle Spam / Scam Likely](https://support.telnyx.com/en/articles/4088988-telnyx-how-to-handle-spam-scam-likely).
