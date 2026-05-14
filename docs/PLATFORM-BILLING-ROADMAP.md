# Platform roadmap — billing, credits, admin, feedback

This document is the **implementation plan** and **profitability model** for making Zing a sustainable product while staying easy to use.

## Guiding principles

1. **Credits belong to the account** (`users.id`) — one balance per business owner login; future “teams” can move to `organizations` + `organization_members` without changing the credit mental model.
2. **Transparent usage** — every debit has a row in `billing_ledger` with reason + optional reference (call id, invoice id).
3. **Admin is rare and powerful** — platform admins (DB flag + `ZING_ADMIN_EMAILS` allow-list) see aggregates, adjust credits, triage feedback.
4. **Ship in phases** — avoid blocking voice on payment; start with **manual top-ups + reporting**, then automate.

---

## Pricing model (profitable, simple to explain)

| Component | Direction | Suggested retail framing |
|-----------|-----------|---------------------------|
| **Subscription** | Recurring MRR | Starter / Growth / Enterprise monthly fee includes bundled minutes + numbers cap. |
| **Metered overage** | Usage above bundle | Per-minute PSTN + per-minute AI at a **markup** over Telnyx + OpenAI landed cost (target **40–60% gross margin** on marginal usage after support). |
| **Prepaid credits** | Cash up front | $20 / $50 / $100 packs at slight discount vs metered; balance stored as `credit_balance_cents`. |
| **Numbers & porting** | Pass-through + fee | Telnyx number + regulatory fees + **flat Zing service fee** per number / port. |

**Implementation constants** (see `lib/billing-pricing.ts`): wholesale placeholders + suggested retail per minute — tune from real Telnyx/OpenAI bills.

**Later**: Stripe Customer Portal, hosted invoices, tax (Stripe Tax), automatic meter webhooks from Telnyx CDR.

---

## Phase 0 (done in repo with migration `019`)

- `users.credit_balance_cents`, `billing_plan`, `is_platform_admin`
- `billing_ledger`, `feedback_submissions`
- User-facing **Help** tab: balance/plan summary + feedback form
- **Admin** area: `/admin` overview, user list with usage snapshot, credit adjustment API
- **Env**: `ZING_ADMIN_EMAILS` — comma-separated emails that always get admin API access (even if `is_platform_admin` is false in DB)

---

## Phase 1 — Usage metering (next)

- Nightly or streaming job: aggregate `call_logs` → bill PSTN minutes (and optional AI duration when stored).
- Insert `billing_ledger` rows `usage_call` / `usage_ai`; decrement `credit_balance_cents` in one transaction.
- **Low balance** banner in app + email when balance &lt; threshold.

---

## Phase 2 — Stripe

- Checkout for subscriptions + credit packs; webhooks update `billing_ledger` + balance.
- Customer portal for payment method + invoices.

---

## Phase 3 — Enterprise & support “fantastic”

- SLA tier, dedicated support inbox, status page integration.
- Impersonation / read-only “view as customer” (audit logged) — only with legal + UX guardrails.

---

## Other ingredients for a fully functional product

| Area | Notes |
|------|--------|
| **Onboarding checklist** | First-run: buy number, set routing, test call, add payment. |
| **Status & incidents** | Link from Help to status page when you have one. |
| **Legal** | ToS, privacy, refund policy aligned with prepaid + subscription. |
| **Observability** | Keep `ZING_VOICE_DEBUG_LOGS` off in prod; use admin + DB for billing disputes. |
| **Security** | Rate-limit `/api/feedback` and admin POSTs; audit `billing_ledger.actor_user_id`. |

---

## Database

Run **`scripts/019-billing-admin-feedback.sql`** in Neon (see `scripts/MIGRATE-ALL.md`).

Set **`ZING_ADMIN_EMAILS`** in Vercel to your operator email(s). Optionally set **`is_platform_admin = true`** on your user row in SQL for the same effect without env drift.
