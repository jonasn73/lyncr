// ============================================
// POST /api/auth/logout
// ============================================
// Clears the session cookie (and legacy zing_session if present).

import { NextResponse } from "next/server"
import {
  getSessionCookieName,
  getLegacySessionCookieName,
  getLogoutCookieClearOptions,
} from "@/lib/auth"

export async function POST() {
  const res = NextResponse.json({ data: { ok: true } })
  const clear = getLogoutCookieClearOptions()
  res.cookies.set(getSessionCookieName(), "", clear)
  res.cookies.set(getLegacySessionCookieName(), "", clear)
  return res
}
