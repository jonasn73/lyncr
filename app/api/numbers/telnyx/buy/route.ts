// ============================================
// POST /api/numbers/telnyx/buy
// ============================================
// Purchase a Telnyx phone number, configure it with our TeXML webhook,
// and save it to the database.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { insertPhoneNumber } from "@/lib/db"
import {
  getTelnyxApiKey,
  telnyxHeaders,
  getOrCreateTexmlApp,
  configureNumberVoice,
} from "@/lib/telnyx-config"

const TELNYX_BASE = "https://api.telnyx.com/v2"
const MAX_LINE_BUSINESS_NAME_LEN = 120

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  // Verify API key is available
  getTelnyxApiKey()

  try {
    const body = await req.json()
    const { phone_number, line_business_name } = body as { phone_number: string; line_business_name?: string }

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

    // Step 1: Purchase the number
    const res = await fetch(`${TELNYX_BASE}/number_orders`, {
      method: "POST",
      headers: telnyxHeaders(),
      body: JSON.stringify({
        phone_numbers: [{ phone_number }],
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      const errMsg = data?.errors?.[0]?.detail || data?.errors?.[0]?.title || "Purchase failed"
      console.error("[Telnyx] Buy error:", errMsg)
      return NextResponse.json({ error: errMsg }, { status: res.status })
    }

    const orderId = data?.data?.id || ""
    const boughtNumber = data?.data?.phone_numbers?.[0]?.phone_number || phone_number

    // Step 2: Configure the number with our TeXML webhook so calls route to the app
    // Telnyx sometimes needs a moment after purchase before the number is configurable
    const texmlAppId = await getOrCreateTexmlApp()
    try {
      await configureNumberVoice(boughtNumber, texmlAppId)
    } catch {
      await new Promise((r) => setTimeout(r, 3000))
      try {
        await configureNumberVoice(boughtNumber, texmlAppId)
      } catch (retryErr) {
        console.error("[Zing] Voice config failed after retry (number still purchased):", retryErr)
      }
    }

    // Step 3: Save to database
    const saved = await insertPhoneNumber({
      user_id: userId,
      number: boughtNumber,
      friendly_name: boughtNumber,
      label,
      type: "local",
      status: "active",
      provider_number_sid: orderId,
    })

    console.log(`[Zing] Number ${boughtNumber} purchased, configured, and saved (order: ${orderId}, db: ${saved.id})`)

    return NextResponse.json({
      success: true,
      number: {
        id: saved.id,
        telnyx_order_id: orderId,
        number: boughtNumber,
        friendly_name: boughtNumber,
        label: saved.label,
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
