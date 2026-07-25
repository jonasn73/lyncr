// GET /api/owner/today — missed callbacks + active / upcoming / finished jobs for Lines Today.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getCallLogs, listOwnerBookedJobs, listOwnerSchedulerEvents } from "@/lib/db"
import {
  buildTodayCallbacks,
  buildTodayJustFinishedJobs,
  buildTodayNowJobs,
  buildTodayUpNextJobs,
  todayLocalRangeIso,
  type TodayBoardPayload,
} from "@/lib/today-board"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const now = new Date()
  const { dayKey, fromIso, toIso } = todayLocalRangeIso(now)

  try {
    const [calls, activeJobs, dayEvents] = await Promise.all([
      getCallLogs(userId, { limit: 40 }),
      listOwnerBookedJobs(userId, 50, { activeOnly: true }),
      listOwnerSchedulerEvents({
        ownerUserId: userId,
        fromIso,
        toIso,
        limit: 80,
      }),
    ])

    const needsYou = buildTodayCallbacks(calls, 5, now)
    const nowJobs = buildTodayNowJobs(activeJobs, 8)
    const nowIds = new Set(nowJobs.map((j) => j.id))
    const upNext = buildTodayUpNextJobs(dayEvents, nowIds, 3, now)
    const justFinished = buildTodayJustFinishedJobs(dayEvents, 3)

    const data: TodayBoardPayload = {
      needsYou,
      now: nowJobs,
      upNext,
      justFinished,
      dayKey,
    }

    return NextResponse.json({ data })
  } catch (e) {
    console.error("[GET /api/owner/today]", e)
    return NextResponse.json({ error: "Could not load Today board" }, { status: 500 })
  }
}
