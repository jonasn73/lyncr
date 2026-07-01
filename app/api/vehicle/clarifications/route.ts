// GET /api/vehicle/clarifications?year=&make=&model=
// Returns call-script questions when YMM alone is ambiguous for key lookup.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getVehicleIntakeClarifications } from "@/lib/vehicle-intake-clarifications"
import { lookupVehicleKeyProfiles } from "@/lib/vehicle-key-reference"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const yearRaw = req.nextUrl.searchParams.get("year")?.trim() ?? ""
  const make = req.nextUrl.searchParams.get("make")?.trim() ?? ""
  const model = req.nextUrl.searchParams.get("model")?.trim() ?? ""

  if (!yearRaw || !make || !model) {
    return NextResponse.json({ error: "year, make, and model are required" }, { status: 400 })
  }

  const lookup = lookupVehicleKeyProfiles(yearRaw, make, model)
  const clarifications = getVehicleIntakeClarifications(
    yearRaw,
    make,
    model,
    lookup
      ? {
          match_type: lookup.match_type,
          matched_model: lookup.matched_model,
          model: lookup.model,
          profiles: lookup.profiles.map((p) => ({ modulation: p.modulation })),
        }
      : null
  )

  return NextResponse.json({
    data: {
      clarifications,
      lookup: lookup
        ? {
            match_type: lookup.match_type,
            matched_model: lookup.matched_model,
            profile_count: lookup.profiles.length,
          }
        : null,
    },
  })
}
