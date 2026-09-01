// Key reorder requests (scripts/159) — a tech flags an out-of-stock key from Key Lookup, the
// owner approves/denies, then tracks the manual Transponder Island order through to receipt.
// Server-only (Neon). See lib/key-inventory-ledger.ts for the usage-history side of this.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import {
  adjustKeyInventoryQuantity,
  createKeyInventoryItem,
  getKeyInventoryBySku,
  type KeyInventoryRow,
  type KeyInventoryStockLocation,
} from "@/lib/key-inventory"
import { recordKeyInventoryLedgerEntry, type KeyInventoryLedgerActor } from "@/lib/key-inventory-ledger"

function getSql() {
  return neon(resolveNeonDatabaseUrl())
}

function isMissingTableError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  return msg.includes('relation "key_reorder_requests" does not exist') || msg.includes("42P01")
}

export type KeyReorderRequestStatus = "pending" | "approved" | "denied" | "ordered" | "received" | "cancelled"

export type KeyReorderRequest = {
  id: string
  ownerUserId: string
  organizationId: string | null
  keyInventoryId: string | null
  tiSku: string
  title: string
  fccId: string
  productUrl: string
  imageUrl: string | null
  vehicleYear: string | null
  vehicleMake: string | null
  vehicleModel: string | null
  quantity: number
  requestedByRole: "owner" | "field_tech"
  requestedByUserId: string | null
  requestedByLabel: string
  status: KeyReorderRequestStatus
  decidedByUserId: string | null
  decidedAt: string | null
  denialReason: string | null
  orderedAt: string | null
  receivedAt: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

function mapRow(row: Record<string, unknown>): KeyReorderRequest {
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v != null ? String(v) : null)
  return {
    id: String(row.id),
    ownerUserId: String(row.owner_user_id),
    organizationId: row.organization_id != null ? String(row.organization_id) : null,
    keyInventoryId: row.key_inventory_id != null ? String(row.key_inventory_id) : null,
    tiSku: String(row.ti_sku ?? ""),
    title: String(row.title ?? ""),
    fccId: String(row.fcc_id ?? ""),
    productUrl: String(row.product_url ?? ""),
    imageUrl: row.image_url != null && String(row.image_url).trim() ? String(row.image_url) : null,
    vehicleYear: row.vehicle_year != null ? String(row.vehicle_year) : null,
    vehicleMake: row.vehicle_make != null ? String(row.vehicle_make) : null,
    vehicleModel: row.vehicle_model != null ? String(row.vehicle_model) : null,
    quantity: Number(row.quantity ?? 1) || 1,
    requestedByRole: row.requested_by_role as "owner" | "field_tech",
    requestedByUserId: row.requested_by_user_id != null ? String(row.requested_by_user_id) : null,
    requestedByLabel: String(row.requested_by_label ?? ""),
    status: row.status as KeyReorderRequestStatus,
    decidedByUserId: row.decided_by_user_id != null ? String(row.decided_by_user_id) : null,
    decidedAt: iso(row.decided_at),
    denialReason: row.denial_reason != null ? String(row.denial_reason) : null,
    orderedAt: iso(row.ordered_at),
    receivedAt: iso(row.received_at),
    notes: row.notes != null ? String(row.notes) : null,
    createdAt: iso(row.created_at) as string,
    updatedAt: iso(row.updated_at) as string,
  }
}

export async function createReorderRequest(params: {
  ownerUserId: string
  organizationId?: string | null
  tiSku: string
  title?: string
  fccId?: string
  productUrl?: string
  imageUrl?: string | null
  vehicleYear?: string | null
  vehicleMake?: string | null
  vehicleModel?: string | null
  quantity?: number
  requestedBy: { role: "owner" | "field_tech"; userId: string | null; label: string }
}): Promise<KeyReorderRequest> {
  const tiSku = params.tiSku.trim()
  if (!params.ownerUserId || !tiSku) throw new Error("ownerUserId and tiSku are required")
  const quantity = Math.max(1, Math.trunc(params.quantity ?? 1))
  const orgId = params.organizationId?.trim() || null

  try {
    const sql = getSql()
    const rows = await sql`
      INSERT INTO key_reorder_requests (
        owner_user_id, organization_id, ti_sku, title, fcc_id, product_url, image_url,
        vehicle_year, vehicle_make, vehicle_model, quantity,
        requested_by_role, requested_by_user_id, requested_by_label
      ) VALUES (
        ${params.ownerUserId}::uuid, ${orgId}::uuid, ${tiSku}, ${params.title ?? ""}, ${params.fccId ?? ""},
        ${params.productUrl ?? ""}, ${params.imageUrl ?? null},
        ${params.vehicleYear ?? null}, ${params.vehicleMake ?? null}, ${params.vehicleModel ?? null}, ${quantity},
        ${params.requestedBy.role}, ${params.requestedBy.userId}, ${params.requestedBy.label.trim().slice(0, 200)}
      )
      RETURNING *
    `
    const row = (rows as Record<string, unknown>[])[0]
    if (!row) throw new Error("Insert failed")
    return mapRow(row)
  } catch (e) {
    if (isMissingTableError(e)) {
      throw new Error("Reorder requests table is missing. Run scripts/159-key-reorder-requests.sql in Neon.")
    }
    throw e
  }
}

export async function listReorderRequestsForOwner(ownerUserId: string): Promise<KeyReorderRequest[]> {
  try {
    const sql = getSql()
    const rows = await sql`
      SELECT * FROM key_reorder_requests
      WHERE owner_user_id = ${ownerUserId}::uuid
      ORDER BY
        CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 WHEN 'ordered' THEN 2 ELSE 3 END,
        created_at DESC
    `
    return (rows as Record<string, unknown>[]).map(mapRow)
  } catch (e) {
    if (isMissingTableError(e)) return []
    throw e
  }
}

