/** localStorage key for the owner's active business workspace (organization) id. */
export const ACTIVE_ORGANIZATION_STORAGE_KEY = "lyncr_active_organization_id"

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
    window.dispatchEvent(new CustomEvent("lyncr-workspace-data-changed", { detail: { organizationId: next } }))
  } catch {
    // ignore quota / private mode
  }
}

/** Append ?organization_id= when a workspace is selected (for dashboard API fetches). */
export function organizationQueryString(organizationId: string | null | undefined): string {
  const id = organizationId?.trim()
  if (!id || id.startsWith("legacy-")) return ""
  return `?organization_id=${encodeURIComponent(id)}`
}
