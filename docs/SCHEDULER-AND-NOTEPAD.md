# Scheduler & Receptionist Call Notepad

Owner calendar for booked/pending jobs and receptionist inline lead capture during live calls.

## Overview

| Feature | Route / surface | Role | Purpose |
|---------|-----------------|------|---------|
| **Job Scheduler** | `/dashboard/scheduler` | Owner | Calendar view of BOOKED + PENDING_TIME jobs |
| **Call Notepad** | `/receptionist` (live intake panel) | Receptionist | Capture caller details + disposition during/after calls |

Both features share the same data layer: **`ai_leads`** (jobs/leads) and **`call_logs`** (call history).

---

## Database

### Existing tables (no change required for v1)

| Table | Relevant columns |
|-------|------------------|
| `ai_leads` | `user_id`, `caller_e164`, `collected` (JSONB), `summary`, `disposition`, `dispatch_status`, `job_status`, `assigned_tech_id` |
| `call_logs` | `provider_call_sid`, `from_number`, `disposition`, `routed_to_receptionist_id` |
| `organizations` | Workspaces — `phone_numbers.organization_id` scopes lines |

### Migration 074 (`scripts/074-scheduler-events.sql`)

Adds optional indexed scheduling columns on `ai_leads`:

| Column | Type | Purpose |
|--------|------|---------|
| `scheduled_at` | `TIMESTAMPTZ` | Structured appointment time (owner calendar + drag-reschedule) |
| `organization_id` | `UUID` | Workspace scope (nullable — legacy rows show in all workspaces) |

**Run in Neon → SQL Editor** after prior migrations. Listed as step **74** in `scripts/MIGRATE-ALL.md`.

When `scheduled_at` is NULL, the scheduler falls back to `created_at` and marks the event as **tentative**.

---

## Role model

There is **no roles table**. Login identity uses `users.account_role`:

| Value | Portal | Guard |
|-------|--------|-------|
| `owner` | `/dashboard/*` | `app/dashboard/layout.tsx` |
| `receptionist` | `/receptionist/*` | `getReceptionistPortalContext()` |
| `field_tech` | `/tech/dashboard` | `lib/field-tech-auth.ts` |

Owner and receptionist are **separate apps** — receptionists never see `/dashboard`.

---

## Owner: Job Scheduler

### Route

- **URL:** `/dashboard/scheduler`
- **File:** `app/dashboard/scheduler/page.tsx`
- **UI:** `components/workspace-views/scheduler-workspace-view.tsx`
- **Navigation:** Bottom tab bar (between Activity and Leads), ⌘K jump palette, and account menu

### API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/owner/scheduler?from=&to=&organization_id=` | List calendar events in date range |
| `POST` | `/api/owner/scheduler` | Create manual appointment (customer, vehicle, job address/notes, tech, start, duration) |
| `PATCH` | `/api/owner/scheduler/[id]` | Set `{ scheduled_at: ISO8601 }` on a lead |

### Data query

`listOwnerSchedulerEvents()` in `lib/db.ts`:

- Includes leads where `disposition` (column or JSONB) is `BOOKED` or `PENDING_TIME`
- Filters by `COALESCE(scheduled_at, created_at)` within the requested range
- Optional workspace filter: `(organization_id IS NULL OR organization_id = $orgId)`

### Workspace context

Uses `DashboardWorkspaceProvider.activeOrganizationId` — same pattern as Routing tab (`?organization_id=` on API calls).

### Automotive field services UI

| View | Purpose |
|------|---------|
| **Grid View** | Hourly timeline (7 AM–7 PM) with click-to-book |
| **Map Route View** | Split pane: chronological stop list + Leaflet map with numbered pins (1, 2, 3…) and dashed route line |

**Create appointment** modal fields (stored in `ai_leads.collected`):

| Field | JSON keys |
|-------|-----------|
| Vehicle year / make / model | `vehicle_year`, `vehicle_make`, `vehicle_model` |
| Job type | `job_type` |
| Job address | `job_address` (+ `location`, `service_address` aliases) |
| Job notes | `job_notes` |

