// ============================================
// POST /api/auth/signup
// ============================================
// Creates a user row and routing_config, then sets session cookie.
// When invite_token is present, redeems team_invites and locks account_role receptionist.

import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { acceptTeamInviteSignup, createUser, getUserAccountStatus } from "@/lib/db"
import { defaultProfileFromUserIndustry } from "@/lib/business-industries"
import { signupAccountStatusForBusinessName } from "@/lib/account-status"
import {
  createSessionCookie,
  getSessionCookieName,
  getSessionCookieOptions,
} from "@/lib/auth"
import { postAuthPayload } from "@/lib/post-auth-redirect"
import {
  buildSignupConfirmationEmailPayload,
  sendSignupConfirmationEmail,
} from "@/lib/signup-confirmation-email"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const email = String(body?.email ?? "").trim().toLowerCase()
    const password = String(body?.password ?? "")
    const name = String(body?.name ?? "").trim()
    const phone = String(body?.phone ?? "").trim()
    const business_name = String(body?.business_name ?? "").trim()
    const industry = defaultProfileFromUserIndustry(body?.industry)
    const inviteToken = String(body?.invite_token ?? body?.inviteToken ?? "").trim()

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      )
    }

    const password_hash = await bcrypt.hash(password, 10)

    let user
    if (inviteToken) {
      if (!phone) {
        return NextResponse.json({ error: "Phone is required to complete your receptionist profile" }, { status: 400 })
      }
      const accepted = await acceptTeamInviteSignup({
        token: inviteToken,
        email,
        password_hash,
        phone: normalizePhone(phone),
      })
      user = accepted.user
    } else {
      if (!name || !phone) {
        return NextResponse.json(
          { error: "Email, password, name, and phone are required" },
          { status: 400 }
        )
      }
      const newAccountStatus = signupAccountStatusForBusinessName(business_name || "My Business")
      user = await createUser({
        email,
        name,
        phone: normalizePhone(phone),
        business_name: business_name || "My Business",
        industry,
        password_hash,
        account_role: "owner",
        account_status: newAccountStatus,
      })

      // Confirmation email — never blocks or fails signup; a Resend outage/misconfig just
      // gets logged. Invited receptionists (the acceptTeamInviteSignup branch above) don't
      // get this — they're joining an existing team, not creating a new pending business.
      try {
        const payload = buildSignupConfirmationEmailPayload({
          toEmail: email,
          name,
          businessName: business_name || "My Business",
          status: newAccountStatus,
        })
        const result = await sendSignupConfirmationEmail(payload)
        if (!result.sent) {
          console.error("[lyncr] Signup confirmation email not sent:", result.error)
        }
      } catch (e) {
        console.error("[lyncr] Signup confirmation email threw:", e instanceof Error ? e.message : e)
      }
    }

    const accountStatus = await getUserAccountStatus(user.id)
    const cookieValue = createSessionCookie(user.id)
    const authMeta = postAuthPayload(user, accountStatus)
    const res = NextResponse.json({
      data: { user, ...authMeta },
    })
    res.cookies.set(getSessionCookieName(), cookieValue, getSessionCookieOptions())
    return res
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes("Invite")) {
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      )
    }
    if (msg.includes("DATABASE_URL is not set")) {
      return NextResponse.json(
        { error: "Database not configured. Add DATABASE_URL in Vercel → Settings → Environment Variables." },
        { status: 500 }
      )
    }
    if (msg.includes("does not exist") || (msg.includes("relation") && msg.includes("users"))) {
      return NextResponse.json(
        { error: "Database schema missing. In Neon SQL Editor run: 001-create-schema.sql then 002-add-password-hash.sql" },
        { status: 500 }
      )
    }
    if (msg.includes("industry") && (msg.includes("column") || msg.includes("does not exist"))) {
      return NextResponse.json(
        {
          error:
            "Database needs migration: in Neon SQL Editor run scripts/011-user-industry.sql (adds industry for AI scripts).",
        },
        { status: 500 }
      )
    }
    console.error("[lyncr] Signup error:", error)
    const safeMessage =
      process.env.NODE_ENV === "development" ? msg || "Failed to create account" : "Failed to create account"
    return NextResponse.json(
      { error: safeMessage },
      { status: 500 }
    )
  }
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  return phone.startsWith("+") ? phone : `+${digits}`
}
