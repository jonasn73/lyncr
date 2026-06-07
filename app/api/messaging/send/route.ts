// POST /api/messaging/send — owner reply from the dashboard SMS thread UI.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  getActivePhoneNumberByE164,
  getDefaultOrganizationForOwner,
  getOrganizationForOwner,
  getUser,
  insertSmsMessage,
  normalizePhoneNumberE164,
} from "@/lib/db"
import { sendTelnyxSms } from "@/lib/telnyx-sms"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const user = await getUser(userId)
  if (!user || user.account_role !== "owner") {
    return NextResponse.json({ error: "Only business owners can send SMS" }, { status: 403 })
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      to?: string
      text?: string
      from_number?: string
      organization_id?: string
    }

    const text = String(body.text ?? "").trim()
    const toE164 = normalizePhoneNumberE164(String(body.to ?? "").trim())
    if (!toE164) return NextResponse.json({ error: "Recipient phone number is required" }, { status: 400 })
    if (!text) return NextResponse.json({ error: "Message text is required" }, { status: 400 })

    let organizationId = String(body.organization_id ?? "").trim()
    if (!organizationId) {
      const def = await getDefaultOrganizationForOwner(userId)
      organizationId = def?.id ?? ""
    }
    const org = organizationId ? await getOrganizationForOwner(organizationId, userId) : null
    const orgUuid = org?.id?.startsWith("legacy-") ? null : org?.id ?? null

    const fromRaw = String(body.from_number ?? "").trim()
    let fromE164 = fromRaw ? normalizePhoneNumberE164(fromRaw) : ""
    let line = fromE164 ? await getActivePhoneNumberByE164(fromE164) : null
    if (!line || line.user_id !== userId) {
      fromE164 = ""
      line = null
    }

    const sent = await sendTelnyxSms({
      toE164,
      text,
      userId,
      fromE164: fromE164 || undefined,
    })

    if (!sent.ok) {
      return NextResponse.json({ error: sent.error, errorType: sent.errorType }, { status: 400 })
    }

    if (!line && sent.from) {
      line = await getActivePhoneNumberByE164(sent.from)
    }

    const message = await insertSmsMessage({
      organization_id: line?.organization_id && !line.organization_id.startsWith("legacy-")
        ? line.organization_id
        : orgUuid,
      owner_user_id: userId,
      phone_number_id: line?.id ?? null,
      direction: "outbound",
      from_number: sent.from,
      to_number: sent.to,
      body: text,
      customer_phone: toE164,
      telnyx_message_id: sent.message_id,
      status: sent.delivery_warning ? "accepted_with_warning" : "sent",
    })

    return NextResponse.json({
      data: {
        message,
        delivery_warning: sent.delivery_warning,
      },
    })
  } catch (e) {
    console.error("[POST /api/messaging/send]", e)
    return NextResponse.json({ error: "Could not send message" }, { status: 500 })
  }
}
