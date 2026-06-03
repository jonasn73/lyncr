// ============================================
// GET /api/receptionist/company-briefing?number=<inbound line E.164>
// ============================================
// Powers the receptionist web-phone "Company Briefing Card" screen-pop. Given the inbound business
// line, returns the company attributes (business_name, business_hours, service_rules,
// business_instructions) so the operator can answer as that specific business.
//
// Resolution order:
//   1) match the inbound `number` against a business line (reserved_number / phone_numbers), then
//   2) fall back to the business this receptionist is linked to, so the card still populates when
//      the carrier leg didn't carry the dialed DID.
// Always responds 200 with { data: { found, ... } } so the UI can render gracefully on a miss.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getReceptionistPortalContext } from "@/lib/receptionist-portal-auth"
import { getCompanyBriefingByNumber, getCompanyBriefingByOwnerId } from "@/lib/db"
import type { CompanyBriefing } from "@/lib/types"

export const dynamic = "force-dynamic"

const EMPTY_BRIEFING: CompanyBriefing = {
  found: false,
  business_name: null,
  business_hours: null,
  service_rules: null,
  business_instructions: null,
}

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const ctx = await getReceptionistPortalContext(userId)
    if (!ctx) {
      return NextResponse.json({ error: "Receptionist portal access required" }, { status: 403 })
    }

    const number = req.nextUrl.searchParams.get("number")?.trim() || ""

    // 1) Try the inbound business line.
    let briefing: CompanyBriefing | null = null
    if (number) {
      briefing = await getCompanyBriefingByNumber(number)
    }

    // 2) Fall back to the receptionist's own linked business so the card still populates.
    if (!briefing) {
      briefing = await getCompanyBriefingByOwnerId(ctx.owner_user_id)
    }

    // 3) Last resort: at least surface the business name we already know.
    if (!briefing) {
      briefing = { ...EMPTY_BRIEFING, business_name: ctx.business_name || null }
    }

    return NextResponse.json({ data: briefing })
  } catch (e) {
    console.error("[receptionist/company-briefing GET]", e)
    // Never break the screen-pop — degrade to an empty card.
    return NextResponse.json({ data: EMPTY_BRIEFING })
  }
}
