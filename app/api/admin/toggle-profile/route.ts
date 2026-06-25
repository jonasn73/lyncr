// PUT /api/admin/toggle-profile — platform admin only (is_platform_admin = true).

import { NextRequest, NextResponse } from "next/server"
import { requireSessionUser } from "@/lib/admin-api-guard"
import { updateMasterToggleMode } from "@/lib/db"
import type { MasterToggleMode } from "@/lib/types"

export const dynamic = "force-dynamic"

const MODES: MasterToggleMode[] = ["tech", "admin", "passive"]

function parseMode(raw: unknown): MasterToggleMode | null {
  const v = String(raw ?? "").trim()
  return MODES.includes(v as MasterToggleMode) ? (v as MasterToggleMode) : null
}

export async function PUT(req: NextRequest) {
  const ctx = await requireSessionUser(req)
  if (ctx instanceof NextResponse) return ctx

  if (!ctx.user.is_platform_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  let body: { mode?: unknown }
  try {
    body = (await req.json()) as { mode?: unknown }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const mode = parseMode(body.mode)
  if (!mode) {
    return NextResponse.json(
      { error: "mode must be one of: tech, admin, passive" },
      { status: 400 }
    )
  }

  try {
    await updateMasterToggleMode(ctx.userId, mode)
    return NextResponse.json({ data: { master_toggle_mode: mode } })
  } catch (e) {
    console.error("[admin/toggle-profile PUT]", e)
    const message = e instanceof Error ? e.message : "Could not save toggle profile"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const ctx = await requireSessionUser(req)
  if (ctx instanceof NextResponse) return ctx

  if (!ctx.user.is_platform_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  return NextResponse.json({
    data: { master_toggle_mode: ctx.user.master_toggle_mode ?? "admin" },
  })
}
