"use client"

// Shared account presence for Lines — Available toggle + call-flow cards stay in sync.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { isBusyPresenceStatus, type PresenceStatus } from "@/lib/account-presence"
import { toast } from "@/hooks/use-toast"
import { useSessionSeed } from "@/lib/hooks/use-client-seed"
import { useDashboardPaintSeeds } from "@/lib/dashboard-paint-seeds"
import {
  readCachedPresence,
  writeCachedPresence,
} from "@/lib/account-presence-cache"
import { useDashboardActivePage } from "@/components/dashboard-shell-chrome-context"
import { usePollBudget } from "@/lib/hooks/use-poll-budget"

type AccountPresenceContextValue = {
  presenceStatus: PresenceStatus
  /**
   * False until session cache or API provides a real status.
   * UI should not highlight Available/Busy while false (avoids Available→Busy flash).
   */
  presenceReady: boolean
  loading: boolean
  saving: boolean
  /** True when cell ring is skipped (Presence Busy). */
  presenceBypass: boolean
  setPresenceStatus: (next: PresenceStatus) => Promise<void>
  refresh: () => Promise<void>
}

const AccountPresenceContext = createContext<AccountPresenceContextValue | null>(null)

function parsePresenceStatus(raw: string | undefined | null): PresenceStatus {
  const upper = String(raw || "AVAILABLE").toUpperCase().replace(/-/g, "_")
  if (upper === "ON_JOB" || upper === "ONJOB" || upper === "BUSY") return "ON_JOB"
  if (upper === "CLOSED" || upper === "OFF" || upper === "OFF_DUTY") return "CLOSED"
  return "AVAILABLE"
}

export function AccountPresenceProvider({ children }: { children: ReactNode }) {
  // Cookie + session seed — Busy/Available paints correctly on hard refresh (SSR too).
  const paintSeeds = useDashboardPaintSeeds()
  const cachedSeed = useSessionSeed(
    () => readCachedPresence(paintSeeds.presence),
    null,
    "account-presence"
  )
  const [liveStatus, setLiveStatus] = useState<PresenceStatus | null>(null)
  const [saving, setSaving] = useState(false)
  // Don’t show a spinner when we already painted from cache.
  const [fetching, setFetching] = useState(false)
  const linesActive = useDashboardActivePage() === "dashboard"
  const pollEnabled = usePollBudget(linesActive)

  const presenceStatus = liveStatus ?? cachedSeed ?? "AVAILABLE"
  const presenceReady = liveStatus != null || cachedSeed != null

  const paintedFromCacheRef = useRef(false)
  if (presenceReady) paintedFromCacheRef.current = true

  const setStatus = useCallback((next: PresenceStatus) => {
    setLiveStatus((prev) => (prev === next ? prev : next))
    writeCachedPresence(next)
  }, [])

  const refresh = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? paintedFromCacheRef.current
      if (!silent) setFetching(true)
      try {
        const res = await fetch("/api/routing/presence", { credentials: "include" })
        const json = (await res.json()) as { data?: { presence_status?: string } }
        const next = parsePresenceStatus(json.data?.presence_status)
        setStatus(next)
        paintedFromCacheRef.current = true
      } catch {
        // Keep cached / current status on network errors — don’t snap to Available.
        if (!paintedFromCacheRef.current) {
          setStatus("AVAILABLE")
        }
      } finally {
        setFetching(false)
      }
    },
    [setStatus]
  )

  useEffect(() => {
    if (!pollEnabled) return
    void refresh()
  }, [refresh, pollEnabled])

  // Re-read presence periodically so the bar matches the DB if something else changes it.
  useEffect(() => {
    if (!pollEnabled) return
    const id = window.setInterval(() => {
      void refresh({ silent: true })
    }, 60_000)
    return () => window.clearInterval(id)
  }, [refresh, pollEnabled])

  const setPresenceStatus = useCallback(
    async (next: PresenceStatus) => {
      const prev = presenceStatus
      setStatus(next)
      setSaving(true)
      try {
        const res = await fetch("/api/routing/presence", {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ presence_status: next }),
        })
        const json = (await res.json()) as {
          error?: string
          migration?: string
          data?: { presence_status?: string }
        }
        if (!res.ok) {
          setStatus(prev)
          toast({
            title: "Could not update presence",
            description: json.migration
              ? `Run ${json.migration} in Neon, then try again.`
              : json.error || res.statusText,
            variant: "destructive",
          })
          return
        }
        const saved = parsePresenceStatus(json.data?.presence_status || next)
        setStatus(saved)
      } catch (e) {
        setStatus(prev)
        toast({
          title: "Could not update presence",
          description: e instanceof Error ? e.message : "Try again.",
          variant: "destructive",
        })
      } finally {
        setSaving(false)
      }
    },
    [presenceStatus, setStatus]
  )

  // Stable wrapper so context consumers do not see a new `refresh` identity every paint.
  const refreshLoud = useCallback(() => refresh({ silent: false }), [refresh])

  const value = useMemo<AccountPresenceContextValue>(
    () => ({
      presenceStatus,
      presenceReady,
      // Spinner only when we have nothing to show yet (not during silent revalidate).
      loading: !presenceReady && fetching,
      saving,
      presenceBypass: presenceReady && isBusyPresenceStatus(presenceStatus),
      setPresenceStatus,
      refresh: refreshLoud,
    }),
    [presenceStatus, presenceReady, fetching, saving, setPresenceStatus, refreshLoud]
  )

  return (
    <AccountPresenceContext.Provider value={value}>{children}</AccountPresenceContext.Provider>
  )
}

export function useAccountPresence(): AccountPresenceContextValue {
  const ctx = useContext(AccountPresenceContext)
  if (!ctx) {
    return {
      presenceStatus: "AVAILABLE",
      presenceReady: false,
      loading: false,
      saving: false,
      presenceBypass: false,
      setPresenceStatus: async () => {},
      refresh: async () => {},
    }
  }
  return ctx
}
