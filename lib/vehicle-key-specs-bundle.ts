// Shared Year/Make/Model → key reference bundle (used by key-info, vin-decode, plate-lookup).
// Server-only — pulls CSV profiles + FCC remote variant photos + Key Inventory stock.

import { lookupFccRemoteVariants } from "@/lib/fccid-remote-variants"
import {
  lookupKeyInventoryForVehicle,
  serializeKeyInventoryForApi,
  type KeyInventoryApiRow,
} from "@/lib/key-inventory"
import {
  lookupTiSupplierCatalogForVehicle,
  type TiCatalogKeyOption,
} from "@/lib/ti-supplier-catalog"
import {
  extractButtonCountFromTitle,
  orderTiCatalogByPreferredFcc,
  resolveVehicleKeyFcc,
  type VehicleKeyFccResolveResult,
} from "@/lib/vehicle-key-fcc-resolve"
import {
  formatCompatibleVehicleSummary,
  lookupCompatibleVehiclesForFcc,
  lookupVehicleKeyInfo,
  type VehicleKeyLookupSource,
  type VehicleKeyLookupResult,
  type VehicleKeyProfile,
} from "@/lib/vehicle-key-reference"
import { fccIdsMatch, modulationMatchesKeyStyle } from "@/lib/fcc-id-input"
import {
  filterTiCatalogForClarification,
} from "@/lib/ti-supplier-catalog-shared"

export type VehicleDecodeVehicle = {
  year: string
  make: string
  model: string
  trim: string | null
}

/** One selectable key / remote in the unified decode response. */
export type VehicleDecodeKeyEntry = {
  id: string
  fccId: string
  frequency: string | null
  modulation: string | null
  chipset: string | null
  variants: Awaited<ReturnType<typeof lookupFccRemoteVariants>>["variants"]
  compatible_summary: ReturnType<typeof formatCompatibleVehicleSummary>
}

/**
 * Compact + full key payload returned alongside VIN/plate decode so the client
 * does not need a second /api/vehicle/key-info round-trip.
 */
export type VehicleDecodeKeySpecs = {
  fccId: string | null
  frequency: string | null
  keys: VehicleDecodeKeyEntry[]
  /** Full key-info payload (same shape as GET /api/vehicle/key-info). */
  key_info: (VehicleKeyLookupResult & {
    profiles: VehicleKeyProfile[]
    profile_details: Array<{
      profile: VehicleKeyProfile
      variants: VehicleDecodeKeyEntry["variants"]
      compatible_vehicles: ReturnType<typeof lookupCompatibleVehiclesForFcc>
      compatible_summary: ReturnType<typeof formatCompatibleVehicleSummary>
    }>
    photo_disclaimer: string
  }) | null
  lookup_source: VehicleKeyLookupSource | "none"
}

export type UnifiedVehicleDecodePayload = {
  vehicle: VehicleDecodeVehicle
  keySpecs: VehicleDecodeKeySpecs
  /** On-hand blanks/fobs matching YMM and/or profile FCC IDs (empty until migration 105). */
  inventory: KeyInventoryApiRow[]
  /** Transponder Island catalog hits for this Year/Make/Model (Key Details primary cards). */
  tiCatalog: TiCatalogKeyOption[]
  /** Multi-FCC compare result (auto-pick or ask-the-customer). */
  fccResolution: VehicleKeyFccResolveResult | null
}

export type BuildUnifiedVehicleDecodeOptions = {
  fccIdRaw?: string | null
  /** When Ask already pinned push vs turn, narrow TI + CSV profiles. */
  keyStyle?: string | null
  userId?: string | null
  organizationId?: string | null
}

