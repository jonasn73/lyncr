// ============================================
// POST /api/numbers/telnyx/buy
// ============================================
// Purchase a carrier phone number when tier + carrier credit allow it.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { purchasePhoneNumberForUser } from "@/lib/number-allocation"
import { getTelnyxApiKey } from "@/lib/telnyx-config"

const MAX_LINE_BUSINESS_NAME_LEN = 120

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  getTelnyxApiKey()

  try {
    const body = await req.json()
    const { phone_number, line_business_name, organization_id } = body as {
      phone_number: string
      line_business_name?: string
      organization_id?: string
    }

    if (!phone_number) {
      return NextResponse.json({ error: "Phone number is required" }, { status: 400 })
    }
    const label =
      typeof line_business_name === "string" ? line_business_name.trim().slice(0, MAX_LINE_BUSINESS_NAME_LEN) : ""
    if (!label) {
      return NextResponse.json(
        { error: "Business name for this line is required (what your team hears for this number)." },
        { status: 400 }
      )
    }

    const result = await purchasePhoneNumberForUser(
      userId,
      phone_number,
      label,
      undefined,
      organization_id?.trim() || null
    )
    if (!result.ok) {
      const status = result.reason === "tier_limit" ? 403 : result.reason === "insufficient_credit" ? 402 : 422
      return NextResponse.json({ error: result.error, reason: result.reason }, { status })
    }

    console.log(`[lyncr] Number ${result.phone_number} purchased (order: ${result.order_id})`)

    return NextResponse.json({
      success: true,
      number: {
        telnyx_order_id: result.order_id,
        number: result.phone_number,
        friendly_name: result.phone_number,
        label,
      },
    })
  } catch (error) {
    console.error("[Telnyx] Error buying number:", error)
    return NextResponse.json(
      { error: "Failed to purchase number" },
      { status: 500 }
    )
  }
}
