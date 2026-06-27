// POST /api/admin/invite-operator — platform admin creates a receptionist invite with magic link.

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { getAppUrl } from "@/lib/telnyx"
import { buildReceptionistInviteEmailPayload, sendReceptionistInviteEmail } from "@/lib/invite-email"
import { inviteOperatorStub } from "@/lib/operator-onboarding"
import type { OperatorAssignedWorkspace } from "@/lib/types"

export async function POST(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const email = String(body.email ?? "").trim().toLowerCase()
    const name = String(body.name ?? "").trim()
    const timezone = String(body.timezone ?? "America/New_York").trim()
    const assignedWorkspaces = (body.assigned_workspaces ?? body.assignedWorkspaces) as
      | OperatorAssignedWorkspace[]
      | undefined

    if (!email.includes("@") || email.length < 5) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 })
    }
    if (name.length < 2) {
      return NextResponse.json({ error: "Operator name is required." }, { status: 400 })
    }

    const { userId, token, expiresAt, created } = await inviteOperatorStub({
      email,
      name,
      timezone,
      assignedWorkspaces,
    })

    const appUrl = getAppUrl().replace(/\/$/, "")
    const onboardUrl = `${appUrl}/auth/onboard?token=${encodeURIComponent(token)}`
    const emailPayload = buildReceptionistInviteEmailPayload({
      toEmail: email,
      onboardingUrl: onboardUrl,
      firstName: name.split(/\s+/)[0],
    })
    const emailResult = await sendReceptionistInviteEmail(emailPayload)

    return NextResponse.json({
      data: {
        user_id: userId,
        email,
        name,
        timezone,
        status: "PENDING_INVITE",
        onboard_url: onboardUrl,
        expires_at: expiresAt,
        created,
        email_sent: emailResult.sent,
        email_error: emailResult.error,
      },
    })
  } catch (e) {
    console.error("[admin/invite-operator]", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not create operator invite." },
      { status: 400 }
    )
  }
}
