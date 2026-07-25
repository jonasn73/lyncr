"use client"

// Shared account presence for Lines — Presence bar + call-flow cards stay in sync.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { isBusyPresenceStatus, type PresenceStatus } from "@/lib/account-presence"
import { useToast } from "@/hooks/use-toast"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"

type AccountPresenceContextValue = {
  presenceStatus: PresenceStatus
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

function readCachedPresence(): PresenceStatus | null {
  const cached = readPersistedCache<PresenceCache>(PRESENCE_CACHE_KEY)
  if (!cached?.status) return null
  return parsePresenceStatus(cached.status)
}

function writeCachedPresence(status: PresenceStatus) {
  writePersistedCache(PRESENCE_CACHE_KEY, { status } satisfies PresenceCache)
}

export function AccountPresenceProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast()
  // Neutral default for SSR; real value comes from cache (before paint) or API.
  const [presenceStatus, setStatus] = useState<PresenceStatus>("AVAILABLE")
  // False when we already painted from cache — avoids spinner/selection flash on refresh.
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // True after sessionStorage hydrate — later fetches stay silent (no spinner).
  const paintedFromCacheRef = useRef(false)

  // Apply last-known presence before the browser paints (stops Available → Busy flash).
  useLayoutEffect(() => {
    const cached = readCachedPresence()
    if (cached) {
      paintedFromCacheRef.current = true
      setStatus(cached)
      setLoading(false)
    }
  }, [])

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    // Default: silent after cache paint; interval passes silent:true; manual can pass false.
    const silent = opts?.silent ?? paintedFromCacheRef.current
    if (!silent) setLoading(true)
    try {
      const res = await fetch("/api/routing/presence", { credentials: "include" })
      const json = (await res.json()) as { data?: { presence_status?: string } }
      const next = parsePresenceStatus(json.data?.presence_status)
      setStatus(next)
      writeCachedPresence(next)
      paintedFromCacheRef.current = true
    } catch {
      // Keep cached / current status on network errors — don’t snap to Available.
      if (!paintedFromCacheRef.current) {
        setStatus("AVAILABLE")
      }
    } finally {
      setLoading(false)
    }
  }, [])

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
      writeCachedPresence(next)
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
          writeCachedPresence(prev)
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
        writeCachedPresence(saved)
      } catch (e) {
        setStatus(prev)
        writeCachedPresence(prev)
        toast({
          title: "Could not update presence",
          description: e instanceof Error ? e.message : "Try again.",
          variant: "destructive",
        })
      } finally {
        setSaving(false)
      }
    },
    [presenceStatus, toast]
  )

  const value = useMemo<AccountPresenceContextValue>(
    () => ({
      presenceStatus,
      loading,
      saving,
      presenceBypass: isBusyPresenceStatus(presenceStatus),
      setPresenceStatus,
      refresh: () => refresh({ silent: false }),
    }),
    [presenceStatus, loading, saving, setPresenceStatus, refresh]
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
      loading: false,
      saving: false,
      presenceBypass: false,
      setPresenceStatus: async () => {},
      refresh: async () => {},
    }
  }
  return ctx
}
