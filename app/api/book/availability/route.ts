// GET /api/book/availability — public open slots for /book (respects blockouts).

import { NextRequest, NextResponse } from "next/server"
import {
  getUserByPhoneNumber,
  listOwnerSchedulerEvents,
  normalizePhoneNumberE164,
} from "@/lib/db"
import { listAvailableBookSlots } from "@/lib/book-availability"
import { defaultIntakeScheduleDate } from "@/lib/intake-schedule-helpers"
import { listScheduleBlockouts } from "@/lib/schedule-blockouts-db"
import { monthRangeUtc } from "@/lib/scheduler-utils"
import { toE164 } from "@/lib/phone-e164"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  // Business line DID identifies which owner's calendar to show.
  const lineRaw =
    req.nextUrl.searchParams.get("line")?.trim() ||
    req.nextUrl.searchParams.get("to")?.trim() ||
    ""
  const line = lineRaw ? normalizePhoneNumberE164(lineRaw) || toE164(lineRaw) : ""
  if (!line) {
    return NextResponse.json(
      { error: "Pass ?line=+1… with the business phone number." },
      { status: 400 }
    )
  }

  const owner = await getUserByPhoneNumber(line)
  if (!owner) {
    return NextResponse.json({ error: "Unknown business line" }, { status: 404 })
  }

  const now = new Date()
  const range = monthRangeUtc(now.getFullYear(), now.getMonth())
  // Also cover next month when near month-end.
  const nextMonth = monthRangeUtc(
    now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear(),
    (now.getMonth() + 1) % 12
  )
  const fromDate = defaultIntakeScheduleDate(now)
  const ahead = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 21)
  const toDate = defaultIntakeScheduleDate(ahead)

  try {
    const [eventsThis, eventsNext, blockouts] = await Promise.all([
      listOwnerSchedulerEvents({
        ownerUserId: owner.id,
        fromIso: range.from,
        toIso: range.to,
      }),
      listOwnerSchedulerEvents({
        ownerUserId: owner.id,
        fromIso: nextMonth.from,
        toIso: nextMonth.to,
      }),
      listScheduleBlockouts({
        ownerUserId: owner.id,
        fromDate,
        toDate,
      }),
    ])

    const byId = new Map<string, (typeof eventsThis)[number]>()
    for (const ev of [...eventsThis, ...eventsNext]) byId.set(ev.id, ev)
    const events = [...byId.values()]

    const slots = listAvailableBookSlots({
      events,
      blockouts,
      fromDate: now,
      lookaheadDays: 14,
      durationMinutes: 60,
    })

    // Full-day blocked dates for UI “unavailable” badges.
    const blockedDates = [
      ...new Set(blockouts.filter((b) => b.is_full_day).map((b) => b.date)),
    ]

    return NextResponse.json({
      data: {
        business_name: owner.business_name || owner.name || "Lyncr",
        line,
        slots,
        blocked_dates: blockedDates,
        blockouts: blockouts.map((b) => ({
          date: b.date,
          is_full_day: b.is_full_day,
          start_time: b.start_time,
          end_time: b.end_time,
          reason: b.reason,
        })),
      },
    })
  } catch (e) {
    console.error("[GET /api/book/availability]", e)
    return NextResponse.json({ error: "Availability unavailable" }, { status: 500 })
  }
}
