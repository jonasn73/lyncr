// GET/PUT /api/routing/ivr-capacity — confirmed-jobs auto-bypass threshold.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  getAccountPresence,
  setAccountIvrCapacityThreshold,
} from "@/lib/account-presence"
import { SMART_OVERFLOW_DEFAULT_CAPACITY_THRESHOLD } from "@/lib/smart-overflow-autopilot"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const presence = await getAccountPresence(userId)
    return NextResponse.json({
      data: {
        ivrCapacityThreshold: presence.ivrCapacityThreshold,
        ivr_capacity_threshold: presence.ivrCapacityThreshold,
      },
    })
  } catch (e) {
    console.error("[GET /api/routing/ivr-capacity]", e)
    return NextResponse.json({
      data: {
        ivrCapacityThreshold: SMART_OVERFLOW_DEFAULT_CAPACITY_THRESHOLD,
        ivr_capacity_threshold: SMART_OVERFLOW_DEFAULT_CAPACITY_THRESHOLD,
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

  const raw = body.ivrCapacityThreshold ?? body.ivr_capacity_threshold ?? body.capacityThreshold
  const n = typeof raw === "number" ? raw : Number(raw)
  if (!Number.isFinite(n)) {
    return NextResponse.json({ error: "ivr_capacity_threshold must be a number" }, { status: 400 })
  }

  try {
    const saved = await setAccountIvrCapacityThreshold({
      ownerUserId: userId,
      ivrCapacityThreshold: n,
    })
    return NextResponse.json({
      data: {
        ivrCapacityThreshold: saved.ivrCapacityThreshold,
        ivr_capacity_threshold: saved.ivrCapacityThreshold,
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Save failed"
    const code = e instanceof Error && "code" in e ? String((e as { code?: string }).code) : ""
    if (code === "IVR_CAPACITY_MIGRATION_REQUIRED" || msg.includes("102-ivr-capacity")) {
      return NextResponse.json(
        { error: msg, migration: "scripts/102-ivr-capacity-threshold.sql" },
        { status: 503 }
      )
    }
    console.error("[PUT /api/routing/ivr-capacity]", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
