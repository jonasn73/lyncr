"use server"

import { revalidatePath } from "next/cache"
import {
  adminAdjustProfileCarrierCredit,
  createTeamInvite,
  getUser,
  isReasonablePstnDialString,
  normalizePhoneNumberE164,
} from "@/lib/db"
import { AdminAuthError, requireLyncrAdminSession } from "@/lib/admin-server-auth"
import { getAppUrl } from "@/lib/telnyx"
import { sendTelnyxSms } from "@/lib/telnyx-sms"
import {
  buildReceptionistInviteEmailPayload,
  sendReceptionistInviteEmail,
} from "@/lib/invite-email"
import {
  buildTeamInviteSignupUrl,
  generateTeamInviteToken,
  TEAM_INVITE_TTL_MS,
} from "@/lib/team-invites"

export type AdjustUserCreditResult =
  | { ok: true; carrier_credit_after: number; user_id: string }
  | { ok: false; error: string }

export type InviteReceptionistResult =
  | {
      ok: true
      invite_id: string
      email: string
      signup_url: string
      email_sent: boolean
      email_error?: string
    }
  | { ok: false; error: string }

/** Operator-only: atomically adjust onboarding_profiles.carrier_credit. */
export async function adjustUserCredit(
  targetUserId: string,
  amount: number
): Promise<AdjustUserCreditResult> {
  try {
    await requireLyncrAdminSession()

    const userId = targetUserId.trim()
    if (!userId) return { ok: false, error: "userId is required" }
    if (!Number.isFinite(amount) || amount === 0) {
      return { ok: false, error: "amount must be a non-zero number" }
    }

    const target = await getUser(userId)
    if (!target) return { ok: false, error: "Target user not found" }

    const result = await adminAdjustProfileCarrierCredit({ userId, amountUsd: amount })
    revalidatePath("/admin")
    return {
      ok: true,
      user_id: result.user_id,
      carrier_credit_after: result.carrier_credit_after,
    }
  } catch (e) {
    if (e instanceof AdminAuthError) return { ok: false, error: e.message }
    const msg = e instanceof Error ? e.message : "Credit adjustment failed"
    console.error("[admin-actions] adjustUserCredit:", e)
    return { ok: false, error: msg }
  }
}

export type InviteByChannelResult =
  | {
      ok: true
      invite_id: string
      type: "EMAIL" | "SMS"
      target: string
      register_url: string
      sent: boolean
      send_error?: string
    }
  | { ok: false; error: string }

/**
 * Operator-only: create a pending receptionist invite delivered by EMAIL or SMS.
 * The invitee completes their own profile at /register?token=… (48h expiry).
 */
export async function inviteReceptionistByChannel(params: {
  target: string
  type: string
}): Promise<InviteByChannelResult> {
  try {
    const { userId } = await requireLyncrAdminSession()

    const type: "EMAIL" | "SMS" = params.type.trim().toUpperCase() === "SMS" ? "SMS" : "EMAIL"
    const rawTarget = params.target.trim()
    if (!rawTarget) return { ok: false, error: "A target email or phone number is required" }

    let email: string | null = null
    let phone: string | null = null
    if (type === "EMAIL") {
      email = rawTarget.toLowerCase()
      if (!email.includes("@") || email.length < 5) return { ok: false, error: "Enter a valid email address" }
    } else {
      phone = normalizePhoneNumberE164(rawTarget)
      if (!isReasonablePstnDialString(phone)) return { ok: false, error: "Enter a valid cell phone number" }
    }

    // Secure, unique token (per spec).
    const token = crypto.randomUUID()
    // 48 hours from creation.
    const expires_at = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()

    const invite = await createTeamInvite({
      token,
      payout_rate_usd: 2.5,
      invited_by_user_id: userId,
      expires_at,
      channel: type,
      email,
      phone,
    })

    const register_url = `${getAppUrl().replace(/\/$/, "")}/register?token=${encodeURIComponent(token)}`

    // Deliver the registration link over the chosen channel.
    let sent = false
    let send_error: string | undefined
    if (type === "EMAIL" && email) {
      const payload = buildReceptionistInviteEmailPayload({
        toEmail: email,
        firstName: "there",
        signupUrl: register_url,
        payoutRateUsd: 2.5,
      })
      const emailResult = await sendReceptionistInviteEmail(payload)
      sent = emailResult.sent
      send_error = emailResult.error
    } else if (type === "SMS" && phone) {
      const smsResult = await sendTelnyxSms({
        toE164: phone,
        text: `You're invited to join Lyncr as a receptionist. Create your account (link expires in 48h): ${register_url}`,
        userId,
      })
      sent = smsResult.ok
      send_error = smsResult.ok ? smsResult.delivery_warning ?? undefined : smsResult.error
    }

    revalidatePath("/admin")
    return { ok: true, invite_id: invite.id, type, target: rawTarget, register_url, sent, send_error }
  } catch (e) {
    if (e instanceof AdminAuthError) return { ok: false, error: e.message }
    const msg = e instanceof Error ? e.message : "Invite failed"
    console.error("[admin-actions] inviteReceptionistByChannel:", e)
    if (msg.includes("team_invites") || msg.includes("42P01")) {
      return { ok: false, error: "Run scripts/041-team-invites.sql then 052-invite-sms-channel.sql in Neon first." }
    }
    return { ok: false, error: msg }
  }
}

/** Operator-only: create pending receptionist invite + optional Resend email. */
export async function inviteReceptionist(
  email: string,
  name: string,
  baseRate: number
): Promise<InviteReceptionistResult> {
  try {
    const { userId } = await requireLyncrAdminSession()

    const normalizedEmail = email.trim().toLowerCase()
    const firstName = name.trim()
    const payoutRate = Math.round(baseRate * 100) / 100

    if (!normalizedEmail.includes("@")) return { ok: false, error: "Valid email is required" }
    if (!firstName) return { ok: false, error: "Name is required" }
    if (!Number.isFinite(payoutRate) || payoutRate <= 0) {
      return { ok: false, error: "Payout rate must be a positive number" }
    }

    const token = generateTeamInviteToken()
    const expires_at = new Date(Date.now() + TEAM_INVITE_TTL_MS).toISOString()

    const invite = await createTeamInvite({
      email: normalizedEmail,
      first_name: firstName,
      token,
      payout_rate_usd: payoutRate,
      invited_by_user_id: userId,
      expires_at,
    })

    const signup_url = buildTeamInviteSignupUrl(token, getAppUrl())
    const emailPayload = buildReceptionistInviteEmailPayload({
      toEmail: normalizedEmail,
      firstName,
      signupUrl: signup_url,
      payoutRateUsd: payoutRate,
    })
    const emailResult = await sendReceptionistInviteEmail(emailPayload)

    revalidatePath("/admin")
    return {
      ok: true,
      invite_id: invite.id,
      email: invite.email,
      signup_url,
      email_sent: emailResult.sent,
      email_error: emailResult.error,
    }
  } catch (e) {
    if (e instanceof AdminAuthError) return { ok: false, error: e.message }
    const msg = e instanceof Error ? e.message : "Invite failed"
    console.error("[admin-actions] inviteReceptionist:", e)
    if (msg.includes("team_invites") || msg.includes("42P01")) {
      return { ok: false, error: "Run scripts/041-team-invites.sql in Neon first." }
    }
    return { ok: false, error: msg }
  }
}
