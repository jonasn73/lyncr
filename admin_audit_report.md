# Lyncr Admin Console — Architecture & Schema Audit

**Generated:** 2026-06-07  
**Purpose:** Baseline inventory before expanding the admin right-hand slide-out into a Business Owner control hub.  
**Scope:** Component wiring, team/technician data model, 10DLC multi-tenant storage. No UI changes in this document.

---

## Executive summary

| Area | Status |
|------|--------|
| Admin slide-out panel | **Exists** — `components/admin-user-manage-drawer.tsx` (shadcn `Sheet`, opens from `/admin`) |
| Line rename / org-scoped admin | **Not in admin drawer** — drawer is **user-scoped** (`user_id`), not `organization_id` |
| Team invites table | **Yes** — `team_invites` (receptionist onboarding from admin) |
| Field tech roster | **Yes** — `field_technicians` + stub `users` rows (`invite_status`, `invitation_token`) |
| `organization_members` | **No** — multi-workspace uses `organizations` owned by `owner_user_id` only |
| 10DLC per org | **Yes** — `messaging_10dlc_registrations.organization_id` + `sms_registrations.organization_id` (migration **068**) |
| Explicit `is_multitenant` flag | **No** — inferred from org count + `subscription_tier` line caps |

---

## 1. Component audit (`app/admin` / admin UI)

### 1.1 Entry point and layout

| Path | Role |
|------|------|
| `app/admin/page.tsx` | Client page: loads directory + mounts drawer |
| `app/admin/layout.tsx` | Server guard — only `admin@lyncr.app` (`isLyncrAdminUser`) |
| `components/admin-chrome.tsx` | Admin shell / nav |
| `components/admin-access-guard.tsx` | Client-side session re-check |
| `components/lyncr-admin-dashboard.tsx` | Main table, KPIs, filters, “Manage user” action |
| **`components/admin-user-manage-drawer.tsx`** | **Right-hand slide-out (Screenshot target)** |
| `hooks/use-lyncr-admin-dashboard.ts` | Fetches `/api/admin/data` |

**How the drawer opens** (`app/admin/page.tsx`):

```tsx
const [manageUser, setManageUser] = useState<LyncrAdminDirectoryRow | null>(null)
const [drawerOpen, setDrawerOpen] = useState(false)

function openManageUser(row: LyncrAdminDirectoryRow) {
  setManageUser(row)
  setDrawerOpen(true)
}

<AdminUserManageDrawer
  row={manageUser}
  open={drawerOpen}
  onOpenChange={setDrawerOpen}
  fetchLatestAdminStats={fetchLatestAdminStats}
/>
```

The dashboard passes `onManageUser` from row actions / dropdown (“Manage user” with pencil icon in `lyncr-admin-dashboard.tsx`).

### 1.2 Slide-out component identity

**File:** `components/admin-user-manage-drawer.tsx`  
**UI primitive:** `@/components/ui/sheet` — `SheetContent side="right"`  
**Title:** “Advanced user management”

This is **not** under `components/admin/`; it lives at repo root `components/`. Sub-widgets under `components/admin/` today:

- `call-history.tsx`
- `live-traffic.tsx`
- `operator-payout-ledger.tsx`

### 1.3 Data loaded into the drawer

#### A) From parent row (`LyncrAdminDirectoryRow`) — no extra fetch

Populated when user clicks “Manage user”. Source: `GET /api/admin/data` → `listLyncrAdminDirectory()`.

**TypeScript shape** (`lib/types.ts`):

```typescript
export interface LyncrAdminDirectoryRow {
  user_id: string
  email: string
  account_role: "owner" | "receptionist"
  role: "OWNER" | "RECEPTIONIST" | "ADMIN"   // computed directory badge
  business_name: string
  receptionist_skills: string[]
  has_active_subscription: boolean
  subscription_tier: string                  // free_trial | starter | professional | business
  phone_number: string | null                // users.phone OR first active phone_numbers row
  carrier_credit: number                     // onboarding_profiles.carrier_credit
  total_calls_routed: number
  total_minutes_used: number
  account_status: string                     // active | suspended | flagged
  custom_routing_note: string | null
}
```

**SQL source (abbreviated)** — `lib/db.ts` → `listLyncrAdminDirectory()`:

