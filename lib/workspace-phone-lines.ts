import type { DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"
import { businessNumbersMatch } from "@/lib/dashboard-routing-utils"
import { isWorkspaceOrgStubId } from "@/lib/workspace-organizations"
import {
  pickPreferredCustomerLine,
  sortBusinessLinesForDisplay,
  type PreferredLineCandidate,
} from "@/lib/preferred-business-line"
import { isFlickerDebugEnabled, logFlicker } from "@/lib/debug/flicker-debug"

/** Prefer the fuller shop line list (bootstrap) over a one-DID paint/chrome subset. */
export function preferPhoneLinesForWorkspace(
  live: DashboardBusinessNumber[],
  bootstrapLines: DashboardBusinessNumber[] | null | undefined
): DashboardBusinessNumber[] {
  const boot = bootstrapLines ?? []
  if (boot.length > live.length) return boot
  if (live.length > 0) return live
  return boot
}

/** Keep only lines owned by the selected business workspace. */
export function filterPhoneLinesForOrganization(
  lines: DashboardBusinessNumber[],
  organizationId: string | null | undefined
): DashboardBusinessNumber[] {
  const orgId = organizationId?.trim()
  // Paint-seed / legacy stubs are not real workspace ids — keep painted lines on screen.
  if (!orgId || isWorkspaceOrgStubId(orgId)) return lines
  return lines.filter((line) => line.organization_id === orgId)
}

/**
 * Activity history for this shop — every DID, not only the painted Main Line.
 * A one-line chrome seed must not hide sister-line calls.
 */
export function scopeCallsToShopLines<T extends { targetLineE164: string }>(
  calls: T[],
  lines: { number: string }[],
  opts?: { activeLine?: string | null; linesLoading?: boolean }
): T[] {
  let result: T[]
  let path: "matched-lines" | "single-line-passthrough" | "matched-empty" | "loading-keep" | "active-line-only" | "passthrough"
  if (lines.length > 0) {
    const matched = calls.filter((c) =>
      lines.some((n) => businessNumbersMatch(c.targetLineE164, n.number))
    )
    if (matched.length > 0) {
      result = matched
      path = "matched-lines"
    } else if (lines.length === 1) {
      result = calls
      path = "single-line-passthrough"
    } else {
      result = matched
      path = "matched-empty"
    }
  } else if (opts?.linesLoading) {
    // Lines still bootstrapping — keep painted Activity rows (do not flash empty / skeleton).
    if (opts?.activeLine) {
      result = calls.filter((c) => businessNumbersMatch(c.targetLineE164, opts.activeLine))
      path = "loading-keep"
    } else {
      result = calls
      path = "loading-keep"
    }
  } else if (opts?.activeLine) {
    result = calls.filter((c) => businessNumbersMatch(c.targetLineE164, opts.activeLine))
    path = "active-line-only"
  } else {
    result = calls
    path = "passthrough"
  }

  if (
    typeof window !== "undefined" &&
    isFlickerDebugEnabled() &&
    (result.length !== calls.length || path === "matched-empty" || path === "loading-keep")
  ) {
    const sig = `${path}:${calls.length}->${result.length}:${lines.length}:${opts?.linesLoading ? 1 : 0}`
    if (sig !== lastScopeFlickerSig) {
      lastScopeFlickerSig = sig
      logFlicker({
        event: "ops-line-scope",
        component: "scopeCallsToShopLines",
        scopePath: path,
        rowCountBefore: calls.length,
        rowCountAfter: result.length,
        shopLineCount: lines.length,
        linesLoading: Boolean(opts?.linesLoading),
        hasActiveLine: Boolean(opts?.activeLine),
        lineScopeChanged: result.length !== calls.length,
      })
    }
  }

  return result
}

let lastScopeFlickerSig = ""

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

