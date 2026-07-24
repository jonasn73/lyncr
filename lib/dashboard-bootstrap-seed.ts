import type { DashboardMainBootstrap } from "@/lib/dashboard-stream-types"
import type { DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"
import type { Organization } from "@/lib/types"
import { readActiveOrganizationId } from "@/lib/workspace-organizations"
import { filterPhoneLinesForOrganization, primaryPhoneLineForOrganization } from "@/lib/workspace-phone-lines"

/** Pick the org the user last selected, or the default workspace. */
export function pickActiveOrganizationIdFromBootstrap(
  organizations: Organization[],
  preferredOrganizationId?: string | null
): string | null {
  const stored = (preferredOrganizationId?.trim() || null) ?? readActiveOrganizationId()
  const def = organizations.find((o) => o.is_default) ?? organizations[0]
  return (stored && organizations.some((o) => o.id === stored) ? stored : null) ?? def?.id ?? null
}

/** Stable header label from bootstrap + preferred org (cookie / localStorage). */
export function organizationLabelFromBootstrap(
  organizations: Organization[],
  preferredOrganizationId?: string | null,
  fallbackName?: string | null
): string {
  const id = pickActiveOrganizationIdFromBootstrap(organizations, preferredOrganizationId)
  const name = organizations.find((o) => o.id === id)?.name?.trim()
  return name || fallbackName?.trim() || "Business"
}

/** Workspace fields derived from bootstrap — used for SSR + session-cache first paint. */
export function workspaceSeedFromBootstrap(
  bootstrap: DashboardMainBootstrap,
  preferredOrganizationId?: string | null
): {
  organizations: Organization[]
  phoneLines: DashboardBusinessNumber[]
  activeOrganizationId: string | null
  activeLine: string | null
} {
  const activeOrganizationId = pickActiveOrganizationIdFromBootstrap(
    bootstrap.organizations,
    preferredOrganizationId
  )
  const phoneLines = filterPhoneLinesForOrganization(bootstrap.phoneLines, activeOrganizationId)
  return {
    organizations: bootstrap.organizations,
    phoneLines,
    activeOrganizationId,
    activeLine: primaryPhoneLineForOrganization(
      bootstrap.phoneLines,
      activeOrganizationId,
      bootstrap.routing.primaryLineNumber
    ),
  }
}
