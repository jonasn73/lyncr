"use client"

import { useMemo } from "react"
import { useDashboardBootstrapEffective } from "@/components/dashboard-bootstrap-context"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import type { DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"
import { customerFacingPhoneLines } from "@/lib/amber-control-line"
import { filterPhoneLinesForOrganization, preferPhoneLinesForWorkspace } from "@/lib/workspace-phone-lines"

/** Phone lines for the active business workspace — never another org's DIDs. */
export function useWorkspacePhoneLines(): DashboardBusinessNumber[] {
  const bootstrap = useDashboardBootstrapEffective()
  const { businessNumbers, activeOrganizationId } = useDashboardWorkspace()

  return useMemo(() => {
    const raw = preferPhoneLinesForWorkspace(businessNumbers, bootstrap?.phoneLines)
    // Amber · Lyncr is Settings-only — keep it off Lines / Activity shop-line lists.
    return customerFacingPhoneLines(filterPhoneLinesForOrganization(raw, activeOrganizationId))
  }, [businessNumbers, bootstrap?.phoneLines, activeOrganizationId])
}
