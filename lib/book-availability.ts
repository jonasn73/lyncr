// Shared availability math for /book + APIs — jobs + schedule_blockouts.

import {
  defaultIntakeScheduleDate,
  findScheduleConflicts,
  scheduleTimeSlotOptions,
  suggestNextOpenTime,
} from "@/lib/intake-schedule-helpers"
import { isDateFullyBlocked } from "@/lib/schedule-blockouts"
import type { ScheduleBlockout, SchedulerEvent } from "@/lib/types"

export type BookableSlot = {
  dateKey: string
  timeValue: string
  label: string
  scheduledAtIso: string
}

/** List open 1-hour slots across lookahead days, skipping full-day / overlapping blockouts. */
export function listAvailableBookSlots(params: {
  events: readonly SchedulerEvent[]
  blockouts: readonly ScheduleBlockout[]
  fromDate?: Date
  lookaheadDays?: number
  durationMinutes?: number
  startHour?: number
  endHour?: number
}): BookableSlot[] {
  const now = params.fromDate ?? new Date()
  const lookaheadDays = params.lookaheadDays ?? 14
  const durationMinutes = params.durationMinutes ?? 60
  const startHourDefault = params.startHour ?? 7
  const endHour = params.endHour ?? 19
  const events = [...params.events]
  const blockouts = params.blockouts
  const out: BookableSlot[] = []

  for (let offset = 0; offset < lookaheadDays; offset += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, 0, 0, 0, 0)
    if (day.getDay() === 0) continue

    const dateKey = defaultIntakeScheduleDate(day)
    if (isDateFullyBlocked(blockouts, dateKey)) continue

    let startHour = startHourDefault
    if (offset === 0) {
      const nowHour = now.getHours()
      const nowMinute = now.getMinutes()
      startHour = Math.max(startHourDefault, nowMinute > 0 ? nowHour + 1 : nowHour)
      if (startHour >= endHour) continue
    }

    for (const slot of scheduleTimeSlotOptions(startHour, endHour, 60)) {
      if (
        findScheduleConflicts(
          events,
          dateKey,
          slot.value,
          durationMinutes,
          null,
          null,
          blockouts
        ).length > 0
      ) {
        continue
      }
      const local = `${dateKey}T${slot.value}:00`
      const when = new Date(local)
      if (Number.isNaN(when.getTime())) continue
      out.push({
        dateKey,
        timeValue: slot.value,
        label: `${dateKey} · ${slot.label}`,
        scheduledAtIso: when.toISOString(),
      })
    }
  }

  return out
}

/** Next single open slot (same rules as IVR / Smart Overflow). */
export function nextAvailableBookSlot(params: {
  events: readonly SchedulerEvent[]
  blockouts: readonly ScheduleBlockout[]
  fromDate?: Date
}): BookableSlot | null {
  const now = params.fromDate ?? new Date()
  for (let offset = 0; offset < 14; offset += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, 0, 0, 0, 0)
    if (day.getDay() === 0) continue
    const dateKey = defaultIntakeScheduleDate(day)
    let startHour = 7
    if (offset === 0) {
      startHour = Math.max(7, now.getMinutes() > 0 ? now.getHours() + 1 : now.getHours())
      if (startHour >= 19) continue
    }
    const timeValue = suggestNextOpenTime(
      [...params.events],
      dateKey,
      60,
      null,
      null,
      startHour,
      19,
      params.blockouts
    )
    if (!timeValue) continue
    const when = new Date(`${dateKey}T${timeValue}:00`)
    if (Number.isNaN(when.getTime())) continue
    return {
      dateKey,
      timeValue,
      label: `${dateKey} · ${timeValue}`,
      scheduledAtIso: when.toISOString(),
    }
  }
  return null
}
