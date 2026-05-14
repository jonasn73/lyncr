// ============================================
// POST /api/auth/logout
// ============================================
// Clears the session cookie.

import { NextResponse } from "next/server"
import { getSessionCookieName, getLogoutCookieClearOptions } from "@/lib/auth"

export async function POST() {
  const res = NextResponse.json({ data: { ok: true } })
  res.cookies.set(getSessionCookieName(), "", getLogoutCookieClearOptions())
  return res
}
