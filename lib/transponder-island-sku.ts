// Transponder Island–style SKU strings for key blank catalog cards.

import { sanitizeFccIdInput } from "@/lib/fcc-id-input"
import { classifyKeyStyleBucket } from "@/lib/vehicle-key-variant-labels"

/** Map key style → TI product family code. */
function tiFamilyCode(title: string, keyType: string | null): string {
  switch (classifyKeyStyleBucket(title, keyType)) {
    case "smart":
      return "PROX"
    case "flip":
      return "FLIP"
    case "remote_head":
      return "RHK"
    case "keyless_fob":
      return "FOB"
    case "turn_key":
      return "BLADE"
    default:
      return "KEY"
  }
}

/** Compact make token for TI SKUs (e.g. Honda → HON). */
export function tiMakeCode(make: string | null | undefined): string {
  const cleaned = String(make ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
  if (!cleaned) return "GEN"
  return cleaned.slice(0, 3)
}

/**
 * Mock Transponder Island catalog SKU, e.g. "TI-SKU: PROX-HON-04".
 * Stable for a given make + variant id so selection UI stays predictable.
 */
export function buildTransponderIslandSku(options: {
  make?: string | null
  title: string
  keyType?: string | null
  variantId: string
}): string {
  const family = tiFamilyCode(options.title, options.keyType ?? null)
  const make = tiMakeCode(options.make)
  const digits = options.variantId.replace(/\D/g, "")
  const suffix = (digits.slice(-2) || "01").padStart(2, "0")
  return `TI-SKU: ${family}-${make}-${suffix}`
}

/** Strip the "TI-SKU: " prefix so we can match catalog codes. */
export function stripTiSkuPrefix(tiSku: string | null | undefined): string {
  return String(tiSku ?? "")
    .trim()
    .replace(/^TI-SKU:\s*/i, "")
    .toUpperCase()
}

/** Exact TI ordering overrides keyed by vehicle + FCC + catalog family. */
export type TiSupplierSkuOverride = {
  supplierSku: string
  fccId: string
  catalogSku: string
}

/**
 * Conditional Transponder Island ordering SKU mapper.
 * Example: 2017–2025 Subaru + FCC HYQ14AHK + PROX-SUB-01 → TIK-SUB-37A.
 */
export function resolveTransponderIslandSupplierSku(params: {
  year?: string | number | null
  make?: string | null
  model?: string | null
  fccId?: string | null
  /** Full badge ("TI-SKU: PROX-SUB-01") or bare catalog code ("PROX-SUB-01"). */
  catalogSku?: string | null
  title?: string | null
  keyType?: string | null
}): TiSupplierSkuOverride | null {
  const year = typeof params.year === "number" ? params.year : Number.parseInt(String(params.year ?? ""), 10)
  const make = String(params.make ?? "")
    .trim()
    .toLowerCase()
  const fccId = sanitizeFccIdInput(params.fccId ?? "")
  const catalog = stripTiSkuPrefix(params.catalogSku)
  const styleBlob = `${params.title ?? ""} ${params.keyType ?? ""}`.toLowerCase()
  const isProxFamily =
    catalog.startsWith("PROX-SUB") ||
    /proximity|smart|prox|push\s*start/.test(styleBlob)

  // PROX-SUB-01 (and PROX-SUB-* prox family) for 2017–2025 Subaru HYQ14AHK.
  if (
    Number.isFinite(year) &&
    year >= 2017 &&
    year <= 2025 &&
    make === "subaru" &&
    fccId === "HYQ14AHK" &&
    isProxFamily
  ) {
    return {
      catalogSku: catalog.startsWith("PROX-SUB") ? catalog : "PROX-SUB-01",
      supplierSku: "TIK-SUB-37A",
      fccId: "HYQ14AHK",
    }
  }

  return null
}

/** Operator-facing badge under the primary TI-SKU chip. */
export function formatTiSupplierOrderBadge(override: TiSupplierSkuOverride): string {
  return `🛒 Supplier SKU: ${override.supplierSku} (FCC: ${override.fccId})`
}
