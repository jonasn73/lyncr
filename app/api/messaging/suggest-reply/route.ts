// POST /api/messaging/suggest-reply — draft 1–2 SMS replies (never sends).
// Uses OpenAI when OPENAI_API_KEY is set; otherwise rule-based chips/drafts.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUser } from "@/lib/db"
import {
  extractBusinessNameFromSmsBody,
  extractVehicleFromSmsBody,
  generateSmsReplySuggestions,
} from "@/lib/sms-reply-suggestions"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  // Require a logged-in owner session cookie.
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Parse JSON body from the sheet.
  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // Customer’s last inbound text is required.
  const customerMessage = String(body.customer_message ?? body.customerMessage ?? "").trim()
  if (!customerMessage) {
    return NextResponse.json({ error: "customer_message is required" }, { status: 400 })
  }

  // Optional context fields from the sheet.
  const customerName =
    typeof body.customer_name === "string"
      ? body.customer_name
      : typeof body.customerName === "string"
        ? body.customerName
        : null
  const priorOutbound =
    typeof body.prior_outbound === "string"
      ? body.prior_outbound
      : typeof body.priorOutbound === "string"
        ? body.priorOutbound
        : null
  const vehicleExplicit =
    typeof body.vehicle === "string" ? body.vehicle.trim() : ""

  // Prefer explicit business_name; else users.business_name; else outbound prefix.
  let businessName =
    typeof body.business_name === "string"
      ? body.business_name.trim()
      : typeof body.businessName === "string"
        ? body.businessName.trim()
        : ""
  if (!businessName) {
    try {
      const user = await getUser(userId)
      businessName = String(user?.business_name ?? "").trim()
    } catch {
      businessName = ""
    }
  }
  if (!businessName) {
    businessName = extractBusinessNameFromSmsBody(priorOutbound) || ""
  }

  // Vehicle from request or scraped from prior outbound.
  const vehicle =
    vehicleExplicit || extractVehicleFromSmsBody(priorOutbound) || null

  try {
    // Generate chips + drafts (OpenAI polish when key present).
    const suggestion = await generateSmsReplySuggestions({
      customerMessage,
      customerName,
      businessName: businessName || null,
      vehicle,
      priorOutbound,
    })
    // Never send — client must put a draft in the composer and tap Send.
    return NextResponse.json({
      data: {
        ...suggestion,
        requires_confirmation: true,
        auto_sent: false,
      },
    })
  } catch (e) {
    console.error("[POST /api/messaging/suggest-reply]", e)
    return NextResponse.json({ error: "Suggestion failed" }, { status: 500 })
  }
}
