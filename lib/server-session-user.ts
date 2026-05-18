// ============================================
// Server-only: resolve signed-in User from cookies
// ============================================
// Used by app layouts that must gate before rendering (admin, dashboard, home).

import { cookies } from "next/headers"
import { verifySessionCookie, getSessionCookieName } from "@/lib/auth"
import { getUser } from "@/lib/db"
import type { User } from "@/lib/types"

/** Returns the current user row, or null if missing/invalid session. Dev-user stub matches admin layout. */
export async function getSessionUser(): Promise<User | null> {
  const cookieStore = await cookies()
  const raw = cookieStore.get(getSessionCookieName())?.value
  const userId = verifySessionCookie(raw)
  if (!userId) return null
  if (process.env.NODE_ENV === "development" && userId === "dev-user") {
    const devEmail = process.env.DEV_LOGIN_EMAIL?.trim().toLowerCase() ?? "dev@zing.local"
    return {
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
  try {
    return await getUser(userId)
  } catch (e) {
    console.error("[getSessionUser] getUser failed:", e)
    return null
  }
}
