// POST /api/auth/register-invited — complete a receptionist profile from an invite token.
//
// Body: { token, name, password, phone }
// Re-validates the token, bcrypt-hashes the password, then runs ONE atomic SQL transaction that
// (a) inserts the users row, (b) inserts the linked receptionists row (sip_username placeholder),
// and (c) marks the invitation ACCEPTED — all-or-nothing. On success the client is redirected to
// /login to sign in with their new credentials.

import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { registerInvitedReceptionist } from "@/lib/invitations"
import { activateReceptionistInviteStub } from "@/lib/receptionist-invite-stub"

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const token = String(body.token ?? "").trim()
    const name = String(body.name ?? body.full_name ?? body.fullName ?? "").trim()
    const phone = String(body.phone ?? "").trim()
    const password = String(body.password ?? "")

    if (!token) return NextResponse.json({ error: "Missing invitation token" }, { status: 400 })
    if (name.length < 2) return NextResponse.json({ error: "Enter your full name" }, { status: 400 })
    if (phone.replace(/\D/g, "").length < 10) {
      return NextResponse.json({ error: "Enter a valid cell phone number" }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 })
    }

    // Hash with bcrypt — same pattern as the rest of our auth (see /api/auth/register, login).
    const passwordHash = await bcrypt.hash(password, 10)

    // Email invites activate an existing `users` stub (migration 054); SMS/legacy invites insert
    // fresh rows via the invitations-table flow. Try the stub first, then fall back.
    const stub = await activateReceptionistInviteStub({ token, name, phone, passwordHash })
    const userId = stub
      ? stub.userId
      : (await registerInvitedReceptionist({ token, name, phone, passwordHash })).userId

    // Account created — send them to sign in with their new credentials.
    return NextResponse.json({ data: { user_id: userId, redirect: "/login" } })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes("Invite")) return NextResponse.json({ error: msg }, { status: 400 })
    if (/unique|duplicate/i.test(msg)) {
      return NextResponse.json(
        { error: "An account for this email or number already exists. Try logging in." },
        { status: 409 }
      )
    }
    console.error("[lyncr] register-invited:", error)
    return NextResponse.json({ error: "Failed to complete registration" }, { status: 500 })
  }
}
