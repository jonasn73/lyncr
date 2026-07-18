// GET /api/vehicle/plate-lookup?plate=...&state=KY
// Plate → vehicle decode + key reference lookup in one round-trip.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { lookupVehicleByPlate } from "@/lib/vehicle-plate-lookup"
import { buildUnifiedVehicleDecode } from "@/lib/vehicle-key-specs-bundle"

export const dynamic = "force-dynamic"
export const maxDuration = 30

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

    const year = result.vehicle_year?.trim() || ""
    const make = result.vehicle_make?.trim() || ""
    const model = result.vehicle_model?.trim() || ""
    const trim = result.trim?.trim() || null

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
            tiCatalog: [],
            fccResolution: null,
          }

    return NextResponse.json({
      data: {
        // Legacy plate payload fields.
        ...result,
        // Unified vehicle + key specs + inventory in one payload.
        vehicle: unified.vehicle,
        keySpecs: unified.keySpecs,
        inventory: unified.inventory,
        ti_catalog: unified.tiCatalog,
        tiCatalog: unified.tiCatalog,
        fcc_resolution: unified.fccResolution,
        fccResolution: unified.fccResolution,
      },
    })
  } catch (e) {
    console.error("[vehicle/plate-lookup]", e)
    return NextResponse.json({ error: "Plate lookup failed" }, { status: 500 })
  }
}
