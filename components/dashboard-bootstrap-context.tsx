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
import { useFlickerDebugLifecycle, logFlicker } from "@/lib/debug/flicker-debug"

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

/**
 * Bootstrap from React context only.
 * Never read sessionStorage here — that made the client first paint differ from SSR
 * HTML (phone / org labels vs "") and triggered React #418.
 * Session upgrades belong in DashboardBootstrapShellGate / AsyncGate useLayoutEffect.
 */
export function useDashboardBootstrapEffective(): DashboardMainBootstrap | null {
  return useContext(DashboardBootstrapContext)
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

  useFlickerDebugLifecycle("DashboardBootstrapSeededProvider", {
    bootstrapSource: "server-seed",
    hasBootstrap: true,
    isSyncing,
  })

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
    logFlicker({
      event: "bootstrap-sync-start",
      component: "DashboardBootstrapSeededProvider",
      bootstrapSource: "network",
      isSyncing: true,
    })
    void Promise.resolve(refreshPromise)
      .then((data) => {
        if (cancelled) return
        writeDashboardBootstrapCache(data)
        setBootstrap((prev) => {
          const same = dashboardBootstrapEquivalent(prev, data)
          logFlicker({
            event: "bootstrap-network-apply",
            component: "DashboardBootstrapSeededProvider",
            bootstrapSource: "network",
            replaced: !same,
          })
          return same ? prev : data
        })
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
  // Match SSR: do not touch sessionStorage in useState (invisible on the server → #418).
  const [bootstrap, setBootstrap] = useState<DashboardMainBootstrap | null>(
    () => parentBootstrap ?? null
  )
  const [isSyncing, setIsSyncing] = useState(() => !parentBootstrap)
  const [source, setSource] = useState<"parent" | "session-cache" | "network" | "none">(() =>
    parentBootstrap ? "parent" : "none"
  )

  useFlickerDebugLifecycle("DashboardBootstrapAsyncGate", {
    bootstrapSource: source,
    hasBootstrap: Boolean(bootstrap || parentBootstrap),
    isSyncing,
    emptyBootstrap: !bootstrap && !parentBootstrap,
  })

  // After hydrate: apply session bootstrap before paint so Lines does not flash empty.
  useLayoutEffect(() => {
    if (parentBootstrap || bootstrap) return
    const cached = readDashboardBootstrapCache()
    if (!cached) return
    setSource("session-cache")
    setBootstrap(cached)
    logFlicker({
      event: "bootstrap-session-apply",
      component: "DashboardBootstrapAsyncGate",
      bootstrapSource: "session-cache",
    })
  }, [parentBootstrap, bootstrap])

  useEffect(() => {
    if (parentBootstrap) {
      setIsSyncing(false)
      return
    }
    let cancelled = false
    setIsSyncing(true)
    logFlicker({
      event: "bootstrap-sync-start",
      component: "DashboardBootstrapAsyncGate",
      bootstrapSource: "network",
      isSyncing: true,
    })
    void Promise.resolve(promise)
      .then((data) => {
        if (cancelled) return
        writeDashboardBootstrapCache(data)
        setSource("network")
        setBootstrap((prev) => {
          const same = Boolean(prev && dashboardBootstrapEquivalent(prev, data))
          logFlicker({
            event: "bootstrap-network-apply",
            component: "DashboardBootstrapAsyncGate",
            bootstrapSource: "network",
            replaced: !same,
          })
          return prev && same ? prev : data
        })
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
  // Server-visible seed only. Session cache upgrades inside AsyncGate useLayoutEffect
  // (do not flip SeededProvider ↔ AsyncGate after hydrate — that remounts the tree).
  const [seed] = useState<DashboardMainBootstrap | null>(() => initialBootstrap ?? null)

  const mode = existing
    ? "passthrough-existing"
    : seed
      ? "seeded"
      : dashboardMainBootstrapPromise
        ? "async"
        : "passthrough-empty"

  useFlickerDebugLifecycle("DashboardBootstrapShellGate", {
    mode,
    hasInitialBootstrap: Boolean(seed),
    hasPromise: Boolean(dashboardMainBootstrapPromise),
  })

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
