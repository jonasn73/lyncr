// GET /api/vehicle/plate-lookup?plate=...&state=KY

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { lookupVehicleByPlate } from "@/lib/vehicle-plate-lookup"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const plate = req.nextUrl.searchParams.get("plate")?.trim() ?? ""
  const state = req.nextUrl.searchParams.get("state")?.trim() ?? ""
  if (!plate) return NextResponse.json({ error: "plate is required" }, { status: 400 })
  if (!state) return NextResponse.json({ error: "state is required" }, { status: 400 })

  try {
    const result = await lookupVehicleByPlate(plate, state)
    if (result.error && !result.vehicle_make) {
      return NextResponse.json({ error: result.error }, { status: 404 })
    }
    return NextResponse.json({ data: result })
  } catch (e) {
    console.error("[vehicle/plate-lookup]", e)
    return NextResponse.json({ error: "Plate lookup failed" }, { status: 500 })
  }
}
