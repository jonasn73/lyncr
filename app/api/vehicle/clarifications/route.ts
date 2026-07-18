// GET /api/vehicle/clarifications?year=&make=&model=
// Returns call-script questions when YMM alone is ambiguous for key lookup.
// Compares multi-FCC reference data against TI catalog before asking.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getVehicleIntakeClarifications } from "@/lib/vehicle-intake-clarifications"
import { extractButtonCountFromTitle, resolveVehicleKeyFcc } from "@/lib/vehicle-key-fcc-resolve"
import { lookupVehicleKeyProfiles } from "@/lib/vehicle-key-reference"
import { lookupFccRemoteVariants } from "@/lib/fccid-remote-variants"
import { lookupTiSupplierCatalogForVehicle } from "@/lib/ti-supplier-catalog"

export const dynamic = "force-dynamic"
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const yearRaw = req.nextUrl.searchParams.get("year")?.trim() ?? ""
  const make = req.nextUrl.searchParams.get("make")?.trim() ?? ""
  const model = req.nextUrl.searchParams.get("model")?.trim() ?? ""

  if (!yearRaw || !make || !model) {
    return NextResponse.json({ error: "year, make, and model are required" }, { status: 400 })
  }

  const year = Number(yearRaw)
  const lookup = lookupVehicleKeyProfiles(yearRaw, make, model)

  // Load TI catalog + variant photo counts so we can compare FCC candidates.
  const [tiCatalog, profileMeta] = await Promise.all([
    lookupTiSupplierCatalogForVehicle({ year: yearRaw, make, model }).catch(() => []),
    lookup
      ? Promise.all(
          lookup.profiles.slice(0, 8).map(async (profile) => {
            const detail = await lookupFccRemoteVariants({
              fcc_id: profile.fcc_id,
              year,
              make,
              model,
            }).catch(() => ({ variants: [] as Array<{ title?: string }> }))
            return {
              fccId: profile.fcc_id,
              frequency: profile.frequency,
              modulation: profile.modulation,
              variantCount: detail.variants.length,
              buttonCountsFromVariants: detail.variants
                .map((variant) => extractButtonCountFromTitle(variant.title ?? ""))
                .filter((n): n is number => n != null && n > 0),
            }
          })
        )
      : Promise.resolve([]),
  ])

  const fccResolution =
    profileMeta.length > 1 || tiCatalog.some((hit) => Boolean(hit.fccId?.trim()))
      ? resolveVehicleKeyFcc({
          profiles: profileMeta,
          tiHits: tiCatalog.map((hit) => ({
            fccId: hit.fccId,
            tiSku: hit.tiSku,
            title: hit.title,
            buttonCount: hit.buttonCount,
            frequency: hit.frequency,
            score: hit.score,
          })),
        })
      : null

  const clarifications = getVehicleIntakeClarifications(
    yearRaw,
    make,
    model,
    lookup
      ? {
          match_type: lookup.match_type,
          matched_model: lookup.matched_model,
          model: lookup.model,
          profiles: lookup.profiles.map((p) => ({
            fcc_id: p.fcc_id,
            modulation: p.modulation,
            frequency: p.frequency,
          })),
          // Only surface the ask prompt when auto-resolve failed.
          fccResolveClarification:
            fccResolution?.needsClarification ? fccResolution.clarification : null,
        }
      : null
  )

  return NextResponse.json({
    data: {
      clarifications,
      lookup: lookup
        ? {
            match_type: lookup.match_type,
            matched_model: lookup.matched_model,
            profile_count: lookup.profiles.length,
          }
        : null,
      fcc_resolution: fccResolution
        ? {
            resolved_fcc_id: fccResolution.resolvedFccId,
            confidence: fccResolution.confidence,
            needs_clarification: fccResolution.needsClarification,
            preferred_ti_sku: fccResolution.preferredTiSku,
            ranked: fccResolution.ranked.slice(0, 6),
          }
        : null,
    },
  })
}
