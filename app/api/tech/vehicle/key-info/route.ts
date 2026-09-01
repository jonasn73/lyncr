// GET /api/tech/vehicle/key-info?year=2017&make=Toyota&model=RAV4&fcc_id=HYQ12BBT
// Same decode as /api/vehicle/key-info, scoped to the tech's owner (not the tech's own
// account) — that scoping is what makes the inventory cross-reference return real stock.

import { NextRequest, NextResponse } from "next/server"
import { resolveActor } from "@/lib/actor"
import { sanitizeFccIdInput } from "@/lib/fcc-id-input"
import { buildUnifiedVehicleDecode } from "@/lib/vehicle-key-specs-bundle"

export const dynamic = "force-dynamic"
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const actor = await resolveActor(req.headers.get("cookie"), { capability: "key_lookup" })
  if (!actor || actor.actorRole !== "field_tech") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const yearRaw = req.nextUrl.searchParams.get("year")?.trim() ?? ""
  const make = req.nextUrl.searchParams.get("make")?.trim() ?? ""
  const model = req.nextUrl.searchParams.get("model")?.trim() ?? ""
  const fccIdRaw = req.nextUrl.searchParams.get("fcc_id")?.trim() ?? ""
  const keyStyle = req.nextUrl.searchParams.get("key_style")?.trim() ?? ""
  const sanitizedFcc = fccIdRaw ? sanitizeFccIdInput(fccIdRaw) : ""

  if (!yearRaw || !make || !model || !Number.isFinite(Number(yearRaw))) {
    return NextResponse.json({ error: "year, make, and model are required" }, { status: 400 })
  }

  try {
    const unified = await buildUnifiedVehicleDecode(
      { year: yearRaw, make, model, trim: null },
      {
        fccIdRaw: sanitizedFcc || null,
        keyStyle: keyStyle || null,
        // The owner's account, not the tech's own — this is the only line that matters
        // for the inventory cross-reference to ever return a real count.
        userId: actor.ownerUserId,
      }
    )
    const keySpecs = unified.keySpecs
    return NextResponse.json({
      data: {
        key_info: keySpecs.key_info,
        lookup_source: keySpecs.lookup_source === "none" ? (sanitizedFcc ? "ymm_fallback" : "ymm") : keySpecs.lookup_source,
        fcc_query: sanitizedFcc || null,
        fcc_matched: keySpecs.lookup_source === "fcc",
        vehicle: unified.vehicle,
        keySpecs,
        inventory: unified.inventory,
        ti_catalog: unified.tiCatalog,
        fcc_resolution: unified.fccResolution,
      },
    })
  } catch (e) {
    console.error("[tech/vehicle/key-info]", e)
    return NextResponse.json({
      data: {
        key_info: null,
        inventory: [],
        ti_catalog: [],
        fcc_resolution: null,
      },
    })
  }
}
