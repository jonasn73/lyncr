"use client"

import { useEffect } from "react"
import { OrganizationSwitcher } from "@/components/organization-switcher"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import type { Organization } from "@/lib/types"

/** Business workspace switcher mounted in the dashboard app header. */
export function DashboardHeaderWorkspace() {
  const { setActiveOrganizationId, setOrganizations } = useDashboardWorkspace()

  return (
    <OrganizationSwitcher
      onOrganizationsLoaded={setOrganizations}
      onOrganizationChange={(id) => {
        setActiveOrganizationId(id)
      }}
    />
  )
}

/** Loads organizations into workspace context (runs once under the provider). */
export function DashboardOrganizationsBootstrap() {
  const { setOrganizations, setActiveOrganizationId } = useDashboardWorkspace()

  useEffect(() => {
    fetch("/api/organizations", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { data?: { organizations?: Organization[] } }) => {
        const rows = Array.isArray(j?.data?.organizations) ? j!.data!.organizations! : []
        setOrganizations(rows)
        const def = rows.find((o) => o.is_default) ?? rows[0]
        if (def) setActiveOrganizationId(def.id)
      })
      .catch(() => {})
  }, [setOrganizations, setActiveOrganizationId])

  return null
}
