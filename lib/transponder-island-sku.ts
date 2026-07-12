// Transponder Island–style SKU strings for key blank catalog cards.

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
