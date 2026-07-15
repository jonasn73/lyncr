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
/** True while a silent background refresh is replacing stale session cache. */
const DashboardBootstrapSyncingContext = createContext(false)

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
    <DashboardBootstrapSyncingContext.Provider value={false}>
      <DashboardBootstrapContext.Provider value={bootstrap}>
        <DashboardBootstrapWorkspaceSync bootstrap={bootstrap} />
        {children}
      </DashboardBootstrapContext.Provider>
    </DashboardBootstrapSyncingContext.Provider>
  )
}

export function useDashboardBootstrapOptional(): DashboardMainBootstrap | null {
  return useContext(DashboardBootstrapContext)
}

/** True when bootstrap is revalidating in the background (stale cache → fresh server data). */
export function useDashboardBootstrapSyncing(): boolean {
  return useContext(DashboardBootstrapSyncingContext)
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
  const [isSyncing, setIsSyncing] = useState(() => Boolean(refreshPromise))

  useEffect(() => {
    writeDashboardBootstrapCache(seed)
    // seed is fixed at mount — avoid re-running when parent re-parses sessionStorage
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!refreshPromise) {
      setIsSyncing(false)
      return
    }
    let cancelled = false
    setIsSyncing(true)
    void Promise.resolve(refreshPromise)
      .then((data) => {
        if (cancelled) return
        writeDashboardBootstrapCache(data)
        setBootstrap((prev) => (dashboardBootstrapEquivalent(prev, data) ? prev : data))
      })
      .finally(() => {
        if (!cancelled) setIsSyncing(false)
      })
    return () => {
      cancelled = true
    }
  }, [refreshPromise])

  return (
    <DashboardBootstrapSyncingContext.Provider value={isSyncing}>
      <DashboardBootstrapContext.Provider value={bootstrap}>
        <DashboardBootstrapWorkspaceSync bootstrap={bootstrap} />
        {children}
      </DashboardBootstrapContext.Provider>
    </DashboardBootstrapSyncingContext.Provider>
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
  const [isSyncing, setIsSyncing] = useState(() => !parentBootstrap)

  useEffect(() => {
    if (parentBootstrap) {
      setIsSyncing(false)
      return
    }
    let cancelled = false
    setIsSyncing(true)
    void Promise.resolve(promise)
      .then((data) => {
        if (cancelled) return
        writeDashboardBootstrapCache(data)
        setBootstrap((prev) => (prev && dashboardBootstrapEquivalent(prev, data) ? prev : data))
      })
      .finally(() => {
        if (!cancelled) setIsSyncing(false)
      })
    return () => {
      cancelled = true
    }
  }, [promise, parentBootstrap])

  if (parentBootstrap) {
    return <>{children}</>
  }

  return (
    <DashboardBootstrapSyncingContext.Provider value={isSyncing}>
      <DashboardBootstrapContext.Provider value={bootstrap}>
        {bootstrap ? <DashboardBootstrapWorkspaceSync bootstrap={bootstrap} /> : null}
        {children}
      </DashboardBootstrapContext.Provider>
    </DashboardBootstrapSyncingContext.Provider>
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
