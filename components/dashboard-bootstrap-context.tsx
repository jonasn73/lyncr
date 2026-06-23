"use client"

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import type { DashboardMainBootstrap } from "@/lib/dashboard-stream-types"
import {
  readDashboardBootstrapCache,
  writeDashboardBootstrapCache,
} from "@/lib/dashboard-bootstrap-cache"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { useDashboardStream } from "@/components/dashboard-stream-context"
import { dashboardBootstrapEquivalent } from "@/lib/dashboard-bootstrap-equivalent"
import {
  pickActiveOrganizationIdFromBootstrap,
  workspaceSeedFromBootstrap,
} from "@/lib/dashboard-bootstrap-seed"

const DashboardBootstrapContext = createContext<DashboardMainBootstrap | null>(null)

function pickActiveOrganizationId(organizations: DashboardMainBootstrap["organizations"]): string | null {
  return pickActiveOrganizationIdFromBootstrap(organizations)
}

/** Hydrates workspace from bootstrap before paint — avoids a second header/content flash. */
function DashboardBootstrapWorkspaceSync({ bootstrap }: { bootstrap: DashboardMainBootstrap }) {
  const { hydrateWorkspaceFromBootstrap, activeLine, businessNumbers, organizations } = useDashboardWorkspace()
  const syncedRef = useRef(false)

  useLayoutEffect(() => {
    const nextOrgId = pickActiveOrganizationId(bootstrap.organizations)
    const alreadySeeded =
      businessNumbers.length === bootstrap.phoneLines.length &&
      organizations.length === bootstrap.organizations.length &&
      (activeLine === bootstrap.routing.primaryLineNumber ||
        (!activeLine && !bootstrap.routing.primaryLineNumber))
    if (syncedRef.current && alreadySeeded) return
    syncedRef.current = true
    if (alreadySeeded) return
    hydrateWorkspaceFromBootstrap({
      organizations: bootstrap.organizations,
      phoneLines: bootstrap.phoneLines,
      activeOrganizationId: nextOrgId,
      activeLine: bootstrap.routing.primaryLineNumber,
    })
  }, [
    bootstrap,
    hydrateWorkspaceFromBootstrap,
    activeLine,
    businessNumbers.length,
    organizations.length,
  ])

  return null
}

export function DashboardBootstrapProvider({
  bootstrap,
  children,
}: {
  bootstrap: DashboardMainBootstrap
  children: ReactNode
}) {
  return (
    <DashboardBootstrapContext.Provider value={bootstrap}>
      <DashboardBootstrapWorkspaceSync bootstrap={bootstrap} />
      {children}
    </DashboardBootstrapContext.Provider>
  )
}

export function useDashboardBootstrapOptional(): DashboardMainBootstrap | null {
  return useContext(DashboardBootstrapContext)
}

/** Context first, then session cache — same data the header uses for instant paint. */
export function useDashboardBootstrapEffective(): DashboardMainBootstrap | null {
  const ctx = useContext(DashboardBootstrapContext)
  if (ctx) return ctx
  if (typeof window === "undefined") return null
  return readDashboardBootstrapCache() ?? null
}

/** Bootstrap known on first paint (server snapshot or session cache) with silent refresh. */
function DashboardBootstrapSeededProvider({
  seed,
  refreshPromise,
  children,
}: {
  seed: DashboardMainBootstrap
  refreshPromise?: Promise<DashboardMainBootstrap>
  children: ReactNode
}) {
  const [bootstrap, setBootstrap] = useState(seed)

  useEffect(() => {
    writeDashboardBootstrapCache(seed)
  }, [seed])

  useEffect(() => {
    if (!refreshPromise) return
    let cancelled = false
    void Promise.resolve(refreshPromise).then((data) => {
      if (cancelled) return
      writeDashboardBootstrapCache(data)
      setBootstrap((prev) => (dashboardBootstrapEquivalent(prev, data) ? prev : data))
    })
    return () => {
      cancelled = true
    }
  }, [refreshPromise])

  return (
    <DashboardBootstrapContext.Provider value={bootstrap}>
      <DashboardBootstrapWorkspaceSync bootstrap={bootstrap} />
      {children}
    </DashboardBootstrapContext.Provider>
  )
}

/**
 * Loads bootstrap without Suspense — children stay mounted (settings-style).
 * Seeds from session cache on hard refresh so routing paints instantly.
 */
export function DashboardBootstrapAsyncGate({
  promise,
  children,
}: {
  promise: Promise<DashboardMainBootstrap>
  children: ReactNode
}) {
  const parentBootstrap = useContext(DashboardBootstrapContext)
  const [bootstrap, setBootstrap] = useState<DashboardMainBootstrap | null>(() => {
    if (parentBootstrap) return parentBootstrap
    return readDashboardBootstrapCache() ?? null
  })

  useEffect(() => {
    if (parentBootstrap) return
    let cancelled = false
    void Promise.resolve(promise).then((data) => {
      if (cancelled) return
      writeDashboardBootstrapCache(data)
      setBootstrap((prev) => (prev && dashboardBootstrapEquivalent(prev, data) ? prev : data))
    })
    return () => {
      cancelled = true
    }
  }, [promise, parentBootstrap])

  if (parentBootstrap) {
    return <>{children}</>
  }

  return (
    <DashboardBootstrapContext.Provider value={bootstrap}>
      {bootstrap ? <DashboardBootstrapWorkspaceSync bootstrap={bootstrap} /> : null}
      {children}
    </DashboardBootstrapContext.Provider>
  )
}

/** Wraps the dashboard shell when the layout starts the bootstrap promise. */
export function DashboardBootstrapShellGate({
  children,
  initialBootstrap,
}: {
  children: ReactNode
  initialBootstrap?: DashboardMainBootstrap | null
}) {
  const { dashboardMainBootstrapPromise } = useDashboardStream()
  const existing = useDashboardBootstrapOptional()

  if (existing) {
    return <>{children}</>
  }

  const seed = initialBootstrap ?? readDashboardBootstrapCache() ?? null

  if (seed) {
    return (
      <DashboardBootstrapSeededProvider seed={seed} refreshPromise={dashboardMainBootstrapPromise}>
        {children}
      </DashboardBootstrapSeededProvider>
    )
  }

  if (!dashboardMainBootstrapPromise) {
    return <>{children}</>
  }

  return (
    <DashboardBootstrapAsyncGate promise={dashboardMainBootstrapPromise}>
      {children}
    </DashboardBootstrapAsyncGate>
  )
}

export { workspaceSeedFromBootstrap }
