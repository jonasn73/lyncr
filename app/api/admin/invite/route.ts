// POST /api/admin/invite — admin-only (admin@lyncr.app).
//
// New channel invite:  { target, type: "EMAIL" | "SMS" }
//   → insert into the `invitations` table (native parameterized SQL), 48h expiry, send the
//     /register?token=… link via Resend (email) or Telnyx (SMS).
// Legacy invite:        { email, first_name, payout_rate }
//   → existing team_invites flow redeemed at /signup (kept for the /admin dialog).

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { inviteReceptionist } from "@/app/actions/admin-actions"
import { createInvitation, INVITATION_TTL_MS, type InviteType } from "@/lib/invitations"
import { RECEPTIONIST_INVITE_TTL_MS, upsertReceptionistInviteStub } from "@/lib/receptionist-invite-stub"
import { isReasonablePstnDialString, normalizePhoneNumberE164 } from "@/lib/db"
import { getAppUrl } from "@/lib/telnyx"
import { buildReceptionistInviteEmailPayload, sendReceptionistInviteEmail } from "@/lib/invite-email"
import { resolvePlatformSmsFromE164 } from "@/lib/platform-sms-sender"
import { sendTelnyxSms } from "@/lib/telnyx-sms"
import { recordAuditEvent } from "@/lib/audit-log"

export async function POST(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

    // ---- New channel-based invite (invitations table) -------------------------------------
    if (body.target !== undefined || body.type !== undefined) {
      const type: InviteType = String(body.type ?? "EMAIL").toUpperCase() === "SMS" ? "SMS" : "EMAIL"
      const rawTarget = String(body.target ?? "").trim()
      if (!rawTarget) {
        return NextResponse.json({ error: "A target email or phone number is required" }, { status: 400 })
      }

      // Normalize + validate the target for the chosen channel.
      let target = rawTarget
      if (type === "EMAIL") {
        target = rawTarget.toLowerCase()
        if (!target.includes("@") || target.length < 5) {
          return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 })
        }
      } else {
        target = normalizePhoneNumberE164(rawTarget)
        if (!isReasonablePstnDialString(target)) {
          return NextResponse.json({ error: "Enter a valid cell phone number" }, { status: 400 })
        }
      }

      const appUrl = getAppUrl().replace(/\/$/, "")

      // ---- EMAIL invite: stub `users` row (token authority) + Lyncr-branded onboarding email ----
      if (type === "EMAIL") {
        const token = crypto.randomUUID()
        const expiresAt = new Date(Date.now() + RECEPTIONIST_INVITE_TTL_MS).toISOString()

        let stubUserId: string
        try {
          const stub = await upsertReceptionistInviteStub({ email: target, token, expiresAt })
          stubUserId = stub.userId
        } catch (e) {
          return NextResponse.json(
            { error: e instanceof Error ? e.message : "Could not create the invitation." },
            { status: 400 }
          )
        }

        const onboarding_url = `${appUrl}/onboarding?token=${encodeURIComponent(token)}`
        const payload = buildReceptionistInviteEmailPayload({ toEmail: target, onboardingUrl: onboarding_url })
        const result = await sendReceptionistInviteEmail(payload)
        void recordAuditEvent({
          ownerUserId: stubUserId,
          actorUserId: ctx.userId,
          actorRole: "platform_admin",
          eventType: "admin.receptionist_invited",
          entityType: "user",
          entityId: stubUserId,
          detail: { channel: "EMAIL", target, sent: result.sent },
        })

        return NextResponse.json({
          data: {
            invite_id: stubUserId,
            type,
            target,
            // `register_url` kept for the existing modal field; `onboarding_url` is the branded link.
            register_url: onboarding_url,
            onboarding_url,
            sent: result.sent,
            send_error: result.error,
          },
        })
      }

      // ---- SMS invite: legacy invitations table → /register?token=… -----------------------------
      const token = crypto.randomUUID()
      const expiresAt = new Date(Date.now() + INVITATION_TTL_MS).toISOString()
      const invitation = await createInvitation({ target, type, token, expiresAt })
      const register_url = `${appUrl}/register?token=${encodeURIComponent(token)}`

      const sender = await resolvePlatformSmsFromE164()
      const smsResult = sender.ok
        ? await sendTelnyxSms({
            toE164: target,
            text: `You're invited to join the Lyncr Operator Network. Activate your account (link expires in 48h): ${register_url}`,
            fromE164: sender.from_e164,
          })
        : { ok: false as const, error: sender.message }

      const smsError =
        smsResult.ok === false
          ? smsResult.error
          : smsResult.delivery_warning ?? undefined

      void recordAuditEvent({
        ownerUserId: null,
        actorUserId: ctx.userId,
        actorRole: "platform_admin",
        eventType: "admin.receptionist_invited",
        entityType: "invitation",
        entityId: invitation.id,
        detail: { channel: "SMS", target, sent: smsResult.ok },
      })

      return NextResponse.json({
        data: {
          invite_id: invitation.id,
          type,
          target,
          register_url,
          sent: smsResult.ok,
          send_error: smsError,
        },
      })
    }

    // ---- Legacy email invite (team_invites → /signup) -------------------------------------
    const email = String(body.email ?? "").trim()
    const name = String(body.first_name ?? body.firstName ?? body.name ?? "").trim()
    const baseRate = Number(body.payout_rate ?? body.payoutRate ?? body.baseRate ?? 2.5)

    const result = await inviteReceptionist(email, name, baseRate)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    void recordAuditEvent({
      ownerUserId: null,
      actorUserId: ctx.userId,
      actorRole: "platform_admin",
      eventType: "admin.receptionist_invited",
      entityType: "invitation",
      entityId: result.invite_id,
      detail: { channel: "EMAIL", target: result.email, sent: result.email_sent },
    })
    return NextResponse.json({
      data: {
        invite_id: result.invite_id,
        email: result.email,
        signup_url: result.signup_url,
        email_sent: result.email_sent,
        email_error: result.email_error,
      },
    })
  } catch (e) {
    console.error("[lyncr-admin] invite:", e)
    return NextResponse.json({ error: "Failed to create invite" }, { status: 500 })
  }
}
