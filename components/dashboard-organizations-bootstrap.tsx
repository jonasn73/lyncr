"use client"

import { useEffect } from "react"
import { useDashboardBootstrapEffective } from "@/components/dashboard-bootstrap-context"
import { useDashboardStream } from "@/components/dashboard-stream-context"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { readActiveOrganizationId } from "@/lib/workspace-organizations"
import type { Organization } from "@/lib/types"

/** Loads organizations into workspace context when server stream is unavailable (client tab nav). */
export function DashboardOrganizationsBootstrap() {
  const bootstrap = useDashboardBootstrapEffective()
  const { organizationsPromise, dashboardMainBootstrapPromise } = useDashboardStream()
  const { setOrganizations, setActiveOrganizationId } = useDashboardWorkspace()

  useEffect(() => {
    if (bootstrap || organizationsPromise || dashboardMainBootstrapPromise) return
    fetch("/api/organizations", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { data?: { organizations?: Organization[] } }) => {
        const rows = Array.isArray(j?.data?.organizations) ? j!.data!.organizations! : []
        setOrganizations(rows)
        const stored = readActiveOrganizationId()
        const def = rows.find((o) => o.is_default) ?? rows[0]
        const pick =
          (stored && rows.some((o) => o.id === stored) ? stored : null) ?? def?.id ?? null
        if (pick) setActiveOrganizationId(pick)
      })
      .catch(() => {})
  }, [
    bootstrap,
    dashboardMainBootstrapPromise,
    organizationsPromise,
    setOrganizations,
    setActiveOrganizationId,
  ])

  return null
}
