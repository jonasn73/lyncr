// Client-safe Key Inventory types + out-of-stock fallback decision (no Neon imports).

export type KeyInventoryApiRow = {
  id: string
  sku: string
  fccId: string
  brand: string
  compatibleVehicles: Array<{
    make: string
    model: string
    yearStart: number
    yearEnd: number
  }>
  van1Quantity: number
  van2Quantity: number
  shopQuantity: number
  minimumStockAlert: number
  isSpecialty: boolean
  totalQuantity: number
  vanQuantity: number
  lowStock: boolean
  notes: string | null
}

/**
 * Show Out of Stock / Unobtainable alternatives when inventory matched the vehicle
 * and (van stock is 0 across matches) or any match is Specialty / Dealer-Only.
 */
export function shouldShowOutOfStockFallback(
  inventory: Array<Pick<KeyInventoryApiRow, "vanQuantity" | "totalQuantity" | "isSpecialty">> | null | undefined
): { show: boolean; reason: "out_of_stock" | "specialty" | null; vanQuantity: number } {
  if (!inventory?.length) {
    return { show: false, reason: null, vanQuantity: 0 }
  }
  const vanQuantity = inventory.reduce((sum, row) => sum + (Number(row.vanQuantity) || 0), 0)
  const specialty = inventory.some((row) => row.isSpecialty)
  if (specialty) return { show: true, reason: "specialty", vanQuantity }
  if (vanQuantity <= 0) return { show: true, reason: "out_of_stock", vanQuantity }
  return { show: false, reason: null, vanQuantity }
}
