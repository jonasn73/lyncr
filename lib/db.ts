// ============================================
// lyncr - Database Client
// ============================================
// Uses Neon serverless when DATABASE_URL is set (production / live app).
// Set DATABASE_URL in Vercel → Settings → Environment Variables, then run
// scripts/001-create-schema.sql and scripts/002-add-password-hash.sql in your Neon SQL Editor.

import { neon } from "@neondatabase/serverless"
import { SITE_NAME } from "@/lib/brand"
import type {
  RoutingConfig,
  Receptionist,
  User,
  CallLog,
  PhoneNumber,
  PortingNotification,
  FeedbackSubmission,
  FeedbackStatus,
  AdminUserSummary,
  AdminUserDetail,
  FeedbackCategory,
  Customer,
  OnboardingProfile,
  UpdateOnboardingProfileRequest,
} from "./types"
import { defaultProfileFromUserIndustry } from "./business-industries"
import { isOnboardingTelnyxSimulationMode } from "./onboarding-telnyx-provision-mode"
import { runOnboardingTelnyxProvisionPlaceholder } from "./onboarding-telnyx-provision-placeholder"

/** True when Postgres/Neon rejects SELECT/INSERT because `users.industry` was not migrated yet (011-user-industry.sql). */
function isMissingIndustryColumnError(e: unknown): boolean {
  const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : ""
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase()
  if (code === "42703" && msg.includes("industry")) return true
  if (!msg.includes("industry")) return false
  return (
    msg.includes("does not exist") ||
    msg.includes("undefined column") ||
    msg.includes("42703") ||
    (msg.includes("column") && msg.includes("users"))
  )
}

/** True when Postgres reports a missing table/view (42P01), e.g. before scripts/010-ai-leads-intake.sql is run in Neon. */
function isMissingOnboardingProfilesTableError(e: unknown): boolean {
  return isUndefinedRelationError(e, "onboarding_profiles")
}

/** True when an old/wrong `profiles` table exists without our onboarding columns. */
function isWrongLegacyProfilesTableError(e: unknown): boolean {
  const msg = pgErrorMessage(e).toLowerCase()
  return (
    pgErrorCode(e) === "42703" &&
    msg.includes("user_id") &&
    msg.includes("profiles") &&
    !msg.includes("onboarding_profiles")
  )
}

function onboardingProfilesMigrationHint(): string {
  return "Run scripts/025-onboarding-profiles-table.sql in Neon (see scripts/MIGRATE-ALL.md step 25)."
}

/** Missing optional onboarding_profiles column (e.g. before scripts/027). */
function isMissingOnboardingProfileColumnError(e: unknown): boolean {
  if (pgErrorCode(e) !== "42703") return false
  const msg = pgErrorMessage(e)
  return (
    msg.includes("billing_cycle") ||
    msg.includes("stripe_customer") ||
    msg.includes("stripe_subscription") ||
    msg.includes("has_billing_method")
  )
}

export function isUndefinedRelationError(e: unknown, relationName?: string): boolean {
  const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : ""
  if (code !== "42P01") return false
  if (!relationName) return true
  const hint = relationName.toLowerCase()
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase()
  return msg.includes(hint)
}

/** True when call_logs is missing timing columns from scripts/007-call-quality-metrics.sql (Postgres 42703). */
function isMissingCallQualityColumnsError(e: unknown): boolean {
  const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : ""
  if (code !== "42703") return false
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase()
  return msg.includes("setup_duration_ms") || msg.includes("post_dial_delay_ms")
}

function pgErrorCode(e: unknown): string {
  return e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : ""
}

function pgErrorMessage(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).toLowerCase()
}

// Lazy Neon client so we only connect when DATABASE_URL is set
let cachedSql: ReturnType<typeof neon> | null = null
function getSql(): ReturnType<typeof neon> {
  if (cachedSql) return cachedSql
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set. Add it in Vercel → Settings → Environment Variables (and in .env.local for local dev).")
  cachedSql = neon(url)
  return cachedSql
}

// --- Query functions ---

/** Postgres / Neon usually returns boolean; normalize edge encodings. */
function pgBool(v: unknown): boolean {
  return v === true || v === "t" || v === "true" || v === 1
}

/** True when `users.inbound_receptionist_whisper_enabled` is missing (run scripts/017-inbound-whisper-user-toggle.sql). */
function isMissingInboundReceptionistWhisperColumnError(e: unknown): boolean {
  const code = pgErrorCode(e)
  const msg = pgErrorMessage(e).toLowerCase()
  return code === "42703" && msg.includes("inbound_receptionist_whisper_enabled")
}

/** True when `019-billing-admin-feedback.sql` has not been applied yet (missing billing columns on `users`). */
function isMissingBillingColumnsError(e: unknown): boolean {
  const code = pgErrorCode(e)
  if (code !== "42703") return false
  const msg = pgErrorMessage(e).toLowerCase()
  return (
    msg.includes("credit_balance_cents") ||
    msg.includes("billing_plan") ||
    msg.includes("is_platform_admin")
  )
}

// Parse a routing_config row into a RoutingConfig object
function parseRoutingRow(row: Record<string, unknown>): RoutingConfig {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    business_number: row.business_number != null ? String(row.business_number) : null,
    selected_receptionist_id: (() => {
      if (row.selected_receptionist_id == null) return null
      const s = String(row.selected_receptionist_id).trim()
      return s === "" ? null : s
    })(),
    fallback_type: row.fallback_type as RoutingConfig["fallback_type"],
    ai_greeting: String(row.ai_greeting ?? ""),
    ring_timeout_seconds: Number(row.ring_timeout_seconds ?? 30),
    ai_ring_owner_first: pgBool(row.ai_ring_owner_first),
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  }
}

export type IncomingRoutingRow = {
  user_id: string
  user_name: string
  /** Account business name (users.business_name) — whisper prefix + optional Telnyx fromDisplayName. */
  business_name: string
  /** Per-account whisper toggle (users.inbound_receptionist_whisper_enabled). */
  inbound_receptionist_whisper_enabled: boolean
  owner_phone: string
  selected_receptionist_id: string | null
  fallback_type: RoutingConfig["fallback_type"]
  ring_timeout_seconds: number
  ai_ring_owner_first: boolean
  receptionist_name: string | null
  receptionist_phone: string | null
  /** `phone_numbers.label` — shown to receptionist in whisper / UI (e.g. "Key Squad 502"). */
  phone_line_label: string
  /** `phone_numbers.friendly_name` — display form of the DID. */
  phone_line_friendly_name: string
}

// Cache for incoming voice routing to reduce per-request DB latency on the **same** instance.
// **Do not rely on this for correctness:** `clearIncomingRoutingCache()` only clears this process; other
// Vercel/serverless instances keep their own Map. Telnyx `/incoming` must use `{ bypassCache: true }` so
// receptionist + fallback match the dashboard immediately after saves.
type IncomingRoutingByNumber = IncomingRoutingRow | null

const incomingRoutingCache = new Map<string, { expiresAt: number; value: IncomingRoutingByNumber }>()
const INCOMING_ROUTING_CACHE_TTL_MS = 10_000

/** Clear cached routing so voice webhooks see updated fallback_type immediately after dashboard saves. */
export function clearIncomingRoutingCache(): void {
  incomingRoutingCache.clear()
}

// Normalize toward E.164 so values match `phone_numbers.number` and Telnyx `<Number>` dialing.
// Returns "" when there are no digits (avoids a lone "+" that would make `hasReceptionist` truthy but nothing dials).
export function normalizePhoneNumberE164(phone: string): string {
  const trimmed = String(phone ?? "").trim()
  if (!trimmed) return ""
  const digits = trimmed.replace(/\D/g, "")
  if (!digits) return ""
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  return `+${digits}`
}

/** True when a string is plausibly dialable as PSTN E.164 (blocks "+", short extensions, and garbage joins). */
export function isReasonablePstnDialString(e164: string): boolean {
  const d = String(e164 ?? "").replace(/\D/g, "")
  return d.length >= 10 && d.length <= 15
}

/** Digits-only key for matching webhook "To" vs rows stored as +1…, 1…, or 10-digit US. */
function phoneDigitsKey(phone: string): string {
  return normalizePhoneNumberE164(phone).replace(/\D/g, "")
}

/**
 * Find an existing per-number routing_config row so dashboard saves update the same row
 * whether the client sent +1… or 10 digits (avoids duplicate rows and wrong LIMIT 1 in joins).
 */
async function findPerNumberRoutingConfigId(userId: string, businessNumber: string): Promise<string | null> {
  const sql = getSql()
  const normalized = normalizePhoneNumberE164(businessNumber)
  const digitKey = phoneDigitsKey(businessNumber)
  const exact = await sql`
    SELECT id FROM routing_config
    WHERE user_id = ${userId} AND business_number = ${normalized}
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 1
  `
  if (exact[0]) return String(exact[0].id)
  if (digitKey.length < 10) return null
  const loose = await sql`
    SELECT id FROM routing_config
    WHERE user_id = ${userId}
      AND business_number IS NOT NULL
      AND (
        regexp_replace(business_number, '\\D', '', 'g') = ${digitKey}
        OR (
          length(regexp_replace(business_number, '\\D', '', 'g')) >= 10
          AND length(${digitKey}) >= 10
          AND right(regexp_replace(business_number, '\\D', '', 'g'), 10) = right(${digitKey}, 10)
        )
      )
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 1
  `
  return loose[0] ? String(loose[0].id) : null
}

// Get the default (global) routing config for a user (business_number IS NULL)
export async function getRoutingConfig(userId: string): Promise<RoutingConfig | null> {
  const sql = getSql()
  const rows = await sql`
    SELECT id, user_id, business_number, selected_receptionist_id, fallback_type, ai_greeting, ring_timeout_seconds, ai_ring_owner_first, updated_at
    FROM routing_config WHERE user_id = ${userId} AND business_number IS NULL LIMIT 1
  `
  return rows[0] ? parseRoutingRow(rows[0]) : null
}

// Overlay account defaults onto a per-number routing row when sparse (matches `getIncomingRoutingByNumber` semantics).
async function mergePerNumberRoutingFromDefault(userId: string, cfg: RoutingConfig): Promise<RoutingConfig> {
  if (cfg.business_number == null) return cfg
  const def = await getRoutingConfig(userId)
  return {
    ...cfg,
    ai_ring_owner_first: Boolean(def?.ai_ring_owner_first),
    selected_receptionist_id:
      cfg.selected_receptionist_id != null && String(cfg.selected_receptionist_id).trim() !== ""
        ? cfg.selected_receptionist_id
        : def?.selected_receptionist_id ?? null,
  }
}

// Get routing config for a specific business number, falling back to the default config
export async function getRoutingConfigForNumber(userId: string, businessNumber: string): Promise<RoutingConfig | null> {
  const sql = getSql()
  const digitKey = phoneDigitsKey(businessNumber)
  const normalizedBn = normalizePhoneNumberE164(businessNumber)
  // Exact match first (fast path); prefer newest row if duplicates exist.
  const specificExact = await sql`
    SELECT id, user_id, business_number, selected_receptionist_id, fallback_type, ai_greeting, ring_timeout_seconds, ai_ring_owner_first, updated_at
    FROM routing_config
    WHERE user_id = ${userId}
      AND (business_number = ${businessNumber} OR business_number = ${normalizedBn})
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 1
  `
  if (specificExact[0]) return mergePerNumberRoutingFromDefault(userId, parseRoutingRow(specificExact[0]))
  if (digitKey.length < 10) return getRoutingConfig(userId)
  // Digit match: per-number rows saved as a different string shape than TeXML sends (+1 vs 10-digit US).
  const specificLoose = await sql`
    SELECT id, user_id, business_number, selected_receptionist_id, fallback_type, ai_greeting, ring_timeout_seconds, ai_ring_owner_first, updated_at
    FROM routing_config
    WHERE user_id = ${userId}
      AND business_number IS NOT NULL
      AND (
        regexp_replace(business_number, '\\D', '', 'g') = ${digitKey}
        OR (
          length(regexp_replace(business_number, '\\D', '', 'g')) >= 10
          AND length(${digitKey}) >= 10
          AND right(regexp_replace(business_number, '\\D', '', 'g'), 10) = right(${digitKey}, 10)
        )
      )
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 1
  `
  if (specificLoose[0]) return mergePerNumberRoutingFromDefault(userId, parseRoutingRow(specificLoose[0]))
  return getRoutingConfig(userId)
}

// Get all routing configs for a user (default + per-number)
export async function getAllRoutingConfigs(userId: string): Promise<RoutingConfig[]> {
  const sql = getSql()
  const rows = await sql`
    SELECT id, user_id, business_number, selected_receptionist_id, fallback_type, ai_greeting, ring_timeout_seconds, ai_ring_owner_first, updated_at
    FROM routing_config WHERE user_id = ${userId} ORDER BY business_number NULLS FIRST
  `
  const def = await getRoutingConfig(userId)
  const ringGlobal = Boolean(def?.ai_ring_owner_first)
  return rows.map((r) => {
    const cfg = parseRoutingRow(r)
    return cfg.business_number == null ? cfg : { ...cfg, ai_ring_owner_first: ringGlobal }
  })
}

// Update routing config (only updates fields that are present)
// If businessNumber is provided, updates (or creates) the config for that number
export async function updateRoutingConfig(
  userId: string,
  updates: Partial<
    Pick<RoutingConfig, "selected_receptionist_id" | "fallback_type" | "ai_greeting" | "ring_timeout_seconds" | "ai_ring_owner_first">
  >,
  businessNumber?: string | null
): Promise<void> {
  const sql = getSql()
  const bn = businessNumber ?? null

  // Ring-first is account-wide: always stored on the default row (`business_number IS NULL`) so inbound
  // `getIncomingRoutingByNumber` (which may resolve a per-number row) still sees the same flag.
  if (updates.ai_ring_owner_first !== undefined) {
    await sql`
      UPDATE routing_config
      SET ai_ring_owner_first = ${updates.ai_ring_owner_first}, updated_at = now()
      WHERE user_id = ${userId} AND business_number IS NULL
    `
    clearIncomingRoutingCache()
  }

  // Per-number row: match by normalized E.164 / digits so we never insert a second row for the same DID.
  // First INSERT must copy receptionist + other fields from the default row — otherwise a row created only
  // to set "AI fallback" would have NULL receptionist and override the default (calls would skip the receptionist).
  if (bn) {
    const normalizedBn = normalizePhoneNumberE164(bn)
    const existingId = await findPerNumberRoutingConfigId(userId, bn)

    if (!existingId) {
      const defaults = await getRoutingConfig(userId)
      const selected_receptionist_id =
        updates.selected_receptionist_id !== undefined
          ? updates.selected_receptionist_id
          : defaults?.selected_receptionist_id ?? null
      const fallback_type = updates.fallback_type ?? defaults?.fallback_type ?? "owner"
      const ai_greeting = updates.ai_greeting !== undefined ? updates.ai_greeting : (defaults?.ai_greeting ?? "")
      const ring_timeout_seconds =
        updates.ring_timeout_seconds !== undefined
          ? updates.ring_timeout_seconds
          : defaults?.ring_timeout_seconds ?? 30
      const ai_ring_owner_first_insert = Boolean(defaults?.ai_ring_owner_first)

      await sql`
        INSERT INTO routing_config (id, user_id, business_number, selected_receptionist_id, fallback_type, ai_greeting, ring_timeout_seconds, ai_ring_owner_first, updated_at)
        VALUES (${crypto.randomUUID()}, ${userId}, ${normalizedBn}, ${selected_receptionist_id}, ${fallback_type}, ${ai_greeting}, ${ring_timeout_seconds}, ${ai_ring_owner_first_insert}, now())
      `
      clearIncomingRoutingCache()
      return
    }

    const whereClause = sql`id = ${existingId}`

    if (updates.selected_receptionist_id !== undefined) {
      await sql`UPDATE routing_config SET selected_receptionist_id = ${updates.selected_receptionist_id}, updated_at = now() WHERE ${whereClause}`
    }
    if (updates.fallback_type !== undefined) {
      await sql`UPDATE routing_config SET fallback_type = ${updates.fallback_type}, updated_at = now() WHERE ${whereClause}`
    }
    if (updates.ai_greeting !== undefined) {
      await sql`UPDATE routing_config SET ai_greeting = ${updates.ai_greeting}, updated_at = now() WHERE ${whereClause}`
    }
    if (updates.ring_timeout_seconds !== undefined) {
      await sql`UPDATE routing_config SET ring_timeout_seconds = ${updates.ring_timeout_seconds}, updated_at = now() WHERE ${whereClause}`
    }

    clearIncomingRoutingCache()
    return
  }

  // Default (global) row — business_number IS NULL
  const whereClause = sql`user_id = ${userId} AND business_number IS NULL`

  if (updates.selected_receptionist_id !== undefined) {
    await sql`UPDATE routing_config SET selected_receptionist_id = ${updates.selected_receptionist_id}, updated_at = now() WHERE ${whereClause}`
  }
  if (updates.fallback_type !== undefined) {
    await sql`UPDATE routing_config SET fallback_type = ${updates.fallback_type}, updated_at = now() WHERE ${whereClause}`
  }
  if (updates.ai_greeting !== undefined) {
    await sql`UPDATE routing_config SET ai_greeting = ${updates.ai_greeting}, updated_at = now() WHERE ${whereClause}`
  }
  if (updates.ring_timeout_seconds !== undefined) {
    await sql`UPDATE routing_config SET ring_timeout_seconds = ${updates.ring_timeout_seconds}, updated_at = now() WHERE ${whereClause}`
  }

  clearIncomingRoutingCache()
}

