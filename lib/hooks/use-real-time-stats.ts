"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useSessionSeed } from "@/lib/hooks/use-client-seed"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { useDashboardActivePage } from "@/components/dashboard-shell-chrome-context"
import {
  isDashboardVisibleLineStatus,
  type DashboardBusinessNumber,
} from "@/lib/dashboard-routing-utils"
import {
  parseTalkSecondsFromDisplay,
  readRoutingTelemetryCache,
  writeRoutingTelemetryCache,
  emptyRoutingTelemetrySnapshot,
  type RoutingTelemetrySnapshot,
} from "@/lib/routing-telemetry-cache"
import { useDashboardPaintSeeds } from "@/lib/dashboard-paint-seeds"
import type {
  OwnerCallAnsweredPayload,
  OwnerCallCompletedPayload,
  OwnerCallInitiatedPayload,
} from "@/lib/realtime/owner-call-event-types"
import {
  isMissedCallTelemetry,
  normalizeCallEventPhoneDigits,
  talkSecondsFromCompletedPayload,
} from "@/lib/realtime/owner-call-event-types"
import { getPusherClient } from "@/lib/realtime/pusher-client"
import { routingTelemetryQueryString } from "@/lib/telemetry-timezone"
import {
  isLyncEngineOwningRealtime,
  subscribeLyncEngineBus,
  type LyncEngineBusEvent,
} from "@/lib/lync-engine-bus"
import {
  telemetryLocalDayPeriodKey,
  telemetryMonthPeriodKey,
  telemetryWeekPeriodKey,
} from "@/lib/daily-call-telemetry"

/** Tracks one ringing/connected leg until call-completed removes it. */
export type ActiveCallSession = {
  callSid: string
  toNumberDigits: string
  /** Set on call-answered — drives live talk-time ticks before hangup. */
  answeredAt: string | null
}

export type UseRealTimeStatsOptions = {
  businessNumbers: DashboardBusinessNumber[]
  /** Currently selected line in the call-flow header (E.164). */
  activeLineE164?: string | null
}

export type UseRealTimeStatsResult = {
  dailyCalls: number
  missedCalls: number
  dailyTalkSeconds: number
  weeklyTalkSeconds: number
  monthlyTalkSeconds: number
  /** Baseline + elapsed seconds for in-progress answered legs (HUD display). */
  liveDailyTalkSeconds: number
  liveWeeklyTalkSeconds: number
  liveMonthlyTalkSeconds: number
  /** Jobs booked ÷ unique callers today (0–100). */
  bookingRatePercent: number
  /** Average minutes from call end → dispatched job today. */
  avgDispatchSpeedMinutes: number | null
  /** Today's open salvage + hold-path booked quotes in cents. */
  rescueRevenueCents: number
  /** Busy menu / Hold / Press 1 call legs today (handled automation). */
  holdPathCalls: number
  /** Count of provisioned active phone lines (static until numbers list changes). */
  liveLineCount: number
  /** In-progress calls on the selected line (drives Step 1 badge). */
  activeCallsOnSelectedLine: number
  /** All in-progress calls across workspace lines (any line in businessNumbers). */
  activeCallSessions: ActiveCallSession[]
  /** True when Pusher client + owner channel subscription is active. */
  realtimeConnected: boolean
  /**
   * True after session cache hydrate or API baseline lands.
   * UI should not paint $0 / 0 as “loaded” while this is false.
   */
  baselineReady: boolean
  /** One-shot baseline sync (mount, org switch, routing config saved). */
  refreshBaseline: () => Promise<void>
}

