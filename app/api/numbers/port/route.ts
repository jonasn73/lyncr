// POST /api/numbers/port — submit a native Telnyx LNP port request (no Twilio webhook forwarding).

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  createPortingOrder,
  ensurePortingLineRecord,
  getOrganizationForOwner,
  getUser,
} from "@/lib/db"
import { SITE_NAME } from "@/lib/brand"
import {
  PORT_ADDRESS_ERROR_CODE,
  PORT_ADDRESS_ERROR_MESSAGE,
  resolvePortOrganizationId,
  validatePortServiceAddress,
} from "@/lib/port-address-validation"
import { classifyTelnyxPortError, submitTelnyxLnpPort, toPortE164 } from "@/lib/telnyx-lnp-submit"

export const dynamic = "force-dynamic"

const MAX_LINE_LABEL_LEN = 120

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const owner = await getUser(userId)
  if (!owner || owner.account_role !== "owner") {
    return NextResponse.json({ error: "Only business owners can submit port requests" }, { status: 403 })
  }

  try {
    const body = (await req.json()) as {
      organization_id?: string
      phone_number?: string
      number?: string
      current_carrier?: string
      account_number?: string
      pin_or_sid?: string
      pin?: string
      line_business_name?: string
      line_label?: string
      invoice_base64?: string
      invoice_filename?: string
    }

    const rawNumber = String(body.phone_number ?? body.number ?? "").trim()
    const currentCarrier = String(body.current_carrier ?? "").trim()
    const accountNumber = String(body.account_number ?? "").trim()
    const pinOrSid = String(body.pin_or_sid ?? body.pin ?? "").trim()
    const lineLabel = String(body.line_label ?? body.line_business_name ?? "").trim().slice(0, MAX_LINE_LABEL_LEN)

    if (!rawNumber) return NextResponse.json({ error: "Phone number to transfer is required" }, { status: 400 })
    if (!currentCarrier) return NextResponse.json({ error: "Current carrier name is required" }, { status: 400 })
    if (!accountNumber) return NextResponse.json({ error: "Account number or SID is required" }, { status: 400 })
    if (!lineLabel) {
      return NextResponse.json({ error: "Line label is required (shown to your team on inbound calls)" }, { status: 400 })
    }
    if (!body.invoice_base64) {
      return NextResponse.json(
        { error: "Upload your latest carrier invoice or bill (PDF or image) — required for regulatory compliance." },
        { status: 400 }
      )
    }

    let organizationId = String(body.organization_id ?? "").trim()
    const { organization_id: resolvedOrgId, org_uuid: orgUuid } = await resolvePortOrganizationId(
      userId,
      organizationId || undefined
    )
    organizationId = resolvedOrgId ?? organizationId
    if (!organizationId) {
      return NextResponse.json({ error: "No business workspace found" }, { status: 404 })
    }
    const org = await getOrganizationForOwner(organizationId, userId)
    if (!org) return NextResponse.json({ error: "Workspace not found" }, { status: 404 })

    const addressCheck = await validatePortServiceAddress(userId, orgUuid ?? organizationId)
    if (!addressCheck.ok || !addressCheck.address) {
      return NextResponse.json(
        {
          error: PORT_ADDRESS_ERROR_MESSAGE,
          error_code: PORT_ADDRESS_ERROR_CODE,
          missing_fields: addressCheck.missing_fields,
          organization_id: addressCheck.organization_id,
        },
        { status: 400 }
      )
    }

    const { street, city, state, postal_code: zip } = addressCheck.address

    const telnyx = await submitTelnyxLnpPort({
      userId,
      organizationId: orgUuid ?? organizationId,
      phoneNumber: rawNumber,
      accountName: owner.business_name?.trim() || owner.name || org.name,
      authorizedPerson: owner.name || org.name,
      accountNumber,
      pin: pinOrSid || undefined,
      streetAddress: street,
      city,
      state,
      zip,
      invoiceBase64: body.invoice_base64,
      invoiceFilename: body.invoice_filename,
      lineLabel,
    })

    await ensurePortingLineRecord({
      user_id: userId,
      number: telnyx.e164,
      label: lineLabel,
      port_order_id: telnyx.telnyxOrderId,
      organization_id: orgUuid,
    })

    const order = await createPortingOrder({
      owner_user_id: userId,
      organization_id: orgUuid,
      phone_number: telnyx.e164,
      current_carrier: currentCarrier,
      account_number: accountNumber,
      pin_or_sid: pinOrSid || null,
      status: telnyx.orderStatus,
      telnyx_order_id: telnyx.telnyxOrderId,
      telnyx_status: telnyx.telnyxStatus,
    })

    if (!telnyx.confirmSuccess) {
      return NextResponse.json({
        success: true,
        partial: true,
        message: `Port order created with ${SITE_NAME}. Confirmation is pending — ${telnyx.confirmError ?? "carrier is still processing documents"}.`,
        data: { order },
      })
    }

    return NextResponse.json({
      success: true,
      message: `Official transfer request submitted. ${SITE_NAME} will move ${toPortE164(rawNumber)} onto our network — usually 1–3 business days.`,
      data: { order },
    })
  } catch (error: unknown) {
    console.error("[POST /api/numbers/port] failed:", error)
    const msg = error instanceof Error ? error.message : String(error)
    const classified = classifyTelnyxPortError(msg)
    return NextResponse.json({ success: false, error: classified.error }, { status: classified.status })
  }
}
