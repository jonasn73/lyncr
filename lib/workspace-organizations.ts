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
    if (!organizationId) localStorage.removeItem(ACTIVE_ORGANIZATION_STORAGE_KEY)
    else localStorage.setItem(ACTIVE_ORGANIZATION_STORAGE_KEY, organizationId)
    window.dispatchEvent(new CustomEvent("lyncr-organization-changed", { detail: { organizationId } }))
  } catch {
    // ignore quota / private mode
  }
}
