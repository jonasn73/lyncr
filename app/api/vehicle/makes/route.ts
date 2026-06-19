// GET /api/vehicle/makes — passenger car/truck/SUV makes (NHTSA vPIC, cached server-side)

import { NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { fetchPassengerVehicleMakes } from "@/lib/nhtsa-vpic"

export async function GET(req: Request) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  try {
    const makes = await fetchPassengerVehicleMakes()
    return NextResponse.json({ data: { makes } })
  } catch (e) {
    console.error("[vehicle/makes]", e)
    return NextResponse.json({ data: { makes: [] as string[] } })
  }
}
