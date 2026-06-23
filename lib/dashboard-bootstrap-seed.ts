import type { DashboardMainBootstrap } from "@/lib/dashboard-stream-types"
import type { DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"
import type { Organization } from "@/lib/types"
import { readActiveOrganizationId } from "@/lib/workspace-organizations"
import { filterPhoneLinesForOrganization, primaryPhoneLineForOrganization } from "@/lib/workspace-phone-lines"

/** Pick the org the user last selected, or the default workspace. */
export function pickActiveOrganizationIdFromBootstrap(
  organizations: Organization[]
): string | null {
  const stored = readActiveOrganizationId()
  const def = organizations.find((o) => o.is_default) ?? organizations[0]
  return (stored && organizations.some((o) => o.id === stored) ? stored : null) ?? def?.id ?? null
}

/** Workspace fields derived from bootstrap — used for SSR + session-cache first paint. */
export function workspaceSeedFromBootstrap(bootstrap: DashboardMainBootstrap): {
  organizations: Organization[]
  phoneLines: DashboardBusinessNumber[]
  activeOrganizationId: string | null
  activeLine: string | null
} {
  const activeOrganizationId = pickActiveOrganizationIdFromBootstrap(bootstrap.organizations)
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
