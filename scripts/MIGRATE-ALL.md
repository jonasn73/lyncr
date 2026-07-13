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
| 50 | `050-receptionist-routing-endpoint.sql` | **`receptionists.routing_endpoint`** (`WEB`/`CELL`, default `CELL`) + **`sip_username`**, and snapshot mirrors **`phone_numbers.inbound_routing_endpoint`** + **`inbound_sip_username`**. Lets a receptionist answer in-browser via Telnyx WebRTC/SIP instead of a cell forward. Read defensively — `WEB` safely falls back to PSTN until a Telnyx Credential Connection + `@telnyx/webrtc` browser client are set up. |
| 51 | `051-receptionist-sip-credential.sql` | **`receptionists.sip_credential_id`** — the Telnyx Telephony Credential id provisioned per agent so the app can mint `@telnyx/webrtc` login tokens automatically. Set the **`TELNYX_CREDENTIAL_CONNECTION_ID`** env (a Credentials-type SIP Connection in the Telnyx portal) to enable auto-provisioning; until then WEB safely falls back to CELL. |
| 52 | `052-invite-sms-channel.sql` | Extends **`team_invites`** with **`channel`** (`EMAIL`/`SMS`), **`phone`**, and **`status`**. (Superseded by the dedicated `invitations` table in 053 for the admin "Invite receptionist" modal flow; harmless to keep.) |
| 53 | `053-invitations.sql` | **`invitations`** table (`target`, `type` EMAIL/SMS, `token`, `status`, `expires_at`) backing SMS invites (and legacy email invites) → `/register?token=`. **Optional** — the app auto-creates it at runtime via `CREATE TABLE IF NOT EXISTS`; run only if you prefer to pre-create it. |
| 54 | `054-receptionist-invite-stub.sql` | Adds **`users.invitation_token`**, **`users.invitation_expires_at`**, **`users.invite_status`** (`invited`/`active`). The admin "Invite receptionist" **email** flow now inserts a stub `users` row (role `receptionist`, status `invited`) carrying a one-time onboarding token + 48h expiry, sends the Lyncr-branded `/onboarding?token=…` email, and supports **Resend** (`POST /api/admin/invite/resend`). **Required** for the email-invite + resend flow — run this in Neon. Until applied, email invites return a clear "run migration 054" error; SMS invites still use the `invitations` table. |
| 55 | `055-routing-instructions.sql` | Adds **`onboarding_profiles.routing_instructions`** — owner-authored notes/script (business hours, pricing, greeting) shown to the live Lyncr operators answering their lines. Saved from the dashboard **Team** page (`GET`/`PUT /api/team/instructions`). Read defensively (returns empty) until applied; saving prompts to run this migration. |
| 56 | `056-dispatch-alert-prefs.sql` | Adds **`onboarding_profiles.email_recordings_enabled`** — the "Email Call Recordings" toggle in the Settings **Lyncr Operator Dispatch Alerts** section (`GET`/`PUT /api/settings/email-recordings`). Read defensively (returns false) until applied; toggling on prompts to run this migration. |
| 57 | `057-company-briefing.sql` | Adds **`onboarding_profiles.business_hours`** + **`onboarding_profiles.service_rules`** — power the receptionist web-phone **Company Briefing Card** screen-pop (`GET /api/receptionist/company-briefing?number=…`). Read defensively (null) until applied; the card just shows "Not set yet". `business_instructions` reuses `routing_instructions` (055). |
| 58 | `058-lead-disposition.sql` | Adds **`ai_leads.disposition`**, **`ai_leads.dispatch_status`**, **`ai_leads.is_salvageable`** + index — the operator job-disposition / lead-salvage pipeline (`POST /api/receptionist/log-job`, owner booking toasts, **Lyncr Lead Salvage** queue). **Optional**: the same keys are also written to `ai_leads.collected` JSONB, so BOOKED toasts + salvage work before this runs; the columns just index those feeds. |
| 59 | `059-cell-fallback-dispositions.sql` | Adds **`call_logs.disposition`** + new table **`pending_sms_dispositions`** — the mobile cell fallback loop: post-call outcome-code SMS to the operator's cell (`/api/voice/telnyx/status`) + inbound reply parser (`/api/webhooks/telnyx/messaging`) that maps 1-4 → BOOKED/PENDING_TIME/PRICE_REJECTED/FAILED, stamps the call log, and broadcasts to the owner. **Required** for the SMS reply loop to persist (the table must exist); the in-call "Press 1 to connect" whisper needs no migration. |
| 60 | `060-voice-wrapup.sql` | Adds **`call_logs.internal_notes`** + **`receptionists.is_mobile_operator`** — the hands-free voice wrap-up callback (`/api/voice/telnyx/wrapup`): a mobile operator is called back after a job, says Booked/Pending/Rejected + speaks job notes; notes are transcribed (OpenAI) into `internal_notes`, then the owner gets a formatted dispatch SMS with a maps link. Needs `TELNYX_TEXML_CONNECTION_ID` (TeXML app id) set in Vercel to place the callback; inert until then. `disposition_status` reuses `call_logs.disposition` (059). |
| 61 | `061-field-technicians.sql` | Field Technician Console + Owner Dispatch. Widens `users.account_role` to allow **`field_tech`**, adds the **`field_technicians`** roster (owner ↔ tech login), **`ai_leads.assigned_tech_id` + `ai_leads.job_status`** (dispatch + field progress), the **`job_invoices`** table (on-site itemized invoicing), and merchant-config columns on `onboarding_profiles`. **Required** for techs to log in, see assigned jobs, and for owners to assign jobs / provision techs. |
| 62 | `062-tracking-badges-sms-engine.sql` | Tech tracking + badges + automated customer SMS. Adds **`users.current_latitude/current_longitude/tech_status/earned_badges`** (live map + gamification), the owner **SMS engine settings** on `onboarding_profiles` (`sms_booking_enabled/route/review` toggles, `sms_*_template`, `google_review_url`), and the **`scheduled_sms`** table (post-job review text drops 15 min after completion). **Required** for the SMS automation engine + tech HUD location/badges. |
| 63 | `063-admin-ops-controls.sql` | Platform admin operational controls. Adds **`onboarding_profiles.feature_flags`** (per-tenant premium toggles like `field_tech_hud` / `sms_automation` set from the admin tenant drawer) and the **`payout_ledger`** table (every receptionist "Mark Paid" writes a balance-reset transaction). **Required** for tenant feature overrides + the operator payout ledger. |
| 64 | `064-tech-invite-link.sql` | **Hands-free field-tech invites.** Ensures the **`users.invitation_token` / `invitation_expires_at` / `invite_status`** columns exist (same columns as 054) so owners can add a tech by **mobile number only** — Lyncr texts a `/tech/setup?token=…` link where the tech sets their own password. Safe to run even if 054 already added these. |
| 65 | `065-organizations-external-lines.sql` | **Multi-business workspaces.** Adds **`organizations`** (one owner → many businesses) and **`phone_numbers.organization_id`**. Backfills a default org per owner. **Required** for the dashboard business switcher. |
| 66 | `066-porting-orders.sql` | **Native LNP porting orders.** Adds **`porting_orders`** to track formal Telnyx port requests (`pending` / `processing` / `completed` / `rejected`) per organization. **Required** for “Port Your Existing Number to Lyncr” in the buy-number modal. |
| 67 | `067-sms-registrations.sql` | **Dashboard SMS carrier registration.** Adds **`sms_registrations`** (compliance form data per workspace) and **`organizations.sms_registration_status`**. **Required** for Settings → `?tab=sms-registration` and the “Set up SMS” dashboard banner. |
| 68 | `068-10dlc-multi-tenant.sql` | **Multi-tenant 10DLC.** Adds **`organization_id`** + surrogate **`id`** PK on **`messaging_10dlc_registrations`** (one brand/campaign row per workspace), backfills existing rows to the default org, and drops the owner-global **`sms_registrations`** fallback index. **Required** for per-workspace SMS banners and carrier registration. |
| 69 | `069-sms-messages.sql` | **Two-way SMS threads.** Adds **`sms_messages`** (inbound + outbound per workspace). **Required** for Telnyx `message.received` storage and `POST /api/messaging/send` replies in the dashboard. |
| 70 | `070-porting-rejection-reason.sql` | **Port rejection capture.** Adds **`porting_orders.carrier_rejection_reason`** — Telnyx `porting_order.rejected` / rejection comments update owner Lines modal with PIN correction. **Required** for rejected-port resubmit flow. |
| 71 | `071-porting-lifecycle-statuses.sql` | **Port lifecycle statuses.** Extends **`porting_orders.status`** with `action_required`, `pending_info`, `submitted`, `pending_carrier_review` for the dashboard transfer tracker banner + interaction drawer. **Required** for amber action-required alerts. |
| 72 | `072-admin-routing-override-phone.sql` | **Admin inbound routing override (legacy).** Adds **`onboarding_profiles.admin_routing_override_phone`** — superseded by **073** (scoped per line/workspace). |
| 73 | `073-scoped-admin-routing-override.sql` | **Scoped admin routing override.** Adds **`phone_numbers.admin_routing_override_phone`** and **`organizations.admin_routing_override_phone`**. Line override wins; migrates legacy global override onto the reserved-number line only. **Required** for per-workspace admin forwarding. |
| 74 | `074-scheduler-events.sql` | **Owner job scheduler.** Adds **`ai_leads.scheduled_at`** and **`ai_leads.organization_id`** for the `/dashboard/scheduler` calendar and workspace-scoped events. **Required** for structured appointment rescheduling; scheduler v1 still works without it (falls back to `created_at`). |
| 75 | `075-structured-job-address.sql` | **Structured job-site addresses.** Adds **`job_address_*`** columns on **`ai_leads`** (street number, route, city, ZIP, state) for map-precision scheduling. **Optional** — app also stores the same keys in `collected` JSONB; columns enable indexing/reporting. |
| 76 | `076-unassigned-job-pool.sql` | **Unassigned Job Pool (Hopper).** Index on unassigned active jobs + backfills **`dispatch_status = 'unassigned_pool'`** for BOOKED/PENDING_TIME rows with no tech. **Required** for `/api/owner/jobs/pool` and tech claim; app sets the flag on new saves even before this runs. |
| 77 | `077-porting-notifications-organization.sql` | **Porting webhook workspace scope.** Adds **`porting_notifications.organization_id`** so carrier transfer desk alerts (PIN exceptions, etc.) stay isolated per business workspace. **Recommended** for multi-org owners. |
| 78 | `078-field-technicians-organization.sql` | **Field tech workspace scope.** Adds **`field_technicians.organization_id`** so the Team roster and scheduler only show technicians for the active business (Key Squad vs Fresh Auto, etc.). Backfills existing rows to each owner's default org. **Required** for multi-org owners. After running, use the **Business** dropdown on Team → Field Technicians to move misplaced techs. |
| 79 | `079-master-toggle-mode.sql` | **Legacy platform toggle column** (superseded by 080). |
| 80 | `080-admin-notification-preferences.sql` | **Granular platform-admin notification toggles.** Adds **`users.admin_notification_preferences`** JSONB with six channel flags. **Required** for the Notification Settings panel. |
| 81 | `081-inbound-caller-greeting-enabled.sql` | **Caller greeting toggle.** Adds **`inbound_caller_greeting_enabled`** on `routing_config` and denormalized on `phone_numbers` (default true). **Required** for the Routing tab “Greeting first” vs “Ring immediately” setting. |
| 82 | `082-operator-onboarding.sql` | **Platform-admin operator provisioning.** Adds **`users.operator_onboarding_status`** (`PENDING_INVITE` → `DEVICE_TESTING` → `ACTIVE_READY`), **`timezone`**, **`operator_assigned_workspaces`**, OTP columns, and **`receptionists.backup_phone_number`** + **`assigned_workspaces`**. **Required** for `/admin/receptionists` and `/auth/onboard`. |
| 83 | `083-call-log-owner-intake-dismissed.sql` | **`call_logs.owner_intake_dismissed_at`** — after you dismiss or **Send to dispatch map** on the answered-call intake sheet, that call stops re-opening in other tabs/windows. **Recommended** for multi-tab owners; localStorage sync works without it, but the column is the cross-device source of truth. |
| 84 | `084-lost-leads-recovery.sql` | **`lost_leads`** table — price-shopper / hang-up telemetry from the intake sheet (`POST /api/leads/lost`) + recovery SMS cron (`GET /api/cron/recover-leads`, 20-minute delay). **Required** for lost-lead logging and automated recovery texts. |
| 85 | `085-manual-call-log-bridge.sql` | **Manual call log bridge.** Extends **`call_logs.call_type`** with **`manual_intake`**, adds **`intake_source`**, **`intake_metadata`**, **`assigned_tech_user_id`**. Powers **`POST /api/calls/manual`** so walk-in dispatch intake shares one **`call_log_id`** with jobs + Activity history. **Recommended** for unified telemetry; app falls back to `incoming` + `status=manual_intake` before this runs. |
| 86 | `086-ivr-menu-settings.sql` | **Dashboard traditional IVR menu.** Adds **`ivr_greeting_text`**, **`ivr_option1_action`**, **`ivr_option2_action`** on **`routing_config`** (canonical) and denormalized on **`phone_numbers`**. Powers Greetings → Traditional IVR (`GET`/`PUT /api/routing/ivr`) and dynamic TeXML on **`/api/telnyx-menu`**. **Required** for custom keypad greetings; app falls back to Key Squad defaults until applied. |
| 87 | `087-ivr-menu-enabled.sql` | **IVR Off-duty switch.** Adds **`ivr_menu_enabled`** on **`routing_config`** + **`phone_numbers`**. When true, inbound TeXML Redirects to **`/api/telnyx-menu`** instead of ringing Your phone. **Required** for Smart Overflow IVR Menu toggle. |
| 88 | `088-schedule-blockouts.sql` | **Schedule blockouts.** Creates **`schedule_blockouts`** (per-owner / optional org) with **`date`**, **`is_full_day`**, **`start_time`**, **`end_time`**, **`reason`**. Powers Scheduler “Add Blockout”, public **`/book`** availability, and IVR next-slot filtering. **Required** for blockout-aware booking. |
| 89 | `089-active-routing-mode-and-deposits.sql` | **Unified Lines mode + deposits.** Adds **`routing_config.active_routing_mode`**, **`custom_routing_phone`**, **`users.require_deposit`**, **`booking_holds`**, and **`call_logs.ivr_action_completed`**. Powers Who Answers radio, Missed Call Rescue, and Stripe deposit on **`/book`**. |
| 90 | `090-missed-call-textback-enabled.sql` | **Missed Call Rescue toggle.** Adds **`users.missed_call_textback_enabled`** (default true). Lines Call Flow card + gates auto SMS booking link after unanswered inbound. **Required** for the Automation · Missed Call Rescue switch. |
| 91 | `091-booking-invites.sql` | **Secure `/book/[id]` invites.** Creates **`booking_invites`** for IVR Digit 1 + unanswered Dial fallback SMS tracking links. **Required** for opaque booking URLs from **`/api/telnyx-menu`**. |
| 92 | `092-account-presence-status.sql` | **Presence status.** Creates **`account_settings`** with **`presence_status`** (`AVAILABLE` / `ON_JOB` / `CLOSED`) + **`presence_closed_manual`**. Powers Lines Presence bar, inbound ring vs SMS, and **`/api/cron/sync-presence`**. **Required** for presence routing. |
| 93 | `093-live-gps-locate.sql` | **Live GPS locate tokens.** Creates **`live_gps_locate_tokens`** for intake “Request Live GPS” SMS links (`/locate?c=…`). **Required** for customer GPS → intake address. |
| 94 | `094-pending-call-review-sms.sql` | **Post-call review gate.** Creates **`pending_call_review_sms`** — after answered inbound &gt;60s, wait 15 min then send Google review SMS only if intake/invoice exists. Flushed by **`/api/sms/flush-scheduled`**. |
| 95 | `095-users-team-roles.sql` | **Team roles.** Ensures **`users.account_role`** defaults to **`owner`**, widens CHECK for **`owner` / `receptionist` / `field_tech` / `technician`** (TECHNICIAN alias). Powers multi-operator Dial + account-wide presence channels. |
| 96 | `096-job-photo-requests.sql` | **Request Job Photos.** Creates **`job_photo_tokens`** + **`job_photos`** for intake SMS upload links (`/upload?t=…`). Customer photos stream into the live **Job Attachments** gallery via Pusher **`ticket.photos_updated`**. |
| 97 | `097-photo-upload-alerts.sql` | **Delayed photo alerts.** Adds **`job_photo_tokens.ticket_status`** (`awaiting_photos` / `pending_info` / `resolved`) + **`operator_alert_sent_at`**, and **`operator_dashboard_heartbeats`**. Powers Pusher **`notification.photo_uploaded`** toast + Telnyx SMS to the operator when customers upload after the call. |
| 98 | `098-intake-rescue.sql` | **Pending Info Intake.** Adds customer name / VIN / notes / decoded vehicle columns on **`job_photo_tokens`**, photo **`category`** (`damage` / `id_verification`), and **`info_received`** ticket status for `/intake-rescue`. |
| 99 | `099-intake-rescue-optional-id-vin.sql` | **Low-friction rescue.** Adds **`verify_on_arrival`** + **`vin_unavailable`** on **`job_photo_tokens`** so ID upload and VIN are optional; operator sees VERIFY ID ON SITE badge. |

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
