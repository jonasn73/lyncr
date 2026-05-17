// POST /api/auth/forgot-password — issue a time-limited reset link (email delivery TBD).

import { NextRequest, NextResponse } from "next/server"
import { getAuthUserByEmail } from "@/lib/db"
import { createPasswordResetToken } from "@/lib/password-reset-token"
import { getAppUrl } from "@/lib/telnyx"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const email = String(body?.email ?? "").trim().toLowerCase()
    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 })
    }

    const authUser = await getAuthUserByEmail(email)
    if (!authUser) {
      return NextResponse.json({
        ok: true,
        message: "If an account exists for that email, you can use the reset link below.",
      })
    }

    const token = createPasswordResetToken(authUser.id)
    const base = getAppUrl().replace(/\/$/, "")
    const resetUrl = `${base}/reset-password?token=${encodeURIComponent(token)}`

    return NextResponse.json({
      ok: true,
      message: "Use the link below to choose a new password. It expires in about one hour.",
      resetUrl,
    })
  } catch (error) {
    console.error("[Sigo] forgot-password:", error)
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes("SESSION_SECRET")) {
      return NextResponse.json(
        { error: "Server misconfiguration: SESSION_SECRET is missing in production." },
        { status: 500 }
      )
    }
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 })
  }
}
