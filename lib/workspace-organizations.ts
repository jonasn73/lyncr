/** localStorage key for the owner's active business workspace (organization) id. */
export const ACTIVE_ORGANIZATION_STORAGE_KEY = "lyncr_active_organization_id"

/**
 * Fix common display-name typos so webhook branding and the dashboard switcher match.
 * Example: "Key Squad 5o2" (letter o) → "Key Squad 502" (digit zero).
 */
export function normalizeWorkspaceDisplayName(raw: string): string {
  // Trim ends so create/rename APIs get a clean name.
  let name = raw.trim()
  // Replace letter-o lookalikes next to 5/2 (5o2 / 5O2) with the digit zero.
  name = name.replace(/\b5[oO]2\b/g, "502")
  return name
}

export function readActiveOrganizationId(): string | null {
  if (typeof window === "undefined") return null
  try {
    const v = localStorage.getItem(ACTIVE_ORGANIZATION_STORAGE_KEY)?.trim()
    return v || null
  } catch {
    return null
  }
}

export function writeActiveOrganizationId(organizationId: string | null): void {
  if (typeof window === "undefined") return
  try {
    const next = organizationId?.trim() || null
    const prev = readActiveOrganizationId()
    if (prev === next) return
    if (!next) localStorage.removeItem(ACTIVE_ORGANIZATION_STORAGE_KEY)
    else localStorage.setItem(ACTIVE_ORGANIZATION_STORAGE_KEY, next)
    window.dispatchEvent(new CustomEvent("lyncr-organization-changed", { detail: { organizationId: next } }))
    notifyWorkspaceDataChanged({ organizationId: next })
  } catch {
    // ignore quota / private mode
  }
}

/** Tell mounted dashboard views (scheduler pool, routing stats, etc.) to re-fetch. */
export function notifyWorkspaceDataChanged(detail?: {
  organizationId?: string | null
  reason?: string
}): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent("lyncr-workspace-data-changed", { detail }))
}

/** Append ?organization_id= when a workspace is selected (for dashboard API fetches). */
export function organizationQueryString(organizationId: string | null | undefined): string {
  const id = organizationId?.trim()
  if (!id || id.startsWith("legacy-")) return ""
  return `?organization_id=${encodeURIComponent(id)}`
}
