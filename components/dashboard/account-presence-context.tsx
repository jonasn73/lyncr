"use client"

// Shared account presence for Lines — Presence bar + call-flow cards stay in sync.

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
import { persistedCacheKey, writePersistedCache } from "@/lib/swr/persisted-cache"

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

/** Session cache so Busy/Available paints correctly on hard refresh (no Available flash). */
const PRESENCE_CACHE_KEY = persistedCacheKey("account-presence", "status")

type PresenceCache = { status: PresenceStatus }

function parsePresenceStatus(raw: string | undefined | null): PresenceStatus {
  const upper = String(raw || "AVAILABLE").toUpperCase()
  if (upper === "ON_JOB") return "ON_JOB"
  if (upper === "CLOSED") return "CLOSED"
  return "AVAILABLE"
}

function writeCachedPresence(status: PresenceStatus) {
  writePersistedCache(PRESENCE_CACHE_KEY, { status } satisfies PresenceCache)
}

export function AccountPresenceProvider({ children }: { children: ReactNode }) {
  // No session-seed snapshot (useClientSnapshot caused React #185). Fetch owns status.
  const [liveStatus, setLiveStatus] = useState<PresenceStatus | null>(null)
  const [saving, setSaving] = useState(false)
  const [fetching, setFetching] = useState(false)

  const presenceStatus = liveStatus ?? "AVAILABLE"
  const presenceReady = liveStatus != null

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
    void refresh()
  }, [refresh])

  // Re-read presence periodically so the bar matches the DB if something else changes it.
  useEffect(() => {
    const id = window.setInterval(() => {
      void refresh({ silent: true })
    }, 60_000)
    return () => window.clearInterval(id)
  }, [refresh])

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
