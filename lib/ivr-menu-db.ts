// Persist / load traditional IVR menu settings (routing_config + phone_numbers snapshot).

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { normalizePhoneNumberE164 } from "@/lib/db"
import {
  DEFAULT_IVR_MENU_SETTINGS,
  normalizeIvrMenuSettings,
  type IvrMenuSettings,
} from "@/lib/ivr-menu-settings"

function sqlClient() {
  return neon(resolveNeonDatabaseUrl())
}

function isMissingIvrColumnError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return (
    msg.includes("ivr_greeting_text") ||
    msg.includes("ivr_option1_action") ||
    msg.includes("ivr_option2_action") ||
    msg.includes("ivr_menu_enabled")
  )
}

/**
 * Load IVR settings for a business line (per-number row, else account default).
 */
export async function getIvrMenuSettingsForOwnerLine(
  ownerUserId: string,
  businessNumber: string | null | undefined
): Promise<IvrMenuSettings> {
  const sql = sqlClient()
  const bn = businessNumber ? normalizePhoneNumberE164(businessNumber) : null

  try {
    if (bn) {
      const perLine = await sql`
        SELECT ivr_greeting_text, ivr_option1_action, ivr_option2_action, ivr_menu_enabled
        FROM routing_config
        WHERE user_id = ${ownerUserId} AND business_number = ${bn}
        LIMIT 1
      `
      if (perLine[0]) return normalizeIvrMenuSettings(perLine[0] as Record<string, unknown>)
    }

    const def = await sql`
      SELECT ivr_greeting_text, ivr_option1_action, ivr_option2_action, ivr_menu_enabled
      FROM routing_config
      WHERE user_id = ${ownerUserId} AND business_number IS NULL
      LIMIT 1
    `
    if (def[0]) return normalizeIvrMenuSettings(def[0] as Record<string, unknown>)
  } catch (e) {
    if (!isMissingIvrColumnError(e)) throw e
    console.warn("[ivr-menu-db] get skipped — run scripts/086 + 087 in Neon")
  }

  return { ...DEFAULT_IVR_MENU_SETTINGS }
}

/**
 * Load IVR settings by the inbound DID (phone_numbers snapshot first, then routing_config).
 */
export async function getIvrMenuSettingsByInboundDid(
  toNumber: string
): Promise<{ ownerUserId: string | null; settings: IvrMenuSettings }> {
  const sql = sqlClient()
  const normalized = normalizePhoneNumberE164(toNumber)
  if (!normalized) {
    return { ownerUserId: null, settings: { ...DEFAULT_IVR_MENU_SETTINGS } }
  }
  const digitKey = normalized.replace(/\D/g, "").slice(-10)

  try {
    const rows = await sql`
      SELECT
        pn.user_id,
        COALESCE(NULLIF(trim(pn.ivr_greeting_text), ''), rc.ivr_greeting_text) AS ivr_greeting_text,
        COALESCE(NULLIF(trim(pn.ivr_option1_action), ''), rc.ivr_option1_action) AS ivr_option1_action,
        COALESCE(NULLIF(trim(pn.ivr_option2_action), ''), rc.ivr_option2_action) AS ivr_option2_action,
        COALESCE(pn.ivr_menu_enabled, rc.ivr_menu_enabled, false) AS ivr_menu_enabled
      FROM phone_numbers pn
      LEFT JOIN routing_config rc
        ON rc.user_id = pn.user_id
       AND (
         rc.business_number = pn.number
         OR (rc.business_number IS NULL AND NOT EXISTS (
           SELECT 1 FROM routing_config r2
           WHERE r2.user_id = pn.user_id AND r2.business_number = pn.number
         ))
       )
      WHERE pn.number = ${normalized}
         OR RIGHT(regexp_replace(pn.number, '[^0-9]', '', 'g'), 10) = ${digitKey}
      ORDER BY CASE WHEN pn.number = ${normalized} THEN 0 ELSE 1 END
      LIMIT 1
    `
    if (rows[0]) {
      return {
        ownerUserId: String((rows[0] as { user_id: string }).user_id),
        settings: normalizeIvrMenuSettings(rows[0] as Record<string, unknown>),
      }
    }
  } catch (e) {
    if (!isMissingIvrColumnError(e)) {
      console.warn("[ivr-menu-db] inbound DID IVR read failed:", e)
    } else {
      console.warn("[ivr-menu-db] inbound DID skipped — run scripts/086 + 087 in Neon")
    }
  }

  try {
    const ownerRows = await sql`
      SELECT user_id FROM phone_numbers
      WHERE number = ${normalized}
         OR RIGHT(regexp_replace(number, '[^0-9]', '', 'g'), 10) = ${digitKey}
      LIMIT 1
    `
    const ownerUserId = ownerRows[0] ? String((ownerRows[0] as { user_id: string }).user_id) : null
    if (ownerUserId) {
      const settings = await getIvrMenuSettingsForOwnerLine(ownerUserId, normalized)
      return { ownerUserId, settings }
    }
  } catch (e) {
    console.warn("[ivr-menu-db] owner lookup failed:", e)
  }

  return { ownerUserId: null, settings: { ...DEFAULT_IVR_MENU_SETTINGS } }
}