function applySnapshot(
  setters: {
    setDailyCalls: (n: number) => void
    setMissedCalls: (n: number) => void
    setHoldPathCalls: (n: number) => void
    setDailyTalkSeconds: (n: number | ((prev: number) => number)) => void
    setWeeklyTalkSeconds: (n: number | ((prev: number) => number)) => void
    setMonthlyTalkSeconds: (n: number | ((prev: number) => number)) => void
    setBookingRatePercent: (n: number) => void
    setAvgDispatchSpeedMinutes: (n: number | null) => void
    setRescueRevenueCents: (n: number) => void
    setOwnerUserId: (id: string | null) => void
  },
  snap: RoutingTelemetrySnapshot,
  options?: { mergeTalk?: boolean; now?: Date }
) {
  const now = options?.now ?? new Date()
  const currentWeekKey = telemetryWeekPeriodKey(now)
  const currentMonthKey = telemetryMonthPeriodKey(now)
  const currentDayKey = telemetryLocalDayPeriodKey(now)
  const snapWeekKey = snap.weekPeriodKey ?? currentWeekKey
  const snapMonthKey = snap.monthPeriodKey ?? currentMonthKey
  const snapDayKey = snap.localDayPeriodKey ?? currentDayKey
  const mergeTalk = options?.mergeTalk ?? false

  setters.setDailyCalls(snapDayKey === currentDayKey ? snap.dailyCalls : 0)
  setters.setMissedCalls(snapDayKey === currentDayKey ? snap.missedCalls : 0)
  setters.setHoldPathCalls(snapDayKey === currentDayKey ? snap.holdPathCalls ?? 0 : 0)
  // Local calendar day — zero talk when the cached snapshot is from a prior day.
  setters.setDailyTalkSeconds(snapDayKey === currentDayKey ? snap.dailyTalkSeconds : 0)
  if (mergeTalk && snapWeekKey === currentWeekKey) {
    setters.setWeeklyTalkSeconds((prev) => Math.max(prev, snap.weeklyTalkSeconds))
  } else {
    setters.setWeeklyTalkSeconds(snap.weeklyTalkSeconds)
  }
  if (mergeTalk && snapMonthKey === currentMonthKey) {
    setters.setMonthlyTalkSeconds((prev) => Math.max(prev, snap.monthlyTalkSeconds))
  } else {
    setters.setMonthlyTalkSeconds(snap.monthlyTalkSeconds)
  }
  setters.setBookingRatePercent(snapDayKey === currentDayKey ? snap.bookingRatePercent : 0)
  setters.setAvgDispatchSpeedMinutes(
    snapDayKey === currentDayKey ? snap.avgDispatchSpeedMinutes : null
  )
  setters.setRescueRevenueCents(snapDayKey === currentDayKey ? snap.rescueRevenueCents : 0)
  setters.setOwnerUserId(snap.ownerUserId)
}

