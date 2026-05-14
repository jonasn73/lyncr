// ============================================
// Shared guards for authenticated JSON APIs
// ============================================

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUser } from "@/lib/db"
import type { User } from "@/lib/types"
import { isPlatformAdminUser } from "@/lib/platform-admin"

export type SessionUserContext = { userId: string; user: User }

/** Loads the signed-in user or returns a 401 JSON response. */
export async function requireSessionUser(req: NextRequest): Promise<SessionUserContext | NextResponse> {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  let user = await getUser(userId)
  if (!user && process.env.NODE_ENV === "development" && userId === "dev-user") {
    const devEmail = process.env.DEV_LOGIN_EMAIL?.trim().toLowerCase() ?? "dev@zing.local"
    user = {
      id: "dev-user",
      email: devEmail,
      name: "Dev User",
      phone: "+15551234567",
      business_name: "My Business",
      inbound_receptionist_whisper_enabled: true,
      industry: "generic",
      telnyx_ai_assistant_id: null,
      created_at: new Date().toISOString(),
      credit_balance_cents: 0,
      billing_plan: "trial",
      is_platform_admin: false,
    }
  }
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 401 })
  }
  return { userId, user }
}

/** Session user must be a platform admin (DB flag or `ZING_ADMIN_EMAILS`). */
export async function requirePlatformAdmin(req: NextRequest): Promise<SessionUserContext | NextResponse> {
  const ctx = await requireSessionUser(req)
  if (ctx instanceof NextResponse) return ctx
  if (!isPlatformAdminUser(ctx.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  return ctx
}