// Delete a per-number routing config (reverts to default)
export async function deleteRoutingConfigForNumber(userId: string, businessNumber: string): Promise<void> {
  const sql = getSql()
  const existingId = await findPerNumberRoutingConfigId(userId, businessNumber)
  if (existingId) {
    await sql`DELETE FROM routing_config WHERE id = ${existingId}`
  }
  clearIncomingRoutingCache()
}

// Parse a receptionists row from the database
function parseReceptionistRow(row: Record<string, unknown>): Receptionist {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    name: String(row.name),
    phone: String(row.phone),
    initials: String(row.initials ?? ""),
    color: String(row.color ?? "bg-primary"),
    rate_per_minute: Number(row.rate_per_minute ?? 0.25),
    is_active: row.is_active !== false,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }
}

// Get a receptionist by ID
export async function getReceptionist(receptionistId: string): Promise<Receptionist | null> {
  const sql = getSql()
  const rows = await sql`
    SELECT id, user_id, name, phone, initials, color, rate_per_minute, is_active, created_at
    FROM receptionists WHERE id = ${receptionistId} LIMIT 1
  `
  return rows[0] ? parseReceptionistRow(rows[0]) : null
}

// Get all receptionists for a user
export async function getReceptionists(userId: string): Promise<Receptionist[]> {
  const sql = getSql()
  const rows = await sql`
    SELECT id, user_id, name, phone, initials, color, rate_per_minute, is_active, created_at
    FROM receptionists WHERE user_id = ${userId} ORDER BY created_at ASC
  `
  return rows.map(parseReceptionistRow)
}

export async function insertReceptionist(params: {
  user_id: string
  name: string
  phone: string
}): Promise<Receptionist> {
  const sql = getSql()
  const id = crypto.randomUUID()
  const phone = normalizePhoneNumberE164(params.phone)
  const nameParts = params.name.trim().split(/\s+/)
  const initials = nameParts.length >= 2
    ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
    : params.name.slice(0, 2).toUpperCase()
  const colors = ["bg-primary", "bg-chart-2", "bg-chart-5", "bg-chart-3", "bg-chart-4"]
  const color = colors[Math.floor(Math.random() * colors.length)]

  await sql`
    INSERT INTO receptionists (id, user_id, name, phone, initials, color, rate_per_minute, is_active, created_at)
    VALUES (${id}, ${params.user_id}, ${params.name}, ${phone}, ${initials}, ${color}, 0.25, true, now())
  `
  return {
    id,
    user_id: params.user_id,
    name: params.name,
    phone: params.phone,
    initials,
    color,
    rate_per_minute: 0.25,
    is_active: true,
    created_at: new Date().toISOString(),
  }
}

// Update a receptionist
export async function updateReceptionist(
  receptionistId: string,
  userId: string,
  updates: Partial<Pick<Receptionist, "name" | "phone" | "is_active" | "rate_per_minute">>
): Promise<void> {
  const sql = getSql()
  if (updates.name !== undefined) {
    await sql`UPDATE receptionists SET name = ${updates.name} WHERE id = ${receptionistId} AND user_id = ${userId}`
  }
  if (updates.phone !== undefined) {
    const raw = String(updates.phone).trim()
    const normalizedPhone = normalizePhoneNumberE164(raw)
    const toStore = isReasonablePstnDialString(normalizedPhone) ? normalizedPhone : raw
    await sql`UPDATE receptionists SET phone = ${toStore} WHERE id = ${receptionistId} AND user_id = ${userId}`
  }
  if (updates.is_active !== undefined) {
    await sql`UPDATE receptionists SET is_active = ${updates.is_active} WHERE id = ${receptionistId} AND user_id = ${userId}`
  }
  if (updates.rate_per_minute !== undefined) {
    await sql`UPDATE receptionists SET rate_per_minute = ${updates.rate_per_minute} WHERE id = ${receptionistId} AND user_id = ${userId}`
  }
}

// Delete a receptionist
export async function deleteReceptionist(receptionistId: string, userId: string): Promise<void> {
  const sql = getSql()
  await sql`DELETE FROM receptionists WHERE id = ${receptionistId} AND user_id = ${userId}`
}

/** Auth login row fetch before `019-billing-admin-feedback.sql` (no billing columns in SELECT). */
async function getAuthUserByEmailWithoutBillingColumns(
  email: string
): Promise<(User & { password_hash: string }) | null> {
  const sql = getSql()
  const pack = (row: Record<string, unknown> | undefined) => {
    if (!row) return null
    return { ...parseUserRow(row), password_hash: String(row.password_hash) }
  }
  try {
    const rows = await sql`
      SELECT id, email, name, phone, business_name, inbound_receptionist_whisper_enabled, industry, telnyx_ai_assistant_id, password_hash, created_at
      FROM users WHERE LOWER(email) = LOWER(${email}) LIMIT 1
    `
    return pack(rows[0])
  } catch (e) {
    if (isMissingInboundReceptionistWhisperColumnError(e)) {
      try {
        const rows = await sql`
          SELECT id, email, name, phone, business_name, industry, telnyx_ai_assistant_id, password_hash, created_at
          FROM users WHERE LOWER(email) = LOWER(${email}) LIMIT 1
        `
        return pack(rows[0])
      } catch (e2) {
        if (!isMissingIndustryColumnError(e2)) throw e2
        const rows = await sql`
          SELECT id, email, name, phone, business_name, telnyx_ai_assistant_id, password_hash, created_at
          FROM users WHERE LOWER(email) = LOWER(${email}) LIMIT 1
        `
        return pack(rows[0])
      }
    }
    if (isMissingIndustryColumnError(e)) {
      try {
        const rows = await sql`
          SELECT id, email, name, phone, business_name, inbound_receptionist_whisper_enabled, telnyx_ai_assistant_id, password_hash, created_at
          FROM users WHERE LOWER(email) = LOWER(${email}) LIMIT 1
        `
        return pack(rows[0])
      } catch (e2) {
        if (!isMissingInboundReceptionistWhisperColumnError(e2)) throw e2
        const rows = await sql`
          SELECT id, email, name, phone, business_name, telnyx_ai_assistant_id, password_hash, created_at
          FROM users WHERE LOWER(email) = LOWER(${email}) LIMIT 1
        `
        return pack(rows[0])
      }
    }
    throw e
  }
}

// Get user by email (for auth login; includes password_hash)
export async function getAuthUserByEmail(email: string): Promise<(User & { password_hash: string }) | null> {
  const sql = getSql()
  const pack = (row: Record<string, unknown> | undefined) => {
    if (!row) return null
    return { ...parseUserRow(row), password_hash: String(row.password_hash) }
  }
  try {
    const rows = await sql`
      SELECT id, email, name, phone, business_name, inbound_receptionist_whisper_enabled, industry, telnyx_ai_assistant_id, password_hash, created_at,
        credit_balance_cents, billing_plan, is_platform_admin
      FROM users WHERE LOWER(email) = LOWER(${email}) LIMIT 1
    `
    return pack(rows[0])
  } catch (e) {
    if (isMissingBillingColumnsError(e)) {
      return getAuthUserByEmailWithoutBillingColumns(email)
    }
    if (isMissingInboundReceptionistWhisperColumnError(e)) {
      try {
        const rows = await sql`
          SELECT id, email, name, phone, business_name, industry, telnyx_ai_assistant_id, password_hash, created_at,
            credit_balance_cents, billing_plan, is_platform_admin
          FROM users WHERE LOWER(email) = LOWER(${email}) LIMIT 1
        `
        return pack(rows[0])
      } catch (e2) {
        if (isMissingBillingColumnsError(e2)) {
          return getAuthUserByEmailWithoutBillingColumns(email)
        }
        if (!isMissingIndustryColumnError(e2)) throw e2
        const rows = await sql`
          SELECT id, email, name, phone, business_name, telnyx_ai_assistant_id, password_hash, created_at,
            credit_balance_cents, billing_plan, is_platform_admin
          FROM users WHERE LOWER(email) = LOWER(${email}) LIMIT 1
        `
        return pack(rows[0])
      }
    }
    if (isMissingIndustryColumnError(e)) {
      try {
        const rows = await sql`
          SELECT id, email, name, phone, business_name, inbound_receptionist_whisper_enabled, telnyx_ai_assistant_id, password_hash, created_at,
            credit_balance_cents, billing_plan, is_platform_admin
          FROM users WHERE LOWER(email) = LOWER(${email}) LIMIT 1
        `
        return pack(rows[0])
      } catch (e2) {
        if (isMissingBillingColumnsError(e2)) {
          return getAuthUserByEmailWithoutBillingColumns(email)
        }
        if (!isMissingInboundReceptionistWhisperColumnError(e2)) throw e2
        const rows = await sql`
          SELECT id, email, name, phone, business_name, telnyx_ai_assistant_id, password_hash, created_at,
            credit_balance_cents, billing_plan, is_platform_admin
          FROM users WHERE LOWER(email) = LOWER(${email}) LIMIT 1
        `
        return pack(rows[0])
      }
    }
    throw e
  }
}

// Create user (for auth signup); also creates routing_config row
export async function createUser(params: {
  email: string
  name: string
  phone: string
  business_name: string
  industry?: string
  password_hash: string
}): Promise<User> {
  const sql = getSql()
  const id = crypto.randomUUID()
  const industry = defaultProfileFromUserIndustry(params.industry)
  try {
    await sql`
      INSERT INTO users (id, email, name, phone, business_name, industry, password_hash, created_at)
      VALUES (${id}, ${params.email}, ${params.name}, ${params.phone}, ${params.business_name}, ${industry}, ${params.password_hash}, now())
    `
  } catch (e) {
    if (!isMissingIndustryColumnError(e)) throw e
    await sql`
      INSERT INTO users (id, email, name, phone, business_name, password_hash, created_at)
      VALUES (${id}, ${params.email}, ${params.name}, ${params.phone}, ${params.business_name}, ${params.password_hash}, now())
    `
  }
  await sql`
    INSERT INTO routing_config (id, user_id, selected_receptionist_id, fallback_type, ai_greeting, ring_timeout_seconds, updated_at)
    VALUES (${crypto.randomUUID()}, ${id}, NULL, 'owner', '', 30, now())
  `
  try {
    await sql`
      INSERT INTO onboarding_profiles (user_id, updated_at)
      VALUES (${id}, now())
      ON CONFLICT (user_id) DO NOTHING
    `
  } catch (e) {
    if (!isMissingOnboardingProfilesTableError(e) && !isWrongLegacyProfilesTableError(e)) throw e
  }
  return {
    id,
    email: params.email,
    name: params.name,
    phone: params.phone,
    business_name: params.business_name,
    inbound_receptionist_whisper_enabled: true,
    industry,
    telnyx_ai_assistant_id: null,
    created_at: new Date().toISOString(),
    credit_balance_cents: 0,
    billing_plan: "trial",
    is_platform_admin: false,
  }
}

/** Sets login hash and platform admin flag (019 columns optional). Used by bootstrap repair API. */
/** Update login password only (does not change platform admin flag). */
export async function setUserPasswordHash(userId: string, passwordHash: string): Promise<void> {
  const sql = getSql()
  await sql`UPDATE users SET password_hash = ${passwordHash} WHERE id = ${userId}`
}

export async function setUserPasswordHashAndPlatformAdmin(userId: string, passwordHash: string): Promise<void> {
  const sql = getSql()
  try {
    await sql`
      UPDATE users
      SET password_hash = ${passwordHash}, is_platform_admin = true
      WHERE id = ${userId}
    `
  } catch (e) {
    if (isMissingBillingColumnsError(e)) {
      await sql`UPDATE users SET password_hash = ${passwordHash} WHERE id = ${userId}`
      return
    }
    const msg = pgErrorMessage(e)
    if (pgErrorCode(e) === "42703" && msg.includes("is_platform_admin")) {
      await sql`UPDATE users SET password_hash = ${passwordHash} WHERE id = ${userId}`
      return
    }
    throw e
  }
}

/**
 * Ensures `email` can log in with the password that produced `passwordHash` (bcrypt),
 * creating the account + default routing_config if missing.
 */
export async function repairBootstrapPlatformAdminAccount(params: {
  email: string
  passwordHash: string
}): Promise<{ created: boolean }> {
  const email = params.email.trim().toLowerCase()
  const existing = await getAuthUserByEmail(email)
  if (existing) {
    await setUserPasswordHashAndPlatformAdmin(existing.id, params.passwordHash)
    return { created: false }
  }
  try {
    await createUser({
      email,
      name: "Platform Admin",
      phone: "+10000000000",
      business_name: SITE_NAME,
      password_hash: params.passwordHash,
      industry: "generic",
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes("unique") || msg.includes("duplicate")) {
      const again = await getAuthUserByEmail(email)
      if (again) {
        await setUserPasswordHashAndPlatformAdmin(again.id, params.passwordHash)
        return { created: false }
      }
    }
    throw e
  }
  const again = await getAuthUserByEmail(email)
  if (!again) throw new Error("repairBootstrapPlatformAdminAccount: user missing after createUser")
  await setUserPasswordHashAndPlatformAdmin(again.id, params.passwordHash)
  return { created: true }
}

function parseUserRow(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    phone: String(row.phone),
    business_name: String(row.business_name ?? "My Business"),
    inbound_receptionist_whisper_enabled:
      row.inbound_receptionist_whisper_enabled === null || row.inbound_receptionist_whisper_enabled === undefined
        ? true
        : pgBool(row.inbound_receptionist_whisper_enabled),
    industry: row.industry != null ? String(row.industry) : "generic",
    telnyx_ai_assistant_id: row.telnyx_ai_assistant_id ? String(row.telnyx_ai_assistant_id) : null,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    credit_balance_cents: row.credit_balance_cents != null && row.credit_balance_cents !== undefined ? Number(row.credit_balance_cents) : 0,
    billing_plan: row.billing_plan != null && row.billing_plan !== undefined ? String(row.billing_plan) : "trial",
    is_platform_admin:
      row.is_platform_admin === null || row.is_platform_admin === undefined ? false : pgBool(row.is_platform_admin),
    answered_call_customer_popup_enabled:
      row.answered_call_customer_popup_enabled === null || row.answered_call_customer_popup_enabled === undefined
        ? true
        : pgBool(row.answered_call_customer_popup_enabled),
  }
}

