// ============================================
// POST /api/team/invites/[id]/resend
// ============================================
// Owner-only: reuse (or refresh) a pending team invite token, optionally re-send the email,
// and always return the register URL so the UI can Copy link.
//
// Body (optional): { send_email?: boolean } — default true when the invite has an email.
// Response: { data: { register_url, email_sent, email_error? } }

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  getTeamInviteForInviter,
  getUser,
  refreshTeamInviteTokenForInviter,
} from "@/lib/db"
import {
  buildReceptionistInviteEmailPayload,
  sendReceptionistInviteEmail,
} from "@/lib/invite-email"
import {
  buildTeamInviteRegisterUrl,
  generateTeamInviteToken,
  TEAM_INVITE_TTL_MS,
  teamInviteNeedsTokenRefresh,
} from "@/lib/team-invites"
import { getAppUrl } from "@/lib/telnyx"

export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, context: RouteContext) {
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
      return NextResponse.json({ error: "Only business owners can resend team invites" }, { status: 403 })
    }

    const { id: inviteId } = await context.params
    if (!inviteId?.trim()) {
      return NextResponse.json({ error: "Invite id is required" }, { status: 400 })
    }

    const body = (await req.json().catch(() => ({}))) as { send_email?: boolean }
    // Default: attempt email when Resend is pressed; Copy link passes send_email: false.
    const wantEmail = body.send_email !== false

    let invite = await getTeamInviteForInviter(inviteId.trim(), userId)
    if (!invite) {
      return NextResponse.json({ error: "Invite not found or already accepted" }, { status: 404 })
    }

    // Reuse the existing token unless expired / near expiry (then mint a fresh one).
    if (teamInviteNeedsTokenRefresh(invite.expires_at)) {
      const token = generateTeamInviteToken()
      const expires_at = new Date(Date.now() + TEAM_INVITE_TTL_MS).toISOString()
      const refreshed = await refreshTeamInviteTokenForInviter({
        inviteId: invite.id,
        invitedByUserId: userId,
        token,
        expiresAt: expires_at,
      })
      if (!refreshed) {
        return NextResponse.json({ error: "Invite not found or already accepted" }, { status: 404 })
      }
      invite = refreshed
    }

    const register_url = buildTeamInviteRegisterUrl(invite.token, getAppUrl())
    const email = (invite.email || "").trim().toLowerCase()
    const hasEmail = email.includes("@") && email.length >= 5

    // No email on the invite (e.g. SMS-only) — only return the copyable link.
    if (!hasEmail || !wantEmail) {
      return NextResponse.json({
        data: {
          register_url,
          email_sent: false,
          email_error: hasEmail
            ? null
            : "This invite has no email — copy the link and share it yourself.",
        },
      })
    }

    const emailPayload = buildReceptionistInviteEmailPayload({
      toEmail: email,
      firstName: invite.first_name || undefined,
      onboardingUrl: register_url,
    })
    const emailResult = await sendReceptionistInviteEmail(emailPayload)

    return NextResponse.json({
      data: {
        register_url,
        email_sent: emailResult.sent,
        email_error: emailResult.error ?? null,
      },
    })
  } catch (e) {
    console.error("[POST /api/team/invites/[id]/resend]", e)
    return NextResponse.json({ error: "Failed to resend invite" }, { status: 500 })
  }
}
