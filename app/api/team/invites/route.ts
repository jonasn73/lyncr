// ============================================
// GET    /api/team/invites — list invites this owner created
// POST   /api/team/invites — create a receptionist invite (email + copy link)
// DELETE /api/team/invites — cancel a pending invite (?id= or body.id)
// ============================================
// Owner-session API (not admin-only). Uses team_invites + invited_by_user_id = owner.
// Redeem at /register?token=… → account_role=receptionist bound to this business.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  cancelTeamInviteForInviter,
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
import { createPendingAgreement } from "@/lib/agreements/store"
import {
  parsePayComponents,
  validatePayComponents,
  type EmploymentType,
} from "@/lib/compensation/plan-schema"

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

    // Terms travel with the invite, so what the owner set is what the invitee is shown
    // — not whatever the plan says by the time they open the link. Optional: an invite
    // sent without them still works, and the worker gets no agreement to sign.
    const employmentType = String(body.employment_type ?? "").trim().toUpperCase()
    const components = parsePayComponents(Array.isArray(body.components) ? body.components : [])
    let agreement_id: string | null = null
    let pay_summary: string | null = null

    if (
      (employmentType === "W2_EMPLOYEE" || employmentType === "CONTRACTOR_1099") &&
      components.length > 0
    ) {
      const validation = validatePayComponents(components, {
        employmentType: employmentType as EmploymentType,
      })
      if (validation.errors.length > 0) {
        return NextResponse.json(
          { error: validation.errors[0], details: validation.errors },
          { status: 400 }
        )
      }
      try {
        const agreement = await createPendingAgreement({
          ownerUserId: userId,
          businessName: sessionUser.business_name,
          workerName: firstName,
          workerRole: "receptionist",
          employmentType: employmentType as EmploymentType,
          components,
          inviteId: invite.id,
        })
        agreement_id = agreement.id
        pay_summary = agreement.pay_summary
      } catch (e) {
        // The invite is already created and usable; an agreement failure must not
        // strand it. Surfaced so the owner knows the terms did not go out.
        console.error("[POST /api/team/invites] agreement:", e)
        return NextResponse.json(
          {
            error:
              e instanceof Error
                ? e.message
                : "The invite was created, but the agreement could not be prepared.",
          },
          { status: 500 }
        )
      }
    }

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
        agreement_id,
        pay_summary,
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

/** Cancel a pending invite so the register link stops working. */
export async function DELETE(req: NextRequest) {
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
      return NextResponse.json({ error: "Only business owners can cancel team invites" }, { status: 403 })
    }

    const urlId = req.nextUrl.searchParams.get("id")?.trim() ?? ""
    const body = (await req.json().catch(() => ({}))) as { id?: string }
    const inviteId = urlId || String(body.id ?? "").trim()
    if (!inviteId) {
      return NextResponse.json({ error: "Invite id is required" }, { status: 400 })
    }

    const ok = await cancelTeamInviteForInviter(inviteId, userId)
    if (!ok) {
      return NextResponse.json({ error: "Invite not found or already accepted" }, { status: 404 })
    }
    return NextResponse.json({ data: { deleted: true, id: inviteId } })
  } catch (e) {
    console.error("[DELETE /api/team/invites]", e)
    return NextResponse.json({ error: "Failed to cancel invite" }, { status: 500 })
  }
}
