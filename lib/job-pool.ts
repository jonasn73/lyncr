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

/** Placeholder street line for pending callback leads (no address yet). */
export const PENDING_CALLBACK_ADDRESS = "PENDING_CALLBACK"

/** dispatch_status values that appear in the owner hopper sidebar — active bookings only. */
export const HOPPER_DISPATCH_STATUSES = [UNASSIGNED_POOL_STATUS] as const

/** dispatch_status after a tech is assigned or claims a job. */
export const DISPATCHED_STATUS = "DISPATCHED"

/** Pull a neighborhood label from a full street address (city/locality segment). */
export function neighborhoodFromLocation(location: string | null | undefined): string | null {
  const raw = location?.trim()
  if (!raw) return null
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean)
  if (parts.length >= 3) return parts[parts.length - 2]
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
