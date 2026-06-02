// GET /api/auth/validate-token?token=… — public preview used by the /register page.
// Queries the `invitations` table and confirms the row exists, is PENDING, and not past expires_at.
//   valid   → 200 { valid: true, target, type }
//   invalid → 400 { valid: false, error }

import { NextRequest, NextResponse } from "next/server"
import { getRedeemableInvitation } from "@/lib/invitations"
import { getReceptionistInviteStubByToken } from "@/lib/receptionist-invite-stub"

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim()
  if (!token) {
    return NextResponse.json({ valid: false, error: "token is required" }, { status: 400 })
  }

  try {
    // Email invites live on a `users` stub (migration 054); SMS/legacy invites on the invitations table.
    const stub = await getReceptionistInviteStubByToken(token)
    if (stub) {
      return NextResponse.json({ valid: true, target: stub.email, type: "EMAIL" })
    }

    const invite = await getRedeemableInvitation(token)
    if (!invite) {
      return NextResponse.json(
        { valid: false, error: "This invitation is invalid, expired, or already used." },
        { status: 400 }
      )
    }
    return NextResponse.json({ valid: true, target: invite.target, type: invite.type })
  } catch (e) {
    console.error("[lyncr] validate-token:", e)
    return NextResponse.json({ valid: false, error: "Failed to validate invitation" }, { status: 500 })
  }
}