// Get user by phone number they own (joins phone_numbers → users)
export async function getUserByPhoneNumber(toNumber: string): Promise<User | null> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT u.id, u.email, u.name, u.phone, u.business_name, u.inbound_receptionist_whisper_enabled, u.industry, u.telnyx_ai_assistant_id, u.created_at
      FROM users u
      JOIN phone_numbers pn ON pn.user_id = u.id
      WHERE pn.number = ${toNumber} AND pn.status = 'active'
      LIMIT 1
    `
    return rows[0] ? parseUserRow(rows[0]) : null
  } catch (e) {
    if (isMissingInboundReceptionistWhisperColumnError(e)) {
      try {
        const rows = await sql`
          SELECT u.id, u.email, u.name, u.phone, u.business_name, u.industry, u.telnyx_ai_assistant_id, u.created_at
          FROM users u
          JOIN phone_numbers pn ON pn.user_id = u.id
          WHERE pn.number = ${toNumber} AND pn.status = 'active'
          LIMIT 1
        `
        return rows[0] ? parseUserRow(rows[0]) : null
      } catch (e2) {
        if (!isMissingIndustryColumnError(e2)) throw e2
        const rows = await sql`
          SELECT u.id, u.email, u.name, u.phone, u.business_name, u.telnyx_ai_assistant_id, u.created_at
          FROM users u
          JOIN phone_numbers pn ON pn.user_id = u.id
          WHERE pn.number = ${toNumber} AND pn.status = 'active'
          LIMIT 1
        `
        return rows[0] ? parseUserRow(rows[0]) : null
      }
    }
    if (!isMissingIndustryColumnError(e)) throw e
    try {
      const rows = await sql`
        SELECT u.id, u.email, u.name, u.phone, u.business_name, u.inbound_receptionist_whisper_enabled, u.telnyx_ai_assistant_id, u.created_at
        FROM users u
        JOIN phone_numbers pn ON pn.user_id = u.id
        WHERE pn.number = ${toNumber} AND pn.status = 'active'
        LIMIT 1
      `
      return rows[0] ? parseUserRow(rows[0]) : null
    } catch (e2) {
      if (!isMissingInboundReceptionistWhisperColumnError(e2)) throw e2
      const rows = await sql`
        SELECT u.id, u.email, u.name, u.phone, u.business_name, u.telnyx_ai_assistant_id, u.created_at
        FROM users u
        JOIN phone_numbers pn ON pn.user_id = u.id
        WHERE pn.number = ${toNumber} AND pn.status = 'active'
        LIMIT 1
      `
      return rows[0] ? parseUserRow(rows[0]) : null
    }
  }
}

function inboundWhisperEnabledFromRoutingRow(row: Record<string, unknown>): boolean {
  if (row.inbound_receptionist_whisper_enabled === null || row.inbound_receptionist_whisper_enabled === undefined) {
    return true
  }
  return pgBool(row.inbound_receptionist_whisper_enabled)
}

// Fast routing lookup for incoming voice webhooks.
// Returns user + resolved routing + receptionist in one query to reduce latency.
//
// Per-number `routing_config` rows are often sparse: if a row exists for the DID but
// `selected_receptionist_id` is NULL, we still inherit the account default receptionist
// from `rc_def` so inbound `<Dial>` matches what the dashboard shows when only the default row was edited.
export async function getIncomingRoutingByNumber(
  toNumber: string,
  options?: { bypassCache?: boolean }
): Promise<IncomingRoutingByNumber> {
  const normalized = normalizePhoneNumberE164(toNumber)
  const digitKey = phoneDigitsKey(toNumber)

  // Return cached result if it is still fresh (skip when forcing fresh read, e.g. Telnyx fallback webhook).
  if (!options?.bypassCache) {
    const cached = incomingRoutingCache.get(normalized)
    if (cached && cached.expiresAt > Date.now()) return cached.value
  }

  const sql = getSql()
  // Match Telnyx "To" (+1…) to rows stored as 10-digit, 11-digit, or E.164 (avoids silent no-match → no call_logs).
  let rows: Record<string, unknown>[]
  try {
    rows = await sql`
    SELECT
      u.id AS user_id,
      u.name AS user_name,
      COALESCE(NULLIF(trim(u.business_name), ''), 'My Business') AS business_name,
      COALESCE(u.inbound_receptionist_whisper_enabled, true) AS inbound_receptionist_whisper_enabled,
      u.phone AS owner_phone,
      COALESCE(
        CASE
          WHEN rc_spec.id IS NOT NULL AND rc_spec.selected_receptionist_id IS NOT NULL THEN rc_spec.selected_receptionist_id
        END,
        rc_def.selected_receptionist_id
      ) AS selected_receptionist_id,
      COALESCE(
        CASE WHEN rc_spec.id IS NOT NULL THEN rc_spec.fallback_type ELSE rc_def.fallback_type END,
        'owner'
      ) AS fallback_type,
      COALESCE(
        CASE WHEN rc_spec.id IS NOT NULL THEN rc_spec.ring_timeout_seconds ELSE rc_def.ring_timeout_seconds END,
        30
      ) AS ring_timeout_seconds,
      COALESCE(rc_def.ai_ring_owner_first, false) AS ai_ring_owner_first,
      reff.name AS receptionist_name,
      reff.phone AS receptionist_phone,
      COALESCE(NULLIF(trim(pn.label), ''), 'Main Line') AS phone_line_label,
      COALESCE(pn.friendly_name, '') AS phone_line_friendly_name
    FROM phone_numbers pn
    JOIN users u ON u.id = pn.user_id
    LEFT JOIN LATERAL (
      SELECT rc.*
      FROM routing_config rc
      WHERE rc.user_id = u.id
        AND rc.business_number IS NOT NULL
        AND (
          rc.business_number = pn.number
          OR regexp_replace(COALESCE(rc.business_number, ''), '\\D', '', 'g') = regexp_replace(pn.number, '\\D', '', 'g')
          OR (
            length(regexp_replace(COALESCE(rc.business_number, ''), '\\D', '', 'g')) >= 10
            AND length(regexp_replace(pn.number, '\\D', '', 'g')) >= 10
            AND right(regexp_replace(COALESCE(rc.business_number, ''), '\\D', '', 'g'), 10)
              = right(regexp_replace(pn.number, '\\D', '', 'g'), 10)
          )
        )
      ORDER BY rc.updated_at DESC NULLS LAST
      LIMIT 1
    ) rc_spec ON true
    LEFT JOIN routing_config rc_def
      ON rc_def.user_id = u.id
      AND rc_def.business_number IS NULL
    LEFT JOIN receptionists reff ON reff.id = COALESCE(
      CASE
        WHEN rc_spec.id IS NOT NULL AND rc_spec.selected_receptionist_id IS NOT NULL THEN rc_spec.selected_receptionist_id
      END,
      rc_def.selected_receptionist_id
    )
    WHERE pn.status = 'active'
      AND (
        regexp_replace(pn.number, '\\D', '', 'g') = ${digitKey}
        OR (
          length(regexp_replace(pn.number, '\\D', '', 'g')) >= 10
          AND length(${digitKey}) >= 10
          AND right(regexp_replace(pn.number, '\\D', '', 'g'), 10) = right(${digitKey}, 10)
        )
      )
    LIMIT 1
  `
  } catch (e) {
    if (!isMissingInboundReceptionistWhisperColumnError(e)) throw e
    rows = await sql`
    SELECT
      u.id AS user_id,
      u.name AS user_name,
      COALESCE(NULLIF(trim(u.business_name), ''), 'My Business') AS business_name,
      u.phone AS owner_phone,
      COALESCE(
        CASE
          WHEN rc_spec.id IS NOT NULL AND rc_spec.selected_receptionist_id IS NOT NULL THEN rc_spec.selected_receptionist_id
        END,
        rc_def.selected_receptionist_id
      ) AS selected_receptionist_id,
      COALESCE(
        CASE WHEN rc_spec.id IS NOT NULL THEN rc_spec.fallback_type ELSE rc_def.fallback_type END,
        'owner'
      ) AS fallback_type,
      COALESCE(
        CASE WHEN rc_spec.id IS NOT NULL THEN rc_spec.ring_timeout_seconds ELSE rc_def.ring_timeout_seconds END,
        30
      ) AS ring_timeout_seconds,
      COALESCE(rc_def.ai_ring_owner_first, false) AS ai_ring_owner_first,
      reff.name AS receptionist_name,
      reff.phone AS receptionist_phone,
      COALESCE(NULLIF(trim(pn.label), ''), 'Main Line') AS phone_line_label,
      COALESCE(pn.friendly_name, '') AS phone_line_friendly_name
    FROM phone_numbers pn
    JOIN users u ON u.id = pn.user_id
    LEFT JOIN LATERAL (
      SELECT rc.*
      FROM routing_config rc
      WHERE rc.user_id = u.id
        AND rc.business_number IS NOT NULL
        AND (
          rc.business_number = pn.number
          OR regexp_replace(COALESCE(rc.business_number, ''), '\\D', '', 'g') = regexp_replace(pn.number, '\\D', '', 'g')
          OR (
            length(regexp_replace(COALESCE(rc.business_number, ''), '\\D', '', 'g')) >= 10
            AND length(regexp_replace(pn.number, '\\D', '', 'g')) >= 10
            AND right(regexp_replace(COALESCE(rc.business_number, ''), '\\D', '', 'g'), 10)
              = right(regexp_replace(pn.number, '\\D', '', 'g'), 10)
          )
        )
      ORDER BY rc.updated_at DESC NULLS LAST
      LIMIT 1
    ) rc_spec ON true
    LEFT JOIN routing_config rc_def
      ON rc_def.user_id = u.id
      AND rc_def.business_number IS NULL
    LEFT JOIN receptionists reff ON reff.id = COALESCE(
      CASE
        WHEN rc_spec.id IS NOT NULL AND rc_spec.selected_receptionist_id IS NOT NULL THEN rc_spec.selected_receptionist_id
      END,
      rc_def.selected_receptionist_id
    )
    WHERE pn.status = 'active'
      AND (
        regexp_replace(pn.number, '\\D', '', 'g') = ${digitKey}
        OR (
          length(regexp_replace(pn.number, '\\D', '', 'g')) >= 10
          AND length(${digitKey}) >= 10
          AND right(regexp_replace(pn.number, '\\D', '', 'g'), 10) = right(${digitKey}, 10)
        )
      )
    LIMIT 1
  `
  }

  const row = rows[0]
  if (!row) {
    incomingRoutingCache.set(normalized, { expiresAt: Date.now() + INCOMING_ROUTING_CACHE_TTL_MS, value: null })
    return null
  }

  const value: IncomingRoutingRow = {
    user_id: String(row.user_id),
    user_name: String(row.user_name),
    business_name: row.business_name != null ? String(row.business_name) : "My Business",
    inbound_receptionist_whisper_enabled: inboundWhisperEnabledFromRoutingRow(row as Record<string, unknown>),
    owner_phone: String(row.owner_phone),
    selected_receptionist_id: row.selected_receptionist_id ? String(row.selected_receptionist_id) : null,
    fallback_type: (row.fallback_type as RoutingConfig["fallback_type"]) || "owner",
    ring_timeout_seconds: Number(row.ring_timeout_seconds ?? 30),
    ai_ring_owner_first: pgBool(row.ai_ring_owner_first),
    receptionist_name: row.receptionist_name ? String(row.receptionist_name) : null,
    receptionist_phone: row.receptionist_phone ? String(row.receptionist_phone) : null,
    phone_line_label: row.phone_line_label != null ? String(row.phone_line_label) : "Main Line",
    phone_line_friendly_name: row.phone_line_friendly_name != null ? String(row.phone_line_friendly_name) : "",
  }

  incomingRoutingCache.set(normalized, { expiresAt: Date.now() + INCOMING_ROUTING_CACHE_TTL_MS, value })
  return value
}

/** `getUser` when `users` has no billing columns yet (pre-019 migration). */
async function getUserWithoutBillingColumnsInSelect(userId: string): Promise<User | null> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT id, email, name, phone, business_name, inbound_receptionist_whisper_enabled, industry, telnyx_ai_assistant_id, created_at
      FROM users WHERE id = ${userId} LIMIT 1
    `
    return rows[0] ? parseUserRow(rows[0]) : null
  } catch (e) {
    if (isMissingInboundReceptionistWhisperColumnError(e)) {
      try {
        const rows = await sql`
          SELECT id, email, name, phone, business_name, industry, telnyx_ai_assistant_id, created_at
          FROM users WHERE id = ${userId} LIMIT 1
        `
        return rows[0] ? parseUserRow(rows[0]) : null
      } catch (e2) {
        if (!isMissingIndustryColumnError(e2)) throw e2
        const rows = await sql`
          SELECT id, email, name, phone, business_name, telnyx_ai_assistant_id, created_at
          FROM users WHERE id = ${userId} LIMIT 1
        `
        return rows[0] ? parseUserRow(rows[0]) : null
      }
    }
    if (isMissingIndustryColumnError(e)) {
      try {
        const rows = await sql`
          SELECT id, email, name, phone, business_name, inbound_receptionist_whisper_enabled, telnyx_ai_assistant_id, created_at
          FROM users WHERE id = ${userId} LIMIT 1
        `
        return rows[0] ? parseUserRow(rows[0]) : null
      } catch (e2) {
        if (!isMissingInboundReceptionistWhisperColumnError(e2)) throw e2
        const rows = await sql`
          SELECT id, email, name, phone, business_name, telnyx_ai_assistant_id, created_at
          FROM users WHERE id = ${userId} LIMIT 1
        `
        return rows[0] ? parseUserRow(rows[0]) : null
      }
    }
    throw e
  }
}