```sql
SELECT
  u.id AS user_id,
  u.email,
  coalesce(u.account_role, 'owner') AS account_role,
  coalesce(u.business_name, '') AS business_name,
  CASE
    WHEN coalesce(u.account_role, '') = 'receptionist'
         OR EXISTS (SELECT 1 FROM receptionists rr WHERE rr.portal_user_id = u.id)
      THEN 'RECEPTIONIST'
    WHEN nullif(trim(u.business_name), '') IS NOT NULL THEN 'OWNER'
    ELSE 'ADMIN'
  END AS role,
  (SELECT r.skills FROM receptionists r WHERE r.portal_user_id = u.id LIMIT 1) AS receptionist_skills,
  coalesce(op.has_active_subscription, false) AS has_active_subscription,
  coalesce(op.subscription_tier, 'free_trial') AS subscription_tier,
  coalesce(op.carrier_credit, 0)::numeric AS carrier_credit,
  coalesce(op.total_calls_routed, stats.call_count, 0)::int AS total_calls_routed,
  coalesce(op.total_minutes_used, stats.minutes_used, 0)::numeric AS total_minutes_used,
  coalesce(op.account_status, 'active') AS account_status,
  op.custom_routing_note,
  coalesce(nullif(trim(u.phone), ''), (
    SELECT pn.number FROM phone_numbers pn
    WHERE pn.user_id = u.id AND pn.status = 'active'
    ORDER BY pn.created_at ASC LIMIT 1
  )) AS phone_number
FROM users u
LEFT JOIN onboarding_profiles op ON op.user_id = u.id
LEFT JOIN LATERAL ( /* call_logs aggregates */ ) stats ON true
ORDER BY u.created_at DESC
```

**Drawer fields initialized from row on open:**

| Drawer UI section | Initial value from row |
|-------------------|------------------------|
| Account status | `row.account_status` |
| Custom admin routing notes | `row.custom_routing_note` |
| Direct phone assignment | `row.phone_number` |
| Wallet balance display | `row.carrier_credit` |

#### B) Lazy fetch on drawer open — tenant controls

**Endpoint:** `GET /api/admin/users/[id]/controls`  
**When:** `useEffect` when `open && row.user_id`

**Response type** (`lib/types.ts`):

```typescript
export interface AdminTenantControls {
  feature_flags: Record<string, boolean>
  phone_lines: { id: string; number: string; label: string; status: string; type: string }[]
}
```

**Server loader** (`app/api/admin/users/[id]/controls/route.ts`):

```typescript
async function loadControls(userId: string): Promise<AdminTenantControls> {
  const [feature_flags, lines] = await Promise.all([
    getProfileFeatureFlags(userId),
    getPhoneNumbers(userId),
  ])
  const phone_lines = lines
    .filter((l) => l.status !== "released")
    .map((l) => ({
      id: l.id,
      number: l.number,
      label: l.label || "Line",
      status: l.status,
      type: l.type,
    }))
  return { feature_flags, phone_lines }
}
```

**Feature flags exposed in UI** (hardcoded in drawer):

```typescript
const FEATURE_CONTROLS = [
  { id: "field_tech_hud", label: "Field Tech HUD", ... },
  { id: "sms_automation", label: "SMS Automation", ... },
]
```

Canonical ids in DB layer: `ADMIN_FEATURE_FLAGS = ["field_tech_hud", "sms_automation"]` (`lib/db.ts`).

Stored in: `onboarding_profiles.feature_flags` JSONB (migration **063**).

#### C) Mutations the drawer can perform today

| Action | API / mechanism |
|--------|-----------------|
| Save status, notes, manual DID | `POST /api/admin/user-override` |
| Adjust wallet | Server action `adjustUserCredit()` → `onboarding_profiles.carrier_credit` |
| Toggle feature flag | `PATCH /api/admin/users/[id]/controls` `{ flag, enabled }` |
| Release a phone line | `DELETE /api/admin/users/[id]/controls` `{ lineId }` |
| Hard reset all active lines + zero credit | `POST /api/admin/user-override` `{ resetActiveLines: true }` |

**Not available in drawer today:**

- Organizations / workspaces list
- Per-org 10DLC status
- Team members (receptionists / field techs)
- `team_invites` pending queue
- Port orders / porting notifications
- SMS registration (`sms_registrations`) detail
- Line label edit (owners do this in `manage-numbers-modal` via `PATCH /api/numbers/[id]`)

### 1.4 Main admin dashboard API surface

**Primary bundle:** `GET /api/admin/data`

Returns:

```typescript
{
  data: {
    metrics: LyncrAdminMetrics,  // user counts, subscription sum, Telnyx pool, health
    users: LyncrAdminDirectoryRow[]
  }
}
```

**Other admin routes (reference):**

