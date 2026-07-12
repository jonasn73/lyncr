"use client"

// Global line-state engine — one owner-channel Pusher sub for ring/answer/miss/complete.

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
import { useDashboardSessionOptional } from "@/components/dashboard-session-context"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { resolveCallerContext, type CallerContextMatch } from "@/lib/caller-context-engine"
import { clearOperationsDataCache } from "@/lib/hooks/use-operations-data"
import {
  emitLyncEngineBus,
  LYNCR_ACTIVITY_REFRESH_EVENT,
  LYNCR_FOCUS_INTAKE_EVENT,
  setLyncEngineOwningRealtime,
  type LyncFocusIntakeDetail,
} from "@/lib/lync-engine-bus"
import type { LyncEngineCall, LyncEnginePublicState, LyncLinePhase } from "@/lib/lync-engine-types"
import type {
  OwnerCallAnsweredPayload,
  OwnerCallCompletedPayload,
  OwnerCallInitiatedPayload,
} from "@/lib/realtime/owner-call-event-types"
import {
  isMissedCallTelemetry,
  normalizeCallEventPhoneDigits,
} from "@/lib/realtime/owner-call-event-types"
import { getPusherClient } from "@/lib/realtime/pusher-client"
import type { SchedulerPhoneLookupResult } from "@/lib/types"

const LyncEngineContext = createContext<LyncEnginePublicState | null>(null)

const ACTIVITY_BADGE_KEY = "lyncr-activity-badge-count"

function readBadgeCount(): number {
  if (typeof window === "undefined") return 0
  try {
    const n = Number(sessionStorage.getItem(ACTIVITY_BADGE_KEY) ?? "0")
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
  } catch {
    return 0
  }
}

function writeBadgeCount(n: number): void {
  if (typeof window === "undefined") return
  try {
    if (n <= 0) sessionStorage.removeItem(ACTIVITY_BADGE_KEY)
    else sessionStorage.setItem(ACTIVITY_BADGE_KEY, String(n))
  } catch {
    /* ignore */
  }
}

async function fetchCallerContext(
  phone: string,
  organizationId: string | null
): Promise<CallerContextMatch> {
  const orgQs =
    organizationId && !organizationId.startsWith("legacy-")
      ? `&organization_id=${encodeURIComponent(organizationId)}`
      : ""
  try {
    const res = await fetch(
      `/api/owner/scheduler/lookup?phone=${encodeURIComponent(phone)}${orgQs}`,
      { credentials: "include", cache: "no-store" }
    )
    if (!res.ok) return resolveCallerContext(phone, { pool: [], scheduled: [] })
    const json = (await res.json()) as { data?: SchedulerPhoneLookupResult }
    return resolveCallerContext(phone, json.data ?? { pool: [], scheduled: [] })
  } catch {
    return resolveCallerContext(phone, { pool: [], scheduled: [] })
  }
}

function pickPrimary(calls: LyncEngineCall[]): LyncEngineCall | null {
  if (calls.length === 0) return null
  // Prefer connected legs, then most recently added ringing.
  const connected = calls.filter((c) => c.phase === "connected")
  if (connected.length > 0) return connected[connected.length - 1]
  return calls[calls.length - 1]
}

