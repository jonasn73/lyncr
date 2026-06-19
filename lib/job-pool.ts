// Unassigned Job Pool ("The Hopper") — shared constants + display helpers.

/** dispatch_status value when a job has no assigned tech and sits in the hopper. */
export const UNASSIGNED_POOL_STATUS = "unassigned_pool"

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