| Route | Purpose |
|-------|---------|
| `GET /api/admin/users/[id]` | Full user detail (`getAdminUserDetail`) — **not used by drawer today** |
| `PATCH /api/admin/users/[id]` | Platform admin flag only |
| `GET/PATCH/DELETE /api/admin/users/[id]/controls` | Feature flags + phone lines |
| `POST /api/admin/user-override` | Account status, notes, manual DID, reset lines |
| `POST /api/admin/toggle-subscription` | Subscription on/off from table |
| `POST /api/admin/adjust-credit` | Credit adjustment (also via server action) |
| `POST /api/admin/invite` | Receptionist invite (email/SMS → `team_invites`) |
| `GET /api/admin/live-traffic` | In-progress calls |
| `GET /api/admin/call-history` | Historical calls |
| `GET /api/admin/operators` | Receptionist payout ledger |
| `POST /api/admin/impersonate` | Login as user |

### 1.5 Admin metrics model

```typescript
export interface LyncrAdminMetrics {
  total_users: number
  active_subscriptions: number
  total_carrier_credit: number
  telnyx_routing_pool: { balance_usd, available_credit_usd, ... } | null
  health: { neon: "ok" | "error", telnyx: "ok" | "error" | "unconfigured" }
}
```

Sourced from `onboarding_profiles` aggregates + Telnyx routing pool ping — **not** org-scoped.

---

## 2. Team & technician mapping

### 2.1 There is no `organization_members` table

Multi-business is modeled as:

- **`organizations`** — one row per workspace; `owner_user_id` → business owner login
- **`phone_numbers.organization_id`** — which workspace owns each line
- **Owner-scoped team tables** — link to `users.id` (owner), **not** `organizations.id`

Future note in `docs/PLATFORM-BILLING-ROADMAP.md` mentions possible `organization_members`; **not implemented**.

### 2.2 Core `users` table (roles & invites)

**Base schema** (`scripts/001-create-schema.sql`):

```sql
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  business_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Later columns (migrations 040, 054, 061, 064):**

| Column | Purpose |
|--------|---------|
| `account_role` | `'owner' \| 'receptionist' \| 'field_tech'` |
| `invite_status` | `NULL` \| `'invited'` \| `'active'` — stub onboarding state |
| `invitation_token` | One-time setup token |
| `invitation_expires_at` | Token expiry |

### 2.3 Receptionists (call-routing team)

**Table:** `receptionists` (`scripts/001-create-schema.sql` + `040-receptionist-portal-role.sql`)

```sql
CREATE TABLE IF NOT EXISTS receptionists (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- BUSINESS OWNER
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  ...
  portal_user_id UUID REFERENCES users(id) ON DELETE SET NULL  -- receptionist LOGIN
);
```

**Link model:**

```
Business Owner (users.id)
    └── receptionists.user_id
            └── receptionists.portal_user_id → users.id (account_role = 'receptionist')
```

**No `organization_id`** on `receptionists`. Routing is historically **per owner account**, not per workspace.

### 2.4 Field technicians (dispatch team)

**Table:** `field_technicians` (`scripts/061-field-technicians.sql`)

```sql
CREATE TABLE IF NOT EXISTS field_technicians (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,      -- OWNER
  portal_user_id UUID REFERENCES users(id) ON DELETE SET NULL,     -- field_tech LOGIN
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (portal_user_id)
);
```

**Link model:**

```
Business Owner (users.id)
    └── field_technicians.user_id
            └── field_technicians.portal_user_id → users.id (account_role = 'field_tech')
