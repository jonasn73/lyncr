"use client"

import { useMemo } from "react"
import { useDashboardBootstrapEffective } from "@/components/dashboard-bootstrap-context"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import type { DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"
import { filterPhoneLinesForOrganization } from "@/lib/workspace-phone-lines"

/** Phone lines for the active business workspace — never another org's DIDs. */
export function useWorkspacePhoneLines(): DashboardBusinessNumber[] {
  const bootstrap = useDashboardBootstrapEffective()
  const { businessNumbers, activeOrganizationId } = useDashboardWorkspace()

  return useMemo(() => {
    const raw =
      businessNumbers.length > 0
        ? businessNumbers
        : bootstrap?.phoneLines?.length
          ? bootstrap.phoneLines
          : []
    return filterPhoneLinesForOrganization(raw, activeOrganizationId)
  }, [businessNumbers, bootstrap?.phoneLines, activeOrganizationId])
}
