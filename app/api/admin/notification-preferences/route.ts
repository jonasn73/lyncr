// GET/PATCH /api/admin/notification-preferences — platform admin only.
//
// Was gated on the raw users.is_platform_admin column while every other /api/admin/*
// route (and /admin itself) gates on requireLyncrAdmin's email allowlist — two admin
// grants that don't necessarily agree on who's an admin. Aligned to the same check
// everything else uses so a user can't be an admin here but not anywhere else, or
// vice versa.

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { updateAdminNotificationPreference } from "@/lib/db"
import {
  isAdminNotificationPreferenceKey,
  resolveAdminNotificationPreferences,
} from "@/lib/admin-notification-preferences"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  return NextResponse.json({
    data: {
      preferences: resolveAdminNotificationPreferences(ctx.user),
    },
  })
}

export async function PATCH(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  let body: { key?: unknown; enabled?: unknown }
  try {
    body = (await req.json()) as { key?: unknown; enabled?: unknown }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (!isAdminNotificationPreferenceKey(body.key)) {
    return NextResponse.json({ error: "Invalid preference key" }, { status: 400 })
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 })
  }

  try {
    const preferences = await updateAdminNotificationPreference(ctx.userId, body.key, body.enabled)
    return NextResponse.json({ data: { preferences } })
  } catch (e) {
    console.error("[admin/notification-preferences PATCH]", e)
    const message = e instanceof Error ? e.message : "Could not save preference"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
