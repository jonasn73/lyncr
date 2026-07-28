// GET/PUT /api/routing/smart-busy — Smart Busy preference (+ optional capacity snapshot).

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  getAccountPresence,
  setAccountSmartBusyEnabled,
} from "@/lib/account-presence"
import { listOwnerSchedulerEvents, listOwnerUnassignedPoolJobs } from "@/lib/db"
import { countConfirmedJobsOnDay } from "@/lib/smart-overflow-autopilot"
import {
  computeCapacityLoad,
  isAtCapacity,
  shouldRecommendBusy,
} from "@/lib/smart-busy"
import { defaultIntakeScheduleDate } from "@/lib/intake-schedule-helpers"
import { monthRangeUtc } from "@/lib/scheduler-utils"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function capacitySnapshot(ownerUserId: string, organizationId: string | null) {
  const presence = await getAccountPresence(ownerUserId)
  const now = new Date()
  const todayKey = defaultIntakeScheduleDate(now)
  const range = monthRangeUtc(now.getFullYear(), now.getMonth())

  let confirmedJobsToday = 0
  let poolCount = 0
  try {
    const events = await listOwnerSchedulerEvents({
      ownerUserId,
      fromIso: range.from,
      toIso: range.to,
      organizationId,
    })
    confirmedJobsToday = countConfirmedJobsOnDay(events, todayKey)
  } catch {
    confirmedJobsToday = 0
  }
  try {
    const pool = await listOwnerUnassignedPoolJobs({
      ownerUserId,
      organizationId,
      limit: 100,
    })
    poolCount = pool.length
  } catch {
    poolCount = 0
  }

  const capacityLoad = computeCapacityLoad({ confirmedJobsToday, poolCount })
  const atCapacity = isAtCapacity(capacityLoad, presence.ivrCapacityThreshold)

  return {
    smart_busy_enabled: presence.smartBusyEnabled,
    smartBusyEnabled: presence.smartBusyEnabled,
    presence_status: presence.presenceStatus,
    ivr_capacity_threshold: presence.ivrCapacityThreshold,
    confirmed_jobs_today: confirmedJobsToday,
    pool_count: poolCount,
    capacity_load: capacityLoad,
    at_capacity: atCapacity,
    recommend_busy: shouldRecommendBusy({
      atCapacity,
      presenceStatus: presence.presenceStatus,
    }),
  }
}

function orgIdFromRequest(req: NextRequest): string | null {
  const raw = req.nextUrl.searchParams.get("organization_id")?.trim() || null
  if (!raw || raw.startsWith("legacy-")) return null
  return raw
}

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const data = await capacitySnapshot(userId, orgIdFromRequest(req))
    return NextResponse.json({ data })
  } catch (e) {
    console.error("[GET /api/routing/smart-busy]", e)
    return NextResponse.json({ error: "Failed to load Smart Busy" }, { status: 500 })
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

  const raw = body.smartBusyEnabled ?? body.smart_busy_enabled ?? body.enabled
  if (typeof raw !== "boolean") {
    return NextResponse.json({ error: "smart_busy_enabled must be a boolean" }, { status: 400 })
  }

  try {
    const saved = await setAccountSmartBusyEnabled({
      ownerUserId: userId,
      smartBusyEnabled: raw,
    })
    const snap = await capacitySnapshot(userId, orgIdFromRequest(req))
    return NextResponse.json({
      data: {
        ...snap,
        smart_busy_enabled: saved.smartBusyEnabled,
        smartBusyEnabled: saved.smartBusyEnabled,
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Save failed"
    const code = e instanceof Error && "code" in e ? String((e as { code?: string }).code) : ""
    if (code === "SMART_BUSY_MIGRATION_REQUIRED" || msg.includes("121-smart-busy")) {
      return NextResponse.json(
        { error: msg, migration: "scripts/121-smart-busy-enabled.sql" },
        { status: 503 }
      )
    }
    console.error("[PUT /api/routing/smart-busy]", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
