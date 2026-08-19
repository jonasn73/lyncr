// ============================================
// Shared guards for authenticated JSON APIs
// ============================================

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { isShopAccountUsable, shopQueueLockPayload } from "@/lib/account-status"
import { getUser, getUserAccountStatus } from "@/lib/db"
import type { User } from "@/lib/types"
import { isLyncrAdminUser } from "@/lib/lyncr-admin"
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
      account_role: "owner" as const,
    }
  }
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 401 })
  }
  if (!isLyncrAdminUser(user) && !isPlatformAdminUser(user)) {
    const accountStatus = await getUserAccountStatus(userId)
    if (!isShopAccountUsable(accountStatus)) {
      return NextResponse.json(shopQueueLockPayload(accountStatus), { status: 403 })
    }
  }
  return { userId, user }
}

/** Block pending/denied shops from buying numbers and finishing onboarding. */
export async function rejectIfShopNotUsable(userId: string): Promise<NextResponse | null> {
  const accountStatus = await getUserAccountStatus(userId)
  if (isShopAccountUsable(accountStatus)) return null
  return NextResponse.json(shopQueueLockPayload(accountStatus), { status: 403 })
}

/** Session user must be admin@lyncr.app. */
export async function requireLyncrAdmin(req: NextRequest): Promise<SessionUserContext | NextResponse> {
  const ctx = await requireSessionUser(req)
  if (ctx instanceof NextResponse) return ctx
  if (!isLyncrAdminUser(ctx.user)) {
    console.warn("[lyncr-admin] forbidden API access:", ctx.user.email)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  return ctx
}

/** @deprecated Alias — use requireLyncrAdmin. */
export async function requirePlatformAdmin(req: NextRequest): Promise<SessionUserContext | NextResponse> {
  return requireLyncrAdmin(req)
}
