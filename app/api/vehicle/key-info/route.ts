// GET /api/vehicle/key-info?year=2017&make=Toyota&model=RAV4
// Returns FCC / frequency key profiles plus key photos for the intake sheet.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { lookupFccRemoteVariants } from "@/lib/fccid-remote-variants"
import { lookupVehicleKeyProfiles } from "@/lib/vehicle-key-reference"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const yearRaw = req.nextUrl.searchParams.get("year")?.trim() ?? ""
  const make = req.nextUrl.searchParams.get("make")?.trim() ?? ""
  const model = req.nextUrl.searchParams.get("model")?.trim() ?? ""
  const year = Number(yearRaw)

  if (!yearRaw || !make || !model || !Number.isFinite(year)) {
    return NextResponse.json({ error: "year, make, and model are required" }, { status: 400 })
  }

  try {
    const result = lookupVehicleKeyProfiles(yearRaw, make, model)
    if (!result || result.profiles.length === 0) {
      return NextResponse.json({ data: { key_info: result } })
    }

    const primaryFcc = result.profiles[0]!.fcc_id
    const photoDetail = await lookupFccRemoteVariants({
      fcc_id: primaryFcc,
      year,
      make,
      model,
    })

    return NextResponse.json({
      data: {
        key_info: {
          ...result,
          variants: photoDetail.variants,
          photo_disclaimer: photoDetail.disclaimer,
        },
      },
    })
  } catch (e) {
    console.error("[vehicle/key-info]", e)
    return NextResponse.json({ data: { key_info: null } })
  }
}
