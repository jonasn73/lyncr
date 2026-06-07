// GET/POST /api/settings/10dlc — dashboard SMS carrier compliance registration.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  getDefaultOrganizationForOwner,
  getMessaging10DlcRegistration,
  getOrganizationForOwner,
  getOrganizationSmsRegistrationStatus,
  getSmsRegistrationForOwner,
  getUser,
} from "@/lib/db"
import { getMessaging10DlcView } from "@/lib/messaging-10dlc"
import { submitSmsRegistrationForOwner, type SmsRegistrationFormInput } from "@/lib/sms-registration-service"

export const dynamic = "force-dynamic"

async function resolveOrganizationId(ownerUserId: string, raw?: string | null): Promise<string | null> {
  const trimmed = String(raw ?? "").trim()
  if (trimmed) {
    const org = await getOrganizationForOwner(trimmed, ownerUserId)
    return org?.id ?? null
  }
  const def = await getDefaultOrganizationForOwner(ownerUserId)
  return def?.id ?? null
}

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const user = await getUser(userId)
  if (!user || user.account_role !== "owner") {
    return NextResponse.json({ error: "Only business owners can manage SMS registration" }, { status: 403 })
  }

  try {
    const organizationId = await resolveOrganizationId(
      userId,
      req.nextUrl.searchParams.get("organization_id")
    )
    const [registration, orgStatus, legacyView] = await Promise.all([
      getSmsRegistrationForOwner(userId, organizationId),
      organizationId ? getOrganizationSmsRegistrationStatus(organizationId, userId) : null,
      getMessaging10DlcView(userId),
    ])

    const pending =
      registration?.status === "PENDING_APPROVAL" ||
      orgStatus === "PENDING_APPROVAL" ||
      ["paid", "submitted", "pending_review"].includes(legacyView.registration?.status ?? "")

    return NextResponse.json({
      data: {
        registration,
        organization_id: organizationId,
        organization_status: orgStatus ?? (registration?.status === "PENDING_APPROVAL" ? "PENDING_APPROVAL" : "NONE"),
        sms_ready: legacyView.sms_ready,
        pending_approval: pending,
        legacy_registration: legacyView.registration,
      },
    })
  } catch (e) {
    console.error("[GET /api/settings/10dlc]", e)
    return NextResponse.json({ error: "Could not load SMS registration" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const user = await getUser(userId)
  if (!user || user.account_role !== "owner") {
    return NextResponse.json({ error: "Only business owners can submit SMS registration" }, { status: 403 })
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Partial<SmsRegistrationFormInput>
    const result = await submitSmsRegistrationForOwner(userId, {
      organization_id: body.organization_id,
      legal_business_name: String(body.legal_business_name ?? ""),
      entity_type: String(body.entity_type ?? ""),
      tax_id_ein: body.tax_id_ein != null ? String(body.tax_id_ein) : undefined,
      street: String(body.street ?? ""),
      city: String(body.city ?? ""),
      state: String(body.state ?? ""),
      postal_code: String(body.postal_code ?? ""),
      use_case_description: String(body.use_case_description ?? ""),
    })

    const legacy = await getMessaging10DlcRegistration(userId)

    return NextResponse.json({
      success: true,
      message: "Your SMS business registration was submitted for carrier review.",
      data: {
        registration: result.registration,
        organization_status: result.org_status,
        legacy_registration: legacy,
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not submit registration"
    console.error("[POST /api/settings/10dlc]", e)
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
