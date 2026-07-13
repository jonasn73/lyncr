// GET list / POST create — owner schedule blockouts.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { validateBlockoutInput } from "@/lib/schedule-blockouts"
import {
  createScheduleBlockout,
  listScheduleBlockouts,
} from "@/lib/schedule-blockouts-db"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const fromDate = req.nextUrl.searchParams.get("from")?.trim() || ""
  const toDate = req.nextUrl.searchParams.get("to")?.trim() || ""
  const organizationId = req.nextUrl.searchParams.get("organization_id")?.trim() || null

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    return NextResponse.json({ error: "from and to must be YYYY-MM-DD" }, { status: 400 })
  }

  try {
    const blockouts = await listScheduleBlockouts({
      ownerUserId: userId,
      fromDate,
      toDate,
      organizationId,
    })
    return NextResponse.json({ data: blockouts })
  } catch (e) {
    console.error("[GET /api/owner/scheduler/blockouts]", e)
    return NextResponse.json({ error: "Failed to load blockouts" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const date = typeof body.date === "string" ? body.date.trim() : ""
  const isFullDay =
    body.isFullDay === true ||
    body.is_full_day === true ||
    body.isFullDay === "true"
  const startTime =
    typeof body.startTime === "string"
      ? body.startTime
      : typeof body.start_time === "string"
        ? body.start_time
        : null
  const endTime =
    typeof body.endTime === "string"
      ? body.endTime
      : typeof body.end_time === "string"
        ? body.end_time
        : null
  const reason =
    typeof body.reason === "string"
      ? body.reason
      : null
  const organizationId =
    typeof body.organization_id === "string"
      ? body.organization_id
      : typeof body.organizationId === "string"
        ? body.organizationId
        : null

  const validated = validateBlockoutInput({
    date,
    isFullDay,
    startTime,
    endTime,
    reason,
  })
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 })
  }

  try {
    const created = await createScheduleBlockout({
      ownerUserId: userId,
      organizationId,
      date,
      isFullDay,
      startTime,
      endTime,
      reason,
    })
    return NextResponse.json({ data: created })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Create failed"
    const code = e instanceof Error && "code" in e ? String((e as { code?: string }).code) : ""
    if (code === "BLOCKOUT_MIGRATION_REQUIRED") {
      return NextResponse.json(
        { error: msg, migration: "scripts/088-schedule-blockouts.sql" },
        { status: 503 }
      )
    }
    console.error("[POST /api/owner/scheduler/blockouts]", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
