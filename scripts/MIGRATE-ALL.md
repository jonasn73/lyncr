# Run all database migrations (Neon)

Zing cannot update your Neon database from Git or Vercel automatically. After pulling new code, **open Neon → SQL Editor** and run any scripts you have **not** run yet, **in this order** (skip ones already applied — most scripts use `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).

| Order | File | What it does |
|------:|------|----------------|
| 1 | `001-create-schema.sql` | Core tables (`users`, `routing_config`, `receptionists`, `phone_numbers`, `call_logs`, …) |
| 2 | `002-add-password-hash.sql` | Password login column on `users` |
| 3 | `003-ai-conversation-state.sql` | `ai_conversation_state` table |
| 4 | `004-phone-numbers-port-in-request-sid.sql` | Porting column on `phone_numbers` |
| 5 | `005-per-number-routing.sql` | Per-DID routing rows |
| 6 | `006-vapi-assistant.sql` | Legacy `vapi_assistant_id` (optional if unused) |
| 7 | `007-call-quality-metrics.sql` | Extra timing columns on `call_logs` |
| 8 | `008-provider-neutral-ids.sql` | Provider-neutral ID columns |
| 9 | `009-ai-assistant-presets.sql` | AI preset sync table |
| 10 | `010-ai-leads-intake.sql` | **`user_ai_intake`** + **`ai_leads`** (required for **Save call flow** / AI intake) |
| 11 | `011-user-industry.sql` | **`users.industry`** |
| 12 | `012-telnyx-ai-assistant.sql` | **`users.telnyx_ai_assistant_id`** (Telnyx Voice AI) |
| 13 | `013-telnyx-ai-incoming-handoff.sql` | **`telnyx_ai_incoming_handoff`** — stops Telnyx **redirect loops** on direct AI (`/incoming` ↔ `/ai-bridge`) |
| 14 | `014-telnyx-ai-incoming-hit-count.sql` | Adds **`incoming_hits`** — repeat `/incoming` uses **Say + Redirect** (not `<Connect>`, which Telnyx rejects) |
| 15 | `015-routing-ai-ring-owner-first.sql` | **`routing_config.ai_ring_owner_first`** — ring your phone before AI (no receptionist); dashboard toggle |
| 16 | `016-porting-notifications.sql` | **`porting_notifications`** — Telnyx porting webhooks → in-app transfer updates |
| 17 | `017-inbound-whisper-user-toggle.sql` | **`users.inbound_receptionist_whisper_enabled`** — per-account on/off for the callee-only line-ID whisper |
| 18 | `018-telnyx-inbound-dial-caller-done.sql` | **`telnyx_inbound_dial_caller_done`** — after a answered first `<Dial>` leg ends, `/incoming` returns **Hangup** instead of sending the caller to AI again |
| 19 | `019-billing-admin-feedback.sql` | **`users`**: `credit_balance_cents`, `billing_plan`, `is_platform_admin` — **`billing_ledger`**, **`feedback_submissions`** (Help tab + `/admin` + credit adjustments) |

## If “Save call flow” fails

Run **`010-ai-leads-intake.sql`** and **`012-telnyx-ai-assistant.sql`** if the error mentions `user_ai_intake` or `telnyx_ai_assistant_id`.

## If Neon says the foreign key “cannot be implemented”

`users.id` is **UUID**. Older copies of `010` used **TEXT** for `user_id` — that fails. Use the **current** `010-ai-leads-intake.sql` from the repo (UUID columns). If you already created wrong tables, run in SQL Editor first:

```sql
DROP TABLE IF EXISTS ai_leads;
DROP TABLE IF EXISTS user_ai_intake;
```

Then run **`010-ai-leads-intake.sql`** again.

## Confirm Vercel

**`DATABASE_URL`** must point at the same Neon database where you ran these scripts.

See also **`PRODUCTION.md`**.
