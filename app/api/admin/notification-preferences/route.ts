// GET/PATCH /api/admin/notification-preferences — platform admin only (is_platform_admin = true).

import { NextRequest, NextResponse } from "next/server"
import { requireSessionUser } from "@/lib/admin-api-guard"
import { updateAdminNotificationPreference } from "@/lib/db"
import {
  isAdminNotificationPreferenceKey,
  resolveAdminNotificationPreferences,
} from "@/lib/admin-notification-preferences"

export const dynamic = "force-dynamic"

function forbidden() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 })
}

export async function GET(req: NextRequest) {
  const ctx = await requireSessionUser(req)
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.user.is_platform_admin) return forbidden()

  return NextResponse.json({
    data: {
      preferences: resolveAdminNotificationPreferences(ctx.user),
    },
  })
}

export async function PATCH(req: NextRequest) {
  const ctx = await requireSessionUser(req)
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.user.is_platform_admin) return forbidden()

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
