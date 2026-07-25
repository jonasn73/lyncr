// Helpers for the Lines “Today” command center (missed callbacks + live jobs).

import { isMissedCallTodayRecord } from "@/lib/missed-call-telemetry"
import {
  isPausedJobStatus,
  schedulerJobStatusDisplayLabel,
  schedulerLifecyclePhase,
} from "@/lib/scheduler-job-status"
import { dayKeyLocal, localDayRangeIso } from "@/lib/scheduler-utils"
import type { CallLog, DispatchJob, SchedulerEvent } from "@/lib/types"

/** One missed / unanswered caller the owner should call or text back. */
export type TodayCallbackItem = {
  id: string
  callerName: string
  callerNumber: string
  targetLineE164: string
  createdAt: string
  routedTo: string | null
}

/** Active or upcoming job row for the Today board. */
export type TodayJobItem = {
  id: string
  customerName: string | null
  customerPhone: string | null
  location: string | null
  summary: string | null
  jobStatus: string | null
  statusLabel: string
  assignedTechName: string | null
  assignedTechId: string | null
  scheduledAt: string | null
  /** Review SMS link was opened (tracked /rv/ token). */
  reviewLinkOpened?: boolean
  reviewLinkClicks?: number
}

/** Payload returned by GET /api/owner/today. */
export type TodayBoardPayload = {
  needsYou: TodayCallbackItem[]
  now: TodayJobItem[]
  upNext: TodayJobItem[]
  justFinished: TodayJobItem[]
  dayKey: string
}

/** Field statuses that belong in the “Now” section. */
const NOW_STATUSES = new Set(["en_route", "arrived", "paused_wait", "paused_parts"])

/** Local calendar day bounds for “today” queries. */
export function todayLocalRangeIso(now: Date = new Date()): { dayKey: string; fromIso: string; toIso: string } {
  const dayKey = dayKeyLocal(now)
  const range = localDayRangeIso(dayKey)
  return { dayKey, fromIso: range.fromIso, toIso: range.toIso }
}

/** Short relative time like “12m ago” for callback rows. */
export function formatTimeAgo(iso: string, now: Date = new Date()): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ""
  const mins = Math.max(0, Math.round((now.getTime() - t) / 60_000))
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/** Deduped missed calls from today (newest first, max `limit`). */
export function buildTodayCallbacks(calls: CallLog[], limit = 5, now: Date = new Date()): TodayCallbackItem[] {
  const seen = new Set<string>()
  const out: TodayCallbackItem[] = []
  for (const call of calls) {
    if (
      !isMissedCallTodayRecord(
        {
          call_type: call.call_type,
          status: call.status,
          routed_to_name: call.routed_to_name,
          answered_at: call.answered_at,
          ended_at: call.ended_at,
          duration_seconds: call.duration_seconds,
          created_at: call.created_at,
        },
        now
      )
    ) {
      continue
    }
    const phone = (call.from_number || "").trim()
    if (!phone) continue
    const key = phone.replace(/\D/g, "")
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      id: call.id,
      callerName: (call.caller_name || "").trim() || "Unknown caller",
      callerNumber: phone,
      targetLineE164: call.to_number || "",
      createdAt: call.created_at,
      routedTo: call.routed_to_name,
    })
    if (out.length >= limit) break
  }
  return out
}

function jobLabel(status: string | null | undefined): string {
  return schedulerJobStatusDisplayLabel(status) || "Scheduled"
}

function fromDispatchJob(job: DispatchJob): TodayJobItem {
  return {
    id: job.id,
    customerName: job.customer_name,
    customerPhone: job.customer_phone,
    location: job.location,
    summary: job.summary,
    jobStatus: job.job_status,
    statusLabel: jobLabel(job.job_status),
    assignedTechName: job.assigned_tech_name,
    assignedTechId: job.assigned_tech_id,
    scheduledAt: null,
  }
}

function fromSchedulerEvent(ev: SchedulerEvent): TodayJobItem {
  return {
    id: ev.id,
    customerName: ev.customer_name,
    customerPhone: ev.customer_phone,
    location: ev.location,
    summary: ev.summary || ev.job_type,
    jobStatus: ev.job_status,
    statusLabel: jobLabel(ev.job_status),
    assignedTechName: ev.assigned_tech_name,
    assignedTechId: ev.assigned_tech_id,
    scheduledAt: ev.scheduled_at,
  }
}

/** Live / paused jobs for the “Now” section. */
export function buildTodayNowJobs(activeJobs: DispatchJob[], limit = 8): TodayJobItem[] {
  return activeJobs
    .filter((j) => NOW_STATUSES.has((j.job_status ?? "").trim().toLowerCase()) || isPausedJobStatus(j.job_status))
    .slice(0, limit)
    .map(fromDispatchJob)
}

/** Next scheduled jobs today that are not already in “Now”. */
export function buildTodayUpNextJobs(
  dayEvents: SchedulerEvent[],
  nowIds: Set<string>,
  limit = 3,
  now: Date = new Date()
): TodayJobItem[] {
  const nowMs = now.getTime()
  const candidates = dayEvents.filter((ev) => {
    if (nowIds.has(ev.id)) return false
    const phase = schedulerLifecyclePhase({
      job_status: ev.job_status,
      dispatch_status: ev.dispatch_status,
      assigned_tech_id: ev.assigned_tech_id,
    })
    if (phase === "completed" || phase === "en_route" || phase === "on_site" || phase === "paused") {
      return false
    }
    return true
  })
  candidates.sort((a, b) => {
    const aT = Date.parse(a.scheduled_at || a.created_at) || 0
    const bT = Date.parse(b.scheduled_at || b.created_at) || 0
    // Prefer upcoming (future) slots, then soonest first.
    const aFuture = aT >= nowMs ? 0 : 1
    const bFuture = bT >= nowMs ? 0 : 1
    if (aFuture !== bFuture) return aFuture - bFuture
    return aT - bT
  })
  return candidates.slice(0, limit).map(fromSchedulerEvent)
}

/** Jobs completed today for the optional “Just finished” strip. */
export function buildTodayJustFinishedJobs(dayEvents: SchedulerEvent[], limit = 3): TodayJobItem[] {
  const done = dayEvents.filter((ev) => (ev.job_status ?? "").trim().toLowerCase() === "completed")
  done.sort((a, b) => {
    const aT = Date.parse(a.scheduled_at || a.created_at) || 0
    const bT = Date.parse(b.scheduled_at || b.created_at) || 0
    return bT - aT
  })
  return done.slice(0, limit).map(fromSchedulerEvent)
}