/** Fast inbound check — true when Off-duty IVR menu should answer this DID. */
export async function isIvrMenuEnabledForInboundDid(toNumber: string): Promise<boolean> {
  const { settings } = await getIvrMenuSettingsByInboundDid(toNumber)
  return settings.ivrMenuEnabled === true
}

/** Upsert IVR settings on routing_config and denormalize onto phone_numbers. */
export async function upsertIvrMenuSettings(params: {
  ownerUserId: string
  businessNumber: string | null
  settings: IvrMenuSettings
}): Promise<IvrMenuSettings> {
  const sql = sqlClient()
  const bn = params.businessNumber ? normalizePhoneNumberE164(params.businessNumber) : null
  const greeting = params.settings.ivrGreetingText.trim() || DEFAULT_IVR_MENU_SETTINGS.ivrGreetingText
  const opt1 = params.settings.ivrOption1Action
  const opt2 = params.settings.ivrOption2Action
  const enabled = params.settings.ivrMenuEnabled === true

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
            ivr_greeting_text = ${greeting},
            ivr_option1_action = ${opt1},
            ivr_option2_action = ${opt2},
            ivr_menu_enabled = ${enabled},
            updated_at = now()
          WHERE user_id = ${params.ownerUserId} AND business_number = ${bn}
        `
      } else {
        const def = await sql`
          SELECT selected_receptionist_id, fallback_type, ai_greeting, ring_timeout_seconds, ai_ring_owner_first
          FROM routing_config
          WHERE user_id = ${params.ownerUserId} AND business_number IS NULL
          LIMIT 1
        `
        const d = (def[0] || {}) as Record<string, unknown>
        await sql`
          INSERT INTO routing_config (
            id, user_id, business_number, selected_receptionist_id, fallback_type, ai_greeting,
            ring_timeout_seconds, ai_ring_owner_first, ivr_greeting_text, ivr_option1_action,
            ivr_option2_action, ivr_menu_enabled, updated_at
          ) VALUES (
            ${crypto.randomUUID()},
            ${params.ownerUserId},
            ${bn},
            ${d.selected_receptionist_id ?? null},
            ${d.fallback_type ?? "owner"},
            ${d.ai_greeting ?? ""},
            ${Number(d.ring_timeout_seconds ?? 30)},
            ${Boolean(d.ai_ring_owner_first)},
            ${greeting},
            ${opt1},
            ${opt2},
            ${enabled},
            now()
          )
        `
      }

      await sql`
        UPDATE phone_numbers
        SET
          ivr_greeting_text = ${greeting},
          ivr_option1_action = ${opt1},
          ivr_option2_action = ${opt2},
          ivr_menu_enabled = ${enabled}
        WHERE user_id = ${params.ownerUserId} AND number = ${bn}
      `
    } else {
      await sql`
        UPDATE routing_config
        SET
          ivr_greeting_text = ${greeting},
          ivr_option1_action = ${opt1},
          ivr_option2_action = ${opt2},
          ivr_menu_enabled = ${enabled},
          updated_at = now()
        WHERE user_id = ${params.ownerUserId} AND business_number IS NULL
      `
      await sql`
        UPDATE phone_numbers
        SET
          ivr_greeting_text = COALESCE(NULLIF(trim(ivr_greeting_text), ''), ${greeting}),
          ivr_option1_action = COALESCE(NULLIF(trim(ivr_option1_action), ''), ${opt1}),
          ivr_option2_action = COALESCE(NULLIF(trim(ivr_option2_action), ''), ${opt2}),
          ivr_menu_enabled = ${enabled}
        WHERE user_id = ${params.ownerUserId}
      `
    }
  } catch (e) {
    if (isMissingIvrColumnError(e)) {
      const err = new Error(
        "IVR settings columns missing — run scripts/086-ivr-menu-settings.sql and scripts/087-ivr-menu-enabled.sql in Neon."
      )
      ;(err as Error & { code?: string }).code = "IVR_MIGRATION_REQUIRED"
      throw err
    }
    throw e
  }

  return {
    ivrGreetingText: greeting,
    ivrOption1Action: opt1,
    ivrOption2Action: opt2,
    ivrMenuEnabled: enabled,
  }
}
