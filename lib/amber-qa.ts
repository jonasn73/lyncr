/**
 * Amber business Q&A — read-only questions answered by SMS.
 *
 * Reuses the exact same data the dashboard already computes (Money, routing telemetry,
 * scheduler) so an answer here can never drift from what the owner sees on screen. Every
 * topic is read-only — no write path, no LLM guessing a number. If a query fails, Amber says
 * so plainly instead of guessing.
 */

import { getOwnerCollectedSummary, formatCollectedDollars } from "@/lib/owner-collected"
import { getDailyCallTelemetryForOwner, listOwnerSchedulerEvents } from "@/lib/db"
import { dayKeyLocal, localDayRangeIso } from "@/lib/scheduler-utils"
import type { AmberWorkspaceRow } from "@/lib/amber-db"

export type AmberQaTopic = "revenue" | "missed_calls" | "next_job"

// Local copy of amber-commands.ts's normalizeAmberSmsBody — kept independent so this file
// (a pure topic matcher + data-lookup) never imports the command parser, avoiding a cycle
// since amber-commands.ts stays free to import Q&A matching if it ever needs to.
function upperNoApostrophe(raw: string): string {
  return raw
    .replace(/[‘’‛`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .replace(/'/g, "")
}

/** True when the owner is asking what they've made / collected today. */
export function isAmberRevenuePhrase(raw: string): boolean {
  const upper = upperNoApostrophe(raw)
  return (
    /HOW MUCH (DID I |HAVE I )?(MAKE|MADE|COLLECT|COLLECTED|EARN|EARNED)/.test(upper) ||
    /WHAT (DID I |HAVE I )?(MAKE|MADE|COLLECT|COLLECTED|EARN|EARNED)/.test(upper) ||
    /HOWS? (MY )?(REVENUE|SALES|MONEY)/.test(upper) ||
    /WHATS? (MY )?REVENUE/.test(upper) ||
    /HOW ARE SALES/.test(upper) ||
    upper === "REVENUE" ||
    upper === "REVENUE TODAY" ||
    upper === "SALES TODAY" ||
    upper === "HOW MUCH TODAY" ||
    upper === "HOW MUCH MONEY TODAY"
  )
}

/** True when the owner is asking about missed / unanswered calls today. */
export function isAmberMissedCallsPhrase(raw: string): boolean {
  const upper = upperNoApostrophe(raw)
  return (
    /ANY MISSED CALLS/.test(upper) ||
    /HOW MANY (MISSED|CALLS)/.test(upper) ||
    /DID I MISS (ANY )?CALLS/.test(upper) ||
    /MISSED CALLS TODAY/.test(upper) ||
    upper === "MISSED CALLS" ||
    upper === "CALLS TODAY"
  )
}

/** True when the owner is asking what's next / today's schedule. */
export function isAmberNextJobPhrase(raw: string): boolean {
  const upper = upperNoApostrophe(raw)
  return (
    /WHATS (MY )?NEXT JOB/.test(upper) ||
    /WHOS (MY )?NEXT JOB/.test(upper) ||
    /WHATS NEXT\b/.test(upper) ||
    /NEXT JOB/.test(upper) ||
    /WHATS (ON )?(MY )?SCHEDULE/.test(upper) ||
    /TODAYS SCHEDULE/.test(upper) ||
    /WHAT DO I HAVE TODAY/.test(upper) ||
    /WHATS COMING UP/.test(upper) ||
    upper === "SCHEDULE" ||
    upper === "SCHEDULE TODAY"
  )
}

/** Match free text against a known Q&A topic, or null when it's not a Q&A question. */
export function matchAmberQaTopic(raw: string): AmberQaTopic | null {
  if (isAmberRevenuePhrase(raw)) return "revenue"
  if (isAmberMissedCallsPhrase(raw)) return "missed_calls"
  if (isAmberNextJobPhrase(raw)) return "next_job"
  return null
}

async function answerAmberRevenue(amber: AmberWorkspaceRow): Promise<string> {
  const summary = await getOwnerCollectedSummary(amber.user_id, amber.timezone)
  if (summary.todayCents <= 0) return "Nothing collected yet today."
  const count = summary.todayCount === 1 ? "1 charge" : `${summary.todayCount} charges`
  return `You've collected ${formatCollectedDollars(summary.todayCents)} today across ${count}.`
}

async function answerAmberMissedCalls(amber: AmberWorkspaceRow): Promise<string> {
  const telemetry = await getDailyCallTelemetryForOwner(
    amber.user_id,
    amber.organization_id,
    amber.timezone
  )
  if (telemetry.missed_calls <= 0) {
    return telemetry.daily_calls > 0
      ? `No missed calls today — all ${telemetry.daily_calls} call${telemetry.daily_calls === 1 ? "" : "s"} answered.`
      : "No calls yet today."
  }
  return `${telemetry.missed_calls} missed call${telemetry.missed_calls === 1 ? "" : "s"} today out of ${telemetry.daily_calls} total.`
}

async function answerAmberNextJob(amber: AmberWorkspaceRow): Promise<string> {
  const dayKey = dayKeyLocal(new Date())
  const { fromIso, toIso } = localDayRangeIso(dayKey, amber.timezone)
  const events = await listOwnerSchedulerEvents({
    ownerUserId: amber.user_id,
    organizationId: amber.organization_id,
    fromIso,
    toIso,
    limit: 50,
  })
  if (events.length === 0) return "Nothing scheduled for today."

  const nowMs = Date.now()
  const upcoming = events
    .filter((ev) => {
      const status = (ev.dispatch_status || ev.job_status || "").trim().toLowerCase()
      if (status === "completed" || status === "cancelled" || status === "canceled") return false
      const t = Date.parse(ev.scheduled_at)
      return Number.isFinite(t) && t >= nowMs
    })
    .sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at))

  if (upcoming.length === 0) return "You're through today's schedule — nothing left."

  const next = upcoming[0]
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: amber.timezone || "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(next.scheduled_at))
  const name = (next.customer_name || "").trim().split(/\s+/)[0] || "Customer"
  const job = (next.summary || next.job_type || "").trim()
  const tech = (next.assigned_tech_name || "").trim()
  const jobPart = job ? ` — ${job}` : ""
  const techPart = tech ? ` (${tech})` : ""
  const extra = upcoming.length - 1
  const more = extra > 0 ? ` +${extra} more today.` : ""
  return `Next up: ${name} at ${time}${jobPart}${techPart}.${more}`
}

