"use client"

// Hands server-resolved workspaces to DashboardWorkspaceProvider once, on mount.
//
// The owner console gets its organizations from the streamed dashboard bootstrap, and
// DashboardOrganizationsBootstrap falls back to GET /api/organizations — a route that
// refuses anyone who is not an owner. The receptionist console has neither, so its layout
// reads the owner's workspaces server-side (it already loads that context to name the
// business) and seeds them here instead. No extra round trip, no widened route.

import { useEffect, useRef } from "react"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import type { Organization } from "@/lib/types"

export function WorkspaceOrganizationsSeed({
  organizations,
  activeOrganizationId,
}: {
  organizations: Organization[]
  activeOrganizationId: string | null
}) {
  const { hydrateWorkspaceFromBootstrap } = useDashboardWorkspace()
  const seeded = useRef(false)

  useEffect(() => {
    if (seeded.current) return
    seeded.current = true
    // One-shot hydrate — the same path the owner's server bootstrap takes, so it does not
    // clear the active line the way setActiveOrganizationId would.
    hydrateWorkspaceFromBootstrap({
      organizations,
      phoneLines: [],
      activeOrganizationId,
      activeLine: null,
    })
  }, [organizations, activeOrganizationId, hydrateWorkspaceFromBootstrap])

  return null
}
