// GET /api/cron/sync-presence — every 5 minutes: calendar blockout → ON_JOB, else AVAILABLE.
// Skips owners who manually locked CLOSED.

import { NextRequest, NextResponse } from "next/server"
import {
  applyCalendarPresenceAutomation,
  listOwnersForPresenceCron,
} from "@/lib/account-presence"
import { listScheduleBlockoutsForDate } from "@/lib/schedule-blockouts-db"
import {
  localDateTimePartsInZone,
  resolveInboundCalendarOverride,
} from "@/lib/schedule-blockouts"
import { INBOUND_CAPTURE_TIMEZONE } from "@/lib/inbound-time-capture"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  if (secret) {
    const auth = req.headers.get("authorization") || ""
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  const now = new Date()
  const parts = localDateTimePartsInZone(now, INBOUND_CAPTURE_TIMEZONE)

  try {
    const owners = await listOwnersForPresenceCron()
    let scanned = 0
    let updated = 0
    let skippedClosed = 0
    const details: {
      user_id: string
      in_blockout: boolean
      presence_status: string
      updated: boolean
      skipped_closed_manual?: boolean
    }[] = []

    for (const ownerUserId of owners) {
      scanned += 1
      const blockouts = await listScheduleBlockoutsForDate({
        ownerUserId,
        dateKey: parts.dateKey,
      })
      const override = resolveInboundCalendarOverride(
        blockouts,
        now,
        INBOUND_CAPTURE_TIMEZONE
      )
      const inBlockout = override != null
      const result = await applyCalendarPresenceAutomation({
        ownerUserId,
        currentlyInBlockout: inBlockout,
      })
      if (result.skippedClosedManual) skippedClosed += 1
      if (result.updated) updated += 1
      details.push({
        user_id: ownerUserId,
        in_blockout: inBlockout,
        presence_status: result.presenceStatus,
        updated: result.updated,
        skipped_closed_manual: result.skippedClosedManual,
      })
    }

    return NextResponse.json({
      data: {
        scanned,
        updated,
        skipped_closed_manual: skippedClosed,
        date_key: parts.dateKey,
        time: parts.timeHhMm,
        details,
      },
    })
  } catch (e) {
    console.error("[GET /api/cron/sync-presence]", e)
    return NextResponse.json({ error: "Presence sync failed" }, { status: 500 })
  }
}
