// POST /api/admin/invite/resend — admin-only (admin@lyncr.app).
//
// Body: { email }  (also accepts { target })
// Re-fires a Lyncr-branded onboarding email for a receptionist who was already invited but hasn't
// finished onboarding. Generates a FRESH token + 48h expiry on their stub `users` row, then sends
// the email again.
//
//   found + sent → 200 { success: true,  message: "Lyncr invitation sent successfully" }
//   no invite    → 404 { success: false, message: "No pending Lyncr invitation found for that email." }
//   send failed  → 502 { success: false, message: "…" }

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { refreshReceptionistInviteStub } from "@/lib/receptionist-invite-stub"
import { buildReceptionistInviteEmailPayload, sendReceptionistInviteEmail } from "@/lib/invite-email"
import { getAppUrl } from "@/lib/telnyx"

export async function POST(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const email = String(body.email ?? body.target ?? "").trim().toLowerCase()
    if (!email.includes("@") || email.length < 5) {
      return NextResponse.json({ success: false, message: "Enter a valid email address." }, { status: 400 })
    }

    // Mint a fresh token + expiry on the existing invited stub.
    const refreshed = await refreshReceptionistInviteStub({ email })
    if (!refreshed) {
      return NextResponse.json(
        { success: false, message: "No pending Lyncr invitation found for that email." },
        { status: 404 }
      )
    }

    const onboarding_url = `${getAppUrl().replace(/\/$/, "")}/onboarding?token=${encodeURIComponent(refreshed.token)}`
    const payload = buildReceptionistInviteEmailPayload({ toEmail: email, onboardingUrl: onboarding_url })
    const result = await sendReceptionistInviteEmail(payload)

    if (!result.sent) {
      return NextResponse.json(
        { success: false, message: result.error ?? "Email could not be sent — please try again." },
        { status: 502 }
      )
    }

    return NextResponse.json({ success: true, message: "Lyncr invitation sent successfully" })
  } catch (e) {
    console.error("[lyncr-admin] invite/resend:", e)
    return NextResponse.json({ success: false, message: "Failed to resend the invitation." }, { status: 500 })
  }
}
