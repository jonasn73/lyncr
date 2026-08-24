// ============================================
// GET /api/receptionist/caller?number=<caller E.164>
// ============================================
// Powers the caller half of the receptionist screen-pop: who is ringing, and the handful of
// CRM facts worth knowing before saying hello. The company half is /company-briefing.
//
// Always responds 200 with { data: { found, ... } } — an unknown caller is a normal outcome
// and the card still has to render before the operator picks up.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getReceptionistPortalContext } from "@/lib/receptionist-portal-auth"
import { EMPTY_CALLER_LOOKUP, lookupReceptionistCaller } from "@/lib/receptionist-caller-lookup"

export const dynamic = "force-dynamic"

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

    const number = req.nextUrl.searchParams.get("number")
    const data = await lookupReceptionistCaller(ctx.owner_user_id, number)
    return NextResponse.json({ data })
  } catch (error) {
    console.error("[lyncr] receptionist caller lookup:", error)
    // Never fail the screen-pop over a lookup — render it unknown instead.
    return NextResponse.json({ data: EMPTY_CALLER_LOOKUP })
  }
}
