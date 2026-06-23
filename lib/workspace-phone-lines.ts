import type { DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"
import { businessNumbersMatch } from "@/lib/dashboard-routing-utils"

/** Keep only lines owned by the selected business workspace. */
export function filterPhoneLinesForOrganization(
  lines: DashboardBusinessNumber[],
  organizationId: string | null | undefined
): DashboardBusinessNumber[] {
  const orgId = organizationId?.trim()
  if (!orgId || orgId.startsWith("legacy-")) return lines
  return lines.filter((line) => line.organization_id === orgId)
}

/** First routable line in the workspace, or null when empty. */
export function primaryPhoneLineForOrganization(
  lines: DashboardBusinessNumber[],
  organizationId: string | null | undefined,
  preferred?: string | null
): string | null {
  const scoped = filterPhoneLinesForOrganization(lines, organizationId)
  if (scoped.length === 0) return null
  if (preferred && scoped.some((line) => businessNumbersMatch(line.number, preferred))) {
    return preferred
  }
  return scoped[0]?.number ?? null
}
