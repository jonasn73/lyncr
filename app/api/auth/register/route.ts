// POST /api/auth/register — complete a receptionist profile from an invite token.
// Creates the users + receptionists rows (linked), sets a sip_username placeholder, marks the
// invite ACCEPTED, then signs the new receptionist in (session cookie).
//
// Body: { token, full_name, phone, password, email? }
//   - email is taken from the invite for EMAIL invites; required here for SMS invites.

import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { acceptReceptionistInviteRegistration } from "@/lib/db"
import {
  createSessionCookie,
  getSessionCookieName,
  getSessionCookieOptions,
} from "@/lib/auth"
import { postAuthPayload } from "@/lib/post-auth-redirect"

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const token = String(body.token ?? "").trim()
    const fullName = String(body.full_name ?? body.fullName ?? body.name ?? "").trim()
    const phone = String(body.phone ?? "").trim()
    const password = String(body.password ?? "")
    const email = String(body.email ?? "").trim()

    if (!token) return NextResponse.json({ error: "Missing invitation token" }, { status: 400 })
    if (fullName.length < 2) return NextResponse.json({ error: "Enter your full name" }, { status: 400 })
    if (!phone) return NextResponse.json({ error: "Enter your cell phone number" }, { status: 400 })
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 })
    }

    const password_hash = await bcrypt.hash(password, 10)

    const { user } = await acceptReceptionistInviteRegistration({
      token,
      full_name: fullName,
      phone,
      password_hash,
      email: email || null,
    })

    const cookieValue = createSessionCookie(user.id)
    const authMeta = postAuthPayload(user)
    const res = NextResponse.json({ data: { user, ...authMeta } })
    res.cookies.set(getSessionCookieName(), cookieValue, getSessionCookieOptions())
    return res
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes("Invite")) return NextResponse.json({ error: msg }, { status: 400 })
    if (msg.includes("email is required")) return NextResponse.json({ error: msg }, { status: 400 })
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 })
    }
    console.error("[lyncr] register:", error)
    return NextResponse.json({ error: "Failed to complete registration" }, { status: 500 })
  }
}
