// GET /api/auth/validate-token?token=… — public preview used by the /register page.
// Returns the invite channel + (for SMS) the pre-fill phone when the token is valid + pending,
// or 404 when it's invalid / expired / already used.

import { NextRequest, NextResponse } from "next/server"
import { getTeamInvitePreview } from "@/lib/db"

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim()
  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 })
  }

  try {
    const preview = await getTeamInvitePreview(token)
    if (!preview) {
      return NextResponse.json({ error: "This invitation is invalid, expired, or already used." }, { status: 404 })
    }
    return NextResponse.json({
      data: {
        valid: true,
        channel: preview.channel,
        // Only surface the contact target relevant to the channel (pre-fills the form).
        email: preview.channel === "EMAIL" ? preview.email : "",
        phone: preview.channel === "SMS" ? preview.phone : null,
        expires_at: preview.expires_at,
      },
    })
  } catch (e) {
    console.error("[lyncr] validate-token:", e)
    return NextResponse.json({ error: "Failed to validate invitation" }, { status: 500 })
  }
}
