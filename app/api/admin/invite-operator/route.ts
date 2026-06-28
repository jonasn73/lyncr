// POST /api/admin/invite-operator — platform admin texts a receptionist a setup link (SMS-first).

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { isReasonablePstnDialString, normalizePhoneNumberE164 } from "@/lib/db"
import { inviteOperatorStub } from "@/lib/operator-onboarding"
import { deliverOperatorInviteSms } from "@/lib/operator-invite-sms"
import type { OperatorAssignedWorkspace } from "@/lib/types"

export async function POST(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const rawPhone = String(body.phone ?? body.cell ?? body.mobile ?? "").trim()
    const name = String(body.name ?? "").trim()
    const assignedWorkspaces = (body.assigned_workspaces ?? body.assignedWorkspaces) as
      | OperatorAssignedWorkspace[]
      | undefined

    const phone = normalizePhoneNumberE164(rawPhone)
    if (!isReasonablePstnDialString(phone)) {
      return NextResponse.json({ error: "Enter a valid US cell phone number." }, { status: 400 })
    }
    if (name.length < 2) {
      return NextResponse.json({ error: "Operator name is required." }, { status: 400 })
    }

    const { userId, token, expiresAt, created, phone: normalizedPhone } = await inviteOperatorStub({
      phone,
      name,
      assignedWorkspaces,
    })

    const delivered = await deliverOperatorInviteSms({ phone: normalizedPhone, name, token })

    return NextResponse.json({
      data: {
        user_id: userId,
        phone: normalizedPhone,
        phone_display: delivered.phone_display,
        name,
        status: "PENDING_INVITE",
        onboard_url: delivered.onboard_url,
        expires_at: expiresAt,
        created,
        sms_sent: delivered.sms_sent,
        sms_error: delivered.sms_error,
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