export function useRealTimeStats(options: UseRealTimeStatsOptions): UseRealTimeStatsResult {
  const { businessNumbers, activeLineE164 } = options
  const { activeOrganizationId } = useDashboardWorkspace()
  // Telemetry HUD lives on Lines — defer / skip visibility refetch on other tabs.
  const linesActive = useDashboardActivePage() === "dashboard"

  // Cookie-backed seeds from layout — available on SSR first paint.
  const paintSeeds = useDashboardPaintSeeds()
  const telemetryPaint = {
    snapshot: paintSeeds.telemetry,
    organizationId: paintSeeds.telemetryOrganizationId,
  }

  // Org-keyed session/cookie seed — re-reads when activeOrganizationId resolves after SSR.
  const telemetrySeed = useSessionSeed<RoutingTelemetrySnapshot | undefined>(
    () => readRoutingTelemetryCache(activeOrganizationId, undefined, telemetryPaint),
    undefined,
    activeOrganizationId ?? "default"
  )
  const seed = telemetrySeed ?? emptyRoutingTelemetrySnapshot()
  const hadSeed = telemetrySeed != null

  const [dailyCalls, setDailyCalls] = useState(() => seed.dailyCalls)
  const [missedCalls, setMissedCalls] = useState(() => seed.missedCalls)
  const [holdPathCalls, setHoldPathCalls] = useState(() => seed.holdPathCalls ?? 0)
  const [dailyTalkSeconds, setDailyTalkSeconds] = useState(() => seed.dailyTalkSeconds)
  const [weeklyTalkSeconds, setWeeklyTalkSeconds] = useState(() => seed.weeklyTalkSeconds)
  const [monthlyTalkSeconds, setMonthlyTalkSeconds] = useState(() => seed.monthlyTalkSeconds)
  const [bookingRatePercent, setBookingRatePercent] = useState(() => seed.bookingRatePercent)
  const [avgDispatchSpeedMinutes, setAvgDispatchSpeedMinutes] = useState<number | null>(
    () => seed.avgDispatchSpeedMinutes
  )
  const [rescueRevenueCents, setRescueRevenueCents] = useState(() => seed.rescueRevenueCents)
  const [ownerUserId, setOwnerUserId] = useState<string | null>(() => seed.ownerUserId)
  const [baselineReady, setBaselineReady] = useState(() => hadSeed)
  const [activeCallSessions, setActiveCallSessions] = useState<ActiveCallSession[]>([])
  const [realtimeConnected, setRealtimeConnected] = useState(false)
  /** Bumps every second while answered legs are live so talk pills keep ticking. */
  const [liveTalkTick, setLiveTalkTick] = useState(0)

  const activeSessionsRef = useRef(activeCallSessions)
  activeSessionsRef.current = activeCallSessions

  const refreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const periodKeysRef = useRef({
    week: telemetryWeekPeriodKey(),
    month: telemetryMonthPeriodKey(),
    day: telemetryLocalDayPeriodKey(),
  })

  const liveLineCount = useMemo(
    () =>
      businessNumbers.filter(
        (line) => isDashboardVisibleLineStatus(line.status) && line.status === "active"
      ).length,
    [businessNumbers]
  )

  const workspaceLineKey = useMemo(
    () =>
      businessNumbers
        .map((line) => normalizeCallEventPhoneDigits(line.number))
        .filter((digits) => digits.length >= 10)
        .sort()
        .join("|"),
    [businessNumbers]
  )

  const workspaceLineSet = useMemo(() => {
    return new Set(workspaceLineKey ? workspaceLineKey.split("|") : [])
  }, [workspaceLineKey])

  const selectedLineDigits = useMemo(
    () => normalizeCallEventPhoneDigits(activeLineE164 ?? ""),
    [activeLineE164]
  )

  const refreshBaseline = useCallback(async () => {
    const orgQs = routingTelemetryQueryString(activeOrganizationId)
    try {
      const res = await fetch(`/api/routing/telemetry${orgQs}`, { credentials: "include", cache: "no-store" })
      if (!res.ok) return
      const json = (await res.json()) as {
        data?: {
          daily_calls?: number
          missed_calls?: number
          hold_path_calls?: number
          daily_talk_seconds?: number
          weekly_talk_seconds?: number
          monthly_talk_seconds?: number
          daily_talk_time_display?: string
          weekly_talk_time_display?: string
          monthly_talk_time_display?: string
          booking_rate_percent?: number
          avg_dispatch_speed_minutes?: number | null
          rescue_revenue_cents?: number
          owner_user_id?: string
        }
      }
      const data = json.data
      if (!data) return
      const parsedDailyTalk =
        Number(data.daily_talk_seconds ?? 0) > 0
          ? Number(data.daily_talk_seconds)
          : parseTalkSecondsFromDisplay(String(data.daily_talk_time_display ?? ""))
      const parsedWeeklyTalk =
        Number(data.weekly_talk_seconds ?? 0) > 0
          ? Number(data.weekly_talk_seconds)
          : parseTalkSecondsFromDisplay(String(data.weekly_talk_time_display ?? ""))
      const parsedMonthlyTalk =
        Number(data.monthly_talk_seconds ?? 0) > 0
          ? Number(data.monthly_talk_seconds)
          : parseTalkSecondsFromDisplay(String(data.monthly_talk_time_display ?? ""))
      const snap: RoutingTelemetrySnapshot = {
        dailyCalls: Number(data.daily_calls ?? 0),
        missedCalls: Number(data.missed_calls ?? 0),
        holdPathCalls: Number(data.hold_path_calls ?? 0),
        dailyTalkSeconds: parsedDailyTalk,
        weeklyTalkSeconds: parsedWeeklyTalk,
        monthlyTalkSeconds: parsedMonthlyTalk,
        bookingRatePercent: Number(data.booking_rate_percent ?? 0),
        avgDispatchSpeedMinutes:
          data.avg_dispatch_speed_minutes == null || !Number.isFinite(Number(data.avg_dispatch_speed_minutes))
            ? null
            : Number(data.avg_dispatch_speed_minutes),
        rescueRevenueCents: Number(data.rescue_revenue_cents ?? 0),
        ownerUserId: data.owner_user_id ? String(data.owner_user_id) : null,
        weekPeriodKey: telemetryWeekPeriodKey(),
        monthPeriodKey: telemetryMonthPeriodKey(),
        localDayPeriodKey: telemetryLocalDayPeriodKey(),
      }
      applySnapshot(
        {
          setDailyCalls,
          setMissedCalls,
          setHoldPathCalls,
          setDailyTalkSeconds,
          setWeeklyTalkSeconds,
          setMonthlyTalkSeconds,
          setBookingRatePercent,
          setAvgDispatchSpeedMinutes,
          setRescueRevenueCents,
          setOwnerUserId,
        },
        snap,
        { mergeTalk: true }
      )
      setBaselineReady(true)
      writeRoutingTelemetryCache(activeOrganizationId, snap)
    } catch {
      /* Keep last values — avoids flashing zeros on transient network errors. */
    }
  }, [activeOrganizationId])

  const scheduleRefreshBaseline = useCallback(() => {
    if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current)
    refreshDebounceRef.current = setTimeout(() => {
      refreshDebounceRef.current = null
      void refreshBaseline()
    }, 500)
  }, [refreshBaseline])

  useEffect(() => {
    const hasAnsweredLeg = activeCallSessions.some((s) => Boolean(s.answeredAt))
    if (!hasAnsweredLeg) return
    const id = window.setInterval(() => setLiveTalkTick((t) => t + 1), 1000)
    return () => window.clearInterval(id)
  }, [activeCallSessions])

  const inProgressTalkSeconds = useMemo(() => {
    void liveTalkTick
    const now = Date.now()
    return activeCallSessions.reduce((sum, session) => {
      if (!session.answeredAt) return sum
      const startMs = new Date(session.answeredAt).getTime()
      if (!Number.isFinite(startMs)) return sum
      return sum + Math.max(0, Math.floor((now - startMs) / 1000))
    }, 0)
  }, [activeCallSessions, liveTalkTick])

  const liveDailyTalkSeconds = dailyTalkSeconds + inProgressTalkSeconds
  const liveWeeklyTalkSeconds = weeklyTalkSeconds + inProgressTalkSeconds
  const liveMonthlyTalkSeconds = monthlyTalkSeconds + inProgressTalkSeconds

  // When useSessionSeed resolves a cache hit (org/cookie lag), copy into live counters.
  useLayoutEffect(() => {
    if (!telemetrySeed) return
    applySnapshot(
      {
        setDailyCalls,
        setMissedCalls,
        setHoldPathCalls,
        setDailyTalkSeconds,
        setWeeklyTalkSeconds,
        setMonthlyTalkSeconds,
        setBookingRatePercent,
        setAvgDispatchSpeedMinutes,
        setRescueRevenueCents,
        setOwnerUserId,
      },
      telemetrySeed
    )
    setBaselineReady(true)
  }, [telemetrySeed])

  // Fetch baseline on org change. Idle-defer only when cache already painted values;
  // cold miss fetches immediately so Rescue/$ metrics are not stuck on "—" / zeros.
  useEffect(() => {
    let cancelled = false
    let idleId: number | undefined
    let timerId: ReturnType<typeof setTimeout> | undefined
    const run = () => {
      if (!cancelled) void refreshBaseline()
    }
    const hasCache = Boolean(
      readRoutingTelemetryCache(activeOrganizationId, undefined, telemetryPaint)
    )
    if (!hasCache) {
      run()
      return () => {
        cancelled = true
      }
    }
    const ric = (
      window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
        cancelIdleCallback?: (id: number) => void
      }
    ).requestIdleCallback
    if (typeof ric === "function") {
      idleId = ric(run, { timeout: 3_000 })
    } else {
      timerId = setTimeout(run, 1_200)
    }
    return () => {
      cancelled = true
      const cic = (
        window as Window & { cancelIdleCallback?: (id: number) => void }
      ).cancelIdleCallback
      if (idleId != null && typeof cic === "function") cic(idleId)
      if (timerId != null) clearTimeout(timerId)
    }
  }, [activeOrganizationId, refreshBaseline])

  useEffect(() => {
    const onRoutingSaved = () => void refreshBaseline()
    window.addEventListener("lyncr-routing-config-changed", onRoutingSaved)
    window.addEventListener("lyncr-workspace-data-changed", onRoutingSaved)
    window.addEventListener("zing-porting-orders-changed", onRoutingSaved)
    return () => {
      window.removeEventListener("lyncr-routing-config-changed", onRoutingSaved)
      window.removeEventListener("lyncr-workspace-data-changed", onRoutingSaved)
      window.removeEventListener("zing-porting-orders-changed", onRoutingSaved)
    }
  }, [refreshBaseline])

  useEffect(() => {
    if (!linesActive) return
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshBaseline()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [refreshBaseline, linesActive])

  useEffect(() => {
    if (!linesActive) return
    const id = window.setInterval(() => {
      const weekKey = telemetryWeekPeriodKey()
      const monthKey = telemetryMonthPeriodKey()
      const dayKey = telemetryLocalDayPeriodKey()
      const prev = periodKeysRef.current
      if (weekKey !== prev.week || monthKey !== prev.month || dayKey !== prev.day) {
        periodKeysRef.current = { week: weekKey, month: monthKey, day: dayKey }
        void refreshBaseline()
      }
    }, 60_000)
    return () => window.clearInterval(id)
  }, [refreshBaseline, linesActive])

  const [engineOwnsRealtime, setEngineOwnsRealtime] = useState(isLyncEngineOwningRealtime)

  useEffect(() => {
    return subscribeLyncEngineBus((event) => {
      if (event.type === "engine-mounted") setEngineOwnsRealtime(true)
      if (event.type === "engine-unmounted") setEngineOwnsRealtime(false)
    })
  }, [])

  useEffect(() => {
    // Shared apply path for bus (engine) and direct Pusher (fallback).
    const applyBusEvent = (event: LyncEngineBusEvent) => {
      if (event.type === "engine-mounted" || event.type === "engine-unmounted") return
      if (event.type === "call-initiated") {
        const raw = event.payload
        const callSid = String(raw.call_sid ?? "").trim()
        if (!callSid) return
        setDailyCalls((prev) => prev + 1)
        setActiveCallSessions((prev) => {
          if (prev.some((s) => s.callSid === callSid)) return prev
          return [
            ...prev,
            {
              callSid,
              toNumberDigits: normalizeCallEventPhoneDigits(raw.to_number),
              answeredAt: null,
            },
          ]
        })
        return
      }
      if (event.type === "call-answered") {
        const raw = event.payload
        const callSid = String(raw.call_sid ?? "").trim()
        if (!callSid) return
        const answeredAt = raw.answered_at ?? new Date().toISOString()
        setActiveCallSessions((prev) => {
          const idx = prev.findIndex((s) => s.callSid === callSid)
          if (idx >= 0) {
            const next = [...prev]
            next[idx] = { ...next[idx], answeredAt }
            return next
          }
          return [
            ...prev,
            {
              callSid,
              toNumberDigits: normalizeCallEventPhoneDigits(raw.to_number),
              answeredAt,
            },
          ]
        })
        return
      }
      if (event.type === "call-completed") {
        const raw = event.payload
        const callSid = String(raw.call_sid ?? "").trim()
        setActiveCallSessions((prev) => prev.filter((s) => s.callSid !== callSid))
        if (isMissedCallTelemetry(raw)) {
          setMissedCalls((prev) => prev + 1)
        } else {
          const routed = String(raw.routed_to_name ?? "").toLowerCase()
          if (
            /hold queue|booked from hold|busy · hold|answered from queue|press 1/.test(routed)
          ) {
            setHoldPathCalls((prev) => prev + 1)
          }
        }
        const talkSec = talkSecondsFromCompletedPayload(raw)
        if (talkSec > 0) {
          setDailyTalkSeconds((prev) => prev + talkSec)
          setWeeklyTalkSeconds((prev) => prev + talkSec)
          setMonthlyTalkSeconds((prev) => prev + talkSec)
        }
        scheduleRefreshBaseline()
      }
    }

    const unsubBus = subscribeLyncEngineBus(applyBusEvent)

    // LyncEngine owns the channel — metrics come only from the bus.
    if (engineOwnsRealtime) {
      setRealtimeConnected(true)
      return () => {
        unsubBus()
      }
    }

    if (!ownerUserId) {
      setRealtimeConnected(false)
      return () => {
        unsubBus()
      }
    }
    const pusher = getPusherClient()
    if (!pusher) {
      setRealtimeConnected(false)
      return () => {
        unsubBus()
      }
    }

    // Account-wide workspace channel (all team members on this business account).
    const channelName = `presence-account-${ownerUserId}`
    const channel = pusher.subscribe(channelName)
    setRealtimeConnected(true)

    const orgId =
      activeOrganizationId && !activeOrganizationId.startsWith("legacy-") ? activeOrganizationId : null

    const eventMatchesWorkspace = (payload: { organization_id?: string | null; to_number?: string | null }) => {
      if (orgId && payload.organization_id && payload.organization_id !== orgId) return false
      if (payload.to_number) {
        const digits = normalizeCallEventPhoneDigits(payload.to_number)
        if (workspaceLineSet.size > 0 && !workspaceLineSet.has(digits)) return false
      }
      return true
    }

    const onCallInitiated = (raw: OwnerCallInitiatedPayload) => {
      if (!eventMatchesWorkspace(raw)) return
      applyBusEvent({ type: "call-initiated", payload: raw })
    }

    const onCallAnswered = (raw: OwnerCallAnsweredPayload) => {
      if (!eventMatchesWorkspace(raw)) return
      applyBusEvent({ type: "call-answered", payload: raw })
    }

    const onCallCompleted = (raw: OwnerCallCompletedPayload) => {
      if (!eventMatchesWorkspace(raw)) return
      applyBusEvent({ type: "call-completed", payload: raw })
    }

    channel.bind("call-initiated", onCallInitiated)
    channel.bind("call-answered", onCallAnswered)
    channel.bind("call-completed", onCallCompleted)
    return () => {
      unsubBus()
      channel.unbind("call-initiated", onCallInitiated)
      channel.unbind("call-answered", onCallAnswered)
      channel.unbind("call-completed", onCallCompleted)
      pusher.unsubscribe(channelName)
      setRealtimeConnected(false)
    }
  }, [ownerUserId, activeOrganizationId, workspaceLineSet, scheduleRefreshBaseline, engineOwnsRealtime])

  useEffect(
    () => () => {
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current)
    },
    []
  )

  const activeCallsOnSelectedLine = useMemo(() => {
    if (!selectedLineDigits) return activeCallSessions.length
    return activeCallSessions.filter(
      (s) => s.toNumberDigits === selectedLineDigits || !s.toNumberDigits
    ).length
  }, [activeCallSessions, selectedLineDigits])

  return useMemo(
    () => ({
      dailyCalls,
      missedCalls,
      holdPathCalls,
      dailyTalkSeconds,
      weeklyTalkSeconds,
      monthlyTalkSeconds,
      liveDailyTalkSeconds,
      liveWeeklyTalkSeconds,
      liveMonthlyTalkSeconds,
      bookingRatePercent,
      avgDispatchSpeedMinutes,
      rescueRevenueCents,
      liveLineCount,
      activeCallsOnSelectedLine,
      activeCallSessions,
      realtimeConnected,
      baselineReady,
      refreshBaseline,
    }),
    [
      dailyCalls,
      missedCalls,
      holdPathCalls,
      dailyTalkSeconds,
      weeklyTalkSeconds,
      monthlyTalkSeconds,
      liveDailyTalkSeconds,
      liveWeeklyTalkSeconds,
      liveMonthlyTalkSeconds,
      bookingRatePercent,
      avgDispatchSpeedMinutes,
      rescueRevenueCents,
      liveLineCount,
      activeCallsOnSelectedLine,
      activeCallSessions,
      realtimeConnected,
      baselineReady,
      refreshBaseline,
    ]
  )
}
