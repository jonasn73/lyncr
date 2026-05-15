// ============================================
// POST /api/numbers/porting-webhook
// ============================================
// Provider porting webhook (legacy adapter endpoint).
// When a number is completed we set its voice URL and mark it active in our DB.

import { NextRequest, NextResponse } from "next/server"
import { getLegacyProviderClient, getLegacyAppUrl } from "@/lib/legacy-voice-provider"
import {
  getPhoneNumberByNumberAndStatus,
  updatePhoneNumber,
} from "@/lib/db"

/** Legacy porting webhook payload shape. */
interface PortingWebhookBody {
  port_in_request_sid?: string
  port_in_phone_number_sid?: string
  last_date_updated?: string
  phone_number?: string | null
  status?: string
  portable?: string
  not_portable_reason_code?: string | null
  not_portable_reason?: string | null
  rejection_reason?: string | null
  rejection_reason_code?: string | null
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  return phone.startsWith("+") ? phone : `+${digits}`
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as PortingWebhookBody
    const phoneNumber = body.phone_number
    const status = (body.status || "").toLowerCase()

    // Only act when the number has been successfully ported and activated.
    const isCompleted =
      status === "completed" ||
      status.includes("completed") ||
      status === "port_in_phone_number_completed"

    if (!phoneNumber || !isCompleted) {
      return NextResponse.json({ received: true })
    }

    const number = normalizePhone(phoneNumber)
    const row = await getPhoneNumberByNumberAndStatus(number, "porting")
    if (!row) {
      return NextResponse.json({ received: true })
    }

    const client = getLegacyProviderClient()
    const list = await client.incomingPhoneNumbers.list({
      phoneNumber: number,
    })
    if (list.length === 0) {
      return NextResponse.json({ received: true })
    }

    const providerNumber = list[0]
    const appUrl = getLegacyAppUrl()

    await client.incomingPhoneNumbers(providerNumber.sid).update({
      voiceUrl: `${appUrl}/api/voice/incoming`,
      voiceMethod: "POST",
      statusCallback: `${appUrl}/api/voice/status`,
      statusCallbackMethod: "POST",
    })

    await updatePhoneNumber(row.id, row.user_id, {
      provider_number_sid: providerNumber.sid,
      status: "active",
    })

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error("[Sigo] Porting webhook error:", error)
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    )
  }
}
