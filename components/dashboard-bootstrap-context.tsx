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
  workspaceSeedFromBootstrap,
} from "@/lib/dashboard-bootstrap-seed"

const DashboardBootstrapContext = createContext<DashboardMainBootstrap | null>(null)

/** Applies bootstrap to workspace once per snapshot — workspace may already be seeded from layout. */
function DashboardBootstrapWorkspaceSync({ bootstrap }: { bootstrap: DashboardMainBootstrap }) {
  const { hydrateWorkspaceFromBootstrap } = useDashboardWorkspace()
  const syncedBootstrapRef = useRef<DashboardMainBootstrap | null>(null)

  useLayoutEffect(() => {
    if (syncedBootstrapRef.current === bootstrap) return
    syncedBootstrapRef.current = bootstrap
    const seed = workspaceSeedFromBootstrap(bootstrap)
    hydrateWorkspaceFromBootstrap(seed)
  }, [bootstrap, hydrateWorkspaceFromBootstrap])

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

/** Context first, then session cache — stable reference so effects do not loop. */
export function useDashboardBootstrapEffective(): DashboardMainBootstrap | null {
  const ctx = useContext(DashboardBootstrapContext)
  const stableCacheRef = useRef<DashboardMainBootstrap | null>(null)

  if (ctx) return ctx

  if (typeof window === "undefined") return null

  const fresh = readDashboardBootstrapCache() ?? null
  if (!fresh) {
    stableCacheRef.current = null
    return null
  }
  if (stableCacheRef.current && dashboardBootstrapEquivalent(stableCacheRef.current, fresh)) {
    return stableCacheRef.current
  }
  stableCacheRef.current = fresh
  return fresh
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
    // seed is fixed at mount — avoid re-running when parent re-parses sessionStorage
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
  const [seed] = useState(
    () => initialBootstrap ?? readDashboardBootstrapCache() ?? null
  )

  if (existing) {
    return <>{children}</>
  }

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