// Get user by ID
export async function getUser(userId: string): Promise<User | null> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT id, email, name, phone, business_name, inbound_receptionist_whisper_enabled, industry, telnyx_ai_assistant_id, created_at,
        credit_balance_cents, billing_plan, is_platform_admin,
        answered_call_customer_popup_enabled
      FROM users WHERE id = ${userId} LIMIT 1
    `
    return rows[0] ? parseUserRow(rows[0]) : null
  } catch (e) {
    if (pgErrorCode(e) === "42703" && pgErrorMessage(e).includes("answered_call_customer_popup_enabled")) {
      try {
        const rows = await sql`
          SELECT id, email, name, phone, business_name, inbound_receptionist_whisper_enabled, industry, telnyx_ai_assistant_id, created_at,
            credit_balance_cents, billing_plan, is_platform_admin
          FROM users WHERE id = ${userId} LIMIT 1
        `
        return rows[0] ? parseUserRow(rows[0]) : null
      } catch (e2) {
        if (isMissingBillingColumnsError(e2)) {
          return getUserWithoutBillingColumnsInSelect(userId)
        }
        throw e2
      }
    }
    if (isMissingBillingColumnsError(e)) {
      return getUserWithoutBillingColumnsInSelect(userId)
    }
    if (isMissingInboundReceptionistWhisperColumnError(e)) {
      try {
        const rows = await sql`
          SELECT id, email, name, phone, business_name, industry, telnyx_ai_assistant_id, created_at,
            credit_balance_cents, billing_plan, is_platform_admin
          FROM users WHERE id = ${userId} LIMIT 1
        `
        return rows[0] ? parseUserRow(rows[0]) : null
      } catch (e2) {
        if (isMissingBillingColumnsError(e2)) {
          return getUserWithoutBillingColumnsInSelect(userId)
        }
        if (!isMissingIndustryColumnError(e2)) throw e2
        const rows = await sql`
          SELECT id, email, name, phone, business_name, telnyx_ai_assistant_id, created_at,
            credit_balance_cents, billing_plan, is_platform_admin
          FROM users WHERE id = ${userId} LIMIT 1
        `
        return rows[0] ? parseUserRow(rows[0]) : null
      }
    }
    if (isMissingIndustryColumnError(e)) {
      try {
        const rows = await sql`
          SELECT id, email, name, phone, business_name, inbound_receptionist_whisper_enabled, telnyx_ai_assistant_id, created_at,
            credit_balance_cents, billing_plan, is_platform_admin
          FROM users WHERE id = ${userId} LIMIT 1
        `
        return rows[0] ? parseUserRow(rows[0]) : null
      } catch (e2) {
        if (isMissingBillingColumnsError(e2)) {
          return getUserWithoutBillingColumnsInSelect(userId)
        }
        if (!isMissingInboundReceptionistWhisperColumnError(e2)) throw e2
        const rows = await sql`
          SELECT id, email, name, phone, business_name, telnyx_ai_assistant_id, created_at,
            credit_balance_cents, billing_plan, is_platform_admin
          FROM users WHERE id = ${userId} LIMIT 1
        `
        return rows[0] ? parseUserRow(rows[0]) : null
      }
    }
    throw e
  }
}

// Update current user profile
export async function updateUser(
  userId: string,
  updates: {
    phone?: string
    name?: string
    business_name?: string
    inbound_receptionist_whisper_enabled?: boolean
    answered_call_customer_popup_enabled?: boolean
    industry?: string
    telnyx_ai_assistant_id?: string | null
  }
): Promise<void> {
  const sql = getSql()
  if (updates.phone !== undefined) {
    await sql`UPDATE users SET phone = ${updates.phone} WHERE id = ${userId}`
  }
  if (updates.name !== undefined) {
    await sql`UPDATE users SET name = ${updates.name} WHERE id = ${userId}`
  }
  if (updates.business_name !== undefined) {
    await sql`UPDATE users SET business_name = ${updates.business_name} WHERE id = ${userId}`
  }
  if (updates.inbound_receptionist_whisper_enabled !== undefined) {
    try {
      await sql`UPDATE users SET inbound_receptionist_whisper_enabled = ${updates.inbound_receptionist_whisper_enabled} WHERE id = ${userId}`
    } catch (e) {
      const code = pgErrorCode(e)
      const msg = pgErrorMessage(e)
      if (code === "42703" && msg.includes("inbound_receptionist_whisper_enabled")) {
        throw new Error(
          "Could not save whisper setting: column inbound_receptionist_whisper_enabled is missing. In Neon → SQL Editor, run scripts/017-inbound-whisper-user-toggle.sql, then try again."
        )
      }
      throw e
    }
  }
  if (updates.answered_call_customer_popup_enabled !== undefined) {
    try {
      await sql`UPDATE users SET answered_call_customer_popup_enabled = ${updates.answered_call_customer_popup_enabled} WHERE id = ${userId}`
    } catch (e) {
      const code = pgErrorCode(e)
      const msg = pgErrorMessage(e)
      if (code === "42703" && msg.includes("answered_call_customer_popup_enabled")) {
        throw new Error(
          "Could not save customer popup setting: column answered_call_customer_popup_enabled is missing. In Neon → SQL Editor, run scripts/023-user-answered-call-popup-toggle.sql, then try again."
        )
      }
      throw e
    }
  }
  if (updates.industry !== undefined) {
    try {
      await sql`UPDATE users SET industry = ${updates.industry} WHERE id = ${userId}`
    } catch (e) {
      if (!isMissingIndustryColumnError(e)) throw e
      /* DB not migrated — ignore industry update until scripts/011-user-industry.sql is run */
    }
  }
  if (updates.telnyx_ai_assistant_id !== undefined) {
    try {
      await sql`UPDATE users SET telnyx_ai_assistant_id = ${updates.telnyx_ai_assistant_id} WHERE id = ${userId}`
    } catch (e) {
      const code = pgErrorCode(e)
      const msg = pgErrorMessage(e)
      if (code === "42703" && msg.includes("telnyx_ai_assistant_id")) {
        throw new Error(
          "Could not link assistant: column telnyx_ai_assistant_id is missing. In Neon → SQL Editor, run scripts/012-telnyx-ai-assistant.sql, then try again."
        )
      }
      throw e
    }
  }
  if (updates.business_name !== undefined || updates.inbound_receptionist_whisper_enabled !== undefined) {
    clearIncomingRoutingCache()
  }
}

// Insert a call log
export async function insertCallLog(log: Omit<CallLog, "id" | "created_at">): Promise<void> {
  const sql = getSql()
  const sid = (log.provider_call_sid || "").trim() || `zing-${crypto.randomUUID()}`
  const fromNum = (log.from_number || "").trim() || "Unknown"
  const toNum = (log.to_number || "").trim() || "Unknown"

  try {
    await sql`
      INSERT INTO call_logs (
        user_id, provider_call_sid, from_number, to_number, caller_name,
        call_type, status, duration_seconds, routed_to_receptionist_id,
        routed_to_name, has_recording, recording_url, recording_duration_seconds, first_ring_at
      ) VALUES (
        ${log.user_id}, ${sid}, ${fromNum}, ${toNum}, ${log.caller_name},
        ${log.call_type}, ${log.status}, ${log.duration_seconds}, ${log.routed_to_receptionist_id},
        ${log.routed_to_name}, ${log.has_recording}, ${log.recording_url}, ${log.recording_duration_seconds}, now()
      )
    `
    return
  } catch (e) {
    const code = pgErrorCode(e)
    const msg = pgErrorMessage(e)
    // Neon not migrated with scripts/007 — no first_ring_at column
    if (code === "42703" && msg.includes("first_ring_at")) {
      await sql`
        INSERT INTO call_logs (
          user_id, provider_call_sid, from_number, to_number, caller_name,
          call_type, status, duration_seconds, routed_to_receptionist_id,
          routed_to_name, has_recording, recording_url, recording_duration_seconds
        ) VALUES (
          ${log.user_id}, ${sid}, ${fromNum}, ${toNum}, ${log.caller_name},
          ${log.call_type}, ${log.status}, ${log.duration_seconds}, ${log.routed_to_receptionist_id},
          ${log.routed_to_name}, ${log.has_recording}, ${log.recording_url}, ${log.recording_duration_seconds}
        )
      `
      return
    }
    // Legacy DB: twilio_call_sid NOT NULL — duplicate sid into both columns
    if (msg.includes("twilio_call_sid")) {
      try {
        await sql`
          INSERT INTO call_logs (
            user_id, provider_call_sid, twilio_call_sid, from_number, to_number, caller_name,
            call_type, status, duration_seconds, routed_to_receptionist_id,
            routed_to_name, has_recording, recording_url, recording_duration_seconds, first_ring_at
          ) VALUES (
            ${log.user_id}, ${sid}, ${sid}, ${fromNum}, ${toNum}, ${log.caller_name},
            ${log.call_type}, ${log.status}, ${log.duration_seconds}, ${log.routed_to_receptionist_id},
            ${log.routed_to_name}, ${log.has_recording}, ${log.recording_url}, ${log.recording_duration_seconds}, now()
          )
        `
        return
      } catch (e2) {
        const m2 = pgErrorMessage(e2)
        if (pgErrorCode(e2) === "42703" && m2.includes("first_ring_at")) {
          await sql`
            INSERT INTO call_logs (
              user_id, provider_call_sid, twilio_call_sid, from_number, to_number, caller_name,
              call_type, status, duration_seconds, routed_to_receptionist_id,
              routed_to_name, has_recording, recording_url, recording_duration_seconds
            ) VALUES (
              ${log.user_id}, ${sid}, ${sid}, ${fromNum}, ${toNum}, ${log.caller_name},
              ${log.call_type}, ${log.status}, ${log.duration_seconds}, ${log.routed_to_receptionist_id},
              ${log.routed_to_name}, ${log.has_recording}, ${log.recording_url}, ${log.recording_duration_seconds}
            )
          `
          return
        }
        throw e2
      }
    }
    throw e
  }
}

/**
 * If the inbound TeXML handler never wrote a row (DB error, etc.), create one when the Dial action hits fallback.
 * Avoids empty dashboard when the call still reached voicemail / AI.
 */
export async function ensureCallLogForInboundLeg(params: {
  userId: string
  providerCallSid: string
  fromNumber: string
  toNumber: string
  callerName?: string | null
  routedToReceptionistId?: string | null
}): Promise<void> {
  const sid = params.providerCallSid.trim()
  if (!sid) return
  const sql = getSql()
  const existing = await sql`
    SELECT 1 AS ok FROM call_logs
    WHERE user_id = ${params.userId} AND provider_call_sid = ${sid}
    LIMIT 1
  `
  if (existing[0]) return
  await insertCallLog({
    user_id: params.userId,
    provider_call_sid: sid,
    from_number: params.fromNumber.trim() || "Unknown",
    to_number: params.toNumber.trim() || "Unknown",
    caller_name: params.callerName ?? null,
    call_type: "incoming",
    status: "no-answer",
    duration_seconds: 0,
    routed_to_receptionist_id: params.routedToReceptionistId ?? null,
    routed_to_name: null,
    has_recording: false,
    recording_url: null,
    recording_duration_seconds: null,
  })
}

// Update a call log (e.g., when status callback arrives)
export async function updateCallLog(
  providerCallSid: string,
  updates: Partial<Pick<CallLog, "status" | "duration_seconds" | "call_type" | "has_recording" | "recording_url" | "recording_duration_seconds" | "answered_at" | "ended_at" | "setup_duration_ms" | "post_dial_delay_ms">>
): Promise<void> {
  const sql = getSql()
  if (updates.status !== undefined) {
    await sql`UPDATE call_logs SET status = ${updates.status} WHERE provider_call_sid = ${providerCallSid} OR twilio_call_sid = ${providerCallSid}`
  }
  if (updates.duration_seconds !== undefined) {
    await sql`UPDATE call_logs SET duration_seconds = ${updates.duration_seconds} WHERE provider_call_sid = ${providerCallSid} OR twilio_call_sid = ${providerCallSid}`
  }
  if (updates.call_type !== undefined) {
    await sql`UPDATE call_logs SET call_type = ${updates.call_type} WHERE provider_call_sid = ${providerCallSid} OR twilio_call_sid = ${providerCallSid}`
  }
  if (updates.has_recording !== undefined) {
    await sql`UPDATE call_logs SET has_recording = ${updates.has_recording}, recording_url = ${updates.recording_url ?? null}, recording_duration_seconds = ${updates.recording_duration_seconds ?? null} WHERE provider_call_sid = ${providerCallSid} OR twilio_call_sid = ${providerCallSid}`
  }
  if (updates.answered_at !== undefined) {
    await sql`UPDATE call_logs SET answered_at = ${updates.answered_at ?? null} WHERE provider_call_sid = ${providerCallSid} OR twilio_call_sid = ${providerCallSid}`
  }
  if (updates.ended_at !== undefined) {
    await sql`UPDATE call_logs SET ended_at = ${updates.ended_at ?? null} WHERE provider_call_sid = ${providerCallSid} OR twilio_call_sid = ${providerCallSid}`
  }
  if (updates.setup_duration_ms !== undefined) {
    await sql`UPDATE call_logs SET setup_duration_ms = ${updates.setup_duration_ms ?? null} WHERE provider_call_sid = ${providerCallSid} OR twilio_call_sid = ${providerCallSid}`
  }
  if (updates.post_dial_delay_ms !== undefined) {
    await sql`UPDATE call_logs SET post_dial_delay_ms = ${updates.post_dial_delay_ms ?? null} WHERE provider_call_sid = ${providerCallSid} OR twilio_call_sid = ${providerCallSid}`
  }
}

// Record a provider status event and derive setup timing metrics.
export async function recordCallStatusEvent(
  providerCallSid: string,
  callStatus: string,
  durationSeconds: number,
  occurredAtIso?: string
): Promise<void> {
  const sql = getSql()
  const occurredAt = occurredAtIso ? new Date(occurredAtIso) : new Date()
  await sql`
    UPDATE call_logs
    SET
      status = ${callStatus},
      duration_seconds = ${durationSeconds},
      answered_at = CASE
        WHEN ${callStatus} IN ('answered', 'in-progress', 'completed') AND answered_at IS NULL THEN ${occurredAt}
        ELSE answered_at
      END,
      ended_at = CASE
        WHEN ${callStatus} IN ('completed', 'busy', 'failed', 'no-answer', 'canceled') THEN ${occurredAt}
        ELSE ended_at
      END,
      setup_duration_ms = CASE
        WHEN ${callStatus} IN ('answered', 'in-progress', 'completed') AND first_ring_at IS NOT NULL THEN
          EXTRACT(EPOCH FROM (${occurredAt} - first_ring_at))::int * 1000
        ELSE setup_duration_ms
      END,
      post_dial_delay_ms = CASE
        WHEN ${callStatus} IN ('answered', 'in-progress', 'completed') AND first_ring_at IS NOT NULL THEN
          EXTRACT(EPOCH FROM (${occurredAt} - first_ring_at))::int * 1000
        ELSE post_dial_delay_ms
      END
    WHERE provider_call_sid = ${providerCallSid} OR twilio_call_sid = ${providerCallSid}
  `
}

export async function getCallQualitySummary(userId: string, days = 7): Promise<{
  total_calls: number
  answered_calls: number
  answer_rate_percent: number
  avg_setup_ms: number | null
  p95_setup_ms: number | null
  avg_post_dial_delay_ms: number | null
}> {
  const sql = getSql()
  try {
    const rows = await sql`
      WITH base AS (
        SELECT status, setup_duration_ms, post_dial_delay_ms
        FROM call_logs
        WHERE user_id = ${userId}
          AND created_at >= now() - (${days}::numeric * interval '1 day')
      ),
      stats AS (
        SELECT
          COUNT(*)::int AS total_calls,
          COUNT(*) FILTER (WHERE status IN ('answered', 'completed', 'in-progress'))::int AS answered_calls,
          AVG(setup_duration_ms)::float8 AS avg_setup_ms,
          AVG(post_dial_delay_ms)::float8 AS avg_post_dial_delay_ms
        FROM base
      ),
      p95 AS (
        SELECT
          percentile_cont(0.95) WITHIN GROUP (ORDER BY setup_duration_ms)::float8 AS p95_setup_ms
        FROM base
        WHERE setup_duration_ms IS NOT NULL
      )
      SELECT
        stats.total_calls,
        stats.answered_calls,
        CASE
          WHEN stats.total_calls = 0 THEN 0
          ELSE ROUND((stats.answered_calls::numeric / stats.total_calls::numeric) * 100, 2)::float8
        END AS answer_rate_percent,
        stats.avg_setup_ms,
        p95.p95_setup_ms,
        stats.avg_post_dial_delay_ms
      FROM stats, p95
    `

    const row = rows[0]
    if (!row) {
      return {
        total_calls: 0,
        answered_calls: 0,
        answer_rate_percent: 0,
        avg_setup_ms: null,
        p95_setup_ms: null,
        avg_post_dial_delay_ms: null,
      }
    }

    return {
      total_calls: Number(row.total_calls ?? 0),
      answered_calls: Number(row.answered_calls ?? 0),
      answer_rate_percent: Number(row.answer_rate_percent ?? 0),
      avg_setup_ms: row.avg_setup_ms == null ? null : Number(row.avg_setup_ms),
      p95_setup_ms: row.p95_setup_ms == null ? null : Number(row.p95_setup_ms),
      avg_post_dial_delay_ms: row.avg_post_dial_delay_ms == null ? null : Number(row.avg_post_dial_delay_ms),
    }
  } catch (e) {
    if (!isMissingCallQualityColumnsError(e)) throw e
    console.warn(
      "[db] call_logs is missing setup/post-dial columns. Run scripts/007-call-quality-metrics.sql in Neon for latency stats."
    )
    const rows = await sql`
      WITH base AS (
        SELECT status
        FROM call_logs
        WHERE user_id = ${userId}
          AND created_at >= now() - (${days}::numeric * interval '1 day')
      ),
      stats AS (
        SELECT
          COUNT(*)::int AS total_calls,
          COUNT(*) FILTER (WHERE status IN ('answered', 'completed', 'in-progress'))::int AS answered_calls
        FROM base
      )
      SELECT
        stats.total_calls,
        stats.answered_calls,
        CASE
          WHEN stats.total_calls = 0 THEN 0
          ELSE ROUND((stats.answered_calls::numeric / stats.total_calls::numeric) * 100, 2)::float8
        END AS answer_rate_percent,
        NULL::float8 AS avg_setup_ms,
        NULL::float8 AS p95_setup_ms,
        NULL::float8 AS avg_post_dial_delay_ms
      FROM stats
    `
    const row = rows[0]
    if (!row) {
      return {
        total_calls: 0,
        answered_calls: 0,
        answer_rate_percent: 0,
        avg_setup_ms: null,
        p95_setup_ms: null,
        avg_post_dial_delay_ms: null,
      }
    }
    return {
      total_calls: Number(row.total_calls ?? 0),
      answered_calls: Number(row.answered_calls ?? 0),
      answer_rate_percent: Number(row.answer_rate_percent ?? 0),
      avg_setup_ms: row.avg_setup_ms == null ? null : Number(row.avg_setup_ms),
      p95_setup_ms: row.p95_setup_ms == null ? null : Number(row.p95_setup_ms),
      avg_post_dial_delay_ms: row.avg_post_dial_delay_ms == null ? null : Number(row.avg_post_dial_delay_ms),
    }
  }
}

export async function getVoiceOperationsInsights(userId: string, days = 7): Promise<{
  daily_quality: {
    day: string
    total_calls: number
    answered_calls: number
    answer_rate_percent: number
    avg_setup_ms: number | null
  }[]
  number_quality: {
    number: string
    total_calls: number
    answered_calls: number
    answer_rate_percent: number
    avg_setup_ms: number | null
  }[]
  top_missed_callers: {
    caller_number: string
    missed_calls: number
    last_missed_at: string
  }[]
}> {
  const sql = getSql()

  let dailyRows: Record<string, unknown>[]
  let numberRows: Record<string, unknown>[]
  let missedRows: Record<string, unknown>[]

  try {
    dailyRows = await sql`
      SELECT
        to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
        COUNT(*)::int AS total_calls,
        COUNT(*) FILTER (WHERE status IN ('answered', 'completed', 'in-progress'))::int AS answered_calls,
        CASE
          WHEN COUNT(*) = 0 THEN 0
          ELSE ROUND((COUNT(*) FILTER (WHERE status IN ('answered', 'completed', 'in-progress'))::numeric / COUNT(*)::numeric) * 100, 2)::float8
        END AS answer_rate_percent,
        AVG(setup_duration_ms)::float8 AS avg_setup_ms
      FROM call_logs
      WHERE user_id = ${userId}
        AND created_at >= now() - (${days}::numeric * interval '1 day')
      GROUP BY date_trunc('day', created_at)
      ORDER BY date_trunc('day', created_at) ASC
    `

    numberRows = await sql`
      SELECT
        to_number AS number,
        COUNT(*)::int AS total_calls,
        COUNT(*) FILTER (WHERE status IN ('answered', 'completed', 'in-progress'))::int AS answered_calls,
        CASE
          WHEN COUNT(*) = 0 THEN 0
          ELSE ROUND((COUNT(*) FILTER (WHERE status IN ('answered', 'completed', 'in-progress'))::numeric / COUNT(*)::numeric) * 100, 2)::float8
        END AS answer_rate_percent,
        AVG(setup_duration_ms)::float8 AS avg_setup_ms
      FROM call_logs
      WHERE user_id = ${userId}
        AND created_at >= now() - (${days}::numeric * interval '1 day')
      GROUP BY to_number
      ORDER BY COUNT(*) DESC
      LIMIT 8
    `

    missedRows = await sql`
      SELECT
        from_number AS caller_number,
        COUNT(*)::int AS missed_calls,
        MAX(created_at) AS last_missed_at
      FROM call_logs
      WHERE user_id = ${userId}
        AND created_at >= now() - (${days}::numeric * interval '1 day')
        AND status IN ('no-answer', 'busy', 'failed', 'canceled')
      GROUP BY from_number
      ORDER BY COUNT(*) DESC, MAX(created_at) DESC
      LIMIT 5
    `
  } catch (e) {
    if (!isMissingCallQualityColumnsError(e)) throw e
    console.warn(
      "[db] call_logs is missing setup_duration_ms. Run scripts/007-call-quality-metrics.sql in Neon for per-day setup latency."
    )
    dailyRows = await sql`
      SELECT
        to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
        COUNT(*)::int AS total_calls,
        COUNT(*) FILTER (WHERE status IN ('answered', 'completed', 'in-progress'))::int AS answered_calls,
        CASE
          WHEN COUNT(*) = 0 THEN 0
          ELSE ROUND((COUNT(*) FILTER (WHERE status IN ('answered', 'completed', 'in-progress'))::numeric / COUNT(*)::numeric) * 100, 2)::float8
        END AS answer_rate_percent,
        NULL::float8 AS avg_setup_ms
      FROM call_logs
      WHERE user_id = ${userId}
        AND created_at >= now() - (${days}::numeric * interval '1 day')
      GROUP BY date_trunc('day', created_at)
      ORDER BY date_trunc('day', created_at) ASC
    `

    numberRows = await sql`
      SELECT
        to_number AS number,
        COUNT(*)::int AS total_calls,
        COUNT(*) FILTER (WHERE status IN ('answered', 'completed', 'in-progress'))::int AS answered_calls,
        CASE
          WHEN COUNT(*) = 0 THEN 0
          ELSE ROUND((COUNT(*) FILTER (WHERE status IN ('answered', 'completed', 'in-progress'))::numeric / COUNT(*)::numeric) * 100, 2)::float8
        END AS answer_rate_percent,
        NULL::float8 AS avg_setup_ms
      FROM call_logs
      WHERE user_id = ${userId}
        AND created_at >= now() - (${days}::numeric * interval '1 day')
      GROUP BY to_number
      ORDER BY COUNT(*) DESC
      LIMIT 8
    `

    missedRows = await sql`
      SELECT
        from_number AS caller_number,
        COUNT(*)::int AS missed_calls,
        MAX(created_at) AS last_missed_at
      FROM call_logs
      WHERE user_id = ${userId}
        AND created_at >= now() - (${days}::numeric * interval '1 day')
        AND status IN ('no-answer', 'busy', 'failed', 'canceled')
      GROUP BY from_number
      ORDER BY COUNT(*) DESC, MAX(created_at) DESC
      LIMIT 5
    `
  }

  return {
    daily_quality: dailyRows.map((r) => ({
      day: String(r.day),
      total_calls: Number(r.total_calls ?? 0),
      answered_calls: Number(r.answered_calls ?? 0),
      answer_rate_percent: Number(r.answer_rate_percent ?? 0),
      avg_setup_ms: r.avg_setup_ms == null ? null : Number(r.avg_setup_ms),
    })),
    number_quality: numberRows.map((r) => ({
      number: String(r.number ?? ""),
      total_calls: Number(r.total_calls ?? 0),
      answered_calls: Number(r.answered_calls ?? 0),
      answer_rate_percent: Number(r.answer_rate_percent ?? 0),
      avg_setup_ms: r.avg_setup_ms == null ? null : Number(r.avg_setup_ms),
    })),
    top_missed_callers: missedRows.map((r) => ({
      caller_number: String(r.caller_number ?? ""),
      missed_calls: Number(r.missed_calls ?? 0),
      last_missed_at: r.last_missed_at instanceof Date ? r.last_missed_at.toISOString() : String(r.last_missed_at),
    })),
  }
}

/** Map one `call_logs` row from Neon into the shared `CallLog` shape. */
function parseCallLogRow(row: Record<string, unknown>): CallLog {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    provider_call_sid: String(row.provider_call_sid ?? row.twilio_call_sid ?? ""),
    from_number: String(row.from_number),
    to_number: String(row.to_number),
    caller_name: row.caller_name ? String(row.caller_name) : null,
    call_type: String(row.call_type) as CallLog["call_type"],
    status: String(row.status),
    duration_seconds: Number(row.duration_seconds),
    routed_to_receptionist_id: row.routed_to_receptionist_id ? String(row.routed_to_receptionist_id) : null,
    routed_to_name: row.routed_to_name ? String(row.routed_to_name) : null,
    has_recording: Boolean(row.has_recording),
    recording_url: row.recording_url ? String(row.recording_url) : null,
    recording_duration_seconds: row.recording_duration_seconds ? Number(row.recording_duration_seconds) : null,
    first_ring_at: row.first_ring_at ? String(row.first_ring_at) : null,
    answered_at: row.answered_at ? String(row.answered_at) : null,
    ended_at: row.ended_at ? String(row.ended_at) : null,
    setup_duration_ms: row.setup_duration_ms == null ? null : Number(row.setup_duration_ms),
    post_dial_delay_ms: row.post_dial_delay_ms == null ? null : Number(row.post_dial_delay_ms),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }
}

// Get call logs for a user (paginated)
export async function getCallLogs(
  userId: string,
  options?: { limit?: number; offset?: number; type?: string }
): Promise<CallLog[]> {
  const sql = getSql()
  const limit = options?.limit ?? 50
  const offset = options?.offset ?? 0

  let rows
  if (options?.type) {
    rows = await sql`
      SELECT * FROM call_logs
      WHERE user_id = ${userId} AND call_type = ${options.type}
      ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
    `
  } else {
    rows = await sql`
      SELECT * FROM call_logs
      WHERE user_id = ${userId}
      ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
    `
  }

  return rows.map((row) => parseCallLogRow(row as Record<string, unknown>))
}

/**
 * Calls that look **in flight** for the dashboard: `ended_at` is still null (see `recordCallStatusEvent`)
 * and the row is recent so stuck webhooks do not show forever.
 * Requires `scripts/007-call-quality-metrics.sql` (`ended_at` column); otherwise returns [].
 */
export async function listLiveCallLogsForUser(userId: string): Promise<CallLog[]> {
  const sql = getSql()
  let rows: Record<string, unknown>[]
  try {
    rows = await sql`
      SELECT * FROM call_logs
      WHERE user_id = ${userId}
        AND ended_at IS NULL
        AND created_at > (now() - interval '1 hour')
      ORDER BY created_at DESC
      LIMIT 20
    `
  } catch (e) {
    if (pgErrorCode(e) === "42703" && pgErrorMessage(e).includes("ended_at")) {
      console.warn("[db] listLiveCallLogsForUser: ended_at missing — run scripts/007-call-quality-metrics.sql in Neon.")
      return []
    }
    throw e
  }
  return rows.map((row) => parseCallLogRow(row as Record<string, unknown>))
}

/** Inbound calls that reached an “answered” state recently — drives the post-answer customer sheet. */
export async function listRecentlyAnsweredIncomingCalls(
  userId: string,
  withinMinutes = 12
): Promise<CallLog[]> {
  const sql = getSql()
  let rows: Record<string, unknown>[]
  try {
    rows = await sql`
      SELECT * FROM call_logs
      WHERE user_id = ${userId}
        AND call_type = 'incoming'
        AND answered_at IS NOT NULL
        AND answered_at > (now() - (${withinMinutes}::numeric * interval '1 minute'))
      ORDER BY answered_at DESC
      LIMIT 40
    `
  } catch (e) {
    if (pgErrorCode(e) === "42703" && pgErrorMessage(e).includes("answered_at")) {
      console.warn("[db] listRecentlyAnsweredIncomingCalls: answered_at missing — run scripts/007-call-quality-metrics.sql.")
      return []
    }
    throw e
  }
  return rows.map((row) => parseCallLogRow(row as Record<string, unknown>))
}

function parseCustomerRow(row: Record<string, unknown>): Customer {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    phone_e164: String(row.phone_e164 ?? ""),
    display_name: String(row.display_name ?? ""),
    company_name: String(row.company_name ?? ""),
    address_line1: String(row.address_line1 ?? ""),
    address_line2: String(row.address_line2 ?? ""),
    city: String(row.city ?? ""),
    region: String(row.region ?? ""),
    postal_code: String(row.postal_code ?? ""),
    country: String(row.country ?? "US"),
    notes: String(row.notes ?? ""),
    source_last_call_log_id: row.source_last_call_log_id ? String(row.source_last_call_log_id) : null,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  }
}

export async function listCustomersForUser(
  userId: string,
  options?: { q?: string; limit?: number }
): Promise<Customer[]> {
  const sql = getSql()
  const limit = Math.min(Math.max(options?.limit ?? 80, 1), 200)
  const q = (options?.q ?? "").trim()
  let rows: Record<string, unknown>[]
  try {
    if (!q) {
      rows = await sql`
        SELECT * FROM customers
        WHERE user_id = ${userId}
        ORDER BY updated_at DESC
        LIMIT ${limit}
      `
    } else {
      const pat = `%${q}%`
      rows = await sql`
        SELECT * FROM customers
        WHERE user_id = ${userId}
          AND (
            phone_e164 ILIKE ${pat}
            OR display_name ILIKE ${pat}
            OR company_name ILIKE ${pat}
            OR address_line1 ILIKE ${pat}
            OR address_line2 ILIKE ${pat}
            OR city ILIKE ${pat}
            OR region ILIKE ${pat}
            OR postal_code ILIKE ${pat}
            OR notes ILIKE ${pat}
          )
        ORDER BY updated_at DESC
        LIMIT ${limit}
      `
    }
  } catch (e) {
    if (isUndefinedRelationError(e, "customers")) return []
    throw e
  }
  return rows.map((r) => parseCustomerRow(r as Record<string, unknown>))
}

export async function getCustomerByPhoneForUser(userId: string, phoneE164: string): Promise<Customer | null> {
  const sql = getSql()
  const phone = normalizePhoneNumberE164(phoneE164)
  let rows: Record<string, unknown>[]
  try {
    rows = await sql`
      SELECT * FROM customers
      WHERE user_id = ${userId} AND phone_e164 = ${phone}
      LIMIT 1
    `
  } catch (e) {
    if (isUndefinedRelationError(e, "customers")) return null
    throw e
  }
  const row = rows[0] as Record<string, unknown> | undefined
  return row ? parseCustomerRow(row) : null
}

export async function upsertCustomerForUser(params: {
  userId: string
  phoneE164: string
  displayName: string
  companyName: string
  addressLine1: string
  addressLine2: string
  city: string
  region: string
  postalCode: string
  country: string
  notes: string
  sourceLastCallLogId?: string | null
}): Promise<Customer> {
  const sql = getSql()
  const phone = normalizePhoneNumberE164(params.phoneE164)
  const sid = params.sourceLastCallLogId?.trim() || null
  const rows = await sql`
    INSERT INTO customers (
      id, user_id, phone_e164, display_name, company_name, address_line1, address_line2,
      city, region, postal_code, country, notes, source_last_call_log_id, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      ${params.userId},
      ${phone},
      ${params.displayName},
      ${params.companyName},
      ${params.addressLine1},
      ${params.addressLine2},
      ${params.city},
      ${params.region},
      ${params.postalCode},
      ${params.country},
      ${params.notes},
      ${sid},
      now(),
      now()
    )
    ON CONFLICT (user_id, phone_e164) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      company_name = EXCLUDED.company_name,
      address_line1 = EXCLUDED.address_line1,
      address_line2 = EXCLUDED.address_line2,
      city = EXCLUDED.city,
      region = EXCLUDED.region,
      postal_code = EXCLUDED.postal_code,
      country = EXCLUDED.country,
      notes = EXCLUDED.notes,
      source_last_call_log_id = COALESCE(EXCLUDED.source_last_call_log_id, customers.source_last_call_log_id),
      updated_at = now()
    RETURNING *
  `
  const row = rows[0] as Record<string, unknown> | undefined
  if (!row) throw new Error("upsertCustomerForUser: no row returned")
  return parseCustomerRow(row)
}

function parsePhoneNumberRow(row: Record<string, unknown>): PhoneNumber {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    provider_number_sid: String(row.provider_number_sid ?? row.twilio_sid ?? ""),
    number: String(row.number),
    friendly_name: String(row.friendly_name ?? ""),
    label: String(row.label ?? "Business Line"),
    type: (row.type as "local" | "toll-free") || "local",
    status: (row.status as "active" | "pending" | "porting") || "active",
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }
}

// Get phone numbers for a user
export async function getPhoneNumbers(userId: string): Promise<PhoneNumber[]> {
  const sql = getSql()
  const rows = await sql`
    SELECT id, user_id, provider_number_sid, twilio_sid, number, friendly_name, label, type, status, created_at
    FROM phone_numbers WHERE user_id = ${userId} ORDER BY created_at ASC
  `
  return rows.map(parsePhoneNumberRow)
}

/**
 * First active business DID for this user — used when Telnyx Dial `action` webhook loses `bn` or sends `To` as the owner’s cell (so per-number AI fallback was misread as default voicemail).
 */
export async function getPrimaryActiveBusinessNumberE164(userId: string): Promise<string | null> {
  const list = await getPhoneNumbers(userId)
  const row = list.find((p) => p.status === "active") ?? list[0]
  if (!row?.number?.trim()) return null
  return normalizePhoneNumberE164(row.number)
}

// Insert a phone number (after purchase or port)
export async function insertPhoneNumber(params: {
  user_id: string
  number: string
  friendly_name: string
  label?: string
  type?: "local" | "toll-free"
  status?: "active" | "pending" | "porting"
  provider_number_sid?: string
}): Promise<PhoneNumber> {
  const sql = getSql()
  const id = crypto.randomUUID()
  const numberE164 = normalizePhoneNumberE164(params.number)
  await sql`
    INSERT INTO phone_numbers (id, user_id, provider_number_sid, twilio_sid, number, friendly_name, label, type, status, created_at)
    VALUES (
      ${id},
      ${params.user_id},
      ${params.provider_number_sid || ""},
      ${params.provider_number_sid || ""},
      ${numberE164},
      ${params.friendly_name},
      ${params.label || "Business Line"},
      ${params.type || "local"},
      ${params.status || "active"},
      now()
    )
  `
  return {
    id,
    user_id: params.user_id,
    provider_number_sid: params.provider_number_sid || "",
    number: numberE164,
    friendly_name: params.friendly_name,
    label: params.label || "Business Line",
    type: params.type || "local",
    status: params.status || "active",
    created_at: new Date().toISOString(),
  }
}

// Get a phone number by number and status (e.g. for porting webhook)
export async function getPhoneNumberByNumberAndStatus(
  number: string,
  status: string
): Promise<PhoneNumber | null> {
  const sql = getSql()
  const normalized = normalizePhoneNumberE164(number)
  const rows = await sql`
    SELECT id, user_id, provider_number_sid, twilio_sid, number, friendly_name, label, type, status, created_at
    FROM phone_numbers WHERE number = ${normalized} AND status = ${status} LIMIT 1
  `
  return rows[0] ? parsePhoneNumberRow(rows[0]) : null
}

/**
 * When a port order is submitted, ensure we have a `phone_numbers` row in `porting` status with the user-chosen label.
 * On repeat submit for the same number, updates label and port order id on the existing porting row.
 */
export async function ensurePortingLineRecord(params: {
  user_id: string
  number: string
  label: string
  port_order_id: string
}): Promise<void> {
  const sql = getSql()
  const e164 = normalizePhoneNumberE164(params.number)
  const active = await getPhoneNumberByNumberAndStatus(e164, "active")
  if (active) return
  const porting = await getPhoneNumberByNumberAndStatus(e164, "porting")
  if (porting && porting.user_id === params.user_id) {
    await sql`
      UPDATE phone_numbers
      SET label = ${params.label}, provider_number_sid = ${params.port_order_id}, twilio_sid = ${params.port_order_id}
      WHERE id = ${porting.id} AND user_id = ${params.user_id}
    `
    clearIncomingRoutingCache()
    return
  }
  if (porting) return
  await insertPhoneNumber({
    user_id: params.user_id,
    number: e164,
    friendly_name: e164,
    label: params.label,
    type: "local",
    status: "porting",
    provider_number_sid: params.port_order_id,
  })
}

// Update a phone number (e.g. after port complete)
export async function updatePhoneNumber(
  phoneNumberId: string,
  userId: string,
  updates: Partial<Pick<PhoneNumber, "provider_number_sid" | "status">>
): Promise<void> {
  const sql = getSql()
  if (updates.provider_number_sid !== undefined) {
    await sql`UPDATE phone_numbers SET provider_number_sid = ${updates.provider_number_sid}, twilio_sid = ${updates.provider_number_sid} WHERE id = ${phoneNumberId} AND user_id = ${userId}`
  }
  if (updates.status !== undefined) {
    await sql`UPDATE phone_numbers SET status = ${updates.status} WHERE id = ${phoneNumberId} AND user_id = ${userId}`
  }
}

/**
 * Updates display fields on a row the user owns. Returns false if no row matched (wrong id / other account).
 * Clears incoming-call routing cache when label or friendly_name changes so voice webhooks read fresh values.
 */
export async function patchPhoneNumberForUser(
  phoneNumberId: string, // `phone_numbers.id` UUID
  userId: string, // Owner id — UPDATE is scoped so you cannot edit someone else’s number
  updates: Partial<Pick<PhoneNumber, "label" | "friendly_name">> // At least one field should be set by the caller
): Promise<boolean> {
  const sql = getSql() // Shared SQL client (Neon serverless)
  if (updates.label === undefined && updates.friendly_name === undefined) {
    return false // Nothing to write — treat as failed patch
  }
  let rows: { id: string }[] // Rows returned by RETURNING id (empty array ⇒ no permission / wrong id)
  if (updates.label !== undefined && updates.friendly_name !== undefined) {
    rows = await sql`
      UPDATE phone_numbers
      SET label = ${updates.label}, friendly_name = ${updates.friendly_name}
      WHERE id = ${phoneNumberId} AND user_id = ${userId}
      RETURNING id
    `
  } else if (updates.label !== undefined) {
    rows = await sql`
      UPDATE phone_numbers SET label = ${updates.label}
      WHERE id = ${phoneNumberId} AND user_id = ${userId}
      RETURNING id
    `
  } else {
    rows = await sql`
      UPDATE phone_numbers SET friendly_name = ${updates.friendly_name!}
      WHERE id = ${phoneNumberId} AND user_id = ${userId}
      RETURNING id
    `
  }
  if (rows.length > 0) {
    clearIncomingRoutingCache() // Incoming Telnyx handler caches label — drop cache so next call is fresh
  }
  return rows.length > 0 // true iff one row updated
}

// --- AI Assistant Presets (cloud-synced) ---
export async function getAiAssistantPresets(userId: string): Promise<{
  id: string
  label: string
  config: Record<string, unknown>
  created_at: string
  updated_at: string
}[]> {
  const sql = getSql()
  const rows = await sql`
    SELECT id, label, config, created_at, updated_at
    FROM ai_assistant_presets
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `
  return rows.map((row) => ({
    id: String(row.id),
    label: String(row.label),
    config: (row.config as Record<string, unknown>) || {},
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  }))
}

export async function insertAiAssistantPreset(params: {
  user_id: string
  label: string
  config: Record<string, unknown>
}): Promise<{ id: string; label: string; config: Record<string, unknown> }> {
  const sql = getSql()
  const id = crypto.randomUUID()
  const rows = await sql`
    INSERT INTO ai_assistant_presets (id, user_id, label, config, created_at, updated_at)
    VALUES (${id}, ${params.user_id}, ${params.label}, ${JSON.stringify(params.config)}, now(), now())
    RETURNING id, label, config
  `
  return {
    id: String(rows[0].id),
    label: String(rows[0].label),
    config: (rows[0].config as Record<string, unknown>) || {},
  }
}

export async function deleteAiAssistantPreset(userId: string, presetId: string): Promise<void> {
  const sql = getSql()
  await sql`
    DELETE FROM ai_assistant_presets
    WHERE id = ${presetId} AND user_id = ${userId}
  `
}

export async function updateAiAssistantPreset(params: {
  user_id: string
  id: string
  label?: string
  config?: Record<string, unknown>
}): Promise<{ id: string; label: string; config: Record<string, unknown> } | null> {
  const sql = getSql()
  const existing = await sql`
    SELECT id, label, config
    FROM ai_assistant_presets
    WHERE id = ${params.id} AND user_id = ${params.user_id}
    LIMIT 1
  `
  if (!existing[0]) return null

  const label = params.label !== undefined ? params.label : String(existing[0].label)
  const config = params.config !== undefined ? params.config : ((existing[0].config as Record<string, unknown>) || {})

  const rows = await sql`
    UPDATE ai_assistant_presets
    SET label = ${label}, config = ${JSON.stringify(config)}, updated_at = now()
    WHERE id = ${params.id} AND user_id = ${params.user_id}
    RETURNING id, label, config
  `
  if (!rows[0]) return null
  return {
    id: String(rows[0].id),
    label: String(rows[0].label),
    config: (rows[0].config as Record<string, unknown>) || {},
  }
}

// --- AI intake config (per user) + leads ---

/** Resolve owner by Telnyx Voice AI assistant id (e.g. future tool / webhook integrations). */
export async function getUserByTelnyxAssistantId(telnyxAssistantId: string): Promise<User | null> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT id, email, name, phone, business_name, industry, telnyx_ai_assistant_id, created_at,
        credit_balance_cents, billing_plan, is_platform_admin
      FROM users WHERE telnyx_ai_assistant_id = ${telnyxAssistantId} LIMIT 1
    `
    return rows[0] ? parseUserRow(rows[0]) : null
  } catch (e) {
    if (isMissingBillingColumnsError(e)) {
      try {
        const rows = await sql`
          SELECT id, email, name, phone, business_name, industry, telnyx_ai_assistant_id, created_at
          FROM users WHERE telnyx_ai_assistant_id = ${telnyxAssistantId} LIMIT 1
        `
        return rows[0] ? parseUserRow(rows[0]) : null
      } catch (e2) {
        if (!isMissingIndustryColumnError(e2)) throw e2
        const rows = await sql`
          SELECT id, email, name, phone, business_name, telnyx_ai_assistant_id, created_at
          FROM users WHERE telnyx_ai_assistant_id = ${telnyxAssistantId} LIMIT 1
        `
        return rows[0] ? parseUserRow(rows[0]) : null
      }
    }
    if (!isMissingIndustryColumnError(e)) throw e
    try {
      const rows = await sql`
        SELECT id, email, name, phone, business_name, telnyx_ai_assistant_id, created_at,
          credit_balance_cents, billing_plan, is_platform_admin
        FROM users WHERE telnyx_ai_assistant_id = ${telnyxAssistantId} LIMIT 1
      `
      return rows[0] ? parseUserRow(rows[0]) : null
    } catch (e2) {
      if (isMissingBillingColumnsError(e2)) {
        const rows = await sql`
          SELECT id, email, name, phone, business_name, telnyx_ai_assistant_id, created_at
          FROM users WHERE telnyx_ai_assistant_id = ${telnyxAssistantId} LIMIT 1
        `
        return rows[0] ? parseUserRow(rows[0]) : null
      }
      throw e2
    }
  }
}

