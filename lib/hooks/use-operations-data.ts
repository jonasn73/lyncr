"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { CallActivityContext } from "@/lib/types"
import { LYNCR_ACTIVITY_REFRESH_EVENT } from "@/lib/lync-engine-bus"
import { useSessionSeed } from "@/lib/hooks/use-client-seed"
import { useDashboardPaintSeeds } from "@/lib/dashboard-paint-seeds"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { readActiveOrganizationId, isWorkspaceOrgStubId } from "@/lib/workspace-organizations"
import { browserSessionCacheReadsAllowed } from "@/lib/swr/persisted-cache"
import {
  operationsPaintToUiCalls,
  readOperationsPaintSeed,
  writeOperationsPaintSeed,
  clearOperationsPaintSeed,
  operationsPaintMatchesOrg,
} from "@/lib/operations-paint-cache"
import { clearSchedulerPaintSeed } from "@/lib/scheduler-paint-cache"
import { logFlicker } from "@/lib/debug/flicker-debug"
import type { UiCallRecord, UiCallType } from "@/lib/operations-ui-types"
import {
  formatListDateLabel,
  formatListTimeLabel,
  relabelCallListTimes,
  resolveOwnerTimezone,
} from "@/lib/browser-timezone-cookie"

export type { UiCallRecord, UiCallType } from "@/lib/operations-ui-types"

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
  /** True when this snapshot came from the tiny hard-refresh cookie (not a full /api/calls). */
  paintOnly?: boolean
}

let operationsCache: OperationsCache | null = null
/** Active shop id for paint-cookie writes (hook keeps this current). */
let lastOperationsOrgId: string | null = null

function cacheIsFresh(c: OperationsCache) {
  return Date.now() - c.fetchedAt < CACHE_TTL_MS
}

const SESSION_STORAGE_KEY = "zing_operations_v2"
/** Keep JSON small for sessionStorage quota (~5MB). */
const SESSION_MAX_CALLS = 80

type SessionOperationsPayload = OperationsCache & {
  /** Shop that owns these rows — reject on mismatch. */
  organizationId: string | null
}

function resolveOperationsOrgId(organizationId: string | null = null): string | null {
  if (organizationId) return organizationId
  if (lastOperationsOrgId) return lastOperationsOrgId
  if (typeof window === "undefined") return null
  try {
    // Fallback so Lines prefetch still tags the paint cookie with the active shop.
    return readActiveOrganizationId()
  } catch {
    return null
  }
}

function writeSessionOperationsCache(c: OperationsCache, organizationId: string | null = null) {
  if (typeof window === "undefined") return
  const orgId = resolveOperationsOrgId(organizationId)
  try {
    const trimmed: SessionOperationsPayload = {
      ...c,
      calls: c.calls.slice(0, SESSION_MAX_CALLS),
      organizationId: orgId,
    }
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(trimmed))
  } catch {
    /* quota / private mode */
  }
  // Cookie seed so the *next* hard refresh can SSR Activity rows (not gray bars).
  // Skip overwrite when we still have no shop id but an org-tagged cookie already exists.
  const existingPaint = readOperationsPaintSeed()
  if (orgId == null && existingPaint?.organizationId) return
  writeOperationsPaintSeed(c.calls, c.fetchedAt, orgId)
}

/** Read last Activity rows from sessionStorage (hard refresh seed). */
function readSessionOperationsCache(
  organizationId?: string | null
): OperationsCache | null {
  if (typeof window === "undefined") return null
  // Same hydrate gate as SWR session cache — cookies paint first.
  if (!browserSessionCacheReadsAllowed()) return null
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SessionOperationsPayload
    if (!parsed || !Array.isArray(parsed.calls)) return null
    const seedOrg = parsed.organizationId ?? null
    const wantOrg =
      organizationId !== undefined ? organizationId : resolveOperationsOrgId(null)
    // Different shop — ignore (paint-seed stub vs real uuid is the same shop).
    if (
      seedOrg != null &&
      wantOrg != null &&
      !operationsPaintMatchesOrg(
        { organizationId: seedOrg, calls: [], fetchedAt: 0 },
        wantOrg
      )
    ) {
      return null
    }
    return {
      calls: parsed.calls.map((row) =>
        relabelCallListTimes(normalizeUiCallRecord(row), resolveOwnerTimezone())
      ),
      quality: parsed.quality ?? null,
      insights: parsed.insights ?? null,
      fetchedAt: typeof parsed.fetchedAt === "number" ? parsed.fetchedAt : 0,
    }
  } catch {
    return null
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
  // Drop hard-refresh cookie so the next login cannot SSR another shop’s callers.
  clearOperationsPaintSeed()
  clearSchedulerPaintSeed()
}

