// GET /api/vehicle/vin-decode?vin=...

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { decodeVin } from "@/lib/nhtsa-vpic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const vin = req.nextUrl.searchParams.get("vin")?.trim() ?? ""
  if (!vin) return NextResponse.json({ error: "vin is required" }, { status: 400 })

  try {
    const result = await decodeVin(vin)
    if (result.error && !result.vehicle_make) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    return NextResponse.json({ data: result })
  } catch (e) {
    console.error("[vehicle/vin-decode]", e)
    return NextResponse.json({ error: "VIN lookup failed" }, { status: 500 })
  }
}
