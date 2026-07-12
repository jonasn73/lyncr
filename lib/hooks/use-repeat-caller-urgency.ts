"use client"

// Load today's call activity and resolve repeat-caller high-urgency state for the intake sheet.

import { useEffect, useMemo, useState } from "react"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import type { UiCallRecord } from "@/lib/hooks/use-operations-data"
import {
  resolveRepeatCallerUrgency,
  type RepeatCallerLogInput,
  type RepeatCallerUrgency,
} from "@/lib/repeat-caller-urgency"

function uiCallToLog(call: UiCallRecord): RepeatCallerLogInput {
  return {
    id: call.id,
    from_number: call.callerNumber,
    callerNumber: call.callerNumber,
    created_at: call.createdAt,
    createdAt: call.createdAt,
    call_type: call.rawCallType || call.type,
    rawCallType: call.rawCallType,
    type: call.type,
    status: call.callStatus,
    callStatus: call.callStatus,
    answered_at: call.answeredAt,
    answeredAt: call.answeredAt,
    ended_at: call.endedAt,
    endedAt: call.endedAt,
  }
}

function apiCallToLog(call: Record<string, unknown>): RepeatCallerLogInput | null {
  const id = String(call.id ?? "").trim()
  if (!id) return null
  return {
    id,
    from_number: call.from_number != null ? String(call.from_number) : null,
    created_at: call.created_at != null ? String(call.created_at) : null,
    call_type: call.call_type != null ? String(call.call_type) : null,
    status: call.status != null ? String(call.status) : null,
    answered_at: call.answered_at != null ? String(call.answered_at) : null,
    ended_at: call.ended_at != null ? String(call.ended_at) : null,
  }
}

const EMPTY: RepeatCallerUrgency = {
  attemptCount: 1,
  previousMissedCount: 0,
  minutesSinceLastMissed: null,
  lastMissedAt: null,
  isHighUrgency: false,
}

export function useRepeatCallerUrgency(
  phoneNumber: string,
  excludeCallId?: string | null
): RepeatCallerUrgency {
  const { activityLogs } = useDashboardWorkspace()
  const [fetchedLogs, setFetchedLogs] = useState<RepeatCallerLogInput[] | null>(null)

  // Prefer in-memory activity feed; fall back to a light /api/calls scan.
  useEffect(() => {
    const digits = phoneNumber.replace(/\D/g, "")
    if (digits.length < 7) {
      setFetchedLogs(null)
      return
    }
    if (activityLogs.length > 0) {
      setFetchedLogs(null)
      return
    }

    let cancelled = false
    void fetch("/api/calls?limit=100", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("calls"))))
      .then((json: { calls?: Record<string, unknown>[] }) => {
        if (cancelled) return
        const rows = Array.isArray(json.calls) ? json.calls : []
        setFetchedLogs(rows.map(apiCallToLog).filter((r): r is RepeatCallerLogInput => r != null))
      })
      .catch(() => {
        if (!cancelled) setFetchedLogs([])
      })

    return () => {
      cancelled = true
    }
  }, [phoneNumber, activityLogs.length])

  return useMemo(() => {
    const phone = phoneNumber.trim()
    if (!phone) return EMPTY
    const logs: RepeatCallerLogInput[] =
      activityLogs.length > 0
        ? activityLogs.map(uiCallToLog)
        : fetchedLogs ?? []
    return resolveRepeatCallerUrgency(phone, logs, { excludeCallId })
  }, [phoneNumber, excludeCallId, activityLogs, fetchedLogs])
}
