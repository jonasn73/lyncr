// ============================================
// POST /api/push/register
// ============================================
// Mobile app registers (or refreshes) its Expo push token for missed/live call alerts.
// Protected: requires session. See scripts/175-device-push-tokens.sql.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { upsertDevicePushToken } from "@/lib/db"

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  try {
    const body = await req.json()
    const token = String(body?.token ?? "").trim()
    const platform = String(body?.platform ?? "").trim()
    if (!token || (platform !== "ios" && platform !== "android")) {
      return NextResponse.json(
        { error: "token and platform ('ios' | 'android') are required" },
        { status: 400 }
      )
    }
    await upsertDevicePushToken({ userId, platform, expoPushToken: token })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[push] register error:", error)
    return NextResponse.json({ error: "Failed to register push token" }, { status: 500 })
  }
}