/**
 * One-line "Today: ..." snapshot for the morning greeting — compact revenue + missed-calls,
 * so "Hi" reads like a coworker checking in instead of just a leftover-lead nag. Best-effort:
 * a lookup failure just drops that half of the line rather than failing the whole greeting.
 */
export async function buildAmberDailySnapshotLine(amber: AmberWorkspaceRow): Promise<string | null> {
  const [revenue, calls] = await Promise.all([
    getOwnerCollectedSummary(amber.user_id, amber.timezone).catch(() => null),
    getDailyCallTelemetryForOwner(amber.user_id, amber.organization_id, amber.timezone).catch(
      () => null
    ),
  ])
  const parts: string[] = []
  if (revenue) parts.push(formatCollectedDollars(revenue.todayCents))
  if (calls) {
    parts.push(
      calls.missed_calls > 0
        ? `${calls.missed_calls} missed call${calls.missed_calls === 1 ? "" : "s"}`
        : "no missed calls"
    )
  }
  if (parts.length === 0) return null
  return `Today: ${parts.join(", ")}.`
}

/** Answer a matched Q&A topic. Never throws — returns a plain-language failure instead. */
export async function answerAmberQa(params: {
  topic: AmberQaTopic
  amber: AmberWorkspaceRow
}): Promise<string> {
  try {
    if (params.topic === "revenue") return await answerAmberRevenue(params.amber)
    if (params.topic === "missed_calls") return await answerAmberMissedCalls(params.amber)
    return await answerAmberNextJob(params.amber)
  } catch (e) {
    console.warn("[amber-qa] lookup failed:", params.topic, e)
    return "Couldn't pull that up right now — try again in a bit, or check Lyncr."
  }
}