async function getReorderRequestForOwner(ownerUserId: string, id: string): Promise<KeyReorderRequest | null> {
  const sql = getSql()
  const rows = await sql`
    SELECT * FROM key_reorder_requests WHERE id = ${id}::uuid AND owner_user_id = ${ownerUserId}::uuid LIMIT 1
  `
  const row = (rows as Record<string, unknown>[])[0]
  return row ? mapRow(row) : null
}

/** Approve or deny a pending request. */
export async function decideReorderRequest(params: {
  ownerUserId: string
  requestId: string
  decision: "approved" | "denied"
  decidedByUserId: string
  denialReason?: string | null
}): Promise<KeyReorderRequest | null> {
  const sql = getSql()
  const rows = await sql`
    UPDATE key_reorder_requests
    SET status = ${params.decision},
        decided_by_user_id = ${params.decidedByUserId}::uuid,
        decided_at = now(),
        denial_reason = ${params.decision === "denied" ? (params.denialReason?.trim() || null) : null},
        updated_at = now()
    WHERE id = ${params.requestId}::uuid
      AND owner_user_id = ${params.ownerUserId}::uuid
      AND status = 'pending'
    RETURNING *
  `
  const row = (rows as Record<string, unknown>[])[0]
  return row ? mapRow(row) : null
}

/** Owner has placed the order on Transponder Island's site (manual step, tracked here). */
export async function markReorderRequestOrdered(params: {
  ownerUserId: string
  requestId: string
}): Promise<KeyReorderRequest | null> {
  const sql = getSql()
  const rows = await sql`
    UPDATE key_reorder_requests
    SET status = 'ordered', ordered_at = now(), updated_at = now()
    WHERE id = ${params.requestId}::uuid
      AND owner_user_id = ${params.ownerUserId}::uuid
      AND status = 'approved'
    RETURNING *
  `
  const row = (rows as Record<string, unknown>[])[0]
  return row ? mapRow(row) : null
}

/** Cancel from any non-terminal state. Never touches inventory. */
export async function cancelReorderRequest(params: {
  ownerUserId: string
  requestId: string
}): Promise<KeyReorderRequest | null> {
  const sql = getSql()
  const rows = await sql`
    UPDATE key_reorder_requests
    SET status = 'cancelled', updated_at = now()
    WHERE id = ${params.requestId}::uuid
      AND owner_user_id = ${params.ownerUserId}::uuid
      AND status IN ('pending', 'approved', 'ordered')
    RETURNING *
  `
  const row = (rows as Record<string, unknown>[])[0]
  return row ? mapRow(row) : null
}

/**
 * Terminal action: the order arrived. Restocks key_inventory (creating the row if this SKU
 * has none yet) and writes the ledger entry itself — not via createKeyInventoryItem's own
 * actor logging, since that would log reason "new_sku_initial" instead of the correct
 * "reorder_received" — then flips the request to received.
 */
export async function receiveReorderRequest(params: {
  ownerUserId: string
  requestId: string
  location: KeyInventoryStockLocation
  actor: KeyInventoryLedgerActor
}): Promise<KeyReorderRequest | null> {
  const request = await getReorderRequestForOwner(params.ownerUserId, params.requestId)
  if (!request) return null
  if (request.status !== "approved" && request.status !== "ordered") {
    throw new Error("Request must be approved or ordered before it can be received")
  }

  let inventoryId = request.keyInventoryId
  let row: KeyInventoryRow

  if (!inventoryId) {
    const existing = await getKeyInventoryBySku(params.ownerUserId, request.tiSku)
    if (existing) inventoryId = existing.id
  }

  if (inventoryId) {
    const adjusted = await adjustKeyInventoryQuantity({
      userId: params.ownerUserId,
      id: inventoryId,
      delta: request.quantity,
      location: params.location,
    })
    if (!adjusted) throw new Error("Could not restock inventory")
    row = adjusted
  } else {
    const created = await createKeyInventoryItem({
      userId: params.ownerUserId,
      organizationId: request.organizationId,
      sku: request.tiSku,
      tiSku: request.tiSku,
      fccId: request.fccId,
      imageUrl: request.imageUrl,
      van1Quantity: params.location === "van1" ? request.quantity : 0,
      van2Quantity: params.location === "van2" ? request.quantity : 0,
      shopQuantity: params.location === "shop" ? request.quantity : 0,
    })
    row = created.row
    inventoryId = row.id
  }

  const balanceAfter =
    params.location === "van2" ? row.van2Quantity : params.location === "shop" ? row.shopQuantity : row.van1Quantity
  await recordKeyInventoryLedgerEntry({
    ownerUserId: params.ownerUserId,
    keyInventoryId: inventoryId,
    location: params.location,
    delta: request.quantity,
    balanceAfter,
    reason: "reorder_received",
    actor: params.actor,
    reorderRequestId: request.id,
  })

  const sql = getSql()
  const rows = await sql`
    UPDATE key_reorder_requests
    SET status = 'received', key_inventory_id = ${inventoryId}::uuid, received_at = now(), updated_at = now()
    WHERE id = ${request.id}::uuid AND owner_user_id = ${params.ownerUserId}::uuid
    RETURNING *
  `
  const updated = (rows as Record<string, unknown>[])[0]
  return updated ? mapRow(updated) : null
}
