// Persist / load unified active_routing_mode and sync legacy routing columns.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { normalizePhoneNumberE164 } from "@/lib/db"
import {
  inferActiveRoutingMode,
  normalizeActiveRoutingMode,
  normalizeCustomRoutingPhone,
  type ActiveRoutingMode,
} from "@/lib/active-routing-mode"
import { upsertIvrMenuSettings } from "@/lib/ivr-menu-db"
import { getIvrMenuSettingsForOwnerLine } from "@/lib/ivr-menu-db"

function sqlClient() {
  return neon(resolveNeonDatabaseUrl())
}

function isMissingModeColumn(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.includes("active_routing_mode") || msg.includes("custom_routing_phone")
}

export type ActiveRoutingState = {
  activeRoutingMode: ActiveRoutingMode
  customRoutingPhone: string | null
  ringTimeoutSeconds: number
  ivrGreetingText?: string
}

/** Read unified mode for a line (falls back to inferred legacy flags). */
export async function getActiveRoutingState(
  ownerUserId: string,
  businessNumber: string | null
): Promise<ActiveRoutingState> {
  const sql = sqlClient()
  const bn = businessNumber ? normalizePhoneNumberE164(businessNumber) : null
  try {
    const rows = bn
      ? await sql`
          SELECT active_routing_mode, custom_routing_phone, ivr_menu_enabled, routing_strategy,
                 selected_receptionist_id, ring_timeout_seconds
          FROM routing_config
          WHERE user_id = ${ownerUserId} AND business_number = ${bn}
          LIMIT 1
        `
      : await sql`
          SELECT active_routing_mode, custom_routing_phone, ivr_menu_enabled, routing_strategy,
                 selected_receptionist_id, ring_timeout_seconds
          FROM routing_config
          WHERE user_id = ${ownerUserId} AND business_number IS NULL
          LIMIT 1
        `
    const row = (rows[0] || {}) as Record<string, unknown>
    if (!rows[0] && bn) {
      const def = await sql`
        SELECT active_routing_mode, custom_routing_phone, ivr_menu_enabled, routing_strategy,
               selected_receptionist_id, ring_timeout_seconds
        FROM routing_config
        WHERE user_id = ${ownerUserId} AND business_number IS NULL
        LIMIT 1
      `
      const d = (def[0] || {}) as Record<string, unknown>
      return {
        activeRoutingMode: inferActiveRoutingMode({
          active_routing_mode: d.active_routing_mode as string | null,
          ivr_menu_enabled: d.ivr_menu_enabled as boolean | null,
          routing_strategy: d.routing_strategy as string | null,
          custom_routing_phone: d.custom_routing_phone as string | null,
        }),
        customRoutingPhone: (d.custom_routing_phone as string) || null,
        ringTimeoutSeconds: Number(d.ring_timeout_seconds ?? 30),
      }
    }
    return {
      activeRoutingMode: inferActiveRoutingMode({
        active_routing_mode: row.active_routing_mode as string | null,
        ivr_menu_enabled: row.ivr_menu_enabled as boolean | null,
        routing_strategy: row.routing_strategy as string | null,
        custom_routing_phone: row.custom_routing_phone as string | null,
      }),
      customRoutingPhone: (row.custom_routing_phone as string) || null,
      ringTimeoutSeconds: Number(row.ring_timeout_seconds ?? 30),
    }
  } catch (e) {
    if (!isMissingModeColumn(e)) throw e
    return {
      activeRoutingMode: "your_phone",
      customRoutingPhone: null,
      ringTimeoutSeconds: 30,
    }
  }
}

/**
 * Set active_routing_mode and sync legacy columns so inbound webhooks stay consistent:
 * smart_ivr → ivr_menu_enabled; lyncr_pool → routing_strategy=lyncr_only; etc.
 */