/**
 * Mark cache stale for the next fetch, but keep rows in memory so Activities
 * does not flash empty / jump when a live call event asks for a refresh.
 */
export function softInvalidateOperationsDataCache() {
  if (!operationsCache) return
  operationsCache = { ...operationsCache, fetchedAt: 0 }
}

/** True only when loading with nothing to show — never cover a real list (Lines pattern). */
export function shouldShowOperationsSkeleton(
  loading: boolean,
  callCount: number,
  /** @deprecated Ignored — paint stubs stay off-screen; session/network rows always display. */
  _paintOnly = false
): boolean {
  void _paintOnly
  return loading && callCount === 0
}

/** First-paint loading flag — paint cookie still counts as seeded (rows show; refresh in background). */
export function initialOperationsLoading(
  seed: { calls?: unknown[]; paintOnly?: boolean; quality?: unknown } | null | undefined
): boolean {
  if (seed == null) return true
  // Paint rows are visible — keep a soft loading flag for network upgrade only.
  if (seed.paintOnly) return true
  return false
}

/** In-memory cache, else last sessionStorage / paint cookie snapshot (client only). */
export function peekOperationsCache(): OperationsCache | null {
  const wantOrg = resolveOperationsOrgId(null)
  // Prefer the live tab cache so a hidden Activity pane stays warm.
  if (operationsCache) return operationsCache
  // Hard-refresh seed — never read sessionStorage during SSR.
  const fromSession = readSessionOperationsCache(wantOrg)
  if (fromSession) return fromSession
  // Cookie mirror — available on first client tick even when sessionStorage lagged.
  const fromCookie = readOperationsPaintSeed(wantOrg)
  if (!fromCookie) return null
  return {
    calls: operationsPaintToUiCalls(fromCookie),
    quality: null,
    insights: null,
    // Never treat paint cookie as a fresh full snapshot — force network upgrade.
    fetchedAt: 0,
    paintOnly: true,
  }
}

/** Shared fetch used by the hook and dashboard prefetch (Lines tab warms Activity). */
let prefetchInflight: Promise<void> | null = null

