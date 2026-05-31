# Voice Architecture (Current)

This is the single source of truth for how voice currently works in lyncr.

## Provider model

- Primary voice provider: **Telnyx**
- Canonical voice webhook namespace: `/api/voice/telnyx/*`
- Legacy compatibility namespace: `/api/voice/*` (re-exports canonical handlers)

## Canonical webhook routes

- Incoming call: `/api/voice/telnyx/incoming`
- No-answer fallback: `/api/voice/telnyx/fallback/u/{userId}?callSid=…&bn=…` (path userId so Telnyx cannot drop `userId` query param). Legacy: `/api/voice/telnyx/fallback`.
- Call status callbacks: `/api/voice/telnyx/status`
- Recording callbacks: `/api/voice/telnyx/recording-status`
- Legacy URL (voicemail after recording): `/api/voice/telnyx/ai-assistant` (voicemail stub; live AI uses Telnyx `<AIAssistant>` from fallback)
- Voicemail after record: `/api/voice/telnyx/voicemail-complete`

Legacy routes under `/api/voice/*` are adapters and should not be used for new integrations.

## Call flow (high level)

1. Telnyx receives call on business number.
2. Telnyx requests `/api/voice/telnyx/incoming`.
3. Incoming handler resolves user + per-number routing config.
4. Handler returns TeXML `<Dial>` (receptionist or owner).
5. If dial leg is not completed, Telnyx calls `/api/voice/telnyx/fallback/u/{userId}` (POST or GET).
6. Fallback behavior uses routing setting:
   - owner
   - ai → **Telnyx Voice AI** TeXML `<Connect><AIAssistant id="…"/></Connect>` when `users.telnyx_ai_assistant_id` or `TELNYX_AI_ASSISTANT_ID` is set; otherwise **voicemail**
   - voicemail
7. Status and recording callbacks update call logs and quality metrics.

## Performance decisions in current implementation

- Incoming routing lookup is optimized and cached briefly (`bypassCache: true` on webhooks so saves are immediate).
- Non-critical call-log writes run fire-and-forget to reduce setup latency.
- **Parallel DB on `/incoming`:** `getIncomingRoutingByNumber` + `isTelnyxInboundDialCallerLegDone`; then `getRoutingConfigForNumber` + `getPhoneNumbers` together before building TeXML.
- **Parallel DB on `/fallback`:** `getRoutingConfigForNumber` (or default) + default routing + `getUser` in one `Promise.all`.
- **JSON webhooks:** nested `data.payload` fields are flattened so we resolve the correct DID on the first hop (avoids wrong routing + retries).
- **`answerOnBridge`:** defaults to **off** on `<Dial>` so the inbound caller leg can bridge sooner after the teammate answers (`ZING_INBOUND_DIAL_ANSWER_ON_BRIDGE=1` restores classic ringback-until-answer).
- **Production logs:** large structured `console.log(JSON.stringify(...))` lines on the hot path are **skipped** unless `ZING_VOICE_DEBUG_LOGS=1` (reduces CPU and log pipeline delay on every ring). **Errors** (`console.error`) are always emitted.
- Voice routes use `nodejs` runtime and **`preferredRegion = iad1`** to stay close to Telnyx US-East voice.

## Call quality & latency checklist (operator / Telnyx)

| Goal | What to check |
|------|-----------------|
| Fastest first ring | Keep **line whisper** off unless needed: `ZING_INBOUND_RECEPTIONIST_WHISPER=no` (or disable per user in Settings). Owner leg uses `<Number url=…>` only when whisper is on — that adds an extra HTTP round trip before audio. |
| Clear TTS | Optional faster speech: `ZING_TEXML_SAY_RATE` (see `lib/texml-say-voice.ts`). |
| AI without extra spoken steps | Avoid `ZING_AI_HANDOFF_TWO_STEP` (default off). Prefer silent redirect to `/ai-bridge`. |
| Second DID outbound | Multi-line accounts may use primary DID as PSTN `callerId` when the dialed line is not on the outbound voice profile yet (auto). All numbers should be on the **same Telnyx outbound voice profile** for best attestation. |
| Callee sees real CLI | Default PSTN `callerId` = inbound caller; `ZING_INBOUND_DIAL_CALLER_ID_USE_BUSINESS_LINE=1` shows business line on teammate phone instead. |
| Deep trace in prod | Set `ZING_VOICE_DEBUG_LOGS=1` on Vercel to restore full `telnyx-incoming-routing-flags`, `telnyx-fallback`, and related JSON logs. |
| Fallback forensics | `ZING_TELNYX_FALLBACK_DIAGNOSTIC=1` adds redacted entry diagnostics (see `lib/telnyx-fallback-diagnostics.ts`). |

**Outside the app (biggest wins):** Telnyx Mission Control — same region as app (`iad1`), low-latency PSTN, outbound voice profile on every purchased DID, stable public URL for TeXML (`NEXT_PUBLIC_APP_URL`), and minimal middleware between Telnyx and Vercel.

## Routing model

- Supports default routing config plus per-number routing config.
- Dashboard + Settings are aligned to per-number routing behavior.
- Business number context is shown in UI to reduce routing ambiguity.

## Data model (provider-neutral direction)

We are migrating from Twilio-specific naming to provider-neutral naming.

- New/target fields:
  - `provider_call_sid`
  - `provider_number_sid`
- Legacy compatibility fields still present:
  - `twilio_call_sid`
  - `twilio_sid`

During transition, DB logic supports fallback reads/writes so old data remains valid.

## Required migrations

Run these on environments that already have existing data:

1. `scripts/007-call-quality-metrics.sql`
2. `scripts/008-provider-neutral-ids.sql`

## Number lifecycle

- Buy number flow: `/api/numbers/telnyx/buy`
  - purchases number
  - configures voice connection
  - persists number in DB
- Porting flow:
  - managed through `/api/numbers/port` + `/api/numbers/porting*`
  - completion auto-configures number and syncs DB
- Safety net:
  - `/api/numbers/configure` can re-sync/configure numbers

## Operations / KPI surfaces

- Web Operations page (dashboard activity route):
  - call KPIs
  - answer rate
  - avg + p95 setup latency
  - per-number quality
  - top missed callers
- API: `/api/voice/quality`
  - summary + insights payload

## Legacy components and naming

- `lib/twilio.ts` and `lib/twilio-porting.ts` are compatibility re-export files.
- New neutral helper files:
  - `lib/legacy-voice-provider.ts`
  - `lib/legacy-porting-provider.ts`

Do not add new feature code to twilio-named files.

## Rules for future changes

- New voice features must be added under `/api/voice/telnyx/*`.
- Keep legacy adapter routes as thin re-exports only.
- Prefer provider-neutral naming in types and database fields.
- Update this document whenever call flow, provider integration, or schema conventions change.
