"use client"

// Shared account presence for Lines — Available toggle + Amber Busy-until stay in sync.

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
  /** ISO timestamp when Amber will flip back to Available (Busy until…). */
  presenceAvailableAt: string | null
  presenceTimezone: string | null
  loading: boolean
  saving: boolean
  /** True when cell ring is skipped (Presence Busy). */
  presenceBypass: boolean
  /** True when a manual Busy/Closed tap is blocking the weekly auto-schedule. */
  presenceLocked: boolean
  /** True when the owner has a weekly auto-schedule turned on. */
  scheduleEnabled: boolean
  /** "Mon–Fri 9:00 AM–5:00 PM" — compact schedule summary for display. */
  scheduleSummary: string | null
  /** "New York" — short timezone label to pair with the summary. */
  scheduleTimezoneLabel: string | null
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

type PresencePayload = {
  presence_status?: string
  presence_available_at?: string | null
  presence_timezone?: string | null
  presence_locked?: boolean
  schedule_enabled?: boolean
  schedule_summary?: string | null
  schedule_timezone_label?: string | null
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
  const [presenceAvailableAt, setPresenceAvailableAt] = useState<string | null>(null)
  const [presenceTimezone, setPresenceTimezone] = useState<string | null>(null)
  const [presenceLocked, setPresenceLocked] = useState(false)
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [scheduleSummary, setScheduleSummary] = useState<string | null>(null)
  const [scheduleTimezoneLabel, setScheduleTimezoneLabel] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Don’t show a spinner when we already painted from cache.
  const [fetching, setFetching] = useState(false)
  const linesActive = useDashboardActivePage() === "dashboard"
  const pollEnabled = usePollBudget(linesActive)

  const presenceStatus = liveStatus ?? cachedSeed ?? "AVAILABLE"
  const presenceReady = liveStatus != null || cachedSeed != null
  const hasUntil =
    Boolean(presenceAvailableAt) && isBusyPresenceStatus(presenceStatus)

  const paintedFromCacheRef = useRef(false)
  if (presenceReady) paintedFromCacheRef.current = true

  const setStatus = useCallback((next: PresenceStatus) => {
    setLiveStatus((prev) => (prev === next ? prev : next))
    writeCachedPresence(next)
  }, [])

  const applyPayload = useCallback(
    (data: PresencePayload | undefined) => {
      const next = parsePresenceStatus(data?.presence_status)
      setStatus(next)
      const until =
        typeof data?.presence_available_at === "string" && data.presence_available_at.trim()
          ? data.presence_available_at
          : null
      setPresenceAvailableAt(until)
      setPresenceTimezone(
        typeof data?.presence_timezone === "string" && data.presence_timezone.trim()
          ? data.presence_timezone
          : null
      )
      setPresenceLocked(data?.presence_locked === true)
      setScheduleEnabled(data?.schedule_enabled === true)
      setScheduleSummary(
        typeof data?.schedule_summary === "string" && data.schedule_summary.trim()
          ? data.schedule_summary
          : null
      )
      setScheduleTimezoneLabel(
        typeof data?.schedule_timezone_label === "string" && data.schedule_timezone_label.trim()
          ? data.schedule_timezone_label
          : null
      )
      if (next === "AVAILABLE") {
        setPresenceAvailableAt(null)
      }
    },
    [setStatus]
  )

  const refresh = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? paintedFromCacheRef.current
      if (!silent) setFetching(true)
      try {
        const res = await fetch("/api/routing/presence", { credentials: "include" })
        const json = (await res.json()) as { data?: PresencePayload }
        applyPayload(json.data)
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
    [applyPayload, setStatus]
  )

  useEffect(() => {
    if (!pollEnabled) return
    void refresh()
  }, [refresh, pollEnabled])

  // Poll faster while Busy-until is active so Amber SMS shows up sooner on Lines.
  useEffect(() => {
    if (!pollEnabled) return
    const ms = hasUntil ? 12_000 : 60_000
    const id = window.setInterval(() => {
      void refresh({ silent: true })
    }, ms)
    return () => window.clearInterval(id)
  }, [refresh, pollEnabled, hasUntil])

  // Returning to the tab / Lines — re-check so Amber flips don’t wait a full minute.
  useEffect(() => {
    if (!pollEnabled) return
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh({ silent: true })
    }
    window.addEventListener("focus", onVisible)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.removeEventListener("focus", onVisible)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [refresh, pollEnabled])

  const setPresenceStatus = useCallback(
    async (next: PresenceStatus) => {
      const prev = presenceStatus
      const prevUntil = presenceAvailableAt
      const prevTz = presenceTimezone
      setStatus(next)
      if (next === "AVAILABLE") setPresenceAvailableAt(null)
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
          data?: PresencePayload
        }
        if (!res.ok) {
          setStatus(prev)
          setPresenceAvailableAt(prevUntil)
          setPresenceTimezone(prevTz)
          toast({
            title: "Could not update presence",
            description: json.migration
              ? `Run ${json.migration} in Neon, then try again.`
              : json.error || res.statusText,
            variant: "destructive",
          })
          return
        }
        applyPayload(json.data ?? { presence_status: next })
      } catch (e) {
        setStatus(prev)
        setPresenceAvailableAt(prevUntil)
        setPresenceTimezone(prevTz)
        toast({
          title: "Could not update presence",
          description: e instanceof Error ? e.message : "Try again.",
          variant: "destructive",
        })
      } finally {
        setSaving(false)
      }
    },
    [presenceStatus, presenceAvailableAt, presenceTimezone, setStatus, applyPayload]
  )

  // Stable wrapper so context consumers do not see a new `refresh` identity every paint.
  const refreshLoud = useCallback(() => refresh({ silent: false }), [refresh])

  const value = useMemo<AccountPresenceContextValue>(
    () => ({
      presenceStatus,
      presenceReady,
      presenceAvailableAt,
      presenceTimezone,
      // Spinner only when we have nothing to show yet (not during silent revalidate).
      loading: !presenceReady && fetching,
      saving,
      presenceBypass: presenceReady && isBusyPresenceStatus(presenceStatus),
      presenceLocked,
      scheduleEnabled,
      scheduleSummary,
      scheduleTimezoneLabel,
      setPresenceStatus,
      refresh: refreshLoud,
    }),
    [
      presenceStatus,
      presenceReady,
      presenceAvailableAt,
      presenceTimezone,
      presenceLocked,
      scheduleEnabled,
      scheduleSummary,
      scheduleTimezoneLabel,
      fetching,
      saving,
      setPresenceStatus,
      refreshLoud,
    ]
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
      presenceAvailableAt: null,
      presenceTimezone: null,
      loading: false,
      saving: false,
      presenceBypass: false,
      presenceLocked: false,
      scheduleEnabled: false,
      scheduleSummary: null,
      scheduleTimezoneLabel: null,
      setPresenceStatus: async () => {},
      refresh: async () => {},
    }
  }
  return ctx
}
