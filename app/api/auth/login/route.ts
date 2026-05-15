// ============================================
// POST /api/auth/login
// ============================================
// Verifies email/password, sets session cookie.

import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { getAuthUserByEmail } from "@/lib/db"
import {
  createSessionCookie,
  getSessionCookieName,
  getSessionCookieOptions,
} from "@/lib/auth"
import { isPlatformAdminUser } from "@/lib/platform-admin"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const email = String(body?.email ?? "").trim().toLowerCase()
    const password = String(body?.password ?? "")

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      )
    }

    // Optional: dev login when database is not connected (set DEV_LOGIN_EMAIL + DEV_LOGIN_PASSWORD in .env.local)
    const devEmail = process.env.DEV_LOGIN_EMAIL?.trim().toLowerCase()
    const devPassword = process.env.DEV_LOGIN_PASSWORD
    if (process.env.NODE_ENV === "development" && devEmail && devPassword && email === devEmail && password === devPassword) {
      const devUser = {
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
      const cookieValue = createSessionCookie(devUser.id)
      const res = NextResponse.json({
        data: { user: devUser, operator_access: isPlatformAdminUser(devUser) },
      })
      res.cookies.set(getSessionCookieName(), cookieValue, getSessionCookieOptions())
      return res
    }

    const authUser = await getAuthUserByEmail(email)
    if (!authUser) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      )
    }

    const ok = await bcrypt.compare(password, authUser.password_hash)
    if (!ok) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      )
    }

    const { password_hash: _, ...user } = authUser
    const cookieValue = createSessionCookie(user.id)
    const res = NextResponse.json({
      data: { user, operator_access: isPlatformAdminUser(user) },
    })
    res.cookies.set(getSessionCookieName(), cookieValue, getSessionCookieOptions())
    return res
  } catch (error) {
    console.error("[Zing] Login error:", error)
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes("SESSION_SECRET")) {
      return NextResponse.json(
        {
          error:
            "Server misconfiguration: SESSION_SECRET must be set in production. Add it in Vercel → Environment Variables.",
        },
        { status: 500 }
      )
    }
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    )
  }
}
