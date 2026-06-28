// POST /api/admin/invite-operator — platform admin texts a receptionist a setup link (SMS-first).

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { isReasonablePstnDialString, normalizePhoneNumberE164 } from "@/lib/db"
import { inviteOperatorStub } from "@/lib/operator-onboarding"
import { getAppUrl } from "@/lib/telnyx"
import { sendTelnyxSms } from "@/lib/telnyx-sms"
import type { OperatorAssignedWorkspace } from "@/lib/types"

function formatPhoneDisplay(e164: string): string {
  const d = e164.replace(/\D/g, "")
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return e164
}

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

    const appUrl = getAppUrl().replace(/\/$/, "")
    const onboardUrl = `${appUrl}/auth/onboard?token=${encodeURIComponent(token)}`
    const firstName = name.split(/\s+/)[0] || "there"

    const smsResult = await sendTelnyxSms({
      toE164: normalizedPhone,
      text: `Hi ${firstName}! Lyncr invited you as a live operator. Tap to set up (expires in 48h): ${onboardUrl}`,
      userId: ctx.userId,
    })

    return NextResponse.json({
      data: {
        user_id: userId,
        phone: normalizedPhone,
        phone_display: formatPhoneDisplay(normalizedPhone),
        name,
        status: "PENDING_INVITE",
        onboard_url: onboardUrl,
        expires_at: expiresAt,
        created,
        sms_sent: smsResult.ok,
        sms_error: smsResult.ok ? smsResult.delivery_warning ?? undefined : smsResult.error,
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