export async function applyActiveRoutingMode(params: {
  ownerUserId: string
  businessNumber: string | null
  mode: ActiveRoutingMode
  customRoutingPhone?: string | null
  ringTimeoutSeconds?: number
}): Promise<ActiveRoutingState> {
  const sql = sqlClient()
  const mode = normalizeActiveRoutingMode(params.mode)
  const bn = params.businessNumber ? normalizePhoneNumberE164(params.businessNumber) : null
  const customPhone =
    mode === "custom_routing"
      ? normalizeCustomRoutingPhone(params.customRoutingPhone) ||
        (params.customRoutingPhone?.trim() || null)
      : null

  if (mode === "custom_routing" && !customPhone) {
    throw new Error("Enter a valid 10-digit phone number for Custom Routing.")
  }

  const ivrEnabled = mode === "smart_ivr"
  const routingStrategy = mode === "lyncr_pool" ? "lyncr_only" : "private_only"
  const selectedReceptionistId = null // owner / pool / IVR / custom — never a team member in this mode set
  const ringTimeout =
    typeof params.ringTimeoutSeconds === "number" && params.ringTimeoutSeconds > 0
      ? Math.min(120, Math.floor(params.ringTimeoutSeconds))
      : undefined

  try {
    if (bn) {
      const existing = await sql`
        SELECT id FROM routing_config
        WHERE user_id = ${params.ownerUserId} AND business_number = ${bn}
        LIMIT 1
      `
      if (existing[0]) {
        await sql`
          UPDATE routing_config
          SET
            active_routing_mode = ${mode},
            custom_routing_phone = ${customPhone},
            ivr_menu_enabled = ${ivrEnabled},
            routing_strategy = ${routingStrategy},
            selected_receptionist_id = ${selectedReceptionistId},
            updated_at = now()
          WHERE user_id = ${params.ownerUserId} AND business_number = ${bn}
        `
        if (ringTimeout != null) {
          await sql`
            UPDATE routing_config
            SET ring_timeout_seconds = ${ringTimeout}, updated_at = now()
            WHERE user_id = ${params.ownerUserId} AND business_number = ${bn}
          `
        }
      } else {
        await sql`
          INSERT INTO routing_config (
            id, user_id, business_number, selected_receptionist_id, fallback_type,
            ai_greeting, ring_timeout_seconds, ai_ring_owner_first, routing_strategy,
            ivr_menu_enabled, active_routing_mode, custom_routing_phone, updated_at
          ) VALUES (
            ${crypto.randomUUID()}, ${params.ownerUserId}, ${bn}, NULL, 'owner',
            '', ${ringTimeout ?? 30}, false, ${routingStrategy},
            ${ivrEnabled}, ${mode}, ${customPhone}, now()
          )
        `
      }

      await sql`
        UPDATE phone_numbers
        SET ivr_menu_enabled = ${ivrEnabled}
        WHERE user_id = ${params.ownerUserId} AND number = ${bn}
      `
    } else {
      await sql`
        UPDATE routing_config
        SET
          active_routing_mode = ${mode},
          custom_routing_phone = ${customPhone},
          ivr_menu_enabled = ${ivrEnabled},
          routing_strategy = ${routingStrategy},
          selected_receptionist_id = ${selectedReceptionistId},
          updated_at = now()
        WHERE user_id = ${params.ownerUserId} AND business_number IS NULL
      `
      if (ringTimeout != null) {
        await sql`
          UPDATE routing_config
          SET ring_timeout_seconds = ${ringTimeout}, updated_at = now()
          WHERE user_id = ${params.ownerUserId} AND business_number IS NULL
        `
      }
      await sql`
        UPDATE phone_numbers
        SET ivr_menu_enabled = ${ivrEnabled}
        WHERE user_id = ${params.ownerUserId}
      `
    }
  } catch (e) {
    if (isMissingModeColumn(e)) {
      const err = new Error(
        "active_routing_mode columns missing — run scripts/089-active-routing-mode-and-deposits.sql in Neon."
      )
      ;(err as Error & { code?: string }).code = "ROUTING_MODE_MIGRATION_REQUIRED"
      throw err
    }
    throw e
  }

  // Keep IVR settings row in sync for Off-duty master switch.
  try {
    const existingIvr = await getIvrMenuSettingsForOwnerLine(params.ownerUserId, bn)
    await upsertIvrMenuSettings({
      ownerUserId: params.ownerUserId,
      businessNumber: bn,
      settings: { ...existingIvr, ivrMenuEnabled: ivrEnabled },
    })
  } catch (e) {
    console.warn("[active-routing-mode] IVR enable sync skipped:", e)
  }

  return {
    activeRoutingMode: mode,
    customRoutingPhone: customPhone,
    ringTimeoutSeconds: ringTimeout ?? 30,
  }
}

