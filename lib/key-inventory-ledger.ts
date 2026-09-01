// Append-only usage ledger for key_inventory quantity changes (scripts/160). Server-only
// (Neon). Written from lib/key-inventory.ts's adjust/create/upsert functions — every call
// site gets a ledger row for free instead of each one having to remember to log it.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"

function getSql() {
  return neon(resolveNeonDatabaseUrl())
}

export type KeyInventoryLedgerLocation = "van1" | "van2" | "shop"
export type KeyInventoryLedgerReason = "scan_adjust" | "new_sku_initial" | "reorder_received"

export type KeyInventoryLedgerActor = {
  role: "owner" | "field_tech"
  /** Portal login id (owner's own id, or the tech's), when known. */
  userId: string | null
  /** Display name snapshot — survives the actor's account being removed later. */
  label: string
}

/** Missing table (pre-160 migration) — matches the isMissingTableError shape used elsewhere. */
function isMissingLedgerTableError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  return (
    msg.includes('relation "key_inventory_ledger" does not exist') ||
    msg.includes("42P01") ||
    /column .*key_inventory_ledger.* does not exist/i.test(msg)
  )
}

/**
 * Log one inventory quantity change. Best-effort and never throws — the inventory write this
 * logs has already succeeded by the time this runs, and a missing table or a transient ledger
 * write failure must not turn that into an error the caller sees.
 */
export async function recordKeyInventoryLedgerEntry(params: {
  ownerUserId: string
  keyInventoryId: string
  location: KeyInventoryLedgerLocation
  delta: number
  balanceAfter: number
  reason: KeyInventoryLedgerReason
  actor: KeyInventoryLedgerActor
  reorderRequestId?: string | null
}): Promise<void> {
  try {
    const sql = getSql()
    await sql`
      INSERT INTO key_inventory_ledger (
        owner_user_id, key_inventory_id, location, delta, balance_after, reason,
        actor_role, actor_user_id, actor_label, reorder_request_id
      )
      VALUES (
        ${params.ownerUserId}, ${params.keyInventoryId}, ${params.location}, ${params.delta},
        ${params.balanceAfter}, ${params.reason}, ${params.actor.role}, ${params.actor.userId},
        ${params.actor.label.trim().slice(0, 200)}, ${params.reorderRequestId ?? null}
      )
    `
  } catch (e) {
    if (isMissingLedgerTableError(e)) return
    console.error("[key-inventory-ledger] write failed (non-fatal):", e)
  }
}

export type KeyInventoryLedgerEntry = {
  id: string
  keyInventoryId: string
  sku: string
  tiSku: string | null
  brand: string
  location: KeyInventoryLedgerLocation
  delta: number
  balanceAfter: number
  reason: KeyInventoryLedgerReason
  actorRole: "owner" | "field_tech"
  actorLabel: string
  createdAt: string
}

function mapLedgerRow(row: Record<string, unknown>): KeyInventoryLedgerEntry {
  return {
    id: String(row.id),
    keyInventoryId: String(row.key_inventory_id),
    sku: String(row.sku ?? ""),
    tiSku: row.ti_sku != null && String(row.ti_sku).trim() ? String(row.ti_sku).trim() : null,
    brand: String(row.brand ?? ""),
    location: row.location as KeyInventoryLedgerLocation,
    delta: Number(row.delta ?? 0) || 0,
    balanceAfter: Number(row.balance_after ?? 0) || 0,
    reason: row.reason as KeyInventoryLedgerReason,
    actorRole: row.actor_role as "owner" | "field_tech",
    actorLabel: String(row.actor_label ?? ""),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }
}

/** Most recent inventory activity for the owner's Usage feed. */
export async function listRecentLedgerActivity(
  ownerUserId: string,
  limit = 50
): Promise<KeyInventoryLedgerEntry[]> {
  try {
    const sql = getSql()
    const rows = await sql`
      SELECT l.id, l.key_inventory_id, ki.sku, ki.ti_sku, ki.brand,
             l.location, l.delta, l.balance_after, l.reason, l.actor_role, l.actor_label, l.created_at
      FROM key_inventory_ledger l
      JOIN key_inventory ki ON ki.id = l.key_inventory_id
      WHERE l.owner_user_id = ${ownerUserId}
      ORDER BY l.created_at DESC
      LIMIT ${limit}
    `
    return (rows as Record<string, unknown>[]).map(mapLedgerRow)
  } catch (e) {
    if (isMissingLedgerTableError(e)) return []
    throw e
  }
}

export type TopConsumedSku = {
  keyInventoryId: string
  sku: string
  tiSku: string | null
  brand: string
  totalConsumed: number
}

/** Highest-usage SKUs (stock pulled, not restocked) in the trailing window — owner Usage panel. */
export async function listTopConsumedSkus(
  ownerUserId: string,
  sinceDays = 30,
  limit = 10
): Promise<TopConsumedSku[]> {
  try {
    const sql = getSql()
    const rows = await sql`
      SELECT l.key_inventory_id, ki.sku, ki.ti_sku, ki.brand,
             SUM(-l.delta)::int AS total_consumed
      FROM key_inventory_ledger l
      JOIN key_inventory ki ON ki.id = l.key_inventory_id
      WHERE l.owner_user_id = ${ownerUserId}
        AND l.delta < 0
        AND l.created_at >= now() - make_interval(days => ${sinceDays})
      GROUP BY l.key_inventory_id, ki.sku, ki.ti_sku, ki.brand
      ORDER BY total_consumed DESC
      LIMIT ${limit}
    `
    return (rows as Record<string, unknown>[]).map((row) => ({
      keyInventoryId: String(row.key_inventory_id),
      sku: String(row.sku ?? ""),
      tiSku: row.ti_sku != null && String(row.ti_sku).trim() ? String(row.ti_sku).trim() : null,
      brand: String(row.brand ?? ""),
      totalConsumed: Number(row.total_consumed ?? 0) || 0,
    }))
  } catch (e) {
    if (isMissingLedgerTableError(e)) return []
    throw e
  }
}
