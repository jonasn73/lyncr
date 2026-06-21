// GET/POST /api/settings/10dlc — dashboard SMS carrier compliance registration.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  getDefaultOrganizationForOwner,
  getMessaging10DlcRegistration,
  getOrganizationForOwner,
  getUser,
} from "@/lib/db"
import { submitSmsRegistrationForOwner, type SmsRegistrationFormInput } from "@/lib/sms-registration-service"
import { buildSmsRegistrationSubmissionSummary } from "@/lib/sms-registration-submission-summary"
import { refreshMessaging10DlcStatus, ensureMessaging10DlcSubmittedToCarrier } from "@/lib/messaging-10dlc"
import { getWorkspace10DlcCompliance } from "@/lib/workspace-10dlc-compliance"

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

    // Backfill + poll when a workspace shows pending but never received a carrier campaign id.
    try {
      await ensureMessaging10DlcSubmittedToCarrier(userId, organizationId)
      await refreshMessaging10DlcStatus(userId, organizationId)
    } catch (syncErr) {
      console.warn("[GET /api/settings/10dlc] carrier sync:", syncErr)
    }

    const compliance = await getWorkspace10DlcCompliance(userId, organizationId)
    const submission_summary = await buildSmsRegistrationSubmissionSummary(userId, compliance)

    return NextResponse.json({
      data: {
        registration: compliance.registration,
        organization_id: compliance.organization_id,
        organization_status: compliance.organization_status,
        sms_ready: compliance.sms_ready,
        pending_approval: compliance.pending_approval,
        legacy_registration: compliance.telnyx_registration,
        submission_summary,
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

    const organizationId = result.registration.organization_id
    const legacy = organizationId
      ? await getMessaging10DlcRegistration(userId, organizationId)
      : await getMessaging10DlcRegistration(userId)

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
