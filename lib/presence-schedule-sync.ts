// Shared "what should Presence be right now" logic — calendar blockout wins,
// then the weekly auto-schedule. Used by the 5-min sync-presence cron AND by
// the dashboard when an owner saves/enables a schedule, so it applies
// immediately instead of waiting for the next cron tick.

import { listScheduleBlockoutsForDate } from "@/lib/schedule-blockouts-db"
import { localDateTimePartsInZone, resolveInboundCalendarOverride } from "@/lib/schedule-blockouts"
import { INBOUND_CAPTURE_TIMEZONE } from "@/lib/inbound-time-capture"
import { getAccountWeeklyHours, isWithinScheduledHours } from "@/lib/account-weekly-hours"
import {
  applyScheduleNowClearingLock,
  type AccountPresence,
  type PresenceStatus,
} from "@/lib/account-presence"

export async function computeScheduledPresenceStatus(
  ownerUserId: string,
  now: Date = new Date()
): Promise<PresenceStatus> {
  const parts = localDateTimePartsInZone(now, INBOUND_CAPTURE_TIMEZONE)
  const blockouts = await listScheduleBlockoutsForDate({ ownerUserId, dateKey: parts.dateKey })
  const override = resolveInboundCalendarOverride(blockouts, now, INBOUND_CAPTURE_TIMEZONE)
  if (override != null) return "ON_JOB"
  const weeklyHours = await getAccountWeeklyHours(ownerUserId)
  return isWithinScheduledHours(weeklyHours, now) ? "AVAILABLE" : "CLOSED"
}

/**
 * Apply the schedule right now, clearing any manual Busy/Closed lock.
 * Call this after the owner enables/saves a weekly schedule from the dashboard.
 */
export async function syncPresenceFromScheduleNow(
  ownerUserId: string,
  now: Date = new Date()
): Promise<AccountPresence> {
  const desiredStatus = await computeScheduledPresenceStatus(ownerUserId, now)
  return applyScheduleNowClearingLock({ ownerUserId, desiredStatus })
}
