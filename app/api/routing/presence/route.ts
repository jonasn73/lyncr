// GET/PUT /api/routing/presence — Lines dashboard presence toggle .

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  getAccountPresence,
  isManualPresenceLock,
  normalizePresenceStatus,
  setAccountPresence,
  type PresenceStatus,
} from "@/lib/account-presence"
import {
  getAccountWeeklyHours,
  shortTimezoneLabel,
  summarizeWeeklyHours,
} from "@/lib/account-weekly-hours"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const [presence, weeklyHours] = await Promise.all([
      getAccountPresence(userId),
      getAccountWeeklyHours(userId),
    ])
    return NextResponse.json({
      data: {
        presence_status: presence.presenceStatus,
        presenceClosedManual: presence.presenceClosedManual,
        presence_closed_manual: presence.presenceClosedManual,
        // Busy-until is no longer set by anything; kept null for the client contract.
        presence_available_at: null,
        presence_timezone: null,
        // True when a manual Busy/Closed tap is blocking the weekly auto-schedule.
        presence_locked: isManualPresenceLock(presence.presenceStatus, presence.presenceClosedManual),
        schedule_enabled: weeklyHours.scheduleEnabled,
        schedule_summary: summarizeWeeklyHours(weeklyHours),
        schedule_timezone_label: shortTimezoneLabel(weeklyHours.timezone),
      },
    })
  } catch (e) {
    console.error("[GET /api/routing/presence]", e)
    return NextResponse.json({
      data: {
        presence_status: "AVAILABLE",
        presence_closed_manual: false,
        presence_available_at: null,
        presence_timezone: null,
        presence_locked: false,
        schedule_enabled: false,
        schedule_summary: "Off — manual only",
        schedule_timezone_label: null,
      },
    })
  }
}

export async function PUT(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const raw = body.presence_status ?? body.presenceStatus ?? body.status
  const status = normalizePresenceStatus(raw) as PresenceStatus
  if (!["AVAILABLE", "ON_JOB", "CLOSED"].includes(String(raw ?? "").toUpperCase().replace(/-/g, "_")) &&
      raw != null &&
      String(raw).trim() !== "") {
    // Still accept aliases via normalizePresenceStatus; only reject empty.
  }

  try {
    const [saved, weeklyHours] = await Promise.all([
      setAccountPresence({
        ownerUserId: userId,
        presenceStatus: status,
      }),
      getAccountWeeklyHours(userId),
    ])
    return NextResponse.json({
      data: {
        presence_status: saved.presenceStatus,
        presenceClosedManual: saved.presenceClosedManual,
        presence_closed_manual: saved.presenceClosedManual,
        presence_available_at: null,
        presence_timezone: null,
        presence_locked: isManualPresenceLock(saved.presenceStatus, saved.presenceClosedManual),
        schedule_enabled: weeklyHours.scheduleEnabled,
        schedule_summary: summarizeWeeklyHours(weeklyHours),
        schedule_timezone_label: shortTimezoneLabel(weeklyHours.timezone),
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Save failed"
    const code = e instanceof Error && "code" in e ? String((e as { code?: string }).code) : ""
    if (code === "PRESENCE_MIGRATION_REQUIRED" || msg.includes("092-account-presence")) {
      return NextResponse.json(
        { error: msg, migration: "scripts/092-account-presence-status.sql" },
        { status: 503 }
      )
    }
    console.error("[PUT /api/routing/presence]", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
