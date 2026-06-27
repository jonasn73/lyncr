"use client"

// Shared React hook: owner-dashboard call metrics + live in-progress tracking via Pusher.
// One baseline REST read on mount/org change; all live updates are event-driven (no interval polling).

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import {
  isDashboardVisibleLineStatus,
  type DashboardBusinessNumber,
} from "@/lib/dashboard-routing-utils"
import {
  emptyRoutingTelemetrySnapshot,
  readRoutingTelemetryCache,
  writeRoutingTelemetryCache,
  type RoutingTelemetrySnapshot,
} from "@/lib/routing-telemetry-cache"
import type {
  OwnerCallCompletedPayload,
  OwnerCallInitiatedPayload,
} from "@/lib/realtime/owner-call-event-types"
import {
  isMissedCallTelemetry,
  normalizeCallEventPhoneDigits,
  talkSecondsFromCompletedPayload,
} from "@/lib/realtime/owner-call-event-types"
import { getPusherClient } from "@/lib/realtime/pusher-client"
import { organizationQueryString } from "@/lib/workspace-organizations"

/** Tracks one ringing/connected leg until call-completed removes it. */
export type ActiveCallSession = {
  callSid: string
  toNumberDigits: string
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
  /** Count of provisioned active phone lines (static until numbers list changes). */
  liveLineCount: number
  /** In-progress calls on the selected line (drives Step 1 badge). */
  activeCallsOnSelectedLine: number
  /** All in-progress calls across workspace lines (any line in businessNumbers). */
  activeCallSessions: ActiveCallSession[]
  /** True when Pusher client + owner channel subscription is active. */
  realtimeConnected: boolean
  /** One-shot baseline sync (mount, org switch, routing config saved). */
  refreshBaseline: () => Promise<void>
}

function applySnapshot(setters: {
  setDailyCalls: (n: number) => void
  setMissedCalls: (n: number) => void
  setDailyTalkSeconds: (n: number) => void
  setWeeklyTalkSeconds: (n: number) => void
  setOwnerUserId: (id: string | null) => void
}, snap: RoutingTelemetrySnapshot) {
  setters.setDailyCalls(snap.dailyCalls)
  setters.setMissedCalls(snap.missedCalls)
  setters.setDailyTalkSeconds(snap.dailyTalkSeconds)
  setters.setWeeklyTalkSeconds(snap.weeklyTalkSeconds)
  setters.setOwnerUserId(snap.ownerUserId)
}