export async function getAiIntakeConfigRaw(userId: string): Promise<Record<string, unknown> | null> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT config FROM user_ai_intake WHERE user_id = ${userId} LIMIT 1
    `
    const c = rows[0]?.config
    if (!c || typeof c !== "object") return null
    return c as Record<string, unknown>
  } catch (e) {
    if (isUndefinedRelationError(e, "user_ai_intake")) {
      console.warn(
        "[db] Table user_ai_intake is missing. Run scripts/010-ai-leads-intake.sql in the Neon SQL Editor."
      )
      return null
    }
    throw e
  }
}

export async function upsertAiIntakeConfig(userId: string, config: Record<string, unknown>): Promise<void> {
  const sql = getSql()
  const json = JSON.stringify(config)
  try {
    await sql`
      INSERT INTO user_ai_intake (user_id, config, updated_at)
      VALUES (${userId}, ${json}::jsonb, now())
      ON CONFLICT (user_id) DO UPDATE SET
        config = EXCLUDED.config,
        updated_at = now()
    `
  } catch (e) {
    if (isUndefinedRelationError(e, "user_ai_intake")) {
      throw new Error(
        "AI call flow settings could not be saved: table user_ai_intake is missing. In Neon → SQL Editor, run scripts/010-ai-leads-intake.sql, then try Save again."
      )
    }
    throw e
  }
}

export async function insertAiLead(params: {
  user_id: string
  caller_e164: string | null
  intent_slug: string | null
  collected: Record<string, unknown>
  summary: string | null
  sms_sent: boolean
  sms_error: string | null
  vapi_call_id: string | null
}): Promise<string> {
  const sql = getSql()
  const id = crypto.randomUUID()
  const collectedJson = JSON.stringify(params.collected)
  await sql`
    INSERT INTO ai_leads (
      id, user_id, caller_e164, intent_slug, collected, summary, sms_sent, sms_error, vapi_call_id, created_at
    ) VALUES (
      ${id},
      ${params.user_id},
      ${params.caller_e164},
      ${params.intent_slug},
      ${collectedJson}::jsonb,
      ${params.summary},
      ${params.sms_sent},
      ${params.sms_error},
      ${params.vapi_call_id},
      now()
    )
  `
  return id
}

export async function listAiLeadsForUser(userId: string, limit = 50): Promise<
  {
    id: string
    caller_e164: string | null
    intent_slug: string | null
    collected: Record<string, unknown>
    summary: string | null
    sms_sent: boolean
    sms_error: string | null
    created_at: string
  }[]
> {
  const sql = getSql()
  const lim = Math.min(Math.max(limit, 1), 100)
  try {
    const rows = await sql`
      SELECT id, caller_e164, intent_slug, collected, summary, sms_sent, sms_error, created_at
      FROM ai_leads
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT ${lim}
    `
    return rows.map((r: Record<string, unknown>) => ({
      id: String(r.id),
      caller_e164: r.caller_e164 != null ? String(r.caller_e164) : null,
      intent_slug: r.intent_slug != null ? String(r.intent_slug) : null,
      collected: (r.collected as Record<string, unknown>) || {},
      summary: r.summary != null ? String(r.summary) : null,
      sms_sent: Boolean(r.sms_sent),
      sms_error: r.sms_error != null ? String(r.sms_error) : null,
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    }))
  } catch (e) {
    if (isUndefinedRelationError(e, "ai_leads")) {
      console.warn(
        "[db] Table ai_leads is missing. Run scripts/010-ai-leads-intake.sql in the Neon SQL Editor."
      )
      return []
    }
    throw e
  }
}

/**
 * Counts how many times Telnyx has POSTed `/incoming` for this `call_sid` (atomic upsert).
 * - **1** → first hit: silent `<Redirect>` to `/ai-bridge` is OK.
 * - **≥ 2** → repeat hits: use **Say + Redirect** to `/ai-bridge` (not `<Connect>` on `/incoming` —
 *   Telnyx often plays a generic “application error” for `<Connect>` on the repeat).
 */
export async function bumpTelnyxAiIncomingHitCount(callSid: string): Promise<number> {
  const sid = callSid.trim()
  if (!sid) return 1
  const sql = getSql()
  try {
    const rows = await sql`
      INSERT INTO telnyx_ai_incoming_handoff (call_sid, incoming_hits) VALUES (${sid}, 1)
      ON CONFLICT (call_sid) DO UPDATE
      SET incoming_hits = telnyx_ai_incoming_handoff.incoming_hits + 1
      RETURNING incoming_hits
    `
    const row = rows[0] as { incoming_hits?: number } | undefined
    const n = row?.incoming_hits != null ? Number(row.incoming_hits) : NaN
    return Number.isFinite(n) && n >= 1 ? n : 1
  } catch (e) {
    if (isUndefinedRelationError(e, "telnyx_ai_incoming_handoff")) {
      console.warn(
        "[db] telnyx_ai_incoming_handoff missing — run scripts/013-telnyx-ai-incoming-handoff.sql in Neon."
      )
      return 1
    }
    const msg = (e instanceof Error ? e.message : String(e)).toLowerCase()
    const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : ""
    if (code === "42703" && msg.includes("incoming_hits")) {
      console.warn(
        "[db] incoming_hits missing — run scripts/014-telnyx-ai-incoming-hit-count.sql. Using legacy first/repeat detection."
      )
      try {
        const legacy = await sql`
          INSERT INTO telnyx_ai_incoming_handoff (call_sid) VALUES (${sid})
          ON CONFLICT (call_sid) DO NOTHING
          RETURNING call_sid
        `
        return Array.isArray(legacy) && legacy.length > 0 ? 1 : 2
      } catch (e2) {
        console.warn("[db] Legacy telnyx_ai_incoming_handoff insert failed:", e2)
        return 1
      }
    }
    throw e
  }
}

/**
 * Mark this inbound `call_sid` so `/incoming` can return `<Hangup>` on repeat fetches (Telnyx may re-hit the voice URL after `<Dial>` ends instead of only the Dial `action` URL).
 * Safe to call multiple times. Requires **`018-telnyx-inbound-dial-caller-done.sql`** in Neon.
 */
export async function markTelnyxInboundDialCallerLegDone(providerCallSid: string): Promise<void> {
  const sid = providerCallSid.trim()
  if (!sid) return
  const sql = getSql()
  try {
    await sql`
      INSERT INTO telnyx_inbound_dial_caller_done (call_sid) VALUES (${sid})
      ON CONFLICT (call_sid) DO NOTHING
    `
  } catch (e) {
    if (isUndefinedRelationError(e, "telnyx_inbound_dial_caller_done")) {
      console.warn(
        "[db] telnyx_inbound_dial_caller_done missing — run scripts/018-telnyx-inbound-dial-caller-done.sql in Neon SQL Editor."
      )
      return
    }
    console.error("[db] markTelnyxInboundDialCallerLegDone:", e)
  }
}

/** True after `markTelnyxInboundDialCallerLegDone` ran for this `call_sid` (table missing → always false). */
export async function isTelnyxInboundDialCallerLegDone(providerCallSid: string): Promise<boolean> {
  const sid = providerCallSid.trim()
  if (!sid) return false
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT 1 AS ok FROM telnyx_inbound_dial_caller_done WHERE call_sid = ${sid} LIMIT 1
    `
    return Array.isArray(rows) && rows.length > 0
  } catch (e) {
    if (isUndefinedRelationError(e, "telnyx_inbound_dial_caller_done")) return false
    throw e
  }
}

