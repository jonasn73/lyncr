// ============================================
// GET  /api/technicians   — list the owner's field techs
// POST /api/technicians   — invite or manually add a field tech
// POST /api/team/technicians — same handler (alias)
// ============================================

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getFieldTechnicianByIdForOwner, getUser, listFieldTechnicians } from "@/lib/db"
import { TECH_INVITE_TTL_MS } from "@/lib/tech-invite"
import { createManualFieldTechnician, createTechInviteStub } from "@/lib/tech-invite-stub"
import { resolveAppBaseUrl, sendTechInviteSms } from "@/lib/tech-invite-sms"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  try {
    const technicians = await listFieldTechnicians(userId)
    return NextResponse.json({ data: technicians })
  } catch (e) {
    console.error("[GET /api/technicians] failed:", e)
    return NextResponse.json({ error: "Failed to list technicians" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const owner = await getUser(userId)
  if (!owner || owner.account_role !== "owner") {
    return NextResponse.json({ error: "Only business owners can add technicians" }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    firstName?: string
    lastName?: string
    name?: string
    phone?: string
    email?: string
    isManual?: boolean
  }
  const firstName = String(body.firstName || "").trim()
  const lastName = String(body.lastName || "").trim()
  const name = (firstName || lastName ? `${firstName} ${lastName}` : String(body.name || "")).trim()
  const phone = String(body.phone || "").trim()
  const isManual = body.isManual === true

  if (!name || name.length < 2) {
    return NextResponse.json({ error: "Name is required (at least 2 characters)" }, { status: 400 })
  }
  const phoneDigits = phone.replace(/\D/g, "")
  if (phoneDigits.length < 10) {
    return NextResponse.json({ error: "Enter a valid mobile phone number" }, { status: 400 })
  }

  try {
    if (isManual) {
      const { rosterId } = await createManualFieldTechnician({
        ownerUserId: userId,
        ownerBusinessName: owner.business_name,
        name,
        phone,
      })
      const technicians = await listFieldTechnicians(userId)
      const technician =
        (await getFieldTechnicianByIdForOwner(userId, rosterId)) ??
        technicians.find((t) => t.id === rosterId) ??
        null
      if (!technician) {
        return NextResponse.json({ error: "Technician was created but could not be loaded" }, { status: 500 })
      }
      return NextResponse.json({
        success: true,
        data: { technician, technicians },
      })
    }

    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + TECH_INVITE_TTL_MS).toISOString()

    const { userId: portalUserId } = await createTechInviteStub({
      ownerUserId: userId,
      ownerBusinessName: owner.business_name,
      name,
      phone,
      token,
      expiresAt,
    })

    const baseUrl = resolveAppBaseUrl(req.nextUrl.origin)
    const sms = await sendTechInviteSms({
      ownerUserId: userId,
      toPhone: phone,
      businessName: owner.business_name,
      token,
      baseUrl,
    })

    if (!sms.success) {
      console.error("[POST /api/technicians] SMS dispatch failed:", {
        phone,
        errorType: sms.errorType,
        error: sms.error,
      })
    }

    const technicians = await listFieldTechnicians(userId)
    const technician =
      technicians.find((t) => t.portal_user_id === portalUserId) ?? technicians[0] ?? null
    const inviteBase = {
      name,
      phone,
      expires_at: expiresAt,
      setup_url: sms.setupUrl,
      sms_sent: sms.success,
      sms_error: sms.error,
      success: sms.success,
      errorType: sms.errorType,
      message: sms.message,
    }

    if (!technician) {
      return NextResponse.json({ error: "Invite sent but technician row missing" }, { status: 500 })
    }

    if (sms.errorType === "10DLC_BLOCK") {
      return NextResponse.json({
        success: false,
        errorType: "10DLC_BLOCK",
        message: sms.message,
        data: { technician, technicians, invite: inviteBase },
      })
    }

    return NextResponse.json({
      success: sms.success,
      data: { technician, technicians, invite: inviteBase },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not add technician"
    console.error("[POST /api/technicians] failed:", e)
    const isUserFacing = /already has|migration|missing (column|table)/i.test(msg)
    return NextResponse.json({ error: isUserFacing ? msg : "Could not add technician" }, {
      status: isUserFacing ? 409 : 500,
    })
  }
}