export function useRealTimeStats(options: UseRealTimeStatsOptions): UseRealTimeStatsResult {
  const { businessNumbers, activeLineE164 } = options
  const { activeOrganizationId } = useDashboardWorkspace()

  const cachedMetrics = useMemo(
    () => readRoutingTelemetryCache(activeOrganizationId) ?? emptyRoutingTelemetrySnapshot(),
    [activeOrganizationId]
  )

  const [dailyCalls, setDailyCalls] = useState(cachedMetrics.dailyCalls)
  const [missedCalls, setMissedCalls] = useState(cachedMetrics.missedCalls)
  const [dailyTalkSeconds, setDailyTalkSeconds] = useState(cachedMetrics.dailyTalkSeconds)
  const [weeklyTalkSeconds, setWeeklyTalkSeconds] = useState(cachedMetrics.weeklyTalkSeconds)
  const [ownerUserId, setOwnerUserId] = useState<string | null>(cachedMetrics.ownerUserId)
  const [activeCallSessions, setActiveCallSessions] = useState<ActiveCallSession[]>([])
  const [realtimeConnected, setRealtimeConnected] = useState(false)

  const activeSessionsRef = useRef(activeCallSessions)
  activeSessionsRef.current = activeCallSessions

  const liveLineCount = useMemo(
    () =>
      businessNumbers.filter(
        (line) => isDashboardVisibleLineStatus(line.status) && line.status === "active"
      ).length,
    [businessNumbers]
  )

  const workspaceLineSet = useMemo(() => {
    return new Set(
      businessNumbers
        .map((line) => normalizeCallEventPhoneDigits(line.number))
        .filter((digits) => digits.length >= 10)
    )
  }, [businessNumbers])

  const selectedLineDigits = useMemo(
    () => normalizeCallEventPhoneDigits(activeLineE164 ?? ""),
    [activeLineE164]
  )

  const refreshBaseline = useCallback(async () => {
    const orgQs = organizationQueryString(activeOrganizationId)
    try {
      const res = await fetch(`/api/routing/telemetry${orgQs}`, { credentials: "include", cache: "no-store" })
      if (!res.ok) return
      const json = (await res.json()) as {
        data?: {
          daily_calls?: number
          missed_calls?: number
          daily_talk_seconds?: number
          weekly_talk_seconds?: number
          owner_user_id?: string
        }
      }
      const data = json.data
      if (!data) return
      const snap: RoutingTelemetrySnapshot = {
        dailyCalls: Number(data.daily_calls ?? 0),
        missedCalls: Number(data.missed_calls ?? 0),
        dailyTalkSeconds: Number(data.daily_talk_seconds ?? 0),
        weeklyTalkSeconds: Number(data.weekly_talk_seconds ?? 0),
        ownerUserId: data.owner_user_id ? String(data.owner_user_id) : null,
      }
      applySnapshot(
        { setDailyCalls, setMissedCalls, setDailyTalkSeconds, setWeeklyTalkSeconds, setOwnerUserId },
        snap
      )
      writeRoutingTelemetryCache(activeOrganizationId, snap)
    } catch {
      /* Keep last values — avoids flashing zeros on transient network errors. */
    }
  }, [activeOrganizationId])

  useEffect(() => {
    const snap = readRoutingTelemetryCache(activeOrganizationId) ?? emptyRoutingTelemetrySnapshot()
    applySnapshot(
      { setDailyCalls, setMissedCalls, setDailyTalkSeconds, setWeeklyTalkSeconds, setOwnerUserId },
      snap
    )
    void refreshBaseline()
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
    if (!ownerUserId) {
      setRealtimeConnected(false)
      return
    }
    const pusher = getPusherClient()
    if (!pusher) {
      setRealtimeConnected(false)
      return
    }

    const channelName = `owner-${ownerUserId}`
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
          },
        ]
      })
    }

    const onCallCompleted = (raw: OwnerCallCompletedPayload) => {
      if (!eventMatchesWorkspace(raw)) return
      const callSid = String(raw.call_sid ?? "").trim()
      setActiveCallSessions((prev) => prev.filter((s) => s.callSid !== callSid))
      if (isMissedCallTelemetry(raw)) {
        setMissedCalls((prev) => prev + 1)
      }
      const talkSec = talkSecondsFromCompletedPayload(raw)
      if (talkSec > 0) {
        setDailyTalkSeconds((prev) => prev + talkSec)
        setWeeklyTalkSeconds((prev) => prev + talkSec)
      }
    }

    channel.bind("call-initiated", onCallInitiated)
    channel.bind("call-completed", onCallCompleted)
    return () => {
      channel.unbind("call-initiated", onCallInitiated)
      channel.unbind("call-completed", onCallCompleted)
      pusher.unsubscribe(channelName)
      setRealtimeConnected(false)
    }
  }, [ownerUserId, activeOrganizationId, workspaceLineSet])

  const activeCallsOnSelectedLine = useMemo(() => {
    if (!selectedLineDigits) return activeCallSessions.length
    return activeCallSessions.filter(
      (s) => s.toNumberDigits === selectedLineDigits || !s.toNumberDigits
    ).length
  }, [activeCallSessions, selectedLineDigits])

  return {
    dailyCalls,
    missedCalls,
    dailyTalkSeconds,
    weeklyTalkSeconds,
    liveLineCount,
    activeCallsOnSelectedLine,
    activeCallSessions,
    realtimeConnected,
    refreshBaseline,
  }
}