/**
 * Insert a Telnyx porting webhook event for the user (idempotent on `telnyx_event_id`).
 * Returns `true` if a new row was inserted.
 */
export async function insertPortingNotificationIfNew(params: {
  userId: string
  telnyxEventId: string
  portingOrderId: string | null
  eventType: string
  title: string
  body: string
  rawPayload: unknown
}): Promise<boolean> {
  const sql = getSql()
  const rawJson = JSON.stringify(params.rawPayload ?? null)
  try {
    const rows = await sql`
      INSERT INTO porting_notifications (
        user_id, telnyx_event_id, porting_order_id, event_type, title, body, raw_payload
      ) VALUES (
        ${params.userId},
        ${params.telnyxEventId},
        ${params.portingOrderId},
        ${params.eventType},
        ${params.title},
        ${params.body},
        ${rawJson}::jsonb
      )
      ON CONFLICT (telnyx_event_id) DO NOTHING
      RETURNING id
    `
    return Array.isArray(rows) && rows.length > 0
  } catch (e) {
    if (isUndefinedRelationError(e, "porting_notifications")) {
      console.warn("[db] porting_notifications missing — run scripts/016-porting-notifications.sql in Neon.")
      return false
    }
    throw e
  }
}

export async function listPortingNotifications(
  userId: string,
  limit: number = 50
): Promise<PortingNotification[]> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT id, user_id, telnyx_event_id, porting_order_id, event_type, title, body, read_at, created_at
      FROM porting_notifications
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT ${Math.min(Math.max(limit, 1), 100)}
    `
    return (rows as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      user_id: String(row.user_id),
      telnyx_event_id: String(row.telnyx_event_id),
      porting_order_id: row.porting_order_id != null ? String(row.porting_order_id) : null,
      event_type: String(row.event_type ?? ""),
      title: String(row.title ?? ""),
      body: String(row.body ?? ""),
      read_at: row.read_at instanceof Date ? row.read_at.toISOString() : row.read_at != null ? String(row.read_at) : null,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ""),
    }))
  } catch (e) {
    if (isUndefinedRelationError(e, "porting_notifications")) {
      console.warn("[db] porting_notifications missing — run scripts/016-porting-notifications.sql in Neon.")
      return []
    }
    throw e
  }
}

export async function countUnreadPortingNotifications(userId: string): Promise<number> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT count(*)::int AS c FROM porting_notifications
      WHERE user_id = ${userId} AND read_at IS NULL
    `
    const row = rows[0] as { c?: number } | undefined
    return row?.c != null ? Number(row.c) : 0
  } catch (e) {
    if (isUndefinedRelationError(e, "porting_notifications")) return 0
    throw e
  }
}

