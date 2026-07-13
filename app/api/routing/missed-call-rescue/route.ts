// GET/PUT users.missed_call_textback_enabled for Lines Missed Call Rescue.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  getMissedCallTextbackEnabled,
  isMissingMissedCallTextbackColumn,
  MISSED_CALL_TEXTBACK_MIGRATION,
  setMissedCallTextbackEnabled,
} from "@/lib/missed-call-textback"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    const missed_call_textback_enabled = await getMissedCallTextbackEnabled(userId)
    return NextResponse.json({ data: { missed_call_textback_enabled } })
  } catch (e) {
    if (isMissingMissedCallTextbackColumn(e)) {
      return NextResponse.json({
        data: { missed_call_textback_enabled: true },
        migration: MISSED_CALL_TEXTBACK_MIGRATION,
      })
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 })
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

  const enabled =
    body.missed_call_textback_enabled === true ||
    body.missedCallTextbackEnabled === true ||
    body.enabled === true
  const explicitlyOff =
    body.missed_call_textback_enabled === false ||
    body.missedCallTextbackEnabled === false ||
    body.enabled === false
  const next = explicitlyOff ? false : enabled

  try {
    await setMissedCallTextbackEnabled(userId, next)
    return NextResponse.json({ data: { missed_call_textback_enabled: next } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Save failed"
    return NextResponse.json(
      {
        error: msg,
        migration: isMissingMissedCallTextbackColumn(e)
          ? MISSED_CALL_TEXTBACK_MIGRATION
          : undefined,
      },
      { status: 503 }
    )
  }
}
