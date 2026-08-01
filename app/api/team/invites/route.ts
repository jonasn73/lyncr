// ============================================
// GET  /api/team/invites — list invites this owner created
// POST /api/team/invites — create a receptionist invite (email + copy link)
// ============================================
// Owner-session API (not admin-only). Uses team_invites + invited_by_user_id = owner.
// Redeem at /register?token=… → account_role=receptionist bound to this business.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  createTeamInvite,
  getUser,
  isReasonablePstnDialString,
  listTeamInvitesForInviter,
  normalizePhoneNumberE164,
} from "@/lib/db"
import {
  buildReceptionistInviteEmailPayload,
  sendReceptionistInviteEmail,
} from "@/lib/invite-email"
import {
  buildTeamInviteRegisterUrl,
  generateTeamInviteToken,
  TEAM_INVITE_TTL_MS,
} from "@/lib/team-invites"
import { getAppUrl } from "@/lib/telnyx"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const sessionUser = await getUser(userId)
    if (!sessionUser) {
      return NextResponse.json({ error: "User not found" }, { status: 401 })
    }
    // Receptionists / field techs should not mint owner invites.
    if (sessionUser.account_role === "receptionist" || sessionUser.account_role === "field_tech") {
      return NextResponse.json({ error: "Only business owners can manage team invites" }, { status: 403 })
    }

    const invites = await listTeamInvitesForInviter(userId)
    return NextResponse.json({ data: invites })
  } catch (e) {
    console.error("[GET /api/team/invites]", e)
    return NextResponse.json({ error: "Failed to list invites" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const sessionUser = await getUser(userId)
    if (!sessionUser) {
      return NextResponse.json({ error: "User not found" }, { status: 401 })
    }
    if (sessionUser.account_role === "receptionist" || sessionUser.account_role === "field_tech") {
      return NextResponse.json({ error: "Only business owners can invite receptionists" }, { status: 403 })
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const firstName = String(body.first_name ?? body.firstName ?? body.name ?? "").trim()
    const email = String(body.email ?? "").trim().toLowerCase()
    const rawPhone = String(body.phone ?? "").trim()
    const phone = rawPhone ? normalizePhoneNumberE164(rawPhone) : null

    if (!firstName) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 })
    }
    if (!email.includes("@") || email.length < 5) {
      return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 })
    }
    if (phone && !isReasonablePstnDialString(phone)) {
      return NextResponse.json({ error: "Enter a valid cell phone number" }, { status: 400 })
    }

    const token = generateTeamInviteToken()
    const expires_at = new Date(Date.now() + TEAM_INVITE_TTL_MS).toISOString()

    const invite = await createTeamInvite({
      token,
      payout_rate_usd: 2.5,
      invited_by_user_id: userId,
      expires_at,
      channel: "EMAIL",
      email,
      first_name: firstName,
      phone,
    })

    const register_url = buildTeamInviteRegisterUrl(token, getAppUrl())

    // Resend when configured; UI always shows Copy link either way.
    const emailPayload = buildReceptionistInviteEmailPayload({
      toEmail: email,
      firstName,
      onboardingUrl: register_url,
    })
    const emailResult = await sendReceptionistInviteEmail(emailPayload)

    return NextResponse.json({
      data: {
        invite_id: invite.id,
        email: invite.email,
        first_name: invite.first_name,
        expires_at: invite.expires_at,
        register_url,
        email_sent: emailResult.sent,
        email_error: emailResult.error ?? null,
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[POST /api/team/invites]", e)
    if (msg.includes("team_invites") || msg.includes("42P01")) {
      return NextResponse.json(
        { error: "Run scripts/041-team-invites.sql (and 052-invite-sms-channel.sql) in Neon first." },
        { status: 500 }
      )
    }
    return NextResponse.json({ error: "Failed to create invite" }, { status: 500 })
  }
}
