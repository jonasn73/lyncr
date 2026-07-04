"use client"

import { useEffect, useLayoutEffect, useState } from "react"
import type { CallActivityContext } from "@/lib/types"

export type UiCallType = "incoming" | "outgoing" | "missed" | "voicemail"

export interface UiCallRecord {
  id: string
  type: UiCallType
  callerName: string
  callerNumber: string
  /** Business line dialed (E.164). */
  targetLineE164: string
  routedTo: string
  routedToReceptionistId: string | null
  routedInitials: string
  routedColor: string
  date: string
  time: string
  /** ISO timestamp from call_logs.created_at for sorting and display. */
  createdAt: string
  /** Raw call_logs.call_type before UI normalization (e.g. manual_intake). */
  rawCallType: string
  /** Raw call_logs.status for missed-call detection. */
  callStatus: string
  answeredAt: string | null
  endedAt: string | null
  durationSeconds: number
  hasRecording: boolean
  recordingUrl: string | null
  /** Intake panel action + scheduling summary from /api/calls. */
  activity: CallActivityContext | null
}

export interface VoiceQualitySummary {
  total_calls: number
  answered_calls: number
  answer_rate_percent: number
  avg_setup_ms: number | null
  p95_setup_ms: number | null
  avg_post_dial_delay_ms: number | null
}

export interface VoiceOperationsInsights {
  daily_quality: {
    day: string
    total_calls: number
    answered_calls: number
    answer_rate_percent: number
    avg_setup_ms: number | null
  }[]
  number_quality: {
    number: string
    total_calls: number
    answered_calls: number
    answer_rate_percent: number
    avg_setup_ms: number | null
  }[]
  top_missed_callers: {
    caller_number: string
    missed_calls: number
    last_missed_at: string
  }[]
}

// --- In-memory cache (same browser tab) ---------------------------------------
// Activity remounts on every tab visit; without this we always set loading=true
// and flash the full-page skeleton until /api/calls + /api/voice/quality return.
const CACHE_TTL_MS = 45_000

type OperationsCache = {
  calls: UiCallRecord[]
  quality: VoiceQualitySummary | null
  insights: VoiceOperationsInsights | null
  fetchedAt: number
}

let operationsCache: OperationsCache | null = null

function cacheIsFresh(c: OperationsCache) {
  return Date.now() - c.fetchedAt < CACHE_TTL_MS
}

const SESSION_STORAGE_KEY = "zing_operations_v2"
/** Keep JSON small for sessionStorage quota (~5MB). */
const SESSION_MAX_CALLS = 80
/** Drop storage older than this so we do not show very stale KPIs forever without refetch. */
const SESSION_MAX_AGE_MS = 24 * 60 * 60_000

function readSessionOperationsCache(): OperationsCache | null {
  if (typeof window === "undefined") return null
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as OperationsCache
    if (!p || typeof p.fetchedAt !== "number" || !Array.isArray(p.calls)) return null
    if (Date.now() - p.fetchedAt > SESSION_MAX_AGE_MS) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY)
      return null
    }
    return {
      ...p,
      calls: p.calls.map((c) => normalizeUiCallRecord(c as UiCallRecord)),
    }
  } catch {
    return null
  }
}

function writeSessionOperationsCache(c: OperationsCache) {
  if (typeof window === "undefined") return
  try {
    const trimmed: OperationsCache = {
      ...c,
      calls: c.calls.slice(0, SESSION_MAX_CALLS),
    }
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(trimmed))
  } catch {
    /* quota / private mode */
  }
}

/** Clears cached calls/quality (e.g. after sign-out) so another account never sees stale rows. */
export function clearOperationsDataCache() {
  operationsCache = null
  if (typeof window !== "undefined") {
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }
}

function formatPhoneDisplay(phone: string | undefined | null): string {
  const v = String(phone || "")
  if (!v) return "Unknown"
  const digits = v.replace(/\D/g, "")
  const d = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return v
}

function getDateLabel(d: Date): string {
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startThatDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diffDays = Math.floor((startToday - startThatDay) / 86_400_000)
  if (diffDays === 0) return "Today"
  if (diffDays === 1) return "Yesterday"
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
  return (parts[0] || "NA").slice(0, 2).toUpperCase()
}

function normalizeCallType(value: unknown): UiCallType {
  const t = String(value || "incoming")
  if (t === "incoming" || t === "outgoing" || t === "missed" || t === "voicemail") return t
  return "incoming"
}

function emptyActivityContext(): CallActivityContext {
  return {
    intakeAction: "No intake recorded",
    intakeDetail: null,
    scheduleLabel: null,
    scheduleAt: null,
    leadId: null,
    callerScheduleHint: null,
    callerPoolCount: 0,
  }
}

/** Backfill fields missing from older session-cache rows. */
function normalizeUiCallRecord(c: UiCallRecord): UiCallRecord {
  return {
    ...c,
    targetLineE164: c.targetLineE164 ?? "",
    routedToReceptionistId: c.routedToReceptionistId ?? null,
    createdAt: c.createdAt ?? "",
    rawCallType: c.rawCallType ?? c.type ?? "incoming",
    callStatus: c.callStatus ?? "",
    answeredAt: c.answeredAt ?? null,
    endedAt: c.endedAt ?? null,
    activity: c.activity ?? emptyActivityContext(),
  }
}

export type UseOperationsDataOptions = {
  /** When set (ms), refetches calls + quality on this interval, ignoring the 45s in-memory cache TTL. */
  refetchIntervalMs?: number
}