async function fetchOperationsSnapshot(bypassCache: boolean): Promise<OperationsCache | null> {
  const cached = operationsCache
  // Fresh in-memory rows: skip the network and keep the same object.
  if (!bypassCache && cached && cacheIsFresh(cached)) return cached

  const [callsRes, qualityRes] = await Promise.all([
    fetch("/api/calls?limit=100", { credentials: "include" }),
    fetch("/api/voice/quality?days=7", { credentials: "include" }),
  ])

  if (callsRes.status === 401) {
    throw new Error("Session expired — sign out and sign in again to see call stats.")
  }
  if (!callsRes.ok) throw new Error("Failed to load calls")
  const callsData = await callsRes.json()
  const tz = resolveOwnerTimezone()
  const normalizedCalls: UiCallRecord[] = Array.isArray(callsData.calls)
    ? callsData.calls.map((c: Record<string, unknown>) => {
      const createdAtRaw = String(c.created_at || "")
      const createdAt = createdAtRaw ? new Date(createdAtRaw) : new Date()
      const statusRaw = String(c.status || "").toLowerCase()
      // Keep empty when unknown — never invent "Owner" (that painted missed calls as Answered).
      const routedToRaw = String(c.routed_to_name || "").trim()
      const routedTo =
        statusRaw.includes("ai") || routedToRaw.toLowerCase().includes("ai")
          ? "AI Receptionist"
          : routedToRaw
      const receptionistId = c.routed_to_receptionist_id ? String(c.routed_to_receptionist_id) : null
      const activityRaw = c.activity as CallActivityContext | null | undefined
      const fromNumber = String(c.from_number || "")
      const toNumber = String(c.to_number || "")
      // Stable id only — never randomUUID (that remounted list rows and jumped scroll).
      const stableId =
        String(c.id || c.provider_call_sid || c.twilio_call_sid || "").trim() ||
        `${fromNumber}|${toNumber}|${createdAt.toISOString()}`
      return {
        id: stableId,
        type: normalizeCallType(c.call_type),
        callerName: String(c.caller_name || "Unknown Caller"),
        callerNumber: formatPhoneDisplay(fromNumber),
        targetLineE164: toNumber,
        routedTo,
        routedToReceptionistId: receptionistId,
        routedInitials: initialsFromName(routedTo),
        routedColor: "bg-primary",
        date: formatListDateLabel(createdAt, tz),
        time: formatListTimeLabel(createdAt, tz),
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

  const next: OperationsCache = {
    calls: normalizedCalls,
    quality: qualitySummary,
    insights: qualityInsights,
    fetchedAt: Date.now(),
    paintOnly: false,
  }
  operationsCache = next
  writeSessionOperationsCache(next, lastOperationsOrgId)
  return next
}

/** Warm Activity rows while the owner is still on Lines / another tab. */
export function prefetchOperationsData(): void {
  // Never run on the server (no credentials / no sessionStorage).
  if (typeof window === "undefined") return
  // Lift session seed into memory so the first Activity mount can paint instantly.
  if (!operationsCache) {
    const session = readSessionOperationsCache()
    if (session) operationsCache = session
  }
  // Fresh cache: nothing to do.
  if (operationsCache && cacheIsFresh(operationsCache)) return
  // Dedupe overlapping dashboard + tab-click prefetches.
  if (prefetchInflight) return
  prefetchInflight = fetchOperationsSnapshot(false)
    .catch(() => {
      // Prefetch failure is quiet — the Activity hook will retry when the tab opens.
    })
    .then(() => {
      prefetchInflight = null
    })
}

function formatPhoneDisplay(phone: string | undefined | null): string {
  const v = String(phone || "")
  if (!v) return "Unknown"
  const digits = v.replace(/\D/g, "")
  const d = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return v
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

/** Compact signature so quiet polls do not replace state / remount list rows. */
function callsFingerprint(calls: UiCallRecord[]): string {
  return calls
    .map(
      (c) =>
        `${c.id}|${c.callStatus}|${c.durationSeconds}|${c.answeredAt ?? ""}|${c.endedAt ?? ""}|${c.date}|${c.time}|${c.activity?.intakeAction ?? ""}|${c.activity?.leadId ?? ""}|${c.recordingUrl ?? ""}`
    )
    .join(";")
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
  /** When false, pause fetch/poll (hidden presence tabs). Default true. */
  enabled?: boolean
  /** SSR hard-refresh rows — first HTML matches the real table (Lines pattern). */
  initialCalls?: UiCallRecord[] | null
}

export function useOperationsData(options?: UseOperationsDataOptions) {
  const refetchIntervalMs = options?.refetchIntervalMs
  const enabled = options?.enabled !== false
  const initialCalls = options?.initialCalls
  const { activeOrganizationId: workspaceOrgId } = useDashboardWorkspace()
  // Cookie paint from layout — SSR HTML can already include last Activity rows.
  const paintSeeds = useDashboardPaintSeeds()
  // Workspace org wins once resolved; fall back to paint cookies during SSR.
  const activeOrgId =
    workspaceOrgId ??
    paintSeeds.lines?.organizationId ??
    paintSeeds.workspace?.organizationId ??
    (typeof window !== "undefined" ? readActiveOrganizationId() : null)
  lastOperationsOrgId = activeOrgId
  const paintOpsRaw = paintSeeds.operations
  // Ignore another shop’s cookie so we never flash the wrong callers.
  const paintOps =
    paintOpsRaw && operationsPaintMatchesOrg(paintOpsRaw, activeOrgId) ? paintOpsRaw : null
  // Session seed re-keys when the shop changes so we never re-apply Shop A under Shop B.
  const sessionSeed = useSessionSeed(
    () => readSessionOperationsCache(activeOrgId),
    null,
    activeOrgId ?? "operations-v2"
  )
  // Server-rendered full list beats cookie stub and empty skeleton.
  const seedFromSsr =
    initialCalls && initialCalls.length > 0
      ? {
          calls: initialCalls,
          quality: null as VoiceQualitySummary | null,
          insights: null as VoiceOperationsInsights | null,
          fetchedAt: Date.now(),
          paintOnly: false as const,
        }
      : null
  const seedFromPaint =
    paintOps != null
      ? {
          calls: operationsPaintToUiCalls(paintOps),
          quality: null as VoiceQualitySummary | null,
          insights: null as VoiceOperationsInsights | null,
          fetchedAt: 0,
          paintOnly: true as const,
        }
      : null
  const seed =
    operationsCache ??
    seedFromSsr ??
    sessionSeed ??
    (typeof window !== "undefined" ? peekOperationsCache() : null) ??
    seedFromPaint ??
    (typeof window !== "undefined"
      ? (() => {
          const fromCookie = readOperationsPaintSeed(activeOrgId)
          if (!fromCookie) return null
          return {
            calls: operationsPaintToUiCalls(fromCookie),
            quality: null as VoiceQualitySummary | null,
            insights: null as VoiceOperationsInsights | null,
            fetchedAt: 0,
            paintOnly: true as const,
          }
        })()
      : null)
  const seedIsPaintOnly = Boolean(seed?.paintOnly)
  // SSR / session / memory rows show immediately. Cookie stub stays off-screen.
  const [calls, setCalls] = useState<UiCallRecord[]>(() =>
    seedIsPaintOnly ? [] : seed?.calls ?? []
  )
  const [quality, setQuality] = useState<VoiceQualitySummary | null>(() =>
    seedIsPaintOnly ? null : seed?.quality ?? null
  )
  const [insights, setInsights] = useState<VoiceOperationsInsights | null>(() =>
    seedIsPaintOnly ? null : seed?.insights ?? null
  )
  const [paintOnly, setPaintOnly] = useState(() => seedIsPaintOnly)
  // SSR rows: not loading. Cookie-only / empty: refresh in background.
  const [loading, setLoading] = useState(() => seed == null || seedIsPaintOnly)
  const [loadError, setLoadError] = useState<string | null>(null)
  const hasCallsRef = useRef(!seedIsPaintOnly && (seed?.calls.length ?? 0) > 0)
  hasCallsRef.current = calls.length > 0
  const prevOrgRef = useRef<string | null | undefined>(undefined)

  // Lift SSR seed into module cache so tab remounts / polls do not blank the table.
  useLayoutEffect(() => {
    if (!seedFromSsr || operationsCache) return
    operationsCache = seedFromSsr
    writeSessionOperationsCache(seedFromSsr, activeOrgId)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount with SSR props
  }, [])

  // When the owner switches shops, drop memory / session / cookie so we do not keep the old list.
  useLayoutEffect(() => {
    const prev = prevOrgRef.current
    prevOrgRef.current = activeOrgId
    // First mount — keep SSR / session / paint rows (never wipe before first paint).
    if (prev === undefined) return
    if (prev === activeOrgId || activeOrgId == null) return
    // Paint stub → real uuid is the same shop.
    if (isWorkspaceOrgStubId(prev) && activeOrgId) return

    const cachedCookie = readOperationsPaintSeed()
    const cookieMismatch =
      cachedCookie != null && !operationsPaintMatchesOrg(cachedCookie, activeOrgId)
    // Session key exists but does not match this shop → clear it.
    let sessionMismatch = false
    try {
      const raw = sessionStorage.getItem(SESSION_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as SessionOperationsPayload
        const seedOrg = parsed?.organizationId ?? null
        sessionMismatch =
          seedOrg != null &&
          activeOrgId != null &&
          !operationsPaintMatchesOrg(
            { organizationId: seedOrg, calls: [], fetchedAt: 0 },
            activeOrgId
          )
      }
    } catch {
      sessionMismatch = false
    }
    if (!cookieMismatch && !sessionMismatch) return
    const prevRowCount = operationsCache?.calls.length ?? 0
    operationsCache = null
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY)
    } catch {
      /* ignore */
    }
    if (cookieMismatch) clearOperationsPaintSeed()
    logFlicker({
      event: "ops-org-clear",
      component: "useOperationsData",
      reason: cookieMismatch ? "cookie-mismatch" : "session-mismatch",
      prevHadOrg: Boolean(prev),
      nextHadOrg: Boolean(activeOrgId),
      prevOrgIsStub: Boolean(prev && isWorkspaceOrgStubId(prev)),
      rowCountBefore: prevRowCount,
      rowCountAfter: 0,
      loadingAfter: true,
    })
    setCalls([])
    setPaintOnly(false)
    setLoading(true)
  }, [activeOrgId])

  // Warm in-memory cache from session once — never write module state during render (#185).
  // useLayoutEffect: apply seed before browser paint so hard refresh is not skeleton → rows.
  useLayoutEffect(() => {
    // Prefer hook seed; peek sessionStorage / cookie if this layout pass still has SSR null.
    const source: "session" | "peek" | "paint" | null = sessionSeed
      ? "session"
      : peekOperationsCache()
        ? "peek"
        : seedFromPaint
          ? "paint"
          : null
    const next = sessionSeed
      ? { ...sessionSeed, paintOnly: false as const }
      : peekOperationsCache() ??
        (seedFromPaint
          ? {
              ...seedFromPaint,
              fetchedAt: 0,
              paintOnly: true as const,
            }
          : null)
    if (!next) return
    // Tiny cookie stub: warm fetch only — never display (short wrong list → full list flash).
    if (next.paintOnly) {
      if (!operationsCache) {
        operationsCache = { ...next, fetchedAt: 0, paintOnly: true }
      }
      setPaintOnly(true)
      setLoading(true)
      logFlicker({
        event: "ops-seed-apply",
        component: "useOperationsData",
        dataSource: source ?? "paint",
        seedRowCount: next.calls.length,
        rowCountAfter: 0,
        loadingAfter: true,
        reason: "paint-stub-not-displayed",
      })
      return
    }
    // Full session / memory: show immediately (before browser paint when possible).
    if (!operationsCache || operationsCache.paintOnly) {
      operationsCache = next
    }
    setPaintOnly(false)
    setCalls((prev) => {
      const nextCalls =
        next.calls.length > prev.length ? next.calls : prev.length === 0 ? next.calls : prev
      if (nextCalls !== prev) {
        logFlicker({
          event: "ops-seed-apply",
          component: "useOperationsData",
          dataSource: source ?? "unknown",
          seedRowCount: next.calls.length,
          rowCountBefore: prev.length,
          rowCountAfter: nextCalls.length,
          loadingAfter: false,
        })
      }
      return nextCalls
    })
    setQuality((prev) => prev ?? next.quality)
    setInsights((prev) => prev ?? next.insights)
    setLoading(false)
    // seedFromPaint is request-stable from cookies; omit identity churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionSeed, activeOrgId])

  useEffect(() => {
    if (!enabled) return
    let mounted = true

    async function loadData(bypassCache: boolean) {
      const cached = operationsCache ?? peekOperationsCache()
      // Paint-only / stale stubs must always hit the network.
      const cacheUsable =
        cached &&
        !cached.paintOnly &&
        cacheIsFresh(cached) &&
        !bypassCache
      if (cacheUsable) {
        if (!mounted) return
        setPaintOnly(false)
        setCalls((prev) => {
          const same = callsFingerprint(prev) === callsFingerprint(cached.calls)
          if (!same) {
            logFlicker({
              event: "ops-list-replace",
              component: "useOperationsData",
              dataSource: "memory-cache",
              rowCountBefore: prev.length,
              rowCountAfter: cached.calls.length,
            })
          }
          return same ? prev : cached.calls
        })
        setQuality(cached.quality)
        setInsights(cached.insights)
        setLoading(false)
        setLoadError(null)
        return
      }

      const canShowExisting =
        hasCallsRef.current || Boolean(cached?.calls.length && !cached.paintOnly)
      if (!canShowExisting) {
        logFlicker({
          event: "ops-loading",
          component: "useOperationsData",
          loading: true,
          reason: cached?.paintOnly ? "paint-stub-await-network" : "first-load-no-rows",
          rowCountBefore: hasCallsRef.current ? -1 : 0,
          bypassCache: bypassCache,
        })
        setLoading(true)
        setLoadError(null)
      } else {
        setLoading(false)
      }
      try {
        const snapshot = await fetchOperationsSnapshot(bypassCache || Boolean(cached?.paintOnly))
        if (!mounted || !snapshot) return
        setPaintOnly(false)
        setCalls((prev) => {
          const same = callsFingerprint(prev) === callsFingerprint(snapshot.calls)
          if (!same) {
            logFlicker({
              event: "ops-list-replace",
              component: "useOperationsData",
              dataSource: "network",
              rowCountBefore: prev.length,
              rowCountAfter: snapshot.calls.length,
              bypassCache: bypassCache,
            })
          }
          return same ? prev : snapshot.calls
        })
        setQuality((prev) =>
          JSON.stringify(prev) === JSON.stringify(snapshot.quality) ? prev : snapshot.quality
        )
        setInsights((prev) =>
          JSON.stringify(prev) === JSON.stringify(snapshot.insights) ? prev : snapshot.insights
        )
        setLoadError(null)
      } catch (e) {
        if (!mounted) return
        if (!hasCallsRef.current && !operationsCache?.calls.length) {
          setLoadError(e instanceof Error ? e.message : "Failed to load operations data")
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }

    void loadData(false)

    let intervalId: ReturnType<typeof setInterval> | undefined
    if (typeof refetchIntervalMs === "number" && refetchIntervalMs > 0) {
      intervalId = setInterval(() => {
        void loadData(true)
      }, refetchIntervalMs)
    }

    const onActivityRefresh = () => {
      softInvalidateOperationsDataCache()
      void loadData(true)
    }
    window.addEventListener(LYNCR_ACTIVITY_REFRESH_EVENT, onActivityRefresh)

    return () => {
      mounted = false
      if (intervalId) clearInterval(intervalId)
      window.removeEventListener(LYNCR_ACTIVITY_REFRESH_EVENT, onActivityRefresh)
    }
  }, [refetchIntervalMs, enabled])

  return { calls, quality, insights, loading, loadError, paintOnly }
}