export function LyncEngineProvider({ children }: { children: ReactNode }) {
  const session = useDashboardSessionOptional()
  const { businessNumbers, activeOrganizationId, activeTab } = useDashboardWorkspace()
  const ownerUserId = session?.companyUserId?.trim() || null

  const [activeCalls, setActiveCalls] = useState<LyncEngineCall[]>([])
  const [activityBadgeCount, setActivityBadgeCount] = useState(0)
  const [realtimeConnected, setRealtimeConnected] = useState(false)

  const activeCallsRef = useRef(activeCalls)
  activeCallsRef.current = activeCalls

  const workspaceLineSet = useMemo(() => {
    return new Set(
      businessNumbers
        .map((line) => normalizeCallEventPhoneDigits(line.number))
        .filter((digits) => digits.length >= 10)
    )
  }, [businessNumbers])

  // Hydrate badge from sessionStorage once on mount.
  useEffect(() => {
    setActivityBadgeCount(readBadgeCount())
  }, [])

  // Clear Activities badge when the user opens that tab.
  useEffect(() => {
    if (activeTab !== "activity") return
    setActivityBadgeCount(0)
    writeBadgeCount(0)
  }, [activeTab])

  const bumpActivityBadge = useCallback(() => {
    setActivityBadgeCount((prev) => {
      const next = prev + 1
      writeBadgeCount(next)
      return next
    })
  }, [])

  const clearActivityBadge = useCallback(() => {
    setActivityBadgeCount(0)
    writeBadgeCount(0)
  }, [])

  const focusIntake = useCallback(() => {
    const call = pickPrimary(activeCallsRef.current)
    if (!call) return
    const detail: LyncFocusIntakeDetail = {
      callSid: call.callSid,
      callLogId: call.callLogId,
      fromNumber: call.fromNumber,
      toNumber: call.toNumber,
      phase: call.phase,
      answeredAt: call.answeredAt,
    }
    window.dispatchEvent(new CustomEvent(LYNCR_FOCUS_INTAKE_EVENT, { detail }))
  }, [])

  // Mark engine as owning realtime so useRealTimeStats skips its Pusher sub.
  useEffect(() => {
    setLyncEngineOwningRealtime(true)
    return () => setLyncEngineOwningRealtime(false)
  }, [])

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
      activeOrganizationId && !activeOrganizationId.startsWith("legacy-")
        ? activeOrganizationId
        : null

    const eventMatchesWorkspace = (payload: {
      organization_id?: string | null
      to_number?: string | null
    }) => {
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
      const fromNumber = String(raw.from_number ?? "").trim()
      const toNumber = String(raw.to_number ?? "").trim()
      const callLogId = raw.call_log_id ? String(raw.call_log_id).trim() : null

      // Fan out metric increment to RealTimeStats via the bus.
      emitLyncEngineBus({ type: "call-initiated", payload: raw })

      setActiveCalls((prev) => {
        if (prev.some((c) => c.callSid === callSid)) return prev
        return [
          ...prev,
          {
            callSid,
            callLogId,
            fromNumber,
            toNumber,
            organizationId: raw.organization_id ?? null,
            phase: "ringing",
            answeredAt: null,
            callerContext: fromNumber
              ? resolveCallerContext(fromNumber, { pool: [], scheduled: [] })
              : null,
            lookupLoading: Boolean(fromNumber),
          },
        ]
      })

      // Prefetch CRM / scheduler match into global overlay state.
      if (fromNumber) {
        void fetchCallerContext(fromNumber, orgId).then((ctx) => {
          setActiveCalls((prev) =>
            prev.map((c) =>
              c.callSid === callSid ? { ...c, callerContext: ctx, lookupLoading: false } : c
            )
          )
        })
      }
    }

    const onCallAnswered = (raw: OwnerCallAnsweredPayload) => {
      if (!eventMatchesWorkspace(raw)) return
      const callSid = String(raw.call_sid ?? "").trim()
      if (!callSid) return
      const answeredAt = raw.answered_at ?? new Date().toISOString()
      emitLyncEngineBus({ type: "call-answered", payload: raw })

      setActiveCalls((prev) => {
        const idx = prev.findIndex((c) => c.callSid === callSid)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = {
            ...next[idx],
            phase: "connected",
            answeredAt,
            callLogId: raw.call_log_id || next[idx].callLogId,
            fromNumber: raw.from_number || next[idx].fromNumber,
            toNumber: raw.to_number || next[idx].toNumber,
          }
          return next
        }
        return [
          ...prev,
          {
            callSid,
            callLogId: raw.call_log_id,
            fromNumber: raw.from_number,
            toNumber: String(raw.to_number ?? ""),
            organizationId: raw.organization_id ?? null,
            phase: "connected",
            answeredAt,
            callerContext: resolveCallerContext(raw.from_number, { pool: [], scheduled: [] }),
            lookupLoading: true,
          },
        ]
      })

      const from = String(raw.from_number ?? "").trim()
      if (from) {
        void fetchCallerContext(from, orgId).then((ctx) => {
          setActiveCalls((prev) =>
            prev.map((c) =>
              c.callSid === callSid ? { ...c, callerContext: ctx, lookupLoading: false } : c
            )
          )
        })
      }
    }

    const onCallCompleted = (raw: OwnerCallCompletedPayload) => {
      if (!eventMatchesWorkspace(raw)) return
      const callSid = String(raw.call_sid ?? "").trim()
      emitLyncEngineBus({ type: "call-completed", payload: raw })
      setActiveCalls((prev) => prev.filter((c) => c.callSid !== callSid))

      if (isMissedCallTelemetry(raw)) {
        bumpActivityBadge()
        clearOperationsDataCache()
        window.dispatchEvent(new CustomEvent(LYNCR_ACTIVITY_REFRESH_EVENT))
      }
    }

    channel.bind("call-initiated", onCallInitiated)
    channel.bind("call-answered", onCallAnswered)
    channel.bind("call-completed", onCallCompleted)

    return () => {
      channel.unbind("call-initiated", onCallInitiated)
      channel.unbind("call-answered", onCallAnswered)
      channel.unbind("call-completed", onCallCompleted)
      pusher.unsubscribe(channelName)
      setRealtimeConnected(false)
    }
  }, [ownerUserId, activeOrganizationId, workspaceLineSet, bumpActivityBadge])

  const primaryCall = useMemo(() => pickPrimary(activeCalls), [activeCalls])

  const linePhase: LyncLinePhase = primaryCall
    ? primaryCall.phase === "connected"
      ? "connected"
      : "ringing"
    : "idle"

  const value = useMemo<LyncEnginePublicState>(
    () => ({
      primaryCall,
      activeCalls,
      linePhase,
      activityBadgeCount,
      realtimeConnected,
      clearActivityBadge,
      focusIntake,
    }),
    [
      primaryCall,
      activeCalls,
      linePhase,
      activityBadgeCount,
      realtimeConnected,
      clearActivityBadge,
      focusIntake,
    ]
  )

  return <LyncEngineContext.Provider value={value}>{children}</LyncEngineContext.Provider>
}

export function useLyncEngine(): LyncEnginePublicState {
  const ctx = useContext(LyncEngineContext)
  if (!ctx) {
    throw new Error("useLyncEngine must be used within LyncEngineProvider")
  }
  return ctx
}

export function useLyncEngineOptional(): LyncEnginePublicState | null {
  return useContext(LyncEngineContext)
}