export function useOperationsData(options?: UseOperationsDataOptions) {
  const refetchIntervalMs = options?.refetchIntervalMs
  const seed = operationsCache
  const [calls, setCalls] = useState<UiCallRecord[]>(() => seed?.calls ?? [])
  const [quality, setQuality] = useState<VoiceQualitySummary | null>(() => seed?.quality ?? null)
  const [insights, setInsights] = useState<VoiceOperationsInsights | null>(() => seed?.insights ?? null)
  // Full-page skeleton only when we have never loaded successfully in this tab.
  const [loading, setLoading] = useState(() => operationsCache === null)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Restore last successful payload before paint so refresh / Activity tab does not flash a loading shell.
  useLayoutEffect(() => {
    if (operationsCache && cacheIsFresh(operationsCache)) return
    const stored = readSessionOperationsCache()
    if (!stored) return
    operationsCache = stored
    setCalls(stored.calls.map(normalizeUiCallRecord))
    setQuality(stored.quality)
    setInsights(stored.insights)
    setLoading(false)
  }, [])

  useEffect(() => {
    let mounted = true

    async function loadData(bypassCache: boolean) {
      const cached = operationsCache
      if (!bypassCache && cached && cacheIsFresh(cached)) {
        if (!mounted) return
        setCalls(cached.calls)
        setQuality(cached.quality)
        setInsights(cached.insights)
        setLoading(false)
        setLoadError(null)
        return
      }

      if (!cached) {
        setLoading(true)
        setLoadError(null)
      } else {
        setRefreshing(true)
      }

      try {
        const [callsRes, qualityRes] = await Promise.all([
          fetch("/api/calls?limit=100", { credentials: "include" }),
          fetch("/api/voice/quality?days=7", { credentials: "include" }),
        ])

        if (callsRes.status === 401) {
          throw new Error("Session expired — sign out and sign in again to see call stats.")
        }
        if (!callsRes.ok) throw new Error("Failed to load calls")
        const callsData = await callsRes.json()
        const normalizedCalls: UiCallRecord[] = Array.isArray(callsData.calls)
          ? callsData.calls.map((c: Record<string, unknown>) => {
            const createdAtRaw = String(c.created_at || "")
            const createdAt = createdAtRaw ? new Date(createdAtRaw) : new Date()
            const statusRaw = String(c.status || "").toLowerCase()
            const routedToRaw = String(c.routed_to_name || c.routed_to_receptionist_id || "")
            const routedTo =
              statusRaw.includes("ai") || routedToRaw.toLowerCase().includes("ai")
                ? "AI Receptionist"
                : routedToRaw || "Owner"
            const receptionistId = c.routed_to_receptionist_id ? String(c.routed_to_receptionist_id) : null
            const activityRaw = c.activity as CallActivityContext | null | undefined
            return {
              id: String(c.id || c.provider_call_sid || c.twilio_call_sid || crypto.randomUUID()),
              type: normalizeCallType(c.call_type),
              callerName: String(c.caller_name || "Unknown Caller"),
              callerNumber: formatPhoneDisplay(String(c.from_number || "")),
              targetLineE164: String(c.to_number || ""),
              routedTo,
              routedToReceptionistId: receptionistId,
              routedInitials: initialsFromName(routedTo),
              routedColor: "bg-primary",
              date: getDateLabel(createdAt),
              time: createdAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
              createdAt: createdAt.toISOString(),
              rawCallType: String(c.call_type || "incoming"),
              callStatus: String(c.status || ""),
              answeredAt: c.answered_at ? String(c.answered_at) : null,
              endedAt: c.ended_at ? String(c.ended_at) : null,
              durationSeconds: Number(c.duration_seconds || 0),
              hasRecording: Boolean(c.has_recording),
              recordingUrl: c.recording_url ? String(c.recording_url) : null,
              activity:
                activityRaw && typeof activityRaw.intakeAction === "string"
                  ? activityRaw
                  : emptyActivityContext(),
            }
          })
          : []

        let qualitySummary: VoiceQualitySummary | null = null
        let qualityInsights: VoiceOperationsInsights | null = null
        if (qualityRes.ok) {
          const q = await qualityRes.json()
          if (q?.summary) qualitySummary = q.summary as VoiceQualitySummary
          if (q?.insights) qualityInsights = q.insights as VoiceOperationsInsights
        }

        if (!mounted) return
        setCalls(normalizedCalls)
        setQuality(qualitySummary)
        setInsights(qualityInsights)
        operationsCache = {
          calls: normalizedCalls,
          quality: qualitySummary,
          insights: qualityInsights,
          fetchedAt: Date.now(),
        }
        writeSessionOperationsCache(operationsCache)
        setLoadError(null)
      } catch (e) {
        if (!mounted) return
        if (!operationsCache) {
          setLoadError(e instanceof Error ? e.message : "Failed to load operations data")
        }
      } finally {
        if (mounted) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    }

    void loadData(false)

    let intervalId: ReturnType<typeof setInterval> | undefined
    if (typeof refetchIntervalMs === "number" && refetchIntervalMs > 0) {
      intervalId = setInterval(() => {
        void loadData(true)
      }, refetchIntervalMs)
    }

    return () => {
      mounted = false
      if (intervalId) clearInterval(intervalId)
    }
  }, [refetchIntervalMs])

  return { calls, quality, insights, loading, loadError, refreshing }
}
