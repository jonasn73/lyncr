// POST /api/admin/invite-operator/resend — re-text a pending operator their setup link.

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { deliverOperatorInviteSms } from "@/lib/operator-invite-sms"
import { refreshOperatorInviteForResend } from "@/lib/operator-onboarding"

export async function POST(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const userId = String(body.user_id ?? body.operator_id ?? body.id ?? "").trim()
    if (!userId) {
      return NextResponse.json({ error: "Operator id is required." }, { status: 400 })
    }

    const refreshed = await refreshOperatorInviteForResend(userId)
    if (!refreshed) {
      return NextResponse.json(
        { error: "No pending operator invite found — they may already be active." },
        { status: 404 }
      )
    }

    const delivered = await deliverOperatorInviteSms({
      phone: refreshed.phone,
      name: refreshed.name,
      token: refreshed.token,
    })

    return NextResponse.json({
      data: {
        user_id: refreshed.userId,
        name: refreshed.name,
        phone: refreshed.phone,
        phone_display: delivered.phone_display,
        onboard_url: delivered.onboard_url,
        expires_at: refreshed.expiresAt,
        sms_sent: delivered.sms_sent,
        sms_error: delivered.sms_error,
      },
    })
  } catch (e) {
    console.error("[admin/invite-operator/resend]", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not resend operator invite." },
      { status: 500 }
    )
  }
}
