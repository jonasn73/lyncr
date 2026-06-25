import type { DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"
import { businessNumbersMatch } from "@/lib/dashboard-routing-utils"
import {
  pickPreferredCustomerLine,
  sortBusinessLinesForDisplay,
  type PreferredLineCandidate,
} from "@/lib/preferred-business-line"

/** Keep only lines owned by the selected business workspace. */
export function filterPhoneLinesForOrganization(
  lines: DashboardBusinessNumber[],
  organizationId: string | null | undefined
): DashboardBusinessNumber[] {
  const orgId = organizationId?.trim()
  if (!orgId || orgId.startsWith("legacy-")) return lines
  return lines.filter((line) => line.organization_id === orgId)
}

/** Customer-facing main line for the workspace (ported DID beats temp placeholder). */
export function primaryPhoneLineForOrganization(
  lines: DashboardBusinessNumber[],
  organizationId: string | null | undefined,
  preferred?: string | null,
  options?: {
    reservedNumber?: string | null
    completedPortTargets?: string[]
  }
): string | null {
  const scoped = filterPhoneLinesForOrganization(lines, organizationId)
  return pickPreferredCustomerLine({
    lines: scoped,
    reservedNumber: options?.reservedNumber ?? preferred,
    completedPortTargets: options?.completedPortTargets,
    previousSelection: preferred,
  })
}

/** Order lines for sidebar display — main customer number first. */
export function orderPhoneLinesForOrganization(
  lines: DashboardBusinessNumber[],
  organizationId: string | null | undefined,
  options?: {
    reservedNumber?: string | null
    completedPortTargets?: string[]
    preferred?: string | null
  }
): DashboardBusinessNumber[] {
  const scoped = filterPhoneLinesForOrganization(lines, organizationId)
  const primary = pickPreferredCustomerLine({
    lines: scoped as PreferredLineCandidate[],
    reservedNumber: options?.reservedNumber,
    completedPortTargets: options?.completedPortTargets,
    previousSelection: options?.preferred,
  })
  return sortBusinessLinesForDisplay(scoped, primary) as DashboardBusinessNumber[]
}

/** True when the preferred line is selected in the UI. */
export function isPrimaryLineSelection(
  lineNumber: string,
  lines: DashboardBusinessNumber[],
  organizationId: string | null | undefined,
  activeLine: string | null | undefined
): boolean {
  if (activeLine && businessNumbersMatch(lineNumber, activeLine)) return true
  const primary = primaryPhoneLineForOrganization(lines, organizationId, activeLine)
  return primary != null && businessNumbersMatch(lineNumber, primary)
}
