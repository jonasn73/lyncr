// ============================================
// GET /api/numbers/telnyx
// ============================================
// Search available Telnyx phone numbers by area code (US).
// Returns a list of numbers you can then buy via POST /api/numbers/telnyx/buy

import { NextRequest, NextResponse } from "next/server"

const TELNYX_BASE = "https://api.telnyx.com/v2"

function getApiKey(): string {
  const key = process.env.TELNYX_API_KEY
  if (!key) throw new Error("Missing TELNYX_API_KEY")
  return key
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const areaCode = searchParams.get("area_code") || "212"
    const type = searchParams.get("type") || "local"

    // Build Telnyx query params
    const params = new URLSearchParams({
      "filter[country_code]": "US",
      "filter[national_destination_code]": areaCode,
      "filter[phone_number_type]": type === "toll_free" ? "toll_free" : "local",
      "filter[features][]": "voice",
      "filter[limit]": "25",
    })

    const res = await fetch(`${TELNYX_BASE}/available_phone_numbers?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
      },
    })

    const body = await res.json()

    if (!res.ok) {
      const errMsg = body?.errors?.[0]?.detail || body?.errors?.[0]?.title || `HTTP ${res.status}`
      console.error("[Telnyx] Number search error:", errMsg)
      return NextResponse.json({ error: errMsg }, { status: res.status })
    }

    const rawNumbers = body?.data || []

    const numbers = rawNumbers.map((item: Record<string, unknown>) => ({
      number: item.phone_number || "",
      friendly_name: item.phone_number || "",
      type: type,
      monthly_cost: (item.cost_information as Record<string, unknown>)?.monthly_cost ?? 1.0,
    }))

    return NextResponse.json({ numbers })
  } catch (error) {
    console.error("[Telnyx] Error searching numbers:", error)
    return NextResponse.json(
      { error: "Failed to search available numbers" },
      { status: 500 }
    )
  }
}
