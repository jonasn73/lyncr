# Run all database migrations (Neon)

Zing cannot update your Neon database from Git or Vercel automatically. After pulling new code, **open Neon → SQL Editor** and run any scripts you have **not** run yet, **in this order** (skip ones already applied — most scripts use `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).

**Paste only the SQL inside each file** (from the first `--` or `ALTER`/`CREATE` line through the last statement). Do **not** paste the table row text like `scripts/019-billing-admin-feedback.sql` by itself — that is a path, not SQL, and Neon will error with `syntax error at or near "scripts"`.

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
| 22 | `022-customers.sql` | **`customers`** — saved caller profiles (name, address, notes) keyed by phone per account; answered-call popup + `/dashboard/customers` search |
| 23 | `023-user-answered-call-popup-toggle.sql` | **`users.answered_call_customer_popup_enabled`** — turn off the answered-call customer sheet in Settings |

## Optional: first platform admin (`admin@getzingapp.com` / `admin`)

**Not part of the numbered migration chain.** Only if you want a pre-made operator account (weak password — change after login). Paste and run the full contents of **`020-bootstrap-admin-getzingapp.sql`** in Neon. In Vercel, you can also set **`ZING_ADMIN_EMAILS=admin@getzingapp.com`** so that email can open `/admin` even without the DB flag (this script sets **both** password and `is_platform_admin`).

If you already ran **`020`** and **`admin` / `admin` login fails**, run **`021-fix-admin-bootstrap-password.sql`** once (corrects a bad bcrypt string in an earlier `020` revision), or re-run the current **`020`** from the repo (it now embeds the verified hash). **Alternatively**, set a temporary **`ZING_BOOTSTRAP_ADMIN_SECRET`** in Vercel (24+ chars), redeploy, then `POST https://<your-domain>/api/auth/repair-bootstrap-admin` with `{ "secret": "…" }` — see **`PRODUCTION.md`** — then **delete** the secret.

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
