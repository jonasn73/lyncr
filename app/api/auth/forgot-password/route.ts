// POST /api/auth/forgot-password — email a time-limited reset link if the account exists.
//
// SECURITY: the response must never reveal whether the email matched an account, or contain
// the reset token/URL — both would let anyone take over an account they only know the email
// for. Always return the same generic message and deliver the link by email instead.

import { NextRequest, NextResponse } from "next/server"
import { getAuthUserByEmail, userFacingDatabaseError } from "@/lib/db"
import { createPasswordResetToken } from "@/lib/password-reset-token"
import { getAppUrl } from "@/lib/telnyx"
import { buildPasswordResetEmailPayload, sendPasswordResetEmail } from "@/lib/password-reset-email"

const GENERIC_RESPONSE = {
  ok: true,
  message: "If an account exists for that email, we've sent a link to reset your password.",
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const email = String(body?.email ?? "").trim().toLowerCase()
    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 })
    }

    const authUser = await getAuthUserByEmail(email)
    if (!authUser) {
      return NextResponse.json(GENERIC_RESPONSE)
    }

    const token = createPasswordResetToken(authUser.id)
    const base = getAppUrl().replace(/\/$/, "")
    const resetUrl = `${base}/reset-password?token=${encodeURIComponent(token)}`

    const payload = buildPasswordResetEmailPayload({
      toEmail: authUser.email,
      name: authUser.name,
      resetUrl,
    })
    const result = await sendPasswordResetEmail(payload)
    if (!result.sent) {
      console.error("[lyncr] forgot-password: email not sent", { userId: authUser.id, error: result.error })
    }

    return NextResponse.json(GENERIC_RESPONSE)
  } catch (error) {
    console.error("[lyncr] forgot-password:", error)
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes("SESSION_SECRET")) {
      return NextResponse.json(
        { error: "Server misconfiguration: SESSION_SECRET is missing in production." },
        { status: 500 }
      )
    }
    const dbError = userFacingDatabaseError(error)
    if (dbError) {
      return NextResponse.json({ error: dbError }, { status: 503 })
    }
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 })
  }
}
