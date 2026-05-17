// POST /api/auth/reset-password — set a new password using a reset token.

import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { getUser, setUserPasswordHash } from "@/lib/db"
import { verifyPasswordResetToken } from "@/lib/password-reset-token"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const token = String(body?.token ?? "")
    const password = String(body?.password ?? "")

    if (!token) {
      return NextResponse.json({ error: "Reset link is invalid or expired" }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 })
    }

    const userId = verifyPasswordResetToken(token)
    if (!userId) {
      return NextResponse.json({ error: "Reset link is invalid or expired" }, { status: 400 })
    }

    const user = await getUser(userId)
    if (!user) {
      return NextResponse.json({ error: "Reset link is invalid or expired" }, { status: 400 })
    }

    const password_hash = await bcrypt.hash(password, 10)
    await setUserPasswordHash(userId, password_hash)

    return NextResponse.json({ ok: true, message: "Password updated. You can log in now." })
  } catch (error) {
    console.error("[Sigo] reset-password:", error)
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 })
  }
}
