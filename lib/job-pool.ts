// Unassigned Job Pool ("The Hopper") — shared constants + display helpers.

/** dispatch_status value when a job has no assigned tech and sits in the hopper. */
export const UNASSIGNED_POOL_STATUS = "unassigned_pool"

/** dispatch_status when intake saved without a map-ready address (callback / pending). */
export const UNASSIGNED_CALLBACK_STATUS = "unassigned_callback"

/** CRM Leads workspace — pending callback / follow-up (not scheduler hopper). */
export const CRM_LEAD_STATUS = "lead"

/** CRM Leads workspace — price-shopper / hang-up saved from intake. */
export const LOST_LEAD_STATUS = "lost_lead"

/** dispatch_status values that belong on the CRM Leads page (not the scheduler hopper). */
export const CRM_LEAD_DISPATCH_STATUSES = [
  CRM_LEAD_STATUS,
  LOST_LEAD_STATUS,
  UNASSIGNED_CALLBACK_STATUS, // legacy rows saved before CRM_LEAD_STATUS
] as const

/**
 * Price denied / salvage outreach — same lane as call-disposition PRICE_REJECTED.
 * Lives in CRM Recover (and optional hopper rescue tray), not Coming Up Next.
 */
export const SALVAGE_PENDING_STATUS = "salvage_pending"

/** Placeholder street line for pending callback leads (no address yet). */
export const PENDING_CALLBACK_ADDRESS = "PENDING_CALLBACK"

/** dispatch_status values that appear in the owner hopper sidebar — active bookings only. */
export const HOPPER_DISPATCH_STATUSES = [UNASSIGNED_POOL_STATUS] as const

/** dispatch_status after a tech is assigned or claims a job. */
export const DISPATCHED_STATUS = "DISPATCHED"

/**
 * True when a lead is CRM salvage / quote / lost — not bookable "Coming Up Next" work.
 * Uses existing enums only (lead, lost_lead, salvage_pending, PRICE_REJECTED).
 */
export function isCrmSalvageOrQuoteDispatch(params: {
  dispatch_status?: string | null
  job_status?: string | null
  disposition?: string | null
}): boolean {
  // Normalize columns once so callers can pass raw API rows.
  const dispatch = (params.dispatch_status ?? "").trim().toLowerCase()
  const jobStatus = (params.job_status ?? "").trim().toLowerCase()
  const disposition = (params.disposition ?? "").trim().toUpperCase()

  // Operator / receptionist price-rejected outcome.
  if (disposition === "PRICE_REJECTED") return true
  // Pipeline "Price denied" + intake lost-lead salvage.
  if (dispatch === SALVAGE_PENDING_STATUS || dispatch === LOST_LEAD_STATUS) return true
  // Pure CRM quote / callback leads (not scheduled field work).
  if (
    dispatch === CRM_LEAD_STATUS ||
    dispatch === UNASSIGNED_CALLBACK_STATUS ||
    jobStatus === CRM_LEAD_STATUS ||
    jobStatus === LOST_LEAD_STATUS ||
    jobStatus === "price_denied" ||
    jobStatus === "price_rejected" ||
    jobStatus.includes("price")
  ) {
    return true
  }
  return false
}

/** Pull a city / neighborhood label from a full street address. */
export function neighborhoodFromLocation(location: string | null | undefined): string | null {
  const raw = location?.trim()
  if (!raw) return null
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return null
  // "Street, City, State, ZIP" → City (not State).
  if (parts.length >= 4) return parts[parts.length - 3]
  // "Street, City, State" or "Street, City, ZIP" → City.
  if (parts.length === 3) return parts[1]
  // "City, State" → City.
  if (parts.length === 2) return parts[0]
  return parts[0] ?? null
}

/** Build "2019 Ford F-150" from vehicle fields. */
export function vehicleLabelFromParts(
  year: string | null | undefined,
  make: string | null | undefined,
  model: string | null | undefined
): string | null {
  const parts = [year, make, model].map((p) => String(p ?? "").trim()).filter(Boolean)
  return parts.length ? parts.join(" ") : null
}