export async function markPortingNotificationsRead(userId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const sql = getSql()
  try {
    for (const id of ids) {
      await sql`
        UPDATE porting_notifications
        SET read_at = now()
        WHERE user_id = ${userId} AND id = ${id}
      `
    }
  } catch (e) {
    if (isUndefinedRelationError(e, "porting_notifications")) return
    throw e
  }
}

export async function markAllPortingNotificationsRead(userId: string): Promise<void> {
  const sql = getSql()
  try {
    await sql`
      UPDATE porting_notifications
      SET read_at = now()
      WHERE user_id = ${userId} AND read_at IS NULL
    `
  } catch (e) {
    if (isUndefinedRelationError(e, "porting_notifications")) return
    throw e
  }
}

function parseFeedbackSubmissionRow(row: Record<string, unknown>): FeedbackSubmission {
  return {
    id: String(row.id),
    user_id: row.user_id != null ? String(row.user_id) : null,
    category: String(row.category) as FeedbackSubmission["category"],
    subject: String(row.subject ?? ""),
    body: String(row.body ?? ""),
    status: String(row.status ?? "open") as FeedbackSubmission["status"],
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ""),
  }
}

/** Logged-in user submits product feedback (requires `019-billing-admin-feedback.sql`). */
export async function insertFeedbackSubmission(params: {
  user_id: string
  category: FeedbackCategory
  subject: string
  body: string
}): Promise<FeedbackSubmission> {
  const sql = getSql()
  const id = crypto.randomUUID()
  try {
    await sql`
      INSERT INTO feedback_submissions (id, user_id, category, subject, body, status)
      VALUES (${id}, ${params.user_id}, ${params.category}, ${params.subject}, ${params.body}, 'open')
    `
    const rows = await sql`
      SELECT id, user_id, category, subject, body, status, created_at
      FROM feedback_submissions WHERE id = ${id} LIMIT 1
    `
    const row = rows[0] as Record<string, unknown> | undefined
    if (!row) throw new Error("Feedback row missing after insert")
    return parseFeedbackSubmissionRow(row)
  } catch (e) {
    if (isUndefinedRelationError(e, "feedback_submissions")) {
      throw new Error(
        "Feedback is not enabled until scripts/019-billing-admin-feedback.sql is run in Neon (creates feedback_submissions)."
      )
    }
    throw e
  }
}

/** Admin queue — newest first. */
export async function listFeedbackSubmissionsForAdmin(limit: number = 100): Promise<FeedbackSubmission[]> {
  const sql = getSql()
  const lim = Math.min(Math.max(limit, 1), 500)
  try {
    const rows = await sql`
      SELECT id, user_id, category, subject, body, status, created_at
      FROM feedback_submissions
      ORDER BY created_at DESC
      LIMIT ${lim}
    `
    return (rows as Record<string, unknown>[]).map(parseFeedbackSubmissionRow)
  } catch (e) {
    if (isUndefinedRelationError(e, "feedback_submissions")) return []
    throw e
  }
}

export async function updateFeedbackSubmissionStatusAdmin(
  submissionId: string,
  status: FeedbackStatus
): Promise<FeedbackSubmission | null> {
  const sql = getSql()
  try {
    const rows = await sql`
      UPDATE feedback_submissions SET status = ${status}
      WHERE id = ${submissionId}
      RETURNING id, user_id, category, subject, body, status, created_at
    `
    const row = rows[0] as Record<string, unknown> | undefined
    return row ? parseFeedbackSubmissionRow(row) : null
  } catch (e) {
    if (isUndefinedRelationError(e, "feedback_submissions")) return null
    throw e
  }
}

export type AdminDashboardStats = {
  user_count: number
  total_credit_balance_cents: number
  open_feedback_count: number
}

export async function getAdminDashboardStats(): Promise<AdminDashboardStats> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT
        (SELECT count(*)::int FROM users) AS user_count,
        (SELECT coalesce(sum(credit_balance_cents), 0)::bigint FROM users) AS total_credit_cents,
        (SELECT count(*)::int FROM feedback_submissions WHERE status = 'open') AS open_feedback_count
    `
    const row = rows[0] as { user_count?: number; total_credit_cents?: bigint; open_feedback_count?: number } | undefined
    return {
      user_count: row?.user_count != null ? Number(row.user_count) : 0,
      total_credit_balance_cents: row?.total_credit_cents != null ? Number(row.total_credit_cents) : 0,
      open_feedback_count: row?.open_feedback_count != null ? Number(row.open_feedback_count) : 0,
    }
  } catch (e) {
    if (isUndefinedRelationError(e, "feedback_submissions")) {
      const rows = await sql`
        SELECT
          (SELECT count(*)::int FROM users) AS user_count,
          (SELECT coalesce(sum(credit_balance_cents), 0)::bigint FROM users) AS total_credit_cents
      `
      const row = rows[0] as { user_count?: number; total_credit_cents?: bigint } | undefined
      return {
        user_count: row?.user_count != null ? Number(row.user_count) : 0,
        total_credit_balance_cents: row?.total_credit_cents != null ? Number(row.total_credit_cents) : 0,
        open_feedback_count: 0,
      }
    }
    if (isMissingBillingColumnsError(e)) {
      const rows = await sql`SELECT count(*)::int AS user_count FROM users`
      const row = rows[0] as { user_count?: number } | undefined
      return {
        user_count: row?.user_count != null ? Number(row.user_count) : 0,
        total_credit_balance_cents: 0,
        open_feedback_count: 0,
      }
    }
    throw e
  }
}

/** Operator console: accounts with last-30-day call volume. */
export async function listAdminUserSummaries(limit: number = 200): Promise<AdminUserSummary[]> {
  const sql = getSql()
  const lim = Math.min(Math.max(limit, 1), 500)
  try {
    const rows = await sql`
      SELECT
        u.id,
        u.email,
        u.name,
        u.business_name,
        u.credit_balance_cents,
        u.billing_plan,
        u.is_platform_admin,
        u.created_at,
        coalesce(agg.cnt, 0)::int AS calls_last_30_days,
        coalesce(agg.secs, 0)::bigint AS talk_seconds_last_30_days
      FROM users u
      LEFT JOIN LATERAL (
        SELECT
          count(*)::int AS cnt,
          coalesce(sum(cl.duration_seconds), 0)::bigint AS secs
        FROM call_logs cl
        WHERE cl.user_id = u.id AND cl.created_at > (now() - interval '30 days')
      ) agg ON true
      ORDER BY u.created_at DESC
      LIMIT ${lim}
    `
    return (rows as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      email: String(row.email ?? ""),
      name: String(row.name ?? ""),
      business_name: String(row.business_name ?? ""),
      credit_balance_cents: Number(row.credit_balance_cents ?? 0),
      billing_plan: String(row.billing_plan ?? "trial"),
      is_platform_admin: pgBool(row.is_platform_admin),
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ""),
      calls_last_30_days: Number(row.calls_last_30_days ?? 0),
      talk_seconds_last_30_days: Number(row.talk_seconds_last_30_days ?? 0),
    }))
  } catch (e) {
    if (isMissingBillingColumnsError(e)) {
      throw new Error(
        "Admin billing list requires scripts/019-billing-admin-feedback.sql in Neon (adds credit_balance_cents, billing_plan, is_platform_admin)."
      )
    }
    throw e
  }
}

/** Operator drill-down: one account + recent calls (newest first). */
export async function getAdminUserDetail(targetUserId: string): Promise<AdminUserDetail | null> {
  const sql = getSql()
  const callLimit = 40
  try {
    const userRows = await sql`
      SELECT
        u.id,
        u.email,
        u.name,
        u.business_name,
        u.credit_balance_cents,
        u.billing_plan,
        u.is_platform_admin,
        u.created_at,
        coalesce(agg.cnt, 0)::int AS calls_last_30_days,
        coalesce(agg.secs, 0)::bigint AS talk_seconds_last_30_days
      FROM users u
      LEFT JOIN LATERAL (
        SELECT
          count(*)::int AS cnt,
          coalesce(sum(cl.duration_seconds), 0)::bigint AS secs
        FROM call_logs cl
        WHERE cl.user_id = u.id AND cl.created_at > (now() - interval '30 days')
      ) agg ON true
      WHERE u.id = ${targetUserId}
      LIMIT 1
    `
    if (!userRows.length) return null
    const row = userRows[0] as Record<string, unknown>
    const user = {
      id: String(row.id),
      email: String(row.email ?? ""),
      name: String(row.name ?? ""),
      business_name: String(row.business_name ?? ""),
      credit_balance_cents: Number(row.credit_balance_cents ?? 0),
      billing_plan: String(row.billing_plan ?? "trial"),
      is_platform_admin: pgBool(row.is_platform_admin),
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ""),
      calls_last_30_days: Number(row.calls_last_30_days ?? 0),
      talk_seconds_last_30_days: Number(row.talk_seconds_last_30_days ?? 0),
    }

    const [rc] = await sql`
      SELECT count(*)::int AS c FROM receptionists WHERE user_id = ${targetUserId}
    `
    const [pn] = await sql`
      SELECT count(*)::int AS c FROM phone_numbers WHERE user_id = ${targetUserId}
    `
    const callRows = await sql`
      SELECT
        id,
        created_at,
        call_type,
        status,
        duration_seconds,
        from_number,
        to_number,
        caller_name,
        routed_to_name,
        has_recording,
        recording_url
      FROM call_logs
      WHERE user_id = ${targetUserId}
      ORDER BY created_at DESC
      LIMIT ${callLimit}
    `
    const recent_calls = (callRows as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at ?? ""),
      call_type: String(r.call_type ?? "incoming"),
      status: String(r.status ?? ""),
      duration_seconds: Number(r.duration_seconds ?? 0),
      from_number: String(r.from_number ?? ""),
      to_number: String(r.to_number ?? ""),
      caller_name: r.caller_name == null ? null : String(r.caller_name),
      routed_to_name: r.routed_to_name == null ? null : String(r.routed_to_name),
      has_recording: pgBool(r.has_recording),
      recording_url: r.recording_url == null ? null : String(r.recording_url),
    }))

    return {
      user,
      receptionist_count: Number((rc as { c?: number })?.c ?? 0),
      phone_number_count: Number((pn as { c?: number })?.c ?? 0),
      recent_calls,
    }
  } catch (e) {
    if (isMissingBillingColumnsError(e)) {
      throw new Error(
        "Admin user detail requires scripts/019-billing-admin-feedback.sql in Neon (adds credit_balance_cents, billing_plan, is_platform_admin)."
      )
    }
    throw e
  }
}

/** Credit adjustment + ledger row (platform admin). */
export async function adminAdjustUserCreditBalance(params: {
  target_user_id: string
  delta_cents: number
  reason: string
  actor_user_id: string
  reference?: string | null
  meta?: Record<string, unknown>
}): Promise<{ balance_after_cents: number }> {
  const sql = getSql()
  const delta = Math.trunc(params.delta_cents)
  if (!Number.isFinite(delta) || delta === 0) {
    throw new Error("delta_cents must be a non-zero finite integer (cents)")
  }
  const metaJson = JSON.stringify(params.meta ?? {})
  try {
    const rows = await sql`
      UPDATE users
      SET credit_balance_cents = credit_balance_cents + ${delta}
      WHERE id = ${params.target_user_id}
      RETURNING credit_balance_cents
    `
    const row = rows[0] as { credit_balance_cents?: bigint | number } | undefined
    if (!row || row.credit_balance_cents === undefined) {
      throw new Error("User not found or credit column missing (run scripts/019-billing-admin-feedback.sql).")
    }
    const balanceAfter = Number(row.credit_balance_cents)
    await sql`
      INSERT INTO billing_ledger (user_id, delta_cents, balance_after_cents, reason, reference, meta, actor_user_id)
      VALUES (
        ${params.target_user_id},
        ${delta},
        ${balanceAfter},
        ${params.reason},
        ${params.reference ?? null},
        ${metaJson}::jsonb,
        ${params.actor_user_id}
      )
    `
    return { balance_after_cents: balanceAfter }
  } catch (e) {
    if (isMissingBillingColumnsError(e) || isUndefinedRelationError(e, "billing_ledger")) {
      throw new Error(
        "Credit adjustments require scripts/019-billing-admin-feedback.sql in Neon (users balance + billing_ledger)."
      )
    }
    throw e
  }
}

/** Grant or revoke `/admin` access for another user (`019` column). */
export async function adminSetUserPlatformAdminFlag(targetUserId: string, is_platform_admin: boolean): Promise<void> {
  const sql = getSql()
  try {
    await sql`UPDATE users SET is_platform_admin = ${is_platform_admin} WHERE id = ${targetUserId}`
  } catch (e) {
    if (isMissingBillingColumnsError(e)) {
      throw new Error("is_platform_admin requires scripts/019-billing-admin-feedback.sql in Neon.")
    }
    throw e
  }
}

function mapOnboardingProfileRow(row: Record<string, unknown>): OnboardingProfile {
  const method = row.reserved_number_method
  const fallback = row.fallback_type
  return {
    user_id: String(row.user_id),
    reserved_number: row.reserved_number != null ? String(row.reserved_number) : null,
    reserved_number_display:
      row.reserved_number_display != null ? String(row.reserved_number_display) : null,
    reserved_number_method:
      method === "buy" || method === "port" ? method : null,
    port_carrier: row.port_carrier != null ? String(row.port_carrier) : null,
    fallback_type: fallback === "ai" || fallback === "voicemail" ? fallback : null,
    trade_category: row.trade_category != null ? String(row.trade_category) : null,
    opening_line: row.opening_line != null ? String(row.opening_line) : null,
    has_active_subscription: pgBool(row.has_active_subscription),
    billing_cycle_start: row.billing_cycle_start != null ? String(row.billing_cycle_start) : null,
    billing_cycle_end: row.billing_cycle_end != null ? String(row.billing_cycle_end) : null,
    stripe_customer_id: row.stripe_customer_id != null ? String(row.stripe_customer_id) : null,
    stripe_subscription_id: row.stripe_subscription_id != null ? String(row.stripe_subscription_id) : null,
    updated_at: row.updated_at != null ? String(row.updated_at) : new Date().toISOString(),
  }
}

export async function ensureOnboardingProfile(userId: string): Promise<void> {
  const sql = getSql()
  try {
    await sql`
      INSERT INTO onboarding_profiles (user_id, updated_at)
      VALUES (${userId}, now())
      ON CONFLICT (user_id) DO NOTHING
    `
  } catch (e) {
    if (isMissingOnboardingProfilesTableError(e) || isWrongLegacyProfilesTableError(e)) {
      throw new Error(`Onboarding profiles table missing. ${onboardingProfilesMigrationHint()}`)
    }
    throw e
  }
}

export async function getOnboardingProfile(userId: string): Promise<OnboardingProfile | null> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT user_id, reserved_number, reserved_number_display, reserved_number_method,
             port_carrier, fallback_type, trade_category, opening_line,
             has_active_subscription,
             billing_cycle_start, billing_cycle_end,
             stripe_customer_id, stripe_subscription_id,
             updated_at
      FROM onboarding_profiles
      WHERE user_id = ${userId}
      LIMIT 1
    `
    const row = rows[0] as Record<string, unknown> | undefined
    if (!row) return null
    return mapOnboardingProfileRow(row)
  } catch (e) {
    if (isMissingOnboardingProfileColumnError(e)) {
      try {
        const rows = await sql`
          SELECT user_id, reserved_number, reserved_number_display, reserved_number_method,
                 port_carrier, fallback_type, trade_category, opening_line,
                 has_active_subscription, updated_at
          FROM onboarding_profiles
          WHERE user_id = ${userId}
          LIMIT 1
        `
        const row = rows[0] as Record<string, unknown> | undefined
        if (!row) return null
        return mapOnboardingProfileRow(row)
      } catch (inner) {
        if (isMissingOnboardingProfilesTableError(inner) || isWrongLegacyProfilesTableError(inner)) {
          return null
        }
        throw inner
      }
    }
    if (isMissingOnboardingProfilesTableError(e) || isWrongLegacyProfilesTableError(e)) return null
    throw e
  }
}