```

**Owner APIs:**

- `GET/POST /api/technicians` — list / SMS invite
- `PATCH /api/technicians/[id]` — toggle active

Invite flow (`lib/tech-invite-stub.ts`): creates stub `users` row + `field_technicians` row with shared `invitation_token`.

### 2.5 `team_invites` — admin receptionist onboarding

**Created:** `scripts/041-team-invites.sql`  
**Extended:** `scripts/052-invite-sms-channel.sql`

```sql
CREATE TABLE IF NOT EXISTS team_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,                    -- nullable after 052 (SMS invites)
  first_name TEXT,               -- nullable after 052
  role TEXT NOT NULL DEFAULT 'receptionist',
  token TEXT NOT NULL UNIQUE,
  payout_rate_usd NUMERIC(6, 2) NOT NULL DEFAULT 2.50,
  invited_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 052 additions:
  channel TEXT NOT NULL DEFAULT 'EMAIL',   -- EMAIL | SMS
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING'   -- PENDING | ACCEPTED | EXPIRED
);
```

**Delivery tracking:**

| Field | Meaning |
|-------|---------|
| `channel` | `EMAIL` (Resend) or `SMS` (Telnyx) |
| `status` | `PENDING` / `ACCEPTED` / `EXPIRED` |
| `accepted_at` | Redemption timestamp at `/signup?invite=token` |
| `phone` | SMS target number |

**Admin entry:** `POST /api/admin/invite` + `AdminInviteReceptionistDialog` on main dashboard — **not** in the slide-out drawer.

**Separate from field tech invites:** techs use stub users + `/tech/setup`, not `team_invites`.

### 2.6 Organizations (workspaces) — owner link only

```sql
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sms_registration_status TEXT   -- added in 067
);
```

**Query helpers:** `listOrganizationsForOwner(ownerUserId)` in `lib/db.ts` — used by dashboard workspace switcher, **not** admin console.

### 2.7 Entity relationship (current)

```
users (owner)
 ├── organizations[]          (1:N workspaces)
 │    ├── phone_numbers[]     (organization_id)
 │    ├── sms_registrations   (1 row per org, unique index)
 │    └── messaging_10dlc_registrations (1 row per org)
 ├── receptionists[]          (user_id = owner; NO org_id)
 ├── field_technicians[]      (user_id = owner; NO org_id)
 ├── team_invites[]           (invited_by_user_id = admin or owner context)
 └── onboarding_profiles      (1:1 user_id — billing, flags, credit)
```

---

## 3. 10DLC & multi-tenant configuration

### 3.1 Two parallel registration stores

| Table | Scope | Primary use |
|-------|-------|-------------|
| `messaging_10dlc_registrations` | Was 1:1 `user_id`; now **1:1 per `organization_id`** (068) | Telnyx brand/campaign lifecycle, Stripe fee |
| `sms_registrations` | **1:1 per `organization_id`** (067) | Dashboard carrier compliance form metadata |

#### `messaging_10dlc_registrations` (origin: `scripts/047-messaging-10dlc.sql`)

Key columns:

```sql
CREATE TABLE messaging_10dlc_registrations (
  -- PK changed in 068 from user_id to id UUID
  user_id UUID REFERENCES users(id),
  organization_id UUID REFERENCES organizations(id),  -- 068
  legal_company_name TEXT,
  display_name TEXT,
  brand_id TEXT,
  campaign_id TEXT,
  assigned_number TEXT,
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | pending_review | approved | rejected | ...
  status_detail TEXT,
  street, city, state, postal_code, ...
  fee_cents, fee_paid, stripe_session_id,
  created_at, updated_at
);

CREATE UNIQUE INDEX messaging_10dlc_registrations_org_uidx
  ON messaging_10dlc_registrations (organization_id)
  WHERE organization_id IS NOT NULL;
```

#### `sms_registrations` (`scripts/067-sms-registrations.sql`)

```sql
CREATE TABLE sms_registrations (
  id UUID PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id),
  owner_user_id UUID NOT NULL REFERENCES users(id),
  legal_business_name TEXT NOT NULL,
  entity_type, tax_id_ein, street, city, state, postal_code,
  use_case_description TEXT NOT NULL,
  status TEXT CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED')),
  created_at, updated_at
);

CREATE UNIQUE INDEX sms_registrations_org_uidx ON sms_registrations (organization_id);
```

#### Organization mirror flag

```sql
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS sms_registration_status TEXT;
-- Values: NONE | PENDING_APPROVAL | APPROVED | REJECTED
```

### 3.2 Querying 10DLC per `organization_id`

**Yes — supported in application code:**

```typescript
// lib/db.ts
getMessaging10DlcRegistration(userId, organizationId?)
getSmsRegistrationForOrganization(ownerUserId, organizationId)
getOrganizationSmsRegistrationStatus(orgUuid, ownerUserId)
```

**Compliance aggregator:** `getWorkspace10DlcCompliance(ownerUserId, organizationId)` (`lib/workspace-10dlc-compliance.ts`) — powers dashboard SMS banner, not admin.

**Admin drawer:** does **not** call these functions today.

### 3.3 Multi-tenant differentiation — what exists vs what does not

| Concept | Implemented? | Where |
|---------|--------------|-------|
| Multiple workspaces per owner | **Yes** | `organizations` table |
| 10DLC per workspace | **Yes** | `organization_id` on 10DLC + sms_registrations (068) |
| Phone lines per workspace | **Yes** | `phone_numbers.organization_id` |
| `is_multitenant` / `tenant_mode` column | **No** | — |
| `max_locations` column | **No** | — |
| Per-tier **line count** cap | **Yes** | `onboarding_profiles.subscription_tier` + `TIER_ACTIVE_NUMBER_LIMIT` |
| Per-tier **workspace** cap | **No explicit cap** | Owners can create multiple orgs; only line limits enforced |

**Subscription tier line limits** (`lib/subscription-tier.ts`):

```typescript
export const TIER_ACTIVE_NUMBER_LIMIT: Record<SubscriptionTier, number> = {
  free_trial: 1,
  starter: 1,
  professional: 3,
  business: 999,
}
```

**Billing / entitlements row:** `onboarding_profiles` (`scripts/028-subscription-tier-carrier-credit.sql`):

```sql
ALTER TABLE onboarding_profiles
  ADD COLUMN subscription_tier TEXT NOT NULL DEFAULT 'free_trial',
  ADD COLUMN carrier_credit NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN has_active_subscription BOOLEAN,
  ADD COLUMN feature_flags JSONB NOT NULL DEFAULT '{}';  -- 063
