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
import { globalPlatformSessionFields, isGlobalPlatformAdmin } from "@/lib/platform-admin"
import {
  IMPERSONATION_ADMIN_COOKIE,
  verifyImpersonationAdminCookie,
} from "@/lib/admin-impersonation"
import {
  resolveTechnicianTargetWorkspace,
  TechnicianWorkspaceError,
} from "@/lib/technician-workspace-binding"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  try {
    const orgParam = req.nextUrl.searchParams.get("organization_id")?.trim() || null
    const technicians = await listFieldTechnicians(userId, orgParam)
    return NextResponse.json({ data: technicians, organization_id: orgParam })
  } catch (e) {
    console.error("[GET /api/technicians] failed:", e)
    return NextResponse.json({ error: "Failed to list technicians" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const sessionUser = await getUser(userId)
  if (!sessionUser) {
    return NextResponse.json({ error: "User not found" }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    firstName?: string
    lastName?: string
    name?: string
    phone?: string
    email?: string
    isManual?: boolean
    workspaceId?: string
    businessId?: string
    organization_id?: string
    organizationId?: string
  }
  const firstName = String(body.firstName || "").trim()
  const lastName = String(body.lastName || "").trim()
  const name = (firstName || lastName ? `${firstName} ${lastName}` : String(body.name || "")).trim()
  const phone = String(body.phone || "").trim()
  const isManual = body.isManual === true

  let targetWorkspace: Awaited<ReturnType<typeof resolveTechnicianTargetWorkspace>>
  try {
    targetWorkspace = await resolveTechnicianTargetWorkspace({
      sessionUserId: userId,
      workspaceId: body.workspaceId,
      businessId: body.businessId,
      organizationId: body.organizationId,
      organization_id: body.organization_id,
      headerWorkspaceId: req.headers.get("x-lyncr-workspace-id"),
    })
  } catch (e) {
    if (e instanceof TechnicianWorkspaceError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    throw e
  }

  const { ownerUserId, workspaceId: targetWorkspaceId, owner } = targetWorkspace

  if (!isManual && (sessionUser.account_role !== "owner" || ownerUserId !== userId)) {
    return NextResponse.json({ error: "Only business owners can add technicians" }, { status: 403 })
  }

  if (!name || name.length < 2) {
    return NextResponse.json({ error: "Name is required (at least 2 characters)" }, { status: 400 })
  }
  const phoneDigits = phone.replace(/\D/g, "")
  if (phoneDigits.length < 10) {
    return NextResponse.json({ error: "Enter a valid mobile phone number" }, { status: 400 })
  }

  if (isManual) {
    const cookieHeader = req.headers.get("cookie") ?? ""
    const impersonationMatch = cookieHeader.match(new RegExp(`${IMPERSONATION_ADMIN_COOKIE}=([^;]+)`))
    const impersonatingAdminId = verifyImpersonationAdminCookie(impersonationMatch?.[1]?.trim())
    const globalActor = impersonatingAdminId ? (await getUser(impersonatingAdminId)) ?? sessionUser : sessionUser
    const platformActor = {
      ...globalPlatformSessionFields(globalActor),
      email: globalActor.email,
    }
    if (!isGlobalPlatformAdmin(platformActor)) {
      return NextResponse.json(
        { error: "Access Denied: Only a Platform Admin can manually override provisioning." },
        { status: 403 }
      )
    }
  }

  try {
    if (isManual) {
      const { rosterId } = await createManualFieldTechnician({
        ownerUserId,
        ownerBusinessName: owner.business_name,
        name,
        phone,
        organizationId: targetWorkspaceId,
      })
      const technicians = await listFieldTechnicians(ownerUserId, targetWorkspaceId)
      const technician =
        (await getFieldTechnicianByIdForOwner(ownerUserId, rosterId)) ??
        technicians.find((t) => t.id === rosterId) ??
        null
      if (!technician) {
        return NextResponse.json({ error: "Technician was created but could not be loaded" }, { status: 500 })
      }
      return NextResponse.json({
        success: true,
        data: {
          technician,
          technicians,
          workspaceId: targetWorkspaceId,
          ownerUserId,
        },
      })
    }

    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + TECH_INVITE_TTL_MS).toISOString()

    const { userId: portalUserId } = await createTechInviteStub({
      ownerUserId,
      ownerBusinessName: owner.business_name,
      name,
      phone,
      token,
      expiresAt,
      organizationId: targetWorkspaceId,
    })

    const baseUrl = resolveAppBaseUrl(req.nextUrl.origin)
    const sms = await sendTechInviteSms({
      ownerUserId,
      organizationId: targetWorkspaceId,
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

    const technicians = await listFieldTechnicians(ownerUserId, targetWorkspaceId)
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

    if (!sms.success && sms.errorType && sms.errorType !== "OTHER") {
      return NextResponse.json({
        success: false,
        errorType: sms.errorType,
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
