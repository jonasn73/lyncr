# Voice Architecture (Current)

This is the single source of truth for how voice currently works in Zing.

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

- Incoming routing lookup is optimized and cached briefly.
- Non-critical call-log writes run fire-and-forget to reduce setup latency.
- `answerOnBridge` defaults to **off** on `<Dial>` so the inbound caller leg can bridge sooner after the teammate answers (set `ZING_INBOUND_DIAL_ANSWER_ON_BRIDGE=1` for classic “ringback until callee answers”).
- Voice routes are configured for `nodejs` runtime and preferred region.

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