Address autocomplete: `GET /api/geocode/autocomplete?q=` (Nominatim; Google Places if `GOOGLE_MAPS_API_KEY` is set). On save, `POST /api/owner/scheduler` geocodes the address and writes `customer_lat` / `customer_lng` for the map.

Shared field schema: `lib/field-service-intake.ts` — used by both scheduler booking and receptionist notepad.

---

## Receptionist: Call Notepad / Lead Dispatcher

### Surface

- **File:** `components/receptionist-live-intake.tsx`
- **Host:** `components/receptionist-portal-view.tsx` — panel replaces live status when Pusher `call-connected` fires

### Flow

1. Call connects → intake form opens with **unified automotive dispatch fields** (same as owner scheduler).
2. Receptionist fills vehicle year/make/model, job address (autocomplete), job notes, preferred time.
3. **Draft autosave:** `sessionStorage` keyed by `callLogId` so a refresh does not lose notes.
4. **Disposition buttons** submit to `POST /api/receptionist/log-job`:

| Button | Disposition | Owner effect |
|--------|-------------|--------------|
| Booked | `BOOKED` | Job feed + optional auto-dispatch to on-duty tech |
| Pending time | `PENDING_TIME` | Scheduler (awaiting confirmed time) |
| Price rejected | `PRICE_REJECTED` | Lead Salvage queue |
| Failed | `FAILED` | Logged outcome, no dispatch |

5. **Save & text owner** → `POST /api/receptionist/intake` (existing lead alert SMS path).

### Shared disposition engine

All dispositions write:

1. `ai_leads` row via `saveCallIntake()` (`lib/intake-engine.ts`)
2. Indexed columns via `applyLeadDisposition()` (`lib/call-disposition.ts`)
3. `call_logs.disposition` when `callLogId` is present
4. Pusher owner event (`job-booked`, `lead-salvageable`, or `disposition-updated`)

If intake includes a parseable `preferred_time`, `scheduled_at` is set on the lead (requires migration 074).

When a job address is present, **background geocoding** runs on both `log-job` and `intake` saves (`after()` → `geocodeAddress` → `setLeadCoordinates`) so the owner scheduler map route populates without a manual refresh.

---

## File index

| Area | Path |
|------|------|
| Docs | `docs/SCHEDULER-AND-NOTEPAD.md` |
| Migration | `scripts/074-scheduler-events.sql` |
| Scheduler DB | `lib/db.ts` — `listOwnerSchedulerEvents`, `updateLeadScheduledAt` |
| Scheduler API | `app/api/owner/scheduler/route.ts`, `app/api/owner/scheduler/[id]/route.ts` |
| Scheduler UI | `components/workspace-views/scheduler-workspace-view.tsx` |
| Scheduler map | `components/scheduler-route-map.tsx` |
| Address autocomplete | `components/job-address-autocomplete.tsx`, `app/api/geocode/autocomplete/route.ts` |
| Shared intake schema | `lib/field-service-intake.ts` |
| Booking modal | `components/scheduler-booking-dialog.tsx` |
| Scheduler route | `app/dashboard/scheduler/page.tsx` |
| Notepad UI | `components/receptionist-live-intake.tsx` |
| Notepad API | `app/api/receptionist/log-job/route.ts` |
| Dispositions | `lib/call-disposition.ts` |
| Types | `lib/types.ts` — `SchedulerEvent` |

---

## Testing checklist

### Owner scheduler

1. Log in as owner → ⌘K → “Scheduler” → `/dashboard/scheduler`
2. Book a job from receptionist portal → event appears on calendar
3. Toggle **Map Route View** → numbered stops appear on map when address was geocoded
4. Create appointment with vehicle + address → pin appears on route map

### Receptionist notepad

1. Log in as receptionist → simulate or receive live call
2. Fill intake fields → refresh page → draft restores
3. Submit each disposition → verify owner Activity/Leads/Scheduler react
4. Confirm `call_logs.disposition` stamped when `callLogId` present
