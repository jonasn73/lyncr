// GET /api/vehicle/fcc-detail?fcc_id=HYQ12BDM&year=2014&make=Toyota&model=Camry
// Returns key photos + style hints from fccid.io replacement listings.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { sanitizeFccIdInput } from "@/lib/fcc-id-input"
import { lookupFccRemoteVariants } from "@/lib/fccid-remote-variants"

export const maxDuration = 30

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const fccId = sanitizeFccIdInput(req.nextUrl.searchParams.get("fcc_id") ?? "")
  const yearRaw = req.nextUrl.searchParams.get("year")?.trim() ?? ""
  const make = req.nextUrl.searchParams.get("make")?.trim() ?? ""
  const model = req.nextUrl.searchParams.get("model")?.trim() ?? ""
  const year = Number(yearRaw)

  if (!fccId || !yearRaw || !make || !model || !Number.isFinite(year)) {
    return NextResponse.json(
      { error: "fcc_id, year, make, and model are required" },
      { status: 400 }
    )
  }

  try {
    const result = await lookupFccRemoteVariants({
      fcc_id: fccId,
      year,
      make,
      model,
    })
    return NextResponse.json({ data: { fcc_detail: result } })
  } catch (e) {
    console.error("[vehicle/fcc-detail]", e)
    return NextResponse.json({ data: { fcc_detail: null } })
  }
}
