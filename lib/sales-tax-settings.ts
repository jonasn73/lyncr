// Business default for Collect/Charge sales tax (account_settings).

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"

export type SalesTaxSettings = {
  /** Charge opens with tax ON when true. */
  enabledDefault: boolean
  /** Percent e.g. 6 for 6%. */
  ratePercent: number
}

export const DEFAULT_SALES_TAX_SETTINGS: SalesTaxSettings = {
  enabledDefault: true,
  ratePercent: 6,
}

function sqlClient() {
  return neon(resolveNeonDatabaseUrl())
}

function isMissingSalesTaxColumn(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "")
  return (
    msg.includes("sales_tax_enabled_default") ||
    msg.includes("sales_tax_rate_percent") ||
    (msg.includes("column") && msg.includes("does not exist") && msg.includes("sales_tax"))
  )
}

function clampRate(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw)
  if (!Number.isFinite(n) || n < 0) return DEFAULT_SALES_TAX_SETTINGS.ratePercent
  return Math.min(30, Math.round(n * 100) / 100)
}

/** Load tax defaults for an owner (falls back to ON / 6% before migration). */
export async function getSalesTaxSettings(ownerUserId: string): Promise<SalesTaxSettings> {
  const uid = ownerUserId.trim()
  if (!uid) return { ...DEFAULT_SALES_TAX_SETTINGS }
  const sql = sqlClient()
  try {
    const rows = await sql`
      SELECT sales_tax_enabled_default, sales_tax_rate_percent
      FROM account_settings
      WHERE user_id = ${uid}
      LIMIT 1
    `
    const row = rows[0] as
      | { sales_tax_enabled_default?: boolean; sales_tax_rate_percent?: string | number }
      | undefined
    if (!row) {
      await sql`
        INSERT INTO account_settings (user_id, presence_status, presence_closed_manual)
        VALUES (${uid}, 'AVAILABLE', false)
        ON CONFLICT (user_id) DO NOTHING
      `
      return { ...DEFAULT_SALES_TAX_SETTINGS }
    }
    return {
      enabledDefault: row.sales_tax_enabled_default !== false,
      ratePercent: clampRate(row.sales_tax_rate_percent),
    }
  } catch (e) {
    if (isMissingSalesTaxColumn(e)) return { ...DEFAULT_SALES_TAX_SETTINGS }
    console.warn("[sales-tax-settings] get failed:", e)
    return { ...DEFAULT_SALES_TAX_SETTINGS }
  }
}

/** Save tax defaults (creates account_settings row if needed). */
export async function updateSalesTaxSettings(
  ownerUserId: string,
  next: { enabledDefault?: boolean; ratePercent?: number }
): Promise<SalesTaxSettings> {
  const uid = ownerUserId.trim()
  if (!uid) throw new Error("Missing user")
  const current = await getSalesTaxSettings(uid)
  const enabledDefault =
    typeof next.enabledDefault === "boolean" ? next.enabledDefault : current.enabledDefault
  const ratePercent =
    next.ratePercent != null ? clampRate(next.ratePercent) : current.ratePercent
  const sql = sqlClient()
  try {
    await sql`
      INSERT INTO account_settings (
        user_id,
        presence_status,
        presence_closed_manual,
        sales_tax_enabled_default,
        sales_tax_rate_percent,
        updated_at
      )
      VALUES (
        ${uid},
        'AVAILABLE',
        false,
        ${enabledDefault},
        ${ratePercent},
        now()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        sales_tax_enabled_default = EXCLUDED.sales_tax_enabled_default,
        sales_tax_rate_percent = EXCLUDED.sales_tax_rate_percent,
        updated_at = now()
    `
    return { enabledDefault, ratePercent }
  } catch (e) {
    if (isMissingSalesTaxColumn(e)) {
      const err = new Error(
        "Sales tax settings need a database update. Run scripts/123-sales-tax-defaults.sql in Neon."
      )
      ;(err as Error & { code?: string }).code = "SALES_TAX_MIGRATION_REQUIRED"
      throw err
    }
    throw e
  }
}
