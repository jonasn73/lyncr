// ============================================
// POST /api/tech/invite  — (re)send a field tech's secure setup-link SMS
// ============================================
// Owner-only. Mints a fresh 48h token on an already-invited tech stub and texts the white-labeled
// Lyncr /tech/setup link again (e.g. the first text didn't arrive). Body: { technicianId }.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUser, listFieldTechnicians } from "@/lib/db"
import { TECH_INVITE_TTL_MS } from "@/lib/tech-invite"
import { refreshTechInviteStub } from "@/lib/tech-invite-stub"
import { resolveAppBaseUrl, sendTechInviteSms } from "@/lib/tech-invite-sms"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const owner = await getUser(userId)
  if (!owner || owner.account_role !== "owner") {
    return NextResponse.json({ error: "Only business owners can invite technicians" }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as { technicianId?: string }
  const technicianId = String(body.technicianId || "").trim()
  if (!technicianId) {
    return NextResponse.json({ error: "technicianId is required" }, { status: 400 })
  }

  // The tech must belong to this owner; resolve their login (portal_user_id) from the roster.
  const roster = await listFieldTechnicians(userId)
  const tech = roster.find((t) => t.id === technicianId)
  if (!tech || !tech.portal_user_id) {
    return NextResponse.json({ error: "Technician not found" }, { status: 404 })
  }

  try {
    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + TECH_INVITE_TTL_MS).toISOString()
    const stub = await refreshTechInviteStub({ portalUserId: tech.portal_user_id, token, expiresAt })
    if (!stub) {
      return NextResponse.json(
        { error: "This technician has already completed setup." },
        { status: 409 }
      )
    }

    const sms = await sendTechInviteSms({
      ownerUserId: userId,
      toPhone: stub.phone || tech.phone,
      businessName: owner.business_name,
      token,
      baseUrl: resolveAppBaseUrl(req.nextUrl.origin),
    })

    if (!sms.success) {
      console.error("[POST /api/tech/invite] SMS dispatch failed:", {
        technicianId,
        errorType: sms.errorType,
        error: sms.error,
      })
    }

    // Surface carrier blocks (e.g. Telnyx 40011 / missing 10DLC) — do not imply delivery succeeded.
    if (sms.errorType === "10DLC_BLOCK") {
      return NextResponse.json({
        success: false,
        errorType: "10DLC_BLOCK",
        message: sms.message,
        data: {
          sms_sent: false,
          sms_error: sms.error,
          setup_url: sms.setupUrl,
          expires_at: expiresAt,
        },
      })
    }

    if (!sms.success) {
      return NextResponse.json(
        {
          success: false,
          errorType: sms.errorType ?? "OTHER",
          message: sms.message ?? sms.error ?? "Could not send invite text",
          data: {
            sms_sent: false,
            sms_error: sms.error,
            setup_url: sms.setupUrl,
            expires_at: expiresAt,
          },
        },
        { status: 502 }
      )
    }

    return NextResponse.json({
      success: true,
      data: { sms_sent: true, sms_error: null, setup_url: sms.setupUrl, expires_at: expiresAt },
    })
  } catch (e) {
    console.error("[POST /api/tech/invite] failed:", e)
    return NextResponse.json({ error: "Could not resend invite" }, { status: 500 })
  }
}
