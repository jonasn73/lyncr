// ============================================
// GET  /api/tech/setup?token=…  — validate an invite token (for the setup page)
// POST /api/tech/setup          — set password, activate the tech, sign them in
// ============================================

import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { createSessionCookie, getSessionCookieName, getSessionCookieOptions } from "@/lib/auth"
import { activateTechInviteStub, getTechInviteStubByToken } from "@/lib/tech-invite-stub"
import {
  buildTeamMemberConfirmationEmailPayload,
  sendSignupConfirmationEmail,
} from "@/lib/signup-confirmation-email"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim() || ""
  if (!token) return NextResponse.json({ data: { valid: false } })
  try {
    const stub = await getTechInviteStubByToken(token)
    if (!stub) return NextResponse.json({ data: { valid: false } })
    return NextResponse.json({
      data: { valid: true, name: stub.name, businessName: stub.businessName },
    })
  } catch (e) {
    console.error("[GET /api/tech/setup] failed:", e)
    return NextResponse.json({ data: { valid: false } })
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { token?: string; password?: string }
  const token = String(body.token || "").trim()
  const password = String(body.password || "")

  if (!token) return NextResponse.json({ error: "Missing setup link token" }, { status: 400 })
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 })
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10)
    const stub = await activateTechInviteStub({ token, passwordHash })
    if (!stub) {
      return NextResponse.json(
        { error: "This setup link is invalid or has expired. Ask your dispatcher to resend it." },
        { status: 410 }
      )
    }

    // Confirmation fires at activation (not invite-send, which is the SMS text) — only if a
    // real email was captured on the invite form.
    if (stub.contactEmail) {
      try {
        const payload = buildTeamMemberConfirmationEmailPayload({
          toEmail: stub.contactEmail,
          name: stub.name,
          role: "field_tech",
        })
        const result = await sendSignupConfirmationEmail(payload)
        if (!result.sent) {
          console.error("[POST /api/tech/setup] confirmation email not sent:", result.error)
        }
      } catch (e) {
        console.error("[POST /api/tech/setup] confirmation email threw:", e instanceof Error ? e.message : e)
      }
    }

    // Sign the tech straight in so they land on their console without a separate login step.
    const res = NextResponse.json({ data: { redirect: "/tech/dashboard" } })
    res.cookies.set(getSessionCookieName(), createSessionCookie(stub.userId), getSessionCookieOptions())
    return res
  } catch (e) {
    console.error("[POST /api/tech/setup] failed:", e)
    const msg = e instanceof Error ? e.message : ""
    if (msg.includes("SESSION_SECRET")) {
      return NextResponse.json(
        { error: "Server misconfiguration: SESSION_SECRET is not set. Add it in Vercel → Environment Variables." },
        { status: 500 }
      )
    }
    return NextResponse.json({ error: "Could not complete setup" }, { status: 500 })
  }
}
