/**
 * Compact CRM list seed for hard-refresh SSR.
 * Full customer JSON is too big for cookies — keep name / phone / badge / status.
 */

import type { CrmCustomerListItem, CrmLeadBadge } from "@/lib/types"
import type { CrmStatusTone } from "@/lib/unreachable-follow-up"
import {
  paintSeedCookieName,
  readPaintSeedCookie,
  readPaintSeedCookieValue,
  writePaintSeedCookie,
} from "@/lib/paint-seed-cookie"
import { operationsPaintMatchesOrg } from "@/lib/operations-paint-cache"

export const CRM_LIST_PAINT_SCOPE = "crm-list"
export const CRM_LIST_PAINT_COOKIE = paintSeedCookieName(CRM_LIST_PAINT_SCOPE)

/** One list row — enough to paint CRM names + status on refresh (no “Price quoted” → flip). */
export type CrmListPaintRow = {
  id: string
  n: string
  p: string
  b?: CrmLeadBadge
  j?: number
  r?: number
  /** job_status_label — e.g. Price quoted / Needs call / Booked · … */
  s?: string
  /** job_status_tone */
  t?: CrmStatusTone
  /** open_lead_count */
  o?: number
}

export type CrmListPaintSeed = {
  organizationId: string | null
  customers: CrmListPaintRow[]
}

const MAX_PAINT_ROWS = 16

function clip(s: string, n: number): string {
  const t = String(s || "")
  return t.length > n ? t.slice(0, n) : t
}

function trimRow(c: CrmCustomerListItem): CrmListPaintRow {
  const status = String(c.job_status_label || "").trim()
  return {
    id: clip(c.id, 40),
    n: clip(c.display_name || "", 28),
    p: clip(c.phone_e164 || "", 16),
    ...(c.lead_badge ? { b: c.lead_badge } : {}),
    ...(typeof c.jobs_completed === "number" ? { j: c.jobs_completed } : {}),
    ...(typeof c.lifetime_revenue_cents === "number" ? { r: c.lifetime_revenue_cents } : {}),
    ...(status ? { s: clip(status, 36) } : {}),
    ...(c.job_status_tone ? { t: c.job_status_tone } : {}),
    ...(typeof c.open_lead_count === "number" && c.open_lead_count > 0
      ? { o: c.open_lead_count }
      : {}),
  }
}

/** Expand paint rows into CRM list items (other fields empty until live fetch). */
export function crmPaintToListItems(seed: CrmListPaintSeed): CrmCustomerListItem[] {
  return seed.customers.map((row) => ({
    id: row.id,
    user_id: "",
    phone_e164: row.p,
    display_name: row.n,
    company_name: "",
    address_line1: "",
    address_line2: "",
    city: "",
    region: "",
    postal_code: "",
    country: "",
    notes: "",
    source_last_call_log_id: null,
    created_at: "",
    updated_at: "",
    jobs_completed: row.j ?? 0,
    lifetime_revenue_cents: row.r ?? 0,
    lead_badge: row.b ?? "new_contact",
    open_lead_count: row.o ?? 0,
    job_status_label: row.s ?? null,
    job_status_tone: row.t ?? null,
  }))
}

/** Persist after a successful CRM list load. Shrinks until the cookie fits. */
export function writeCrmListPaintSeed(
  customers: CrmCustomerListItem[],
  organizationId: string | null = null
): void {
  let n = Math.min(MAX_PAINT_ROWS, Math.max(0, customers.length))
  while (n >= 0) {
    const payload: CrmListPaintSeed = {
      organizationId,
      customers: customers.slice(0, n).map(trimRow),
    }
    if (writePaintSeedCookie(CRM_LIST_PAINT_SCOPE, payload)) return
    n -= 1
  }
}

export function readCrmListPaintFromCookieRaw(
  cookieRaw: string | null | undefined
): CrmListPaintSeed | null {
  const parsed = readPaintSeedCookieValue<CrmListPaintSeed>(cookieRaw)
  if (!parsed || !Array.isArray(parsed.customers)) return null
  return parsed
}

export function readCrmListPaintSeed(
  paint?: CrmListPaintSeed | null,
  organizationId?: string | null
): CrmListPaintSeed | null {
  const fromPaint = paint && Array.isArray(paint.customers) ? paint : null
  const parsed = fromPaint ?? readPaintSeedCookie<CrmListPaintSeed>(CRM_LIST_PAINT_SCOPE) ?? null
  if (!parsed || !Array.isArray(parsed.customers)) return null
  if (
    organizationId !== undefined &&
    !operationsPaintMatchesOrg(
      { organizationId: parsed.organizationId, calls: [], fetchedAt: 0 },
      organizationId
    )
  ) {
    return null
  }
  return parsed
}

/** Compact signature — skip setState when the live list matches what is already on screen. */
export function crmListFingerprint(rows: CrmCustomerListItem[]): string {
  return rows
    .map(
      (r) =>
        `${r.id}|${r.lead_badge}|${r.job_status_label ?? ""}|${r.job_status_tone ?? ""}|${r.open_lead_count}|${r.jobs_completed}|${r.display_name}|${r.lifetime_revenue_cents}|${r.phone_e164}`
    )
    .join(";")
}
