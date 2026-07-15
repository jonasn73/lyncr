// ============================================
// GET /api/numbers
// POST /api/numbers (buy a number)
// ============================================
// Legacy numbers endpoint (kept for compatibility).
// Primary number search/buy flow uses /api/numbers/telnyx and /api/numbers/telnyx/buy.

import { NextRequest, NextResponse } from "next/server"
import { getLegacyProviderClient } from "@/lib/legacy-voice-provider"
import { getPhoneNumbers } from "@/lib/db"
import type { BuyNumberRequest } from "@/lib/types"

const DEMO_USER_ID = "demo-user-id"

export async function GET() {
  try {
    const numbers = await getPhoneNumbers(DEMO_USER_ID)
    return NextResponse.json({ numbers })
  } catch (error) {
    console.error("[lyncr] Error fetching numbers:", error)
    return NextResponse.json(
      { error: "Failed to fetch phone numbers" },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: BuyNumberRequest = await req.json()
    const client = getLegacyProviderClient()

    // Search for available numbers
    const available = await client.availablePhoneNumbers("US")
      .local.list({
        areaCode: parseInt(body.area_code, 10),
        limit: 5,
      })

    if (available.length === 0) {
      return NextResponse.json(
        { error: "No numbers available for that area code" },
        { status: 404 }
      )
    }

    return NextResponse.json({
      numbers: available.map((num) => ({
        number: num.phoneNumber,
        friendly_name: num.friendlyName,
        type: "local" as const,
        monthly_cost: 2.99, // Example local number pricing
      })),
    })
  } catch (error) {
    console.error("[lyncr] Error searching numbers:", error)
    return NextResponse.json(
      { error: "Failed to search numbers" },
      { status: 500 }
    )
  }
}