/** Resolve custom forward target for an inbound DID (null when not in custom mode). */
export async function getCustomRoutingPhoneForDid(toNumber: string): Promise<string | null> {
  const sql = sqlClient()
  const normalized = normalizePhoneNumberE164(toNumber)
  if (!normalized) return null
  const digitKey = normalized.replace(/\D/g, "").slice(-10)
  try {
    const rows = await sql`
      SELECT rc.active_routing_mode, rc.custom_routing_phone
      FROM phone_numbers pn
      JOIN routing_config rc ON rc.user_id = pn.user_id
        AND (rc.business_number = pn.number OR rc.business_number IS NULL)
      WHERE pn.number = ${normalized}
         OR RIGHT(regexp_replace(pn.number, '[^0-9]', '', 'g'), 10) = ${digitKey}
      ORDER BY CASE WHEN rc.business_number = pn.number THEN 0 ELSE 1 END
      LIMIT 1
    `
    const row = rows[0] as { active_routing_mode?: string; custom_routing_phone?: string } | undefined
    if (!row) return null
    if (normalizeActiveRoutingMode(row.active_routing_mode) !== "custom_routing") return null
    return normalizeCustomRoutingPhone(row.custom_routing_phone)
  } catch (e) {
    if (isMissingModeColumn(e)) return null
    console.warn("[active-routing-mode] custom DID lookup failed:", e)
    return null
  }
}

/** Who Answers mode for an inbound DID — drives night/day capture vs pool. */
export async function getActiveRoutingModeForDid(
  toNumber: string
): Promise<ActiveRoutingMode> {
  const sql = sqlClient()
  const normalized = normalizePhoneNumberE164(toNumber)
  if (!normalized) return "your_phone"
  const digitKey = normalized.replace(/\D/g, "").slice(-10)
  try {
    const rows = await sql`
      SELECT
        rc.active_routing_mode,
        rc.ivr_menu_enabled,
        rc.routing_strategy,
        rc.custom_routing_phone,
        rc.selected_receptionist_id
      FROM phone_numbers pn
      JOIN routing_config rc ON rc.user_id = pn.user_id
        AND (rc.business_number = pn.number OR rc.business_number IS NULL)
      WHERE pn.number = ${normalized}
         OR RIGHT(regexp_replace(pn.number, '[^0-9]', '', 'g'), 10) = ${digitKey}
      ORDER BY CASE WHEN rc.business_number = pn.number THEN 0 ELSE 1 END
      LIMIT 1
    `
    const row = rows[0] as Record<string, unknown> | undefined
    if (!row) return "your_phone"
    return inferActiveRoutingMode({
      active_routing_mode: row.active_routing_mode as string | null,
      ivr_menu_enabled: row.ivr_menu_enabled as boolean | null,
      routing_strategy: row.routing_strategy as string | null,
      custom_routing_phone: row.custom_routing_phone as string | null,
      selected_receptionist_id: row.selected_receptionist_id as string | null,
    })
  } catch (e) {
    if (isMissingModeColumn(e)) return "your_phone"
    console.warn("[active-routing-mode] mode DID lookup failed:", e)
    return "your_phone"
  }
}