/** Build keySpecs for a decoded Year/Make/Model (optional FCC filter). */
export async function buildVehicleKeySpecs(
  yearRaw: string,
  makeRaw: string,
  modelRaw: string,
  fccIdRaw?: string | null
): Promise<VehicleDecodeKeySpecs> {
  const year = Number(String(yearRaw).trim())
  const make = makeRaw.trim()
  const model = modelRaw.trim()

  if (!Number.isFinite(year) || !make || !model) {
    return {
      fccId: null,
      frequency: null,
      keys: [],
      key_info: null,
      lookup_source: "none",
    }
  }

  const result = lookupVehicleKeyInfo(yearRaw, make, model, fccIdRaw ?? null)
  if (!result || result.profiles.length === 0) {
    return {
      fccId: null,
      frequency: null,
      keys: [],
      key_info: null,
      lookup_source: fccIdRaw ? "ymm_fallback" : "ymm",
    }
  }

  const profile_details = await Promise.all(
    result.profiles.map(async (profile) => {
      const variants = await lookupFccRemoteVariants({
        fcc_id: profile.fcc_id,
        year,
        make,
        model,
      }).then((detail) => detail.variants)

      const compatible_vehicles = lookupCompatibleVehiclesForFcc(profile.fcc_id)
      const compatible_summary = formatCompatibleVehicleSummary(compatible_vehicles, {
        year,
        make,
        model,
      })

      return {
        profile,
        variants,
        compatible_vehicles,
        compatible_summary,
      }
    })
  )

  const anyVariantPhotos = profile_details.some((detail) =>
    detail.variants.some((variant) => Boolean(variant.image_url))
  )
  const visible_profile_details =
    anyVariantPhotos && profile_details.length > 1
      ? profile_details.filter((detail) => detail.variants.length > 0)
      : profile_details

  const hasReferencePhotos = visible_profile_details.some((detail) =>
    detail.variants.some((variant) => variant.reference_image)
  )

  const keys: VehicleDecodeKeyEntry[] = visible_profile_details.map((detail) => ({
    id: detail.profile.id,
    fccId: detail.profile.fcc_id,
    frequency: detail.profile.frequency,
    modulation: detail.profile.modulation,
    chipset: detail.profile.chipset,
    variants: detail.variants,
    compatible_summary: detail.compatible_summary,
  }))

  const primary = keys[0] ?? null

  return {
    fccId: primary?.fccId ?? null,
    frequency: primary?.frequency ?? null,
    keys,
    key_info: {
      ...result,
      profiles: visible_profile_details.map((d) => d.profile),
      profile_details: visible_profile_details,
      photo_disclaimer: hasReferencePhotos
        ? "Some photos are reference images from the same FCC ID — always confirm the key on the vehicle."
        : "Photos and titles come from public FCC ID replacement listings. Always confirm the physical key on the vehicle before ordering.",
    },
    lookup_source: result.lookup_source,
  }
}

