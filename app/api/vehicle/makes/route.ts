// GET /api/vehicle/makes?year=2022 — passenger makes (NHTSA), year-filtered when provided.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { fetchPassengerVehicleMakes } from "@/lib/nhtsa-vpic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  try {
    const yearRaw = req.nextUrl.searchParams.get("year")?.trim() ?? ""
    const year = yearRaw ? Number(yearRaw) : undefined
    const makes = await fetchPassengerVehicleMakes(
      year != null && Number.isFinite(year) ? year : undefined
    )
    return NextResponse.json({ data: { makes } })
  } catch (e) {
    console.error("[vehicle/makes]", e)
    return NextResponse.json({ data: { makes: [] as string[] } })
  }
}
