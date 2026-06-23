"use client"

import { createContext, useContext, useLayoutEffect, useRef, type ReactNode } from "react"
import type { DashboardMainBootstrap } from "@/lib/dashboard-stream-types"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { readActiveOrganizationId } from "@/lib/workspace-organizations"

const DashboardBootstrapContext = createContext<DashboardMainBootstrap | null>(null)

export function DashboardBootstrapProvider({
  bootstrap,
  children,
}: {
  bootstrap: DashboardMainBootstrap
  children: ReactNode
}) {
  return (
    <DashboardBootstrapContext.Provider value={bootstrap}>{children}</DashboardBootstrapContext.Provider>
  )
}

export function useDashboardBootstrapOptional(): DashboardMainBootstrap | null {
  return useContext(DashboardBootstrapContext)
}

function pickActiveOrganizationId(organizations: DashboardMainBootstrap["organizations"]): string | null {
  const stored = readActiveOrganizationId()
  const def = organizations.find((o) => o.is_default) ?? organizations[0]
  return (stored && organizations.some((o) => o.id === stored) ? stored : null) ?? def?.id ?? null
}

/** Mirrors streamed bootstrap into workspace context once (for cross-tab filters). */
export function DashboardBootstrapSync() {
  const bootstrap = useDashboardBootstrapOptional()
  const { hydrateWorkspaceFromBootstrap } = useDashboardWorkspace()
  const syncedRef = useRef(false)

  useLayoutEffect(() => {
    if (!bootstrap || syncedRef.current) return
    syncedRef.current = true
    hydrateWorkspaceFromBootstrap({
      organizations: bootstrap.organizations,
      phoneLines: bootstrap.phoneLines,
      activeOrganizationId: pickActiveOrganizationId(bootstrap.organizations),
      activeLine: bootstrap.routing.primaryLineNumber,
    })
  }, [bootstrap, hydrateWorkspaceFromBootstrap])

  return null
}
