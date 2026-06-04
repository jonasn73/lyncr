// ============================================
// GET  /api/technicians   — list the owner's field techs
// POST /api/technicians   — invite a field tech by mobile number (no password)
// ============================================
// Hands-free invite flow: the owner submits first name, last name and mobile number. We create a
// passwordless stub login + roster row carrying a one-time token (48h), then text the tech a secure
// /tech/setup link where they pick their own password. See lib/tech-invite-stub.ts.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUser, listFieldTechnicians } from "@/lib/db"
import { TECH_INVITE_TTL_MS } from "@/lib/tech-invite"
import { createTechInviteStub } from "@/lib/tech-invite-stub"
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
  }
  const firstName = String(body.firstName || "").trim()
  const lastName = String(body.lastName || "").trim()
  // Accept a combined `name` too, but prefer first + last.
  const name = (firstName || lastName ? `${firstName} ${lastName}` : String(body.name || "")).trim()
  const phone = String(body.phone || "").trim()

  if (!name || name.length < 2) {
    return NextResponse.json({ error: "First and last name are required" }, { status: 400 })
  }
  const phoneDigits = phone.replace(/\D/g, "")
  if (phoneDigits.length < 10) {
    return NextResponse.json({ error: "Enter a valid mobile phone number" }, { status: 400 })
  }

  try {
    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + TECH_INVITE_TTL_MS).toISOString()

    await createTechInviteStub({
      ownerUserId: userId,
      ownerBusinessName: owner.business_name,
      name,
      phone,
      token,
      expiresAt,
    })

    // Fire the white-labeled invite SMS immediately.
    const baseUrl = resolveAppBaseUrl(req.nextUrl.origin)
    const sms = await sendTechInviteSms({
      ownerUserId: userId,
      toPhone: phone,
      businessName: owner.business_name,
      token,
      baseUrl,
    })

    // Return the refreshed roster so the UI updates, plus invite/SMS status.
    const technicians = await listFieldTechnicians(userId)
    return NextResponse.json({
      data: {
        technicians,
        invite: {
          name,
          phone,
          expires_at: expiresAt,
          setup_url: sms.setupUrl,
          sms_sent: sms.sent,
          sms_error: sms.error,
        },
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not invite technician"
    console.error("[POST /api/technicians] failed:", e)
    // Surface friendly validation/migration errors to the owner.
    const isUserFacing = /already has|migration|missing (column|table)/i.test(msg)
    return NextResponse.json({ error: isUserFacing ? msg : "Could not invite technician" }, {
      status: isUserFacing ? 409 : 500,
    })
  }
}