/** Unified vehicle + keySpecs + inventory block for decode API responses. */
export async function buildUnifiedVehicleDecode(
  vehicle: VehicleDecodeVehicle,
  options?: BuildUnifiedVehicleDecodeOptions | string | null
): Promise<UnifiedVehicleDecodePayload> {
  // Back-compat: second arg used to be fccIdRaw string.
  const opts: BuildUnifiedVehicleDecodeOptions =
    typeof options === "string" || options == null
      ? { fccIdRaw: options ?? null }
      : options

  const keySpecs = await buildVehicleKeySpecs(
    vehicle.year,
    vehicle.make,
    vehicle.model,
    opts.fccIdRaw
  )

  // When ignition style is known, hide the wrong ASK/FSK family from the filmstrip.
  if (opts.keyStyle?.trim() && keySpecs.keys.length > 1) {
    const filteredKeys = keySpecs.keys.filter((key) =>
      modulationMatchesKeyStyle(key.modulation, opts.keyStyle)
    )
    if (filteredKeys.length > 0 && filteredKeys.length < keySpecs.keys.length) {
      const primary = filteredKeys[0]!
      keySpecs.keys = filteredKeys
      keySpecs.fccId = primary.fccId
      keySpecs.frequency = primary.frequency
      if (keySpecs.key_info) {
        keySpecs.key_info = {
          ...keySpecs.key_info,
          profiles: filteredKeys.map((key) => {
            const detail = keySpecs.key_info!.profile_details.find((row) =>
              fccIdsMatch(row.profile.fcc_id, key.fccId)
            )
            return detail?.profile ?? keySpecs.key_info!.profiles[0]!
          }),
          profile_details: filteredKeys.map((key) => {
            const detail = keySpecs.key_info!.profile_details.find((row) =>
              fccIdsMatch(row.profile.fcc_id, key.fccId)
            )
            return (
              detail ?? {
                profile: keySpecs.key_info!.profiles[0]!,
                variants: key.variants,
                compatible_vehicles: [],
                compatible_summary: key.compatible_summary,
              }
            )
          }),
        }
      }
    }
  }

  const fccIds = [
    ...(opts.fccIdRaw ? [opts.fccIdRaw] : []),
    ...keySpecs.keys.map((k) => k.fccId),
  ]

  const inventoryRows =
    opts.userId && vehicle.make && vehicle.model
      ? await lookupKeyInventoryForVehicle({
          userId: opts.userId,
          organizationId: opts.organizationId,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          fccIds,
        })
      : []

  let tiCatalog =
    vehicle.make && vehicle.model
      ? await lookupTiSupplierCatalogForVehicle({
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
        })
      : []

  // Cross-check CSV FCC profiles against TI catalog FCC/button data.
  const fccResolution =
    keySpecs.keys.length > 0 || tiCatalog.some((hit) => hit.fccId?.trim())
      ? resolveVehicleKeyFcc({
          profiles: keySpecs.keys.map((key) => ({
            fccId: key.fccId,
            frequency: key.frequency,
            modulation: key.modulation,
            variantCount: key.variants.length,
            buttonCountsFromVariants: key.variants
              .map((variant) => extractButtonCountFromTitle(variant.title ?? ""))
              .filter((n): n is number => n != null && n > 0),
          })),
          tiHits: tiCatalog.map((hit) => ({
            fccId: hit.fccId,
            tiSku: hit.tiSku,
            title: hit.title,
            buttonCount: hit.buttonCount,
            frequency: hit.frequency,
            score: hit.score,
          })),
          preferredKeyStyle: opts.keyStyle ?? null,
        })
      : null

  // When evidence picks one FCC, put that TI blank first (strict = only that FCC).
  const preferredFcc =
    opts.fccIdRaw?.trim() ||
    (fccResolution && !fccResolution.needsClarification ? fccResolution.resolvedFccId : null)
  if (preferredFcc) {
    tiCatalog = orderTiCatalogByPreferredFcc(tiCatalog, preferredFcc, true)
  }

  // Style pin (even without FCC) must drop the wrong smart/turn blanks.
  if (opts.keyStyle?.trim()) {
    tiCatalog = filterTiCatalogForClarification(tiCatalog, preferredFcc, opts.keyStyle)
  }

  // Re-order keySpecs so the resolved FCC is primary for the filmstrip path.
  let nextKeySpecs = keySpecs
  if (preferredFcc && keySpecs.keys.length > 1) {
    const matching = keySpecs.keys.filter((key) => fccIdsMatch(key.fccId, preferredFcc))
    const rest = keySpecs.keys.filter((key) => !fccIdsMatch(key.fccId, preferredFcc))
    if (matching.length > 0) {
      const orderedKeys = [...matching, ...rest]
      const primary = orderedKeys[0]!
      nextKeySpecs = {
        ...keySpecs,
        fccId: primary.fccId,
        frequency: primary.frequency,
        keys: orderedKeys,
        key_info: keySpecs.key_info
          ? {
              ...keySpecs.key_info,
              profiles: orderedKeys.map((key) => {
                const detail = keySpecs.key_info!.profile_details.find((row) =>
                  fccIdsMatch(row.profile.fcc_id, key.fccId)
                )
                return detail?.profile ?? keySpecs.key_info!.profiles[0]!
              }),
              profile_details: orderedKeys.map((key) => {
                const detail = keySpecs.key_info!.profile_details.find((row) =>
                  fccIdsMatch(row.profile.fcc_id, key.fccId)
                )
                return (
                  detail ?? {
                    profile: keySpecs.key_info!.profiles[0]!,
                    variants: key.variants,
                    compatible_vehicles: [],
                    compatible_summary: key.compatible_summary,
                  }
                )
              }),
            }
          : null,
      }
    }
  }

  return {
    vehicle,
    keySpecs: nextKeySpecs,
    inventory: serializeKeyInventoryForApi(inventoryRows),
    tiCatalog,
    fccResolution,
  }
}
