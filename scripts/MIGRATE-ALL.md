# Run all database migrations (Neon)

lyncr cannot update your Neon database from Git or Vercel automatically. After pulling new code, **open Neon → SQL Editor** and run any scripts you have **not** run yet, **in this order** (skip ones already applied — most scripts use `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).

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
| 24 | `024-onboarding-profiles.sql` | **`onboarding_profiles`** — same as 025 (use **025** if you already have a different `profiles` table in Neon) |
| 25 | `025-onboarding-profiles-table.sql` | **`onboarding_profiles`** — run this if Launch errors with `column "user_id" of relation "profiles" does not exist` |
| 26 | `026-onboarding-billing-method.sql` | **`onboarding_profiles.has_billing_method`** — one-click dashboard activation when card was saved at signup |
| 27 | `027-stripe-billing-cycle.sql` | **`billing_cycle_start` / `billing_cycle_end`**, Stripe customer + subscription ids |
| 28 | `028-subscription-tier-carrier-credit.sql` | **`subscription_tier`**, **`carrier_credit`** on `onboarding_profiles` — line limits + prepaid provisioning wallet |
| 29 | `029-low-balance-notified.sql` | **`low_balance_notified`** on `onboarding_profiles` — Pay tab warning when carrier credit drops below $3 after call usage |
| 31 | `031-revoke-legacy-platform-admins.sql` | Revoke **`is_platform_admin`** from all accounts except **admin@lyncr.app**; delete legacy **admin@getzingapp.com** |
| 32 | `032-bootstrap-lyncr-admin.sql` | Bootstrap operator account **admin@lyncr.app** (password **`admin`** — change after first login) |
| 33 | `033-fix-lyncr-admin-password.sql` | **Run if login fails** — corrects a bad bcrypt hash for **admin@lyncr.app** / **admin** |
| 34 | `034-admin-profile-metrics.sql` | **`onboarding_profiles`**: `total_calls_routed`, `total_minutes_used`, `account_status`, `custom_routing_note` — admin console usage + overrides |
| 35 | `035-inbound-phone-lookup-index.sql` | **Indexes on `phone_numbers`** — faster inbound DID lookup for Telnyx voice webhooks |
| 36 | `036-inbound-dial-snapshot.sql` | **Precomputed dial columns on `phone_numbers`** — one-row inbound routing (fastest path); open Routing tab once after running to backfill |
| 37 | `037-backfill-inbound-dial-snapshot.sql` | **Fill `inbound_dial_e164`** when timestamp is set but receptionist phone column is empty |
| 38 | `038-phone-numbers-released-status.sql` | **`phone_numbers.status`** may be **`released`** — return a bought line to Telnyx from **Manage existing lines** |
| 39 | `039-receptionist-pay-mode.sql` | **`receptionists.pay_mode`** + **`flat_rate_usd`** — FLAT_RATE vs PER_MINUTE receptionist payout tracking |
| 40 | `040-receptionist-portal-role.sql` | **`users.account_role`** + **`receptionists.portal_user_id`** — receptionist payout portal at `/receptionist` |
| 41 | `041-team-invites.sql` | **`team_invites`** — admin-issued receptionist signup tokens |
| 42 | `042-skill-routing-pool.sql` | **`receptionists.skills`**, **`routing_config.industry_tag`**, **`phone_numbers.industry_tag`** + **`routing_pool_mode`** — skill-tagged managed receptionist routing pool |
| 43 | `043-certifications-training.sql` | **`certifications`**, **`receptionist_badges`** — training courses, quiz completion, and live routing toggles |
| 44 | `044-sms-lead-notifications.sql` | **`onboarding_profiles.sms_leads_enabled`** + **`notification_phone`** — instant SMS lead alerts |
| 45 | `045-dispatch-sms-phone.sql` | **`onboarding_profiles.dispatch_sms_phone`** — dedicated dispatch SMS target (falls back to profile phone) |
| 46 | `046-automotive-core-locksmith-quiz.sql` | **Updates `automotive_core`** certification — AKL, proximity, YMM, and structural key quiz matrix |
| 47 | `047-messaging-10dlc.sql` | **`messaging_10dlc_registrations`** — each business registers its own A2P 10DLC brand + campaign (Settings → SMS lead-alert registration) so lead-alert texts deliver on US carriers |
| 48 | `048-hybrid-network-fields.sql` | **`routing_config.routing_strategy`** (`private_only`/`lyncr_only`/`hybrid_fallback`, default `private_only`) + **`allow_lyncr_network_fallback`**, and **`receptionists.user_id` made NULLABLE** (NULL = shared global Lyncr network agent). Powers private-staff vs shared-pool routing with fallback. App reads these defensively, so routing keeps working before this runs. |
| 49 | `049-private-ring-timeout.sql` | **`routing_config.private_ring_timeout_seconds`** (default 15) — how long a hybrid line rings its private staff before falling back to the shared Lyncr network. Exposed in Settings → Call routing strategy. Read defensively (defaults to 15s) until applied. |

## Platform admin (`admin@lyncr.app`)

After migrations **31** then **32**, sign in at **`/login`** with **admin@lyncr.app** / **admin** and open **`/admin`**. Only that email may access the operator dashboard and `/api/admin/*` routes.

If login says **Invalid email or password**, run **`033-fix-lyncr-admin-password.sql`** in Neon (or re-run **032**). Alternatively set **`ZING_BOOTSTRAP_ADMIN_SECRET`** in Vercel and `POST /api/auth/repair-bootstrap-admin` with `{ "secret": "…" }` (defaults to **admin@lyncr.app** / **admin**).

The old **admin@getzingapp.com** bootstrap (**`020-bootstrap-admin-getzingapp.sql`**) is deprecated — run **031** to remove it.

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
