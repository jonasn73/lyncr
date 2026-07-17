// Explicit vehicle → compatible key mapping for dispatcher Key Details.

import type { ManualKeyFrequencyOption } from "@/lib/fcc-id-input"
import {
  buildTransponderIslandSku,
  stripTiSkuPrefix,
} from "@/lib/transponder-island-sku"

/** Canonical Subaru prox blank for model years 2017–2025. */
export const SUBARU_2017_2025_PROX = {
  catalogSku: "PROX-SUB-01",
  supplierSku: "TIK-SUB-37A",
  fccId: "HYQ14AHK",
  /** Primary badge on the key card (real-world ordering SKU). */
  primaryTiSku: "TI-SKU: TIK-SUB-37A",
  specText: "Push-to-start proximity fob (FCC ID: HYQ14AHK / 4-Button / 433 MHz)",
  /** Legacy / incompatible Subaru catalog codes to hide on mapped years. */
  hiddenCatalogSkus: ["KEY-SUB-15", "KEY-SUB-01"] as const,
} as const

/** Parse a year string/number; returns NaN when missing/invalid. */
export function parseVehicleYear(year: string | number | null | undefined): number {
  if (typeof year === "number") return year
  return Number.parseInt(String(year ?? "").trim(), 10)
}

/** True for Subaru model years that map exclusively to PROX-SUB-01 / TIK-SUB-37A. */
export function isSubaru2017To2025ProxMap(
  year: string | number | null | undefined,
  make: string | null | undefined
): boolean {
  const y = parseVehicleYear(year)
  const m = String(make ?? "")
    .trim()
    .toLowerCase()
  return Number.isFinite(y) && y >= 2017 && y <= 2025 && m === "subaru"
}

/** Single compatible key option for mapped Subaru years. */
export function subaruMappedProxOption(): ManualKeyFrequencyOption {
  return {
    id: "mapped-prox-sub-01",
    label: "Proximity Smart Key",
    keyStyle: "Push start (smart key)",
    frequency: "433",
    description: SUBARU_2017_2025_PROX.specText,
    programmingMethod: "Active Dashboard Turn Sequence",
    imageUrl: "/key-images/mykeys/subaru-prox.svg",
    fccId: SUBARU_2017_2025_PROX.fccId,
    catalogSku: SUBARU_2017_2025_PROX.catalogSku,
    supplierSku: SUBARU_2017_2025_PROX.supplierSku,
  }
}

/** Keep only PROX-SUB-01 for mapped Subaru years; otherwise pass options through. */
export function filterManualOptionsForVehicle(
  options: ManualKeyFrequencyOption[],
  year: string | number | null | undefined,
  make: string | null | undefined
): ManualKeyFrequencyOption[] {
  if (!isSubaru2017To2025ProxMap(year, make)) return options
  // Explicit map: hide KEY-SUB-15 / KEY-SUB-01 and every other fallback card.
  return [subaruMappedProxOption()]
}

type SkuVariantLike = {
  id: string
  title: string
  key_type?: string | null
}

/** Keep only PROX-SUB-01 (hide KEY-SUB-15 / KEY-SUB-01 and every non-prox card). */
export function filterFccVariantsForVehicle<T extends SkuVariantLike>(
  variants: T[],
  year: string | number | null | undefined,
  make: string | null | undefined
): T[] {
  if (!isSubaru2017To2025ProxMap(year, make)) return variants

  const hidden = new Set<string>(SUBARU_2017_2025_PROX.hiddenCatalogSkus)
  const prox = variants.filter((variant) => {
    const tiSku = buildTransponderIslandSku({
      make,
      title: variant.title,
      keyType: variant.key_type ?? null,
      variantId: variant.id,
    })
    const catalog = stripTiSkuPrefix(tiSku)
    // Explicitly drop legacy Subaru blade / remote-head catalog codes.
    if (hidden.has(catalog) || catalog.startsWith("KEY-SUB") || catalog.startsWith("RHK-SUB")) {
      return false
    }
    if (catalog === SUBARU_2017_2025_PROX.catalogSku || catalog.startsWith("PROX-SUB")) return true
    return /proximity|smart|prox|push.?start/i.test(`${variant.title} ${variant.key_type ?? ""}`)
  })

  // Prefer exact PROX-SUB-01 when present; otherwise keep filtered prox list.
  const exact = prox.filter((variant) => {
    const catalog = stripTiSkuPrefix(
      buildTransponderIslandSku({
        make,
        title: variant.title,
        keyType: variant.key_type ?? null,
        variantId: variant.id,
      })
    )
    return catalog === SUBARU_2017_2025_PROX.catalogSku
  })
  return exact.length > 0 ? exact : prox
}

export type MappableKeyCard = {
  id: string
  tiSku?: string | null
  specs?: Array<{ label: string; value: string }>
  supplierOrderBadge?: string | null
  fccFootnote?: string | null
  description?: string | null
}

/**
 * For mapped Subaru + PROX-SUB-01: show TI-SKU: TIK-SUB-37A and the real-world Spec line.
 */
export function applyVehicleKeyCardOverrides<T extends MappableKeyCard>(
  card: T,
  year: string | number | null | undefined,
  make: string | null | undefined
): T {
  if (!isSubaru2017To2025ProxMap(year, make)) return card

  const catalog = stripTiSkuPrefix(card.tiSku)
  const isProxCard =
    catalog === SUBARU_2017_2025_PROX.catalogSku ||
    catalog === SUBARU_2017_2025_PROX.supplierSku ||
    catalog.startsWith("PROX-SUB") ||
    card.id === "mapped-prox-sub-01" ||
    /tik-sub-37a|prox-sub-01/i.test(`${card.tiSku ?? ""} ${card.id}`)

  if (!isProxCard) return card

  return {
    ...card,
    tiSku: SUBARU_2017_2025_PROX.primaryTiSku,
    // Ordering SKU is already the primary badge — avoid a second supplier chip.
    supplierOrderBadge: null,
    description: SUBARU_2017_2025_PROX.specText,
    specs: [{ label: "Spec", value: SUBARU_2017_2025_PROX.specText }],
    fccFootnote: null,
  }
}
