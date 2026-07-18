// Derive a stable SKU for call-time inventory intake from decode / key selection.

import type { KeyInventoryApiRow } from "@/lib/key-inventory-shared"
import { sanitizeFccIdInput } from "@/lib/fcc-id-input"

/** Pick the best inventory row for the currently selected FCC (or first match). */
export function pickPrimaryInventoryRow(
  inventory: KeyInventoryApiRow[] | null | undefined,
  selectedFccId?: string | null
): KeyInventoryApiRow | null {
  if (!inventory?.length) return null
  const fcc = selectedFccId ? sanitizeFccIdInput(selectedFccId) : ""
  if (fcc) {
    const byFcc = inventory.find((row) => sanitizeFccIdInput(row.fccId) === fcc)
    if (byFcc) return byFcc
  }
  return inventory[0] ?? null
}

/** True when a string looks like a real TI / catalog order blank (not FCC-…). */
function looksLikeCatalogSku(value: string): boolean {
  return /^(TIK|TIT|KEY|PROX)-/i.test(value.trim())
}

/**
 * SKU to upsert when saving call-time stock.
 * Prefers selected TI blank → inventory row → FCC code → YEAR-MAKE-MODEL provisional.
 */
export function deriveCallTimeInventorySku(params: {
  inventory?: KeyInventoryApiRow[] | null
  selectedFccId?: string | null
  /** Selected Key Details blank (e.g. TIK-MAZ-46A) — wins over FCC-… invent. */
  selectedTiSku?: string | null
  year?: string | null
  make?: string | null
  model?: string | null
}): string {
  const selectedTi = params.selectedTiSku?.trim().toUpperCase() || ""
  if (selectedTi && looksLikeCatalogSku(selectedTi)) return selectedTi

  const primary = pickPrimaryInventoryRow(params.inventory, params.selectedFccId)
  const rowSku = (primary?.tiSku || primary?.sku || "").trim().toUpperCase()
  if (rowSku && looksLikeCatalogSku(rowSku)) return rowSku
  if (rowSku && !rowSku.startsWith("FCC-")) return rowSku

  // Last resort only when no TI blank was selected.
  const fcc = params.selectedFccId ? sanitizeFccIdInput(params.selectedFccId) : ""
  if (fcc) return `FCC-${fcc}`

  const make = String(params.make ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 6)
  const model = String(params.model ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 10)
  const year = String(params.year ?? "").trim().slice(0, 4)
  const parts = [year, make, model].filter(Boolean)
  return parts.length > 0 ? `KEY-${parts.join("-")}` : "KEY-UNKNOWN"
}
