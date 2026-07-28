// POST /api/intake/suggest — confirm-only AI prefill for intake (never creates a job).

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  generateIntakeAiSuggestion,
  type IntakeAiSuggestInput,
} from "@/lib/intake-ai-suggest"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const input: IntakeAiSuggestInput = {
    phone: typeof body.phone === "string" ? body.phone : null,
    notes: typeof body.notes === "string" ? body.notes : null,
    customerName: typeof body.customerName === "string" ? body.customerName : null,
    customerNotes: typeof body.customerNotes === "string" ? body.customerNotes : null,
    openServiceTypeId:
      typeof body.openServiceTypeId === "string"
        ? body.openServiceTypeId
        : typeof body.serviceTypeId === "string"
          ? body.serviceTypeId
          : null,
    openQuoteCents:
      typeof body.openQuoteCents === "number"
        ? body.openQuoteCents
        : typeof body.quotedPriceCents === "number"
          ? body.quotedPriceCents
          : null,
    vehicleYear: typeof body.vehicleYear === "string" ? body.vehicleYear : null,
    vehicleMake: typeof body.vehicleMake === "string" ? body.vehicleMake : null,
    vehicleModel: typeof body.vehicleModel === "string" ? body.vehicleModel : null,
    callContext: typeof body.callContext === "string" ? body.callContext : null,
  }

  try {
    const suggestion = await generateIntakeAiSuggestion(input)
    return NextResponse.json({
      data: {
        ...suggestion,
        // Explicit: caller must confirm before booking — API never creates jobs.
        requires_confirmation: true,
        auto_booked: false,
      },
    })
  } catch (e) {
    console.error("[POST /api/intake/suggest]", e)
    return NextResponse.json({ error: "Suggestion failed" }, { status: 500 })
  }
}
