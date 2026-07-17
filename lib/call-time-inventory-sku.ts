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

/**
 * SKU to upsert when no catalog row exists yet.
 * Prefers inventory SKU → FCC-based code → YEAR-MAKE-MODEL provisional.
 */
export function deriveCallTimeInventorySku(params: {
  inventory?: KeyInventoryApiRow[] | null
  selectedFccId?: string | null
  year?: string | null
  make?: string | null
  model?: string | null
}): string {
  const primary = pickPrimaryInventoryRow(params.inventory, params.selectedFccId)
  if (primary?.sku?.trim()) return primary.sku.trim().toUpperCase()

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