```

**Inferring “multi-tenant” today:**

```sql
-- Example: owners with more than one organization
SELECT owner_user_id, count(*) AS org_count
FROM organizations
GROUP BY owner_user_id
HAVING count(*) > 1;
```

There is no first-class admin UI or flag for this.

### 3.4 Related messaging tables (not in admin)

| Table | Purpose |
|-------|---------|
| `sms_messages` (069) | Inbound/outbound SMS threads per org |
| `porting_orders` (066) | Native LNP port requests per org |
| `porting_notifications` (016) | Telnyx webhook inbox per **user_id** |

---

## 4. Gaps for a “Business Owner control hub” expansion

Based on current architecture, a richer admin slide-out would likely need **new read APIs** (or extend existing ones) for:

1. **Organizations** — `listOrganizationsForOwner(userId)` + org-scoped phone lines
2. **10DLC** — `getWorkspace10DlcCompliance` / raw registration rows per org
3. **Team roster** — `receptionists`, `field_technicians`, pending `team_invites`
4. **Porting** — `porting_orders` + `porting_notifications` filtered by owner
5. **Org vs account scope** — drawer today keys everything on `user_id`; multi-workspace owners need org picker or nested sections

**Already available without schema changes:**

- Wallet, subscription tier, account status, admin notes
- Feature flags (`field_tech_hud`, `sms_automation`)
- All phone lines for owner (includes `label`, `organization_id` in DB but org **not** passed to drawer UI)
- Line release + hard reset

---

## 5. Key file index (quick navigation)

| Concern | File |
|---------|------|
| Slide-out panel | `components/admin-user-manage-drawer.tsx` |
| Admin home wiring | `app/admin/page.tsx` |
| Directory table | `components/lyncr-admin-dashboard.tsx` |
| Directory SQL | `lib/db.ts` → `listLyncrAdminDirectory()` |
| Tenant controls API | `app/api/admin/users/[id]/controls/route.ts` |
| User override API | `app/api/admin/user-override/route.ts` |
| Directory types | `lib/types.ts` → `LyncrAdminDirectoryRow`, `AdminTenantControls` |
| Organizations schema | `scripts/065-organizations-external-lines.sql` |
| 10DLC multi-tenant | `scripts/068-10dlc-multi-tenant.sql` |
| SMS registrations | `scripts/067-sms-registrations.sql` |
| Team invites | `scripts/041-team-invites.sql`, `scripts/052-invite-sms-channel.sql` |
| Field techs | `scripts/061-field-technicians.sql`, `scripts/064-tech-invite-link.sql` |
| Feature flags | `scripts/063-admin-ops-controls.sql` |
| Subscription tiers | `scripts/028-subscription-tier-carrier-credit.sql`, `lib/subscription-tier.ts` |

---

## 6. Migration checklist (if Neon is behind)

Ensure these scripts are applied for full fidelity of this audit:

| Step | Script |
|------|--------|
| 34 | `034-admin-profile-metrics.sql` — account_status, custom_routing_note |
| 40 | `040-receptionist-portal-role.sql` — portal_user_id |
| 41 | `041-team-invites.sql` |
| 52 | `052-invite-sms-channel.sql` — channel, status, phone |
| 61 | `061-field-technicians.sql` |
| 63 | `063-admin-ops-controls.sql` — feature_flags |
| 65 | `065-organizations-external-lines.sql` |
| 67 | `067-sms-registrations.sql` |
| 68 | `068-10dlc-multi-tenant.sql` |

See `scripts/MIGRATE-ALL.md` for ordered runbook.

---

*End of audit — ready for structural analysis and control-hub design.*
