// GET /api/vehicle/key-info?year=2017&make=Toyota&model=RAV4
// Returns FCC / frequency key profiles plus key photos for the intake sheet.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { lookupFccRemoteVariants, mergeVariantLists } from "@/lib/fccid-remote-variants"
import { lookupVehicleKeyProfiles } from "@/lib/vehicle-key-reference"

export const maxDuration = 30

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

    const variantLists = await Promise.all(
      result.profiles.map((profile) =>
        lookupFccRemoteVariants({
          fcc_id: profile.fcc_id,
          year,
          make,
          model,
        }).then((detail) => detail.variants)
      )
    )
    const variants = mergeVariantLists(variantLists, 6)

    return NextResponse.json({
      data: {
        key_info: {
          ...result,
          variants,
          photo_disclaimer:
            variants.some((v) => v.reference_image)
              ? "Some photos are reference images from the same FCC ID — always confirm the key on the vehicle."
              : "Photos and titles come from public FCC ID replacement listings. Always confirm the physical key on the vehicle before ordering.",
        },
      },
    })
  } catch (e) {
    console.error("[vehicle/key-info]", e)
    return NextResponse.json({ data: { key_info: null } })
  }
}
