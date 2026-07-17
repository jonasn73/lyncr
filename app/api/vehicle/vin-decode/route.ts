// GET /api/vehicle/vin-decode?vin=...
// Decodes VIN → Year/Make/Model/Trim and runs key reference lookup in one round-trip.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { decodeVin } from "@/lib/nhtsa-vpic"
import { buildUnifiedVehicleDecode } from "@/lib/vehicle-key-specs-bundle"

export const maxDuration = 30

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

    const year = result.vehicle_year?.trim() || ""
    const make = result.vehicle_make?.trim() || ""
    const model = result.vehicle_model?.trim() || ""
    const trim = result.vehicle_trim?.trim() || null

    const unified =
      make && model
        ? await buildUnifiedVehicleDecode(
            { year, make, model, trim },
            { userId }
          )
        : {
            vehicle: { year, make, model, trim },
            keySpecs: {
              fccId: null,
              frequency: null,
              keys: [],
              key_info: null,
              lookup_source: "none" as const,
            },
            inventory: [],
          }

    return NextResponse.json({
      data: {
        // Legacy flat fields (VinLookupField / older clients).
        ...result,
        // Unified vehicle + key specs + inventory in one payload.
        vehicle: unified.vehicle,
        keySpecs: unified.keySpecs,
        inventory: unified.inventory,
      },
    })
  } catch (e) {
    console.error("[vehicle/vin-decode]", e)
    return NextResponse.json({ error: "VIN lookup failed" }, { status: 500 })
  }
}
