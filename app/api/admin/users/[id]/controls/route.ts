// ============================================
// GET / PATCH / DELETE /api/admin/users/[id]/controls
// ============================================
// Tenant drawer overrides (admin@lyncr.app only):
//   GET    → feature flags, phone lines, workspaces, team roster, pending invites
//   PATCH  → toggle one feature flag ({ flag, enabled })
//   DELETE → release one provisioned line back to the pool ({ lineId })

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import {
  ADMIN_FEATURE_FLAGS,
  countActiveFieldTechniciansForOwner,
  countActiveReceptionistsForOwner,
  getMessaging10DlcRegistration,
  getOrganizationSmsRegistrationStatus,
  getPhoneNumbers,
  getProfileFeatureFlags,
  getSmsRegistrationForOrganization,
  listOrganizationsForOwner,
  listTeamInvitesForInviter,
  markPhoneNumberReleasedForUser,
  setProfileFeatureFlag,
} from "@/lib/db"
import type {
  AdminTenantControlOrganization,
  AdminTenantControlPendingInvite,
  AdminTenantControls,
  SmsRegistrationOrgStatus,
} from "@/lib/types"

export const dynamic = "force-dynamic"

function normalizeOrgSmsStatus(raw: string | null | undefined): SmsRegistrationOrgStatus {
  const s = String(raw ?? "NONE").toUpperCase()
  if (s === "PENDING_APPROVAL" || s === "APPROVED" || s === "REJECTED") return s
  return "NONE"
}

async function mapOrganizationControls(
  userId: string,
  org: Awaited<ReturnType<typeof listOrganizationsForOwner>>[number]
): Promise<AdminTenantControlOrganization> {
  const [smsReg, dlcReg, orgStatus] = await Promise.all([
    getSmsRegistrationForOrganization(userId, org.id),
    getMessaging10DlcRegistration(userId, org.id),
    org.sms_registration_status != null
      ? Promise.resolve(org.sms_registration_status)
      : getOrganizationSmsRegistrationStatus(org.id, userId),
  ])

  return {
    id: org.id,
    name: org.name,
    is_default: org.is_default,
    sms_registration_status: normalizeOrgSmsStatus(orgStatus ?? org.sms_registration_status ?? "NONE"),
    sms_registration: smsReg
      ? {
          id: smsReg.id,
          legal_business_name: smsReg.legal_business_name,
          status: smsReg.status,
        }
      : null,
    messaging_10dlc: dlcReg
      ? {
          status: dlcReg.status,
          brand_id: dlcReg.brand_id,
          campaign_id: dlcReg.campaign_id,
          legal_company_name: dlcReg.legal_company_name,
          display_name: dlcReg.display_name,
        }
      : null,
  }
}

async function loadControls(userId: string): Promise<AdminTenantControls> {
  const [feature_flags, lines, organizations, activeReceptionists, activeFieldTechnicians, teamInvites] =
    await Promise.all([
      getProfileFeatureFlags(userId),
      getPhoneNumbers(userId),
      listOrganizationsForOwner(userId),
      countActiveReceptionistsForOwner(userId),
      countActiveFieldTechniciansForOwner(userId),
      listTeamInvitesForInviter(userId),
    ])

  const phone_lines = lines
    .filter((l) => l.status !== "released")
    .map((l) => ({
      id: l.id,
      number: l.number,
      label: l.label || "Line",
      status: l.status,
      type: l.type,
    }))

  const orgControls = await Promise.all(organizations.map((org) => mapOrganizationControls(userId, org)))

  const realOrgCount = organizations.filter((o) => !o.id.startsWith("legacy-")).length
  const is_multi_workspace = realOrgCount > 1

  const pending_invites: AdminTenantControlPendingInvite[] = teamInvites
    .filter((inv) => inv.status === "PENDING")
    .map((inv) => ({
      id: inv.id,
      target: inv.channel === "SMS" ? inv.phone || inv.email || "—" : inv.email || inv.phone || "—",
      channel: inv.channel,
      status: inv.status,
      created_at: inv.created_at,
      expires_at: inv.expires_at,
    }))

  return {
    feature_flags,
    phone_lines,
    is_multi_workspace,
    team_roster: {
      active_receptionists: activeReceptionists,
      active_field_technicians: activeFieldTechnicians,
    },
    organizations: orgControls,
    pending_invites,
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireLyncrAdmin(req)
  if (guard instanceof NextResponse) return guard
  const { id } = await ctx.params

  try {
    return NextResponse.json({ data: await loadControls(id) })
  } catch (e) {
    console.error("[admin/controls] GET:", e)
    return NextResponse.json({ error: "Could not load tenant controls" }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireLyncrAdmin(req)
  if (guard instanceof NextResponse) return guard
  const { id } = await ctx.params

  const body = (await req.json().catch(() => ({}))) as { flag?: string; enabled?: boolean }
  const flag = String(body.flag || "").trim()
  if (!(ADMIN_FEATURE_FLAGS as readonly string[]).includes(flag)) {
    return NextResponse.json({ error: "Unknown feature flag" }, { status: 400 })
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 })
  }

  try {
    const feature_flags = await setProfileFeatureFlag(id, flag, body.enabled)
    return NextResponse.json({ data: { feature_flags } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not update feature flag"
    console.error("[admin/controls] PATCH:", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireLyncrAdmin(req)
  if (guard instanceof NextResponse) return guard
  const { id } = await ctx.params

  const body = (await req.json().catch(() => ({}))) as { lineId?: string }
  const lineId = String(body.lineId || "").trim()
  if (!lineId) return NextResponse.json({ error: "lineId is required" }, { status: 400 })

  try {
    const released = await markPhoneNumberReleasedForUser(lineId, id)
    if (!released) {
      return NextResponse.json({ error: "Line not found or not active" }, { status: 404 })
    }
    return NextResponse.json({ data: await loadControls(id) })
  } catch (e) {
    console.error("[admin/controls] DELETE:", e)
    return NextResponse.json({ error: "Could not release line" }, { status: 500 })
  }
}
