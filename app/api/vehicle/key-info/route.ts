// GET /api/vehicle/key-info?year=2017&make=Toyota&model=RAV4&fcc_id=HYQ12BBT
// Returns FCC profiles grouped with key photos and compatible vehicles per FCC ID.
// When fcc_id misses, automatically falls back to year/make/model remotes.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { sanitizeFccIdInput } from "@/lib/fcc-id-input"
import { buildVehicleKeySpecs } from "@/lib/vehicle-key-specs-bundle"

export const maxDuration = 30

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const yearRaw = req.nextUrl.searchParams.get("year")?.trim() ?? ""
  const make = req.nextUrl.searchParams.get("make")?.trim() ?? ""
  const model = req.nextUrl.searchParams.get("model")?.trim() ?? ""
  const fccIdRaw = req.nextUrl.searchParams.get("fcc_id")?.trim() ?? ""
  const sanitizedFcc = fccIdRaw ? sanitizeFccIdInput(fccIdRaw) : ""

  if (!yearRaw || !make || !model || !Number.isFinite(Number(yearRaw))) {
    return NextResponse.json({ error: "year, make, and model are required" }, { status: 400 })
  }

  try {
    const keySpecs = await buildVehicleKeySpecs(yearRaw, make, model, sanitizedFcc || null)
    return NextResponse.json({
      data: {
        key_info: keySpecs.key_info,
        lookup_source: keySpecs.lookup_source === "none" ? (sanitizedFcc ? "ymm_fallback" : "ymm") : keySpecs.lookup_source,
        fcc_query: sanitizedFcc || null,
        fcc_matched: keySpecs.lookup_source === "fcc",
        // Unified shape (same as vin-decode / plate-lookup).
        vehicle: { year: yearRaw, make, model, trim: null },
        keySpecs,
      },
    })
  } catch (e) {
    console.error("[vehicle/key-info]", e)
    return NextResponse.json({ data: { key_info: null } })
  }
}
