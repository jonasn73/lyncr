// Affiliate locksmith partners for out-of-stock Partner Dispatch.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { normalizePhoneNumberE164 } from "@/lib/db"

export type AffiliateLocksmith = {
  id: string
  userId: string
  organizationId: string | null
  name: string
  phoneE164: string
  webhookUrl: string | null
  commissionCents: number
  notes: string | null
  active: boolean
  sortOrder: number
}

function getSql() {
  return neon(resolveNeonDatabaseUrl())
}

function isMissingTableError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  return (
    msg.includes("affiliate_locksmiths") &&
    (msg.includes("does not exist") || msg.includes("undefined_table"))
  )
}

function mapRow(row: Record<string, unknown>): AffiliateLocksmith {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    organizationId: row.organization_id != null ? String(row.organization_id) : null,
    name: String(row.name ?? "").trim(),
    phoneE164: String(row.phone_e164 ?? "").trim(),
    webhookUrl: row.webhook_url != null ? String(row.webhook_url).trim() || null : null,
    commissionCents: Number(row.commission_cents ?? 5000) || 0,
    notes: row.notes != null ? String(row.notes) : null,
    active: row.active !== false && row.active !== "f" && row.active !== 0,
    sortOrder: Number(row.sort_order ?? 0) || 0,
  }
}

export function serializeAffiliateForApi(row: AffiliateLocksmith) {
  return {
    id: row.id,
    name: row.name,
    phoneE164: row.phoneE164,
    webhookUrl: row.webhookUrl,
    commissionCents: row.commissionCents,
    commissionLabel: `$${(row.commissionCents / 100).toFixed(row.commissionCents % 100 === 0 ? 0 : 2)}`,
    notes: row.notes,
  }
}

export async function listAffiliateLocksmiths(
  userId: string,
  organizationId?: string | null
): Promise<AffiliateLocksmith[]> {
  if (!userId) return []
  const orgId = organizationId?.trim() || null
  try {
    const sql = getSql()
    const rows = orgId
      ? await sql`
          SELECT *
          FROM affiliate_locksmiths
          WHERE user_id = ${userId}::uuid
            AND active = true
            AND (
              organization_id = ${orgId}::uuid
              OR organization_id IS NULL
            )
          ORDER BY sort_order ASC, name ASC
          LIMIT 50
        `
      : await sql`
          SELECT *
          FROM affiliate_locksmiths
          WHERE user_id = ${userId}::uuid
            AND active = true
          ORDER BY sort_order ASC, name ASC
          LIMIT 50
        `
    return (rows as Record<string, unknown>[]).map(mapRow)
  } catch (error) {
    if (isMissingTableError(error)) {
      console.warn("[affiliates] table missing — run scripts/106-key-inventory-specialty-affiliates.sql")
      return []
    }
    throw error
  }
}

export async function getAffiliateLocksmithById(
  userId: string,
  id: string
): Promise<AffiliateLocksmith | null> {
  if (!userId || !id) return null
  try {
    const sql = getSql()
    const rows = await sql`
      SELECT *
      FROM affiliate_locksmiths
      WHERE id = ${id}::uuid
        AND user_id = ${userId}::uuid
        AND active = true
      LIMIT 1
    `
    const row = (rows as Record<string, unknown>[])[0]
    return row ? mapRow(row) : null
  } catch (error) {
    if (isMissingTableError(error)) return null
    throw error
  }
}

/** Build the SMS body sent to a partner when a lead is referred out. */
export function buildAffiliateLeadSms(params: {
  partnerName: string
  customerName: string
  customerPhone: string
  vehicleLabel: string
  address: string
  notes?: string | null
  commissionLabel: string
}): string {
  const phone = normalizePhoneNumberE164(params.customerPhone) || params.customerPhone
  const lines = [
    `Lyncr partner lead for ${params.partnerName}`,
    `Customer: ${params.customerName} · ${phone}`,
    params.vehicleLabel ? `Vehicle: ${params.vehicleLabel}` : null,
    params.address ? `Address: ${params.address}` : null,
    params.notes?.trim() ? `Notes: ${params.notes.trim()}` : null,
    `Commission: ${params.commissionLabel} pending`,
  ].filter(Boolean)
  return lines.join("\n")
}
