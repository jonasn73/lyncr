// ============================================
// POST /api/numbers/buy
// ============================================
// Legacy number purchase endpoint (kept for compatibility/testing).
// Primary purchase flow uses /api/numbers/telnyx/buy.

import { NextRequest, NextResponse } from "next/server"
import { getLegacyProviderClient, getLegacyAppUrl } from "@/lib/legacy-voice-provider"

const DEMO_USER_ID = "demo-user-id"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { phone_number } = body as { phone_number: string }

    const client = getLegacyProviderClient()
    const appUrl = getLegacyAppUrl()

    // Purchase the number
    const purchased = await client.incomingPhoneNumbers.create({
      phoneNumber: phone_number,
      voiceUrl: `${appUrl}/api/voice/incoming`,
      voiceMethod: "POST",
      statusCallback: `${appUrl}/api/voice/status`,
      statusCallbackMethod: "POST",
    })

    // TODO: Save to database
    // await sql`
    //   INSERT INTO phone_numbers (user_id, provider_number_sid, number, friendly_name, label, type, status)
    //   VALUES (${DEMO_USER_ID}, ${purchased.sid}, ${purchased.phoneNumber}, ${purchased.friendlyName}, 'New Line', 'local', 'active')
    // `

    return NextResponse.json({
      success: true,
      number: {
        provider_number_sid: purchased.sid,
        number: purchased.phoneNumber,
        friendly_name: purchased.friendlyName,
      },
    })
  } catch (error) {
    console.error("[lyncr] Error buying number:", error)
    return NextResponse.json(
      { error: "Failed to purchase number" },
      { status: 500 }
    )
  }
}