export async function updateOnboardingProfile(
  userId: string,
  updates: UpdateOnboardingProfileRequest
): Promise<OnboardingProfile> {
  await ensureOnboardingProfile(userId)
  const sql = getSql()
  const existing = await getOnboardingProfile(userId)
  const reserved_number =
    updates.reserved_number !== undefined ? updates.reserved_number : existing?.reserved_number ?? null
  const reserved_number_display =
    updates.reserved_number_display !== undefined
      ? updates.reserved_number_display
      : existing?.reserved_number_display ?? null
  const reserved_number_method =
    updates.reserved_number_method !== undefined
      ? updates.reserved_number_method
      : existing?.reserved_number_method ?? null
  const port_carrier =
    updates.port_carrier !== undefined ? updates.port_carrier : existing?.port_carrier ?? null
  const fallback_type =
    updates.fallback_type !== undefined ? updates.fallback_type : existing?.fallback_type ?? null
  const trade_category =
    updates.trade_category !== undefined ? updates.trade_category : existing?.trade_category ?? null
  const opening_line =
    updates.opening_line !== undefined ? updates.opening_line : existing?.opening_line ?? null
  const has_active_subscription =
    updates.has_active_subscription !== undefined
      ? updates.has_active_subscription
      : existing?.has_active_subscription ?? false
  const billing_cycle_start =
    updates.billing_cycle_start !== undefined
      ? updates.billing_cycle_start
      : existing?.billing_cycle_start ?? null
  const billing_cycle_end =
    updates.billing_cycle_end !== undefined
      ? updates.billing_cycle_end
      : existing?.billing_cycle_end ?? null
  const stripe_customer_id =
    updates.stripe_customer_id !== undefined
      ? updates.stripe_customer_id
      : existing?.stripe_customer_id ?? null
  const stripe_subscription_id =
    updates.stripe_subscription_id !== undefined
      ? updates.stripe_subscription_id
      : existing?.stripe_subscription_id ?? null

  try {
    const rows = await sql`
      INSERT INTO onboarding_profiles (
        user_id, reserved_number, reserved_number_display, reserved_number_method,
        port_carrier, fallback_type, trade_category, opening_line,
        has_active_subscription,
        billing_cycle_start, billing_cycle_end,
        stripe_customer_id, stripe_subscription_id,
        updated_at
      )
      VALUES (
        ${userId}, ${reserved_number}, ${reserved_number_display}, ${reserved_number_method},
        ${port_carrier}, ${fallback_type}, ${trade_category}, ${opening_line},
        ${has_active_subscription},
        ${billing_cycle_start}, ${billing_cycle_end},
        ${stripe_customer_id}, ${stripe_subscription_id},
        now()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        reserved_number = EXCLUDED.reserved_number,
        reserved_number_display = EXCLUDED.reserved_number_display,
        reserved_number_method = EXCLUDED.reserved_number_method,
        port_carrier = EXCLUDED.port_carrier,
        fallback_type = EXCLUDED.fallback_type,
        trade_category = EXCLUDED.trade_category,
        opening_line = EXCLUDED.opening_line,
        has_active_subscription = EXCLUDED.has_active_subscription,
        billing_cycle_start = EXCLUDED.billing_cycle_start,
        billing_cycle_end = EXCLUDED.billing_cycle_end,
        stripe_customer_id = EXCLUDED.stripe_customer_id,
        stripe_subscription_id = EXCLUDED.stripe_subscription_id,
        updated_at = now()
      RETURNING user_id, reserved_number, reserved_number_display, reserved_number_method,
                port_carrier, fallback_type, trade_category, opening_line,
                has_active_subscription,
                billing_cycle_start, billing_cycle_end,
                stripe_customer_id, stripe_subscription_id,
                updated_at
    `
    return mapOnboardingProfileRow(rows[0] as Record<string, unknown>)
  } catch (e) {
    if (isMissingOnboardingProfileColumnError(e)) {
      const rows = await sql`
        INSERT INTO onboarding_profiles (
          user_id, reserved_number, reserved_number_display, reserved_number_method,
          port_carrier, fallback_type, trade_category, opening_line,
          has_active_subscription, updated_at
        )
        VALUES (
          ${userId}, ${reserved_number}, ${reserved_number_display}, ${reserved_number_method},
          ${port_carrier}, ${fallback_type}, ${trade_category}, ${opening_line},
          ${has_active_subscription}, now()
        )
        ON CONFLICT (user_id) DO UPDATE SET
          reserved_number = EXCLUDED.reserved_number,
          reserved_number_display = EXCLUDED.reserved_number_display,
          reserved_number_method = EXCLUDED.reserved_number_method,
          port_carrier = EXCLUDED.port_carrier,
          fallback_type = EXCLUDED.fallback_type,
          trade_category = EXCLUDED.trade_category,
          opening_line = EXCLUDED.opening_line,
          has_active_subscription = EXCLUDED.has_active_subscription,
          updated_at = now()
        RETURNING user_id, reserved_number, reserved_number_display, reserved_number_method,
                  port_carrier, fallback_type, trade_category, opening_line,
                  has_active_subscription, updated_at
      `
      return mapOnboardingProfileRow(rows[0] as Record<string, unknown>)
    }
    if (isMissingOnboardingProfilesTableError(e) || isWrongLegacyProfilesTableError(e)) {
      throw new Error(`Onboarding profiles table missing. ${onboardingProfilesMigrationHint()}`)
    }
    throw e
  }
}

function inferOnboardingLineType(e164: string): "local" | "toll-free" {
  const digits = e164.replace(/\D/g, "")
  const area = digits.length >= 10 ? digits.slice(-10, -7) : ""
  if (/^8[08]/.test(area)) return "toll-free"
  return "local"
}

/** Create a `phone_numbers` row from onboarding checkout so the dashboard shows the reserved line. */
export async function syncOnboardingLineToPhoneNumbers(
  userId: string,
  profile: Pick<
    OnboardingProfile,
    "reserved_number" | "reserved_number_display" | "reserved_number_method" | "has_active_subscription"
  >
): Promise<PhoneNumber | null> {
  const e164 = profile.reserved_number?.trim()
  if (!e164) return null

  const normalized = normalizePhoneNumberE164(e164)
  const existing = await getPhoneNumbers(userId)
  const match = existing.find((row) => normalizePhoneNumberE164(row.number) === normalized)
  if (match) return match

  const friendly = profile.reserved_number_display?.trim() || e164
  const lineType = inferOnboardingLineType(normalized)
  const status: "active" | "porting" = profile.reserved_number_method === "port" ? "porting" : "active"

  return insertPhoneNumber({
    user_id: userId,
    number: normalized,
    friendly_name: friendly,
    label: "Business Line",
    type: lineType,
    status,
  })
}

/** Buy the reserved DID on Telnyx (buy flow) and upsert `phone_numbers` with the order id. */
async function deleteUnprovisionedPhoneNumberPlaceholders(userId: string, keepId: string): Promise<void> {
  const sql = getSql()
  try {
    await sql`
      DELETE FROM phone_numbers
      WHERE user_id = ${userId}
        AND id <> ${keepId}
        AND (provider_number_sid IS NULL OR provider_number_sid = '')
    `
  } catch (e) {
    console.error("[deleteUnprovisionedPhoneNumberPlaceholders]", e)
  }
}

export async function provisionOnboardingBuyLine(
  userId: string,
  profile: Pick<
    OnboardingProfile,
    "reserved_number" | "reserved_number_display" | "reserved_number_method" | "has_active_subscription"
  >
): Promise<PhoneNumber> {
  if (profile.reserved_number_method === "port") {
    const row = await syncOnboardingLineToPhoneNumbers(userId, profile)
    if (!row) throw new Error("Could not save porting line.")
    return row
  }

  const e164 = profile.reserved_number?.trim()
  if (!e164) throw new Error("No business number to provision.")

  const normalized = normalizePhoneNumberE164(e164)
  const existing = await getPhoneNumbers(userId)
  const row = existing.find((r) => normalizePhoneNumberE164(r.number) === normalized)
  if (row?.provider_number_sid?.trim()) {
    return row
  }

  if (isOnboardingTelnyxSimulationMode()) {
    const synced = await syncOnboardingLineToPhoneNumbers(userId, profile)
    if (!synced) throw new Error("Could not save reserved line for dashboard preview.")
    return synced
  }

  const purchase = await runOnboardingTelnyxProvisionPlaceholder(normalized)
  if (!purchase.purchased) {
    if (purchase.mode === "simulation") {
      const synced = await syncOnboardingLineToPhoneNumbers(userId, profile)
      if (!synced) throw new Error("Could not save reserved line.")
      return synced
    }
    throw new Error("error" in purchase ? purchase.error : "Telnyx purchase failed.")
  }

  const user = await getUser(userId)
  const label = user?.business_name?.trim() || "Business Line"
  const friendly = profile.reserved_number_display?.trim() || purchase.phone_number

  if (row) {
    await updatePhoneNumber(row.id, userId, {
      provider_number_sid: purchase.order_id,
      status: "active",
    })
    const updated = await getPhoneNumbers(userId)
    const found = updated.find((r) => r.id === row.id)
    if (found) {
      await deleteUnprovisionedPhoneNumberPlaceholders(userId, found.id)
      return found
    }
  }

  const saved = await insertPhoneNumber({
    user_id: userId,
    number: purchase.phone_number,
    friendly_name: friendly,
    label,
    type: inferOnboardingLineType(purchase.phone_number),
    status: "active",
    provider_number_sid: purchase.order_id,
  })
  await deleteUnprovisionedPhoneNumberPlaceholders(userId, saved.id)
  return saved
}

/** If checkout saved a buy line but Telnyx purchase never ran, try once (non-fatal for GET). */
export async function retryProvisionOnboardingBuyLine(userId: string): Promise<void> {
  if (isOnboardingTelnyxSimulationMode()) return
  const profile = await getOnboardingProfile(userId)
  if (!profile?.has_active_subscription || !profile.reserved_number?.trim()) return
  if (profile.reserved_number_method === "port") return

  const normalized = normalizePhoneNumberE164(profile.reserved_number)
  const existing = await getPhoneNumbers(userId)
  const row =
    existing.find((r) => normalizePhoneNumberE164(r.number) === normalized) ??
    existing.find((r) => !r.provider_number_sid?.trim())
  if (row?.provider_number_sid?.trim()) return

  try {
    await provisionOnboardingBuyLine(userId, profile)
  } catch (e) {
    console.error("[retryProvisionOnboardingBuyLine]", userId, e)
  }
}

/** Backfill `phone_numbers` when checkout finished but the line row was never created (older deploys). */
export async function ensureOnboardingLineFromProfile(userId: string): Promise<PhoneNumber | null> {
  const profile = await getOnboardingProfile(userId)
  if (!profile?.reserved_number?.trim()) return null

  const normalized = normalizePhoneNumberE164(profile.reserved_number)
  const existing = await getPhoneNumbers(userId)
  const match = existing.find((row) => normalizePhoneNumberE164(row.number) === normalized)
  if (match) return match

  // One unprovisioned placeholder from an older sync — update to match onboarding profile.
  const unprovisioned = existing.filter((row) => !row.provider_number_sid?.trim())
  if (unprovisioned.length === 1 && existing.length === 1) {
    const row = unprovisioned[0]!
    if (normalizePhoneNumberE164(row.number) !== normalized) {
      const sql = getSql()
      const friendly = profile.reserved_number_display?.trim() || normalized
      await sql`
        UPDATE phone_numbers
        SET number = ${normalized}, friendly_name = ${friendly}, type = ${inferOnboardingLineType(normalized)}
        WHERE id = ${row.id} AND user_id = ${userId}
      `
      const updated = await getPhoneNumbers(userId)
      return updated.find((r) => r.id === row.id) ?? null
    }
    return row
  }

  return syncOnboardingLineToPhoneNumbers(userId, profile)
}

/** After mock/real checkout — also sync greeting into default routing_config when present. */
export async function completeOnboardingCheckout(
  userId: string,
  opts?: UpdateOnboardingProfileRequest & {
    opening_line?: string
    fallback_type?: "ai" | "voicemail"
  }
): Promise<OnboardingProfile> {
  const { opening_line, fallback_type, ...profileFields } = opts ?? {}
  const profile = await updateOnboardingProfile(userId, {
    ...profileFields,
    ...(opening_line !== undefined ? { opening_line } : {}),
    ...(fallback_type !== undefined ? { fallback_type } : {}),
  })
  try {
    if (profile.reserved_number?.trim()) {
      await syncOnboardingLineToPhoneNumbers(userId, profile)
    }
  } catch (e) {
    console.error("[completeOnboardingCheckout] sync sandbox line:", e)
  }
  const greeting = opening_line?.trim()
  const fb = fallback_type
  if (greeting || fb) {
    try {
      await updateRoutingConfig(userId, {
        ...(greeting ? { ai_greeting: greeting } : {}),
        ...(fb ? { fallback_type: fb } : {}),
      })
    } catch {
      /* routing_config may not exist yet — non-fatal */
    }
  }
  return profile
}

// Get talk time analytics for a date range
export async function getAgentTalkTime(
  userId: string,
  startDate: string,
  endDate: string
): Promise<
  {
    receptionist_id: string
    receptionist_name: string
    rate_per_minute: number
    total_seconds: number
    total_calls: number
    daily: { date: string; seconds: number }[]
  }[]
> {
  throw new Error("Not implemented - connect your database")
}
