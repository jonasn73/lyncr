# Porting rejections & multi-tenant workspace audit

## Scope

Three linked areas: Telnyx port rejection capture, owner PIN correction in the Lines modal, and strict dashboard isolation via the business workspace switcher.

## 1. Telnyx port rejection capture

| Layer | File | Role |
|-------|------|------|
| Webhook ingress | `app/api/webhooks/telnyx/porting/route.ts` | Receives all Telnyx port events; stores notification + syncs `porting_orders` |
| Payload parsing | `lib/telnyx-porting-webhook.ts` | `extractEventType`, `extractPortRejectionReason`, `isPortRejectionWebhook` |
| Order sync | `lib/porting-order-sync.ts` | `applyPortRejectionFromTelnyxWebhook` → status `rejected` + `carrier_rejection_reason` |
| Schema | `scripts/070-porting-rejection-reason.sql` | `porting_orders.carrier_rejection_reason TEXT` |

**Events handled:** `porting_order.comment_created` (when body looks like a rejection), `porting_order.rejected`.

**Status values:** lowercase `rejected` (matches `066-porting-orders.sql` CHECK constraint).

## 2. Owner PIN correction (Lines modal)

| Layer | File | Role |
|-------|------|------|
| UI | `components/manage-numbers-modal.tsx` | Red badge + inline PIN form for `status === rejected` |
| **Lifecycle banner** | `components/dashboard/porting-status-banner.tsx` | Permanent tracker for all non-completed ports (slate / amber / red) |
| **Interaction drawer** | `components/dashboard/porting-interaction-drawer.tsx` | Pipeline + `porting_notifications` thread + Telnyx reply |
| API | `GET /api/porting/orders/[id]/desk`, `POST /api/porting/orders/[id]/reply` | Drawer data + send comment/PIN to Telnyx |
| API | `app/api/porting/orders/[id]/resubmit-pin/route.ts` | Owner-only POST → Telnyx PATCH + reset local status to `pending` |
| Telnyx | `lib/telnyx-lnp-update.ts` | `submitTelnyxPortingPinCorrection` |

Rejected orders stay visible in **Pending Number Transfers** until corrected or completed. Banner click opens the **interaction drawer** (not the Lines modal).

## 3. Workspace isolation

| Concern | Mechanism |
|---------|-----------|
| Active workspace | `lib/workspace-organizations.ts` → localStorage + `lyncr-organization-changed` event |
| Global state | `components/dashboard-workspace-context.tsx` → `activeOrganizationId` |
| Switcher | `components/organization-switcher.tsx` / `components/dashboard-header-workspace.tsx` |
| Phone lines | `GET /api/numbers/mine?organization_id=` + buy route stamps `organization_id` |
| Port orders | `GET /api/porting/orders?organization_id=` + `POST /api/numbers/port` body |
| Personnel | `GET /api/receptionists?organization_id=` → receptionists on routing for that org's lines |
| Dashboard refetch | `components/dashboard-page.tsx` refetches numbers + receptionists when `activeOrganizationId` changes |

**Note:** Receptionists remain owner-scoped in the DB; workspace filtering is via `routing_config` ↔ `phone_numbers.organization_id` join (no new `receptionists.organization_id` column in this pass).

## Run migration

See `scripts/MIGRATE-ALL.md` row **70** — run `070-porting-rejection-reason.sql` in Neon.
