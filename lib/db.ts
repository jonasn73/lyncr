// ============================================
// lyncr - Database Client
// ============================================
// Uses Neon serverless when DATABASE_URL is set (production / live app).
// Set DATABASE_URL in Vercel → Settings → Environment Variables, then run
// scripts/001-create-schema.sql and scripts/002-add-password-hash.sql in your Neon SQL Editor.

import { neon } from "@neondatabase/serverless"
import { unstable_cache, revalidateTag } from "next/cache"
import {
  neighborhoodFromLocation,
  CRM_LEAD_STATUS,
  LOST_LEAD_STATUS,
  UNASSIGNED_CALLBACK_STATUS,
  UNASSIGNED_POOL_STATUS,
} from "@/lib/job-pool"
import { dispatchJobTypeFromServiceQuoteTypeId } from "@/lib/job-intake-fields"
import { calculateServiceQuote } from "@/lib/service-quote-calculator"
import { buildIntakePricingMetadata, getOwnerServiceRateCard, type ServiceQuoteTypeId } from "@/lib/service-rate-card"
import { localDayRangeIso } from "@/lib/scheduler-utils"
import { parseAdminNotificationPreferences } from "@/lib/admin-notification-preferences"
import { sanitizeIanaTimezone } from "@/lib/telemetry-timezone"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { formatAdminRoutingOverridePhoneForTelnyx, resolveScopedAdminRoutingOverrideE164 } from "@/lib/phone-e164"
import { SITE_NAME } from "@/lib/brand"
import { lineMatchesOwnerCell } from "@/lib/owner-cell-line-filter"
import { parseRoutingPoolMode, parseSkillsArray, normalizeRoutingPoolSkillTag, routingSkillTagFromCertCode } from "@/lib/routing-pool-skills"
import type {
  CompanyBriefing,
  RoutingConfig,
  RoutingStrategy,
  Receptionist,
  User,
  AdminNotificationPreferences,
  MasterToggleMode,
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
  LyncrAdminDirectoryRow,
  LyncrAdminMetrics,
  AdminUserOverrideResult,
  ReceptionistPayoutMetrics,
  TeamInvite,
  TeamInvitePreview,
  Certification,
  CertificationModuleData,
  CertificationLesson,
  CertificationQuizQuestion,
  ReceptionistBadge,
  ReceptionistBadgeStatus,
  Messaging10DlcRegistration,
  TenDlcStatus,
  FieldTechnician,
  DispatchJob,
  TechLiveLocation,
  InvoiceLineItem,
  JobInvoice,
  OwnerSmsSettings,
  LeadDispatchContext,
  AdminLiveCall,
  AdminCallHistoryRow,
  OperatorPayoutRow,
  Organization,
  PortingOrder,
  PortingOrderStatus,
  SmsRegistration,
  SmsRegistrationOrgStatus,
  SmsRegistrationStatus,
  SmsMessage,
} from "./types"
import { isAccountRoutingBlocked, parseAccountStatus } from "./account-status"
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

/** Missing scoped admin override columns (scripts/073). */
function isMissingPhoneLineAdminOverrideColumnError(e: unknown): boolean {
  if (pgErrorCode(e) !== "42703") return false
  const msg = pgErrorMessage(e).toLowerCase()
  return msg.includes("admin_routing_override_phone")
}


/** Missing optional onboarding_profiles column (e.g. before scripts/027). */
function isMissingOnboardingProfileColumnError(e: unknown): boolean {
  if (pgErrorCode(e) !== "42703") return false
  const msg = pgErrorMessage(e)
  return (
    msg.includes("billing_cycle") ||
    msg.includes("stripe_customer") ||
    msg.includes("stripe_subscription") ||
    msg.includes("has_billing_method") ||
    msg.includes("subscription_tier") ||
    msg.includes("carrier_credit") ||
    msg.includes("low_balance_notified") ||
    msg.includes("total_calls_routed") ||
    msg.includes("total_minutes_used") ||
    msg.includes("account_status") ||
    msg.includes("custom_routing_note") ||
    msg.includes("sms_leads_enabled") ||
    msg.includes("notification_phone") ||
    msg.includes("dispatch_sms_phone") ||
    msg.includes("admin_routing_override_phone")
  )
}

/** Missing SMS alert columns (scripts/044–045). */
function isMissingSmsNotificationColumnError(e: unknown): boolean {
  if (pgErrorCode(e) !== "42703") return false
  const msg = pgErrorMessage(e)
  return (
    msg.includes("sms_leads_enabled") ||
    msg.includes("notification_phone") ||
    msg.includes("dispatch_sms_phone")
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

// Lazy Neon client so we only connect when DATABASE_URL is set (prefers pooled endpoint).
let cachedSql: ReturnType<typeof neon> | null = null
function getSql(): ReturnType<typeof neon> {
  if (cachedSql) return cachedSql
  const url = resolveNeonDatabaseUrl()
  cachedSql = neon(url)
  return cachedSql
}

/** Warm the Neon HTTP driver on cold start (voice webhooks call this at module load). */
export async function warmDatabasePool(): Promise<void> {
  try {
    const sql = getSql()
    await sql`SELECT 1 AS ok`
  } catch (e) {
    console.warn("[db] warmDatabasePool failed:", e)
  }
}

// --- Query functions ---

/** Postgres / Neon usually returns boolean; normalize edge encodings. */
function pgBool(v: unknown): boolean {
  return v === true || v === "t" || v === "true" || v === 1
}

/** TIMESTAMPTZ from Neon may be a JS Date — always store/read ISO-8601, never Date.toString(). */
function pgTimestamptzToIso(value: unknown): string | null {
  if (value == null) return null
  if (value instanceof Date) return value.toISOString()
  const s = String(value).trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s
  const ms = Date.parse(s)
  if (Number.isFinite(ms)) return new Date(ms).toISOString()
  return s
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

/** True when `users.master_toggle_mode` is missing (run scripts/079-master-toggle-mode.sql). */
function isMissingMasterToggleModeColumnError(e: unknown): boolean {
  return pgErrorCode(e) === "42703" && pgErrorMessage(e).includes("master_toggle_mode")
}

function parseMasterToggleMode(raw: unknown): MasterToggleMode {
  const v = String(raw ?? "admin")
  if (v === "tech" || v === "passive") return v
  return "admin"
}

/** True when `users.admin_notification_preferences` is missing (run scripts/080-admin-notification-preferences.sql). */
function isMissingAdminNotificationPreferencesColumnError(e: unknown): boolean {
  return pgErrorCode(e) === "42703" && pgErrorMessage(e).includes("admin_notification_preferences")
}

/** True when `routing_config.inbound_caller_greeting_enabled` is missing (run scripts/081-inbound-caller-greeting-enabled.sql). */
function isMissingInboundCallerGreetingColumnError(e: unknown): boolean {
  return pgErrorCode(e) === "42703" && pgErrorMessage(e).includes("inbound_caller_greeting_enabled")
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
    industry_tag: row.industry_tag != null && String(row.industry_tag).trim() !== "" ? String(row.industry_tag).trim() : null,
    // `048`/`049` columns — default safely when the SELECT omits them or the migration hasn't run.
    routing_strategy: normalizeRoutingStrategy(row.routing_strategy),
    allow_lyncr_network_fallback: pgBool(row.allow_lyncr_network_fallback),
    private_ring_timeout_seconds: Number(row.private_ring_timeout_seconds ?? 15),
    inbound_caller_greeting_enabled:
      row.inbound_caller_greeting_enabled != null ? pgBool(row.inbound_caller_greeting_enabled) : true,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  }
}

/** Coerce a raw routing_strategy value to a known enum; defaults to `private_only` to protect existing routes. */
function normalizeRoutingStrategy(raw: unknown): RoutingStrategy {
  const s = raw != null ? String(raw).trim().toLowerCase() : ""
  if (s === "lyncr_only" || s === "hybrid_fallback" || s === "private_only") return s
  return "private_only"
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
  /** Per-line caller greeting before cell forward (`081`, default true). */
  inbound_caller_greeting_enabled: boolean
  receptionist_name: string | null
  receptionist_phone: string | null
  /** Where the selected receptionist answers: 'WEB' (Telnyx WebRTC/SIP) or 'CELL' (PSTN). Defaults 'CELL'. */
  receptionist_routing_endpoint: "WEB" | "CELL"
  /** SIP username for WEB routing (built into `sip:<user>@<domain>`). NULL = not provisioned → PSTN fallback. */
  receptionist_sip_username: string | null
  /** `phone_numbers.label` — shown to receptionist in whisper / UI (e.g. "Key Squad 502"). */
  phone_line_label: string
  /** `phone_numbers.friendly_name` — display form of the DID. */
  phone_line_friendly_name: string
  /** onboarding_profiles.account_status — suspended blocks routing (034). */
  account_status: string
  /** Active lines on account — avoids extra `getPhoneNumbers` on inbound hot path. */
  active_phone_count: number
  /** First active DID — PSTN caller-id when account has multiple lines. */
  primary_phone_number: string
  /** Platform-admin PSTN override — bypasses owner/receptionist/pool when set (072). */
  admin_routing_override_phone: string | null
  /** Workspace display name (`organizations.name`) for branded greeting + dispatch SMS. */
  organization_name: string
}

// L1: in-memory per serverless instance. L2: Vercel Data Cache (unstable_cache) shared across instances.
type IncomingRoutingByNumber = IncomingRoutingRow | null

const incomingRoutingCache = new Map<string, { expiresAt: number; value: IncomingRoutingByNumber }>()
const INCOMING_ROUTING_CACHE_TTL_MS = 3_600_000
/** Vercel Data Cache tag — shared across serverless instances (unlike the in-memory Map below). */
const INCOMING_ROUTING_DATA_TAG = "incoming-routing"
/** Snapshot-only cache tag (voice hot path). */
const INBOUND_SNAPSHOT_DATA_TAG = "inbound-snapshot"

/** Hot-path cache: suspended DIDs reject instantly on this instance (admin override primes it). */
const blockedInboundStatusCache = new Map<
  string,
  { expiresAt: number; account_status: string; user_id: string }
>()
const BLOCKED_INBOUND_STATUS_CACHE_TTL_MS = 120_000

function primeBlockedInboundStatusForUser(userId: string, accountStatus: string, phoneNumbers: string[]): void {
  const expiresAt = Date.now() + BLOCKED_INBOUND_STATUS_CACHE_TTL_MS
  for (const num of phoneNumbers) {
    const key = phoneDigitsKey(num)
    if (key.length >= 10) {
      blockedInboundStatusCache.set(key, { expiresAt, account_status: accountStatus, user_id: userId })
    }
  }
}

/** Clear cached routing so voice webhooks see updated fallback_type immediately after dashboard saves. */
export function clearIncomingRoutingCache(): void {
  incomingRoutingCache.clear()
  try {
    // Next.js 16: revalidateTag requires a cache-life profile. { expire: 0 } forces immediate
    // expiry so voice webhooks read fresh routing right away (read-your-own-writes after a save).
    revalidateTag(INCOMING_ROUTING_DATA_TAG, { expire: 0 })
    revalidateTag(INBOUND_SNAPSHOT_DATA_TAG, { expire: 0 })
  } catch {
    // revalidateTag requires a server request context — safe to ignore during tests
  }
}

function revalidateIncomingRoutingDataCache(normalized: string): void {
  try {
    // { expire: 0 } = immediate expiry (Next.js 16 requires the second argument).
    revalidateTag(INCOMING_ROUTING_DATA_TAG, { expire: 0 })
    revalidateTag(`incoming-routing-${normalized}`, { expire: 0 })
    revalidateTag(INBOUND_SNAPSHOT_DATA_TAG, { expire: 0 })
    revalidateTag(`inbound-snapshot-${normalized}`, { expire: 0 })
  } catch {
    // ignore outside request context
  }
}

function storeIncomingRoutingInMemory(normalized: string, value: IncomingRoutingByNumber): void {
  incomingRoutingCache.set(normalized, {
    expiresAt: Date.now() + INCOMING_ROUTING_CACHE_TTL_MS,
    value,
  })
}

/** Warm inbound routing cache after dashboard saves (fire-and-forget). */
export async function primeIncomingRoutingCache(toNumber: string): Promise<void> {
  await syncInboundDialSnapshotForNumber(toNumber)
}

export async function primeIncomingRoutingCacheForUser(userId: string): Promise<void> {
  await syncInboundDialSnapshotForUser(userId)
}

/** Sync peek — blocked DIDs rejected on pass 1 without a DB round trip. */
export function peekBlockedInboundStatusForNumber(toNumber: string): string | null {
  const key = phoneDigitsKey(toNumber)
  if (key.length < 10) return null
  const hit = blockedInboundStatusCache.get(key)
  if (hit && hit.expiresAt > Date.now()) return hit.account_status
  return null
}

/** Sync peek — warm routing cache (used to skip pass-2 redirect when fresh). */
export function peekIncomingRoutingCache(toNumber: string): IncomingRoutingRow | null {
  const normalized = normalizePhoneNumberE164(toNumber)
  if (!normalized) return null
  const cached = incomingRoutingCache.get(normalized)
  if (cached && cached.expiresAt > Date.now() && cached.value) return cached.value
  return null
}

/** Minimal snapshot read — indexed match on business DID (exact E.164 or last-10 digits). */
async function fetchInboundDialSnapshotSql(
  normalized: string,
  digitKey: string
): Promise<IncomingRoutingRow | null> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT
        pn.user_id,
        pn.number AS primary_phone_number,
        pn.inbound_dial_e164 AS receptionist_phone,
        pn.inbound_receptionist_id AS selected_receptionist_id,
        pn.inbound_receptionist_name AS receptionist_name,
        COALESCE(pn.inbound_fallback_type, 'owner') AS fallback_type,
        COALESCE(pn.inbound_ring_timeout_seconds, 30) AS ring_timeout_seconds,
        COALESCE(pn.inbound_ai_ring_owner_first, false) AS ai_ring_owner_first,
        COALESCE(pn.inbound_caller_greeting_enabled, true) AS inbound_caller_greeting_enabled,
        COALESCE(pn.inbound_account_status, 'active') AS account_status,
        COALESCE(
          NULLIF(trim(pn.admin_routing_override_phone), ''),
          NULLIF(trim(org.admin_routing_override_phone), '')
        ) AS admin_routing_override_phone,
        COALESCE(NULLIF(trim(org.name), ''), '') AS organization_name,
        -- to_jsonb(pn)->>'col' reads a column that may not exist yet (pre-050) without erroring.
        to_jsonb(pn) ->> 'inbound_routing_endpoint' AS inbound_routing_endpoint,
        to_jsonb(pn) ->> 'inbound_sip_username' AS inbound_sip_username
      FROM phone_numbers pn
      LEFT JOIN organizations org ON org.id = pn.organization_id
      LEFT JOIN onboarding_profiles op ON op.user_id = pn.user_id
      WHERE pn.status = 'active'
        AND (
          pn.number = ${normalized}
          OR regexp_replace(pn.number, '\\D', '', 'g') = ${digitKey}
          OR (
            length(${digitKey}) >= 10
            AND length(regexp_replace(pn.number, '\\D', '', 'g')) >= 10
            AND right(regexp_replace(pn.number, '\\D', '', 'g'), 10) = right(${digitKey}, 10)
          )
        )
        AND pn.inbound_routing_updated_at IS NOT NULL
        AND NULLIF(trim(pn.inbound_dial_e164), '') IS NOT NULL
      LIMIT 1
    `
    if (!rows[0]) return null
    const row = rows[0] as Record<string, unknown>
    const dialE164 = row.receptionist_phone ? String(row.receptionist_phone).trim() : ""
    const recvId = row.selected_receptionist_id ? String(row.selected_receptionist_id) : null
    return {
      user_id: String(row.user_id),
      user_name: "",
      business_name: "My Business",
      inbound_receptionist_whisper_enabled: true,
      owner_phone: recvId ? "" : dialE164,
      selected_receptionist_id: recvId,
      fallback_type: (row.fallback_type as RoutingConfig["fallback_type"]) || "owner",
      ring_timeout_seconds: Number(row.ring_timeout_seconds ?? 30),
      ai_ring_owner_first: row.ai_ring_owner_first === true || row.ai_ring_owner_first === "t",
      receptionist_name: row.receptionist_name ? String(row.receptionist_name) : null,
      receptionist_phone: recvId ? dialE164 : dialE164,
      // Endpoint mirror from the snapshot; unknown/missing → safe 'CELL' (PSTN) default.
      receptionist_routing_endpoint:
        String(row.inbound_routing_endpoint ?? "").toUpperCase() === "WEB" ? "WEB" : "CELL",
      receptionist_sip_username: row.inbound_sip_username ? String(row.inbound_sip_username) : null,
      phone_line_label: "Main Line",
      phone_line_friendly_name: "",
      account_status: row.account_status != null ? String(row.account_status) : "active",
      active_phone_count: 1,
      primary_phone_number: row.primary_phone_number != null ? String(row.primary_phone_number) : normalized,
      admin_routing_override_phone:
        row.admin_routing_override_phone != null ? String(row.admin_routing_override_phone) : null,
      organization_name: row.organization_name != null ? String(row.organization_name) : "",
      inbound_caller_greeting_enabled:
        row.inbound_caller_greeting_enabled != null ? pgBool(row.inbound_caller_greeting_enabled) : true,
    }
  } catch (e) {
    if (isMissingInboundDialSnapshotColumnError(e)) return null
    if (pgErrorCode(e) === "42703" && pgErrorMessage(e).includes("admin_routing_override_phone")) {
      try {
        const rows = await sql`
          SELECT
            pn.user_id,
            pn.number AS primary_phone_number,
            pn.inbound_dial_e164 AS receptionist_phone,
            pn.inbound_receptionist_id AS selected_receptionist_id,
            pn.inbound_receptionist_name AS receptionist_name,
            COALESCE(pn.inbound_fallback_type, 'owner') AS fallback_type,
            COALESCE(pn.inbound_ring_timeout_seconds, 30) AS ring_timeout_seconds,
            COALESCE(pn.inbound_ai_ring_owner_first, false) AS ai_ring_owner_first,
            COALESCE(pn.inbound_account_status, 'active') AS account_status,
            to_jsonb(pn) ->> 'inbound_routing_endpoint' AS inbound_routing_endpoint,
            to_jsonb(pn) ->> 'inbound_sip_username' AS inbound_sip_username
          FROM phone_numbers pn
          WHERE pn.status = 'active'
            AND (
              pn.number = ${normalized}
              OR regexp_replace(pn.number, '\\D', '', 'g') = ${digitKey}
              OR (
                length(${digitKey}) >= 10
                AND length(regexp_replace(pn.number, '\\D', '', 'g')) >= 10
                AND right(regexp_replace(pn.number, '\\D', '', 'g'), 10) = right(${digitKey}, 10)
              )
            )
            AND pn.inbound_routing_updated_at IS NOT NULL
            AND NULLIF(trim(pn.inbound_dial_e164), '') IS NOT NULL
          LIMIT 1
        `
        if (!rows[0]) return null
        const row = rows[0] as Record<string, unknown>
        const dialE164 = row.receptionist_phone ? String(row.receptionist_phone).trim() : ""
        const recvId = row.selected_receptionist_id ? String(row.selected_receptionist_id) : null
        return {
          user_id: String(row.user_id),
          user_name: "",
          business_name: "My Business",
          inbound_receptionist_whisper_enabled: true,
          owner_phone: recvId ? "" : dialE164,
          selected_receptionist_id: recvId,
          fallback_type: (row.fallback_type as RoutingConfig["fallback_type"]) || "owner",
          ring_timeout_seconds: Number(row.ring_timeout_seconds ?? 30),
          ai_ring_owner_first: row.ai_ring_owner_first === true || row.ai_ring_owner_first === "t",
          receptionist_name: row.receptionist_name ? String(row.receptionist_name) : null,
          receptionist_phone: recvId ? dialE164 : dialE164,
          receptionist_routing_endpoint:
            String(row.inbound_routing_endpoint ?? "").toUpperCase() === "WEB" ? "WEB" : "CELL",
          receptionist_sip_username: row.inbound_sip_username ? String(row.inbound_sip_username) : null,
          phone_line_label: "Main Line",
          phone_line_friendly_name: "",
          account_status: row.account_status != null ? String(row.account_status) : "active",
          active_phone_count: 1,
          primary_phone_number: row.primary_phone_number != null ? String(row.primary_phone_number) : normalized,
          admin_routing_override_phone: null,
          organization_name: "",
          inbound_caller_greeting_enabled:
            row.inbound_caller_greeting_enabled != null ? pgBool(row.inbound_caller_greeting_enabled) : true,
        }
      } catch (inner) {
        if (isMissingInboundDialSnapshotColumnError(inner)) return null
        throw inner
      }
    }
    throw e
  }
}

function getInboundSnapshotFromDataCache(
  normalized: string,
  digitKey: string
): Promise<IncomingRoutingRow | null> {
  const run = unstable_cache(
    async () => fetchInboundDialSnapshotSql(normalized, digitKey),
    ["inbound-snapshot-v3", normalized, digitKey],
    {
      revalidate: 300,
      tags: [INBOUND_SNAPSHOT_DATA_TAG, `inbound-snapshot-${normalized}`],
    }
  )
  return run()
}

/**
 * Voice webhook routing — in-memory (0ms) → direct indexed snapshot on pooled Neon → full joins.
 * Skips unstable_cache here so Telnyx webhooks never wait on Next.js Data Cache I/O.
 */
export async function getIncomingRoutingForVoiceWebhook(
  toNumber: string
): Promise<IncomingRoutingByNumber> {
  const normalized = normalizePhoneNumberE164(toNumber)
  if (!normalized) return null
  const digitKey = phoneDigitsKey(toNumber)

  const mem = incomingRoutingCache.get(normalized)
  if (mem && mem.expiresAt > Date.now()) return mem.value

  const snap = await fetchInboundDialSnapshotSql(normalized, digitKey)
  if (snap) {
    storeIncomingRoutingInMemory(normalized, snap)
    return snap
  }

  return fetchIncomingRoutingByNumberFromDb(normalized, digitKey)
}

/** Resolve inbound routing: active phone_numbers row first, then onboarding_profiles.reserved_number. */
async function resolveIncomingRoutingFromDb(
  normalized: string,
  digitKey: string
): Promise<IncomingRoutingByNumber> {
  const fromPhone = await fetchIncomingRoutingFullFromDb(normalized, digitKey)
  if (fromPhone) return fromPhone
  return fetchIncomingRoutingByReservedNumberFromDb(normalized, digitKey)
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
  try {
    const rows = await sql`
      SELECT id, user_id, business_number, selected_receptionist_id, fallback_type, ai_greeting, ring_timeout_seconds, ai_ring_owner_first, routing_strategy, allow_lyncr_network_fallback, private_ring_timeout_seconds, inbound_caller_greeting_enabled, updated_at
      FROM routing_config WHERE user_id = ${userId} AND business_number IS NULL LIMIT 1
    `
    return rows[0] ? parseRoutingRow(rows[0]) : null
  } catch (e) {
    if (isMissingInboundCallerGreetingColumnError(e)) {
      const rows = await sql`
        SELECT id, user_id, business_number, selected_receptionist_id, fallback_type, ai_greeting, ring_timeout_seconds, ai_ring_owner_first, routing_strategy, allow_lyncr_network_fallback, private_ring_timeout_seconds, updated_at
        FROM routing_config WHERE user_id = ${userId} AND business_number IS NULL LIMIT 1
      `
      return rows[0] ? parseRoutingRow(rows[0]) : null
    }
    if (!isMissingHybridNetworkColumnError(e)) throw e
    // Pre-048/049 schema: read without the hybrid columns (parseRoutingRow defaults them).
    const rows = await sql`
      SELECT id, user_id, business_number, selected_receptionist_id, fallback_type, ai_greeting, ring_timeout_seconds, ai_ring_owner_first, updated_at
      FROM routing_config WHERE user_id = ${userId} AND business_number IS NULL LIMIT 1
    `
    return rows[0] ? parseRoutingRow(rows[0]) : null
  }
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
    inbound_caller_greeting_enabled:
      cfg.inbound_caller_greeting_enabled ?? def?.inbound_caller_greeting_enabled ?? true,
  }
}

// Get routing config for a specific business number, falling back to the default config
export async function getRoutingConfigForNumber(userId: string, businessNumber: string): Promise<RoutingConfig | null> {
  const sql = getSql()
  const digitKey = phoneDigitsKey(businessNumber)
  const normalizedBn = normalizePhoneNumberE164(businessNumber)
  // Exact match first (fast path); prefer newest row if duplicates exist.
  let specificExact: Record<string, unknown>[]
  try {
    specificExact = await sql`
      SELECT id, user_id, business_number, selected_receptionist_id, fallback_type, ai_greeting, ring_timeout_seconds, ai_ring_owner_first, inbound_caller_greeting_enabled, updated_at
      FROM routing_config
      WHERE user_id = ${userId}
        AND (business_number = ${businessNumber} OR business_number = ${normalizedBn})
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1
    `
  } catch (e) {
    if (!isMissingInboundCallerGreetingColumnError(e)) throw e
    specificExact = await sql`
      SELECT id, user_id, business_number, selected_receptionist_id, fallback_type, ai_greeting, ring_timeout_seconds, ai_ring_owner_first, updated_at
      FROM routing_config
      WHERE user_id = ${userId}
        AND (business_number = ${businessNumber} OR business_number = ${normalizedBn})
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1
    `
  }
  if (specificExact[0]) return mergePerNumberRoutingFromDefault(userId, parseRoutingRow(specificExact[0]))
  if (digitKey.length < 10) return getRoutingConfig(userId)
  // Digit match: per-number rows saved as a different string shape than TeXML sends (+1 vs 10-digit US).
  let specificLoose: Record<string, unknown>[]
  try {
    specificLoose = await sql`
      SELECT id, user_id, business_number, selected_receptionist_id, fallback_type, ai_greeting, ring_timeout_seconds, ai_ring_owner_first, inbound_caller_greeting_enabled, updated_at
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
  } catch (e) {
    if (!isMissingInboundCallerGreetingColumnError(e)) throw e
    specificLoose = await sql`
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
  }
  if (specificLoose[0]) return mergePerNumberRoutingFromDefault(userId, parseRoutingRow(specificLoose[0]))
  return getRoutingConfig(userId)
}

/**
 * Read just the `048` hybrid-network strategy for a line (per-number override, then account default).
 * Fully defensive: returns `private_only` / `false` when the migration hasn't run or the row is missing,
 * so the routing engine never throws on a pre-048 database.
 */
export async function getLineHybridRoutingStrategy(
  userId: string,
  businessNumber: string | null | undefined
): Promise<{ routing_strategy: RoutingStrategy; allow_lyncr_network_fallback: boolean; private_ring_timeout_seconds: number }> {
  const fallback = {
    routing_strategy: "private_only" as RoutingStrategy,
    allow_lyncr_network_fallback: false,
    private_ring_timeout_seconds: 15,
  }
  if (!userId?.trim()) return fallback
  const sql = getSql()
  try {
    const bn = businessNumber ? normalizePhoneNumberE164(businessNumber) : ""
    if (bn) {
      const perNumber = await sql`
        SELECT routing_strategy, allow_lyncr_network_fallback, private_ring_timeout_seconds
        FROM routing_config
        WHERE user_id = ${userId} AND business_number = ${bn}
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 1
      `
      if (perNumber[0]) {
        return {
          routing_strategy: normalizeRoutingStrategy(perNumber[0].routing_strategy),
          allow_lyncr_network_fallback: pgBool(perNumber[0].allow_lyncr_network_fallback),
          private_ring_timeout_seconds: Number(perNumber[0].private_ring_timeout_seconds ?? 15),
        }
      }
    }
    const def = await sql`
      SELECT routing_strategy, allow_lyncr_network_fallback, private_ring_timeout_seconds
      FROM routing_config
      WHERE user_id = ${userId} AND business_number IS NULL
      LIMIT 1
    `
    if (def[0]) {
      return {
        routing_strategy: normalizeRoutingStrategy(def[0].routing_strategy),
        allow_lyncr_network_fallback: pgBool(def[0].allow_lyncr_network_fallback),
        private_ring_timeout_seconds: Number(def[0].private_ring_timeout_seconds ?? 15),
      }
    }
    return fallback
  } catch (e) {
    if (!isMissingHybridNetworkColumnError(e)) {
      console.warn("[db] getLineHybridRoutingStrategy:", pgErrorMessage(e))
    }
    return fallback
  }
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
    Pick<
      RoutingConfig,
      | "selected_receptionist_id"
      | "fallback_type"
      | "ai_greeting"
      | "ring_timeout_seconds"
      | "ai_ring_owner_first"
      | "routing_strategy"
      | "allow_lyncr_network_fallback"
      | "private_ring_timeout_seconds"
      | "inbound_caller_greeting_enabled"
    >
  >,
  businessNumber?: string | null
): Promise<void> {
  const sql = getSql()
  const bn = businessNumber ?? null

  const applyInboundCallerGreeting = async (where: ReturnType<typeof sql>): Promise<void> => {
    if (updates.inbound_caller_greeting_enabled === undefined) return
    try {
      await sql`
        UPDATE routing_config
        SET inbound_caller_greeting_enabled = ${updates.inbound_caller_greeting_enabled}, updated_at = now()
        WHERE ${where}
      `
      clearIncomingRoutingCache()
    } catch (e) {
      if (!isMissingInboundCallerGreetingColumnError(e)) throw e
      console.warn(
        "[db] updateRoutingConfig: inbound_caller_greeting_enabled skipped — run scripts/081 in Neon.",
        pgErrorMessage(e)
      )
    }
  }

  // `048`/`049` hybrid-network fields — applied via guarded UPDATEs so a pre-migration schema
  // (missing columns) never breaks the rest of the save. `where` is a sql fragment.
  const applyHybridFields = async (where: ReturnType<typeof sql>): Promise<void> => {
    if (
      updates.routing_strategy === undefined &&
      updates.allow_lyncr_network_fallback === undefined &&
      updates.private_ring_timeout_seconds === undefined
    ) {
      return
    }
    try {
      if (updates.routing_strategy !== undefined) {
        await sql`UPDATE routing_config SET routing_strategy = ${updates.routing_strategy}, updated_at = now() WHERE ${where}`
      }
      if (updates.allow_lyncr_network_fallback !== undefined) {
        await sql`UPDATE routing_config SET allow_lyncr_network_fallback = ${updates.allow_lyncr_network_fallback}, updated_at = now() WHERE ${where}`
      }
      if (updates.private_ring_timeout_seconds !== undefined) {
        await sql`UPDATE routing_config SET private_ring_timeout_seconds = ${updates.private_ring_timeout_seconds}, updated_at = now() WHERE ${where}`
      }
    } catch (e) {
      if (!isMissingHybridNetworkColumnError(e)) throw e
      console.warn(
        "[db] updateRoutingConfig: hybrid-network fields skipped — run scripts/048 + 049 in Neon.",
        pgErrorMessage(e)
      )
    }
  }

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
      await applyHybridFields(sql`user_id = ${userId} AND business_number = ${normalizedBn}`)
      await applyInboundCallerGreeting(sql`user_id = ${userId} AND business_number = ${normalizedBn}`)
      clearIncomingRoutingCache()
      void primeIncomingRoutingCache(normalizedBn).catch(() => {})
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
    await applyHybridFields(whereClause)
    await applyInboundCallerGreeting(whereClause)

    clearIncomingRoutingCache()
    void primeIncomingRoutingCache(normalizedBn).catch(() => {})
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
  await applyHybridFields(whereClause)
  await applyInboundCallerGreeting(whereClause)

  clearIncomingRoutingCache()
  void primeIncomingRoutingCacheForUser(userId).catch(() => {})
}
export async function deleteRoutingConfigForNumber(userId: string, businessNumber: string): Promise<void> {
  const sql = getSql()
  const existingId = await findPerNumberRoutingConfigId(userId, businessNumber)
  if (existingId) {
    await sql`DELETE FROM routing_config WHERE id = ${existingId}`
  }
  clearIncomingRoutingCache()
  void primeIncomingRoutingCache(normalizePhoneNumberE164(businessNumber) || businessNumber).catch(() => {})
}

// Parse a receptionists row from the database
function parseReceptionistRow(row: Record<string, unknown>): Receptionist {
  const payModeRaw = String(row.pay_mode ?? "PER_MINUTE").toUpperCase()
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    name: String(row.name),
    phone: String(row.phone),
    initials: String(row.initials ?? ""),
    color: String(row.color ?? "bg-primary"),
    rate_per_minute: Number(row.rate_per_minute ?? 0.25),
    pay_mode: payModeRaw === "FLAT_RATE" ? "FLAT_RATE" : "PER_MINUTE",
    flat_rate_usd: Number(row.flat_rate_usd ?? 2.5),
    is_active: row.is_active !== false,
    portal_user_id: row.portal_user_id ? String(row.portal_user_id) : null,
    // Endpoint (050): unknown/missing → safe 'CELL' default.
    routing_endpoint: String(row.routing_endpoint ?? "").toUpperCase() === "WEB" ? "WEB" : "CELL",
    sip_username: row.sip_username ? String(row.sip_username) : null,
    sip_credential_id: row.sip_credential_id ? String(row.sip_credential_id) : null,
    skills: parseSkillsArray(row.skills),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }
}

function isMissingReceptionistPayColumnError(e: unknown): boolean {
  if (pgErrorCode(e) !== "42703") return false
  const msg = pgErrorMessage(e)
  return msg.includes("pay_mode") || msg.includes("flat_rate_usd")
}

function isMissingAccountRoleColumnError(e: unknown): boolean {
  if (pgErrorCode(e) !== "42703") return false
  return pgErrorMessage(e).includes("account_role")
}

function isMissingPortalUserColumnError(e: unknown): boolean {
  if (pgErrorCode(e) !== "42703") return false
  return pgErrorMessage(e).includes("portal_user_id")
}

function isMissingEndedAtColumnError(e: unknown): boolean {
  // 42703 = undefined_column. Thrown until scripts/007-call-quality-metrics.sql runs in Neon.
  return pgErrorCode(e) === "42703" && pgErrorMessage(e).includes("ended_at")
}

/** True when a query failed only because a scripts/007 timing column is missing. */
function isMissing007TimingColumnError(e: unknown): boolean {
  if (pgErrorCode(e) !== "42703") return false
  const msg = pgErrorMessage(e)
  return (
    msg.includes("answered_at") ||
    msg.includes("ended_at") ||
    msg.includes("first_ring_at") ||
    msg.includes("setup_duration_ms") ||
    msg.includes("post_dial_delay_ms")
  )
}

function isMissingReceptionistSkillsColumnError(e: unknown): boolean {
  if (pgErrorCode(e) !== "42703") return false
  return pgErrorMessage(e).includes("skills")
}

function isMissingIndustryTagColumnError(e: unknown): boolean {
  if (pgErrorCode(e) !== "42703") return false
  const msg = pgErrorMessage(e)
  return msg.includes("industry_tag") || msg.includes("routing_pool_mode")
}

/** 42703 thrown until scripts/048-hybrid-network-fields.sql (and 049) run in Neon. */
function isMissingHybridNetworkColumnError(e: unknown): boolean {
  if (pgErrorCode(e) !== "42703") return false
  const msg = pgErrorMessage(e)
  return (
    msg.includes("routing_strategy") ||
    msg.includes("allow_lyncr_network_fallback") ||
    msg.includes("private_ring_timeout_seconds")
  )
}

function isMissingCertificationsTableError(e: unknown): boolean {
  if (pgErrorCode(e) === "42P01") return true
  const msg = pgErrorMessage(e)
  return msg.includes("certifications") || msg.includes("receptionist_badges")
}

// Get a receptionist by ID
export async function getReceptionist(receptionistId: string): Promise<Receptionist | null> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT id, user_id, name, phone, initials, color, rate_per_minute, pay_mode, flat_rate_usd, is_active, created_at
      FROM receptionists WHERE id = ${receptionistId} LIMIT 1
    `
    return rows[0] ? parseReceptionistRow(rows[0]) : null
  } catch (e) {
    if (!isMissingReceptionistPayColumnError(e)) throw e
    const rows = await sql`
      SELECT id, user_id, name, phone, initials, color, rate_per_minute, is_active, created_at
      FROM receptionists WHERE id = ${receptionistId} LIMIT 1
    `
    return rows[0] ? parseReceptionistRow(rows[0]) : null
  }
}

// Get all receptionists for a user
export async function getReceptionists(userId: string): Promise<Receptionist[]> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT id, user_id, name, phone, initials, color, rate_per_minute, pay_mode, flat_rate_usd, is_active, created_at
      FROM receptionists WHERE user_id = ${userId} ORDER BY created_at ASC
    `
    return rows.map(parseReceptionistRow)
  } catch (e) {
    if (!isMissingReceptionistPayColumnError(e)) throw e
    const rows = await sql`
      SELECT id, user_id, name, phone, initials, color, rate_per_minute, is_active, created_at
      FROM receptionists WHERE user_id = ${userId} ORDER BY created_at ASC
    `
    return rows.map(parseReceptionistRow)
  }
}

/** Receptionists assigned (via routing_config) to phone lines in one workspace. */
export async function getReceptionistsForOrganization(
  userId: string,
  organizationId: string
): Promise<Receptionist[]> {
  if (!organizationId || organizationId.startsWith("legacy-")) {
    return getReceptionists(userId)
  }
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT DISTINCT r.id, r.user_id, r.name, r.phone, r.initials, r.color, r.rate_per_minute,
        r.pay_mode, r.flat_rate_usd, r.is_active, r.created_at
      FROM receptionists r
      INNER JOIN routing_config rc ON rc.selected_receptionist_id = r.id AND rc.user_id = r.user_id
      INNER JOIN phone_numbers pn ON pn.user_id = r.user_id AND pn.number = rc.business_number
      WHERE r.user_id = ${userId}
        AND pn.organization_id = ${organizationId}
        AND r.is_active = true
      ORDER BY r.created_at ASC
    `
    if (rows.length > 0) return rows.map(parseReceptionistRow)
    return []
  } catch (e) {
    if (isMissingOrganizationsSchemaError(e)) return getReceptionists(userId)
    if (!isMissingReceptionistPayColumnError(e)) throw e
    const rows = await sql`
      SELECT DISTINCT r.id, r.user_id, r.name, r.phone, r.initials, r.color, r.rate_per_minute, r.is_active, r.created_at
      FROM receptionists r
      INNER JOIN routing_config rc ON rc.selected_receptionist_id = r.id AND rc.user_id = r.user_id
      INNER JOIN phone_numbers pn ON pn.user_id = r.user_id AND pn.number = rc.business_number
      WHERE r.user_id = ${userId}
        AND pn.organization_id = ${organizationId}
        AND r.is_active = true
      ORDER BY r.created_at ASC
    `
    if (rows.length > 0) return rows.map(parseReceptionistRow)
    return []
  }
}

/** Active phone_numbers row by primary key — used by skill-pool routing. */
export async function getPhoneNumberLineById(lineId: string): Promise<PhoneNumber | null> {
  const sql = getSql()
  const id = lineId.trim()
  if (!id) return null
  try {
    const rows = await sql`
      SELECT id, user_id, provider_number_sid, twilio_sid, number, friendly_name, label, type, status,
             industry_tag, routing_pool_mode, created_at
      FROM phone_numbers
      WHERE id = ${id} AND status = 'active'
      LIMIT 1
    `
    return rows[0] ? parsePhoneNumberRow(rows[0] as Record<string, unknown>) : null
  } catch (e) {
    if (!isMissingIndustryTagColumnError(e)) throw e
    const rows = await sql`
      SELECT id, user_id, provider_number_sid, twilio_sid, number, friendly_name, label, type, status, created_at
      FROM phone_numbers
      WHERE id = ${id} AND status = 'active'
      LIMIT 1
    `
    return rows[0] ? parsePhoneNumberRow(rows[0] as Record<string, unknown>) : null
  }
}

/** Active phone_numbers row by inbound DID (E.164 or digit variants). */
export async function getActivePhoneNumberByE164(toNumber: string): Promise<PhoneNumber | null> {
  const sql = getSql()
  const normalized = normalizePhoneNumberE164(toNumber)
  if (!normalized) return null
  const digitKey = phoneDigitsKey(toNumber)
  try {
    const rows = await sql`
      SELECT id, user_id, organization_id, provider_number_sid, twilio_sid, number, friendly_name, label, type, status,
             industry_tag, routing_pool_mode, created_at
      FROM phone_numbers
      WHERE status = 'active'
        AND (number = ${normalized} OR regexp_replace(number, '\\D', '', 'g') = ${digitKey})
      ORDER BY created_at ASC
      LIMIT 1
    `
    return rows[0] ? parsePhoneNumberRow(rows[0] as Record<string, unknown>) : null
  } catch (e) {
    if (!isMissingIndustryTagColumnError(e)) throw e
    const rows = await sql`
      SELECT id, user_id, organization_id, provider_number_sid, twilio_sid, number, friendly_name, label, type, status, created_at
      FROM phone_numbers
      WHERE status = 'active'
        AND (number = ${normalized} OR regexp_replace(number, '\\D', '', 'g') = ${digitKey})
      ORDER BY created_at ASC
      LIMIT 1
    `
    return rows[0] ? parsePhoneNumberRow(rows[0] as Record<string, unknown>) : null
  }
}

/** Resolve the industry tag for a line — phone_numbers override, then routing_config, then users.industry. */
export async function resolveIndustryTagForLine(line: PhoneNumber): Promise<string | null> {
  if (line.industry_tag?.trim()) return normalizeRoutingPoolSkillTag(line.industry_tag)
  const cfg = await getRoutingConfigForNumber(line.user_id, line.number)
  if (cfg?.industry_tag?.trim()) return normalizeRoutingPoolSkillTag(cfg.industry_tag)
  const def = await getRoutingConfig(line.user_id)
  if (def?.industry_tag?.trim()) return normalizeRoutingPoolSkillTag(def.industry_tag)
  const sql = getSql()
  try {
    const rows = await sql`SELECT industry FROM users WHERE id = ${line.user_id} LIMIT 1`
    const industry = rows[0]?.industry != null ? String(rows[0].industry).trim() : ""
    if (industry && industry !== "generic") return normalizeRoutingPoolSkillTag(industry)
  } catch {
    // users.industry optional on older schemas
  }
  return null
}

export type PlatformRoutingPoolReceptionist = Pick<Receptionist, "id" | "name" | "phone" | "skills" | "is_active">

/** `048` pool scope: any business, this business's own private staff, or shared Lyncr network agents (user_id NULL). */
export type ReceptionistPoolScope = "any" | "private" | "network"

/**
 * Platform-managed receptionists available for a skill tag — active, portal-linked, not on another live call.
 * `opts.scope` ('private' | 'network') applies the `048` hybrid-network filter at the query level:
 *   - private → r.user_id = opts.ownerUserId (the line's owning business)
 *   - network → r.user_id IS NULL (shared global Lyncr pool)
 */
export async function listAvailablePlatformReceptionistsForIndustryTag(
  industryTag: string,
  opts?: { scope?: ReceptionistPoolScope; ownerUserId?: string | null }
): Promise<PlatformRoutingPoolReceptionist[]> {
  const sql = getSql()
  const tag = normalizeRoutingPoolSkillTag(industryTag)
  if (!tag) return []
  const scope: ReceptionistPoolScope = opts?.scope ?? "any"
  const ownerUserId = opts?.ownerUserId ?? null
  try {
    const rows = await sql`
      SELECT r.id, r.name, r.phone, r.skills, r.is_active
      FROM receptionists r
      INNER JOIN users u ON u.id = r.portal_user_id
      WHERE r.portal_user_id IS NOT NULL
        AND r.is_active = true
        AND coalesce(u.account_role, 'receptionist') = 'receptionist'
        AND (
          ${scope} = 'any'
          OR (${scope} = 'private' AND r.user_id = ${ownerUserId})
          OR (${scope} = 'network' AND r.user_id IS NULL)
        )
        AND (
          ${tag} = ANY(r.skills)
          OR EXISTS (
            -- Symmetric, token-aware skill match. Normalize each stored skill to a slug, then match when:
            --   * the slug equals the tag exactly ("detailing_core" = "detailing_core"), OR
            --   * the line tag is one of the skill's underscore tokens ("detailing" ∈ "auto_detailing"), OR
            --   * the base families line up ("auto_detailing" ↔ "auto_wash" both start "auto").
            SELECT 1 FROM unnest(r.skills) AS raw_skill
            CROSS JOIN LATERAL (
              SELECT lower(replace(replace(raw_skill, '-', '_'), ' ', '_')) AS slug
            ) sk
            WHERE sk.slug = ${tag}
              OR ${tag} = ANY(string_to_array(sk.slug, '_'))
              OR split_part(sk.slug, '_', 1) = split_part(${tag}, '_', 1)
          )
        )
        AND (
          NOT EXISTS (
            SELECT 1 FROM receptionist_badges rb
            WHERE rb.user_id = r.portal_user_id AND rb.status = 'certified'
          )
          OR EXISTS (
            SELECT 1 FROM receptionist_badges rb
            INNER JOIN certifications cert ON cert.id = rb.certification_id
            WHERE rb.user_id = r.portal_user_id
              AND rb.status = 'certified'
              AND rb.active_toggle = true
              AND split_part(replace(cert.code_identifier, '-', '_'), '_', 1) = ${tag}
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM call_logs cl
          WHERE cl.routed_to_receptionist_id = r.id
            AND cl.ended_at IS NULL
            AND lower(cl.status) IN ('answered', 'in-progress', 'ringing')
            AND cl.created_at > (now() - interval '2 hours')
        )
      ORDER BY r.name ASC
    `
    return (rows as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      phone: String(row.phone),
      skills: parseSkillsArray(row.skills),
      is_active: row.is_active !== false,
    }))
  } catch (e) {
    if (isMissingReceptionistSkillsColumnError(e)) return []
    if (isMissingCertificationsTableError(e)) {
      try {
        const rows = await sql`
          SELECT r.id, r.name, r.phone, r.skills, r.is_active
          FROM receptionists r
          INNER JOIN users u ON u.id = r.portal_user_id
          WHERE r.portal_user_id IS NOT NULL
            AND r.is_active = true
            AND coalesce(u.account_role, 'receptionist') = 'receptionist'
            AND (
              ${tag} = ANY(r.skills)
              OR EXISTS (
                SELECT 1 FROM unnest(r.skills) AS skill_slug
                WHERE split_part(replace(skill_slug, '-', '_'), '_', 1) = ${tag}
              )
            )
            AND NOT EXISTS (
              SELECT 1 FROM call_logs cl
              WHERE cl.routed_to_receptionist_id = r.id
                AND cl.ended_at IS NULL
                AND lower(cl.status) IN ('answered', 'in-progress', 'ringing')
                AND cl.created_at > (now() - interval '2 hours')
            )
          ORDER BY r.name ASC
        `
        return (rows as Record<string, unknown>[]).map((row) => ({
          id: String(row.id),
          name: String(row.name),
          phone: String(row.phone),
          skills: parseSkillsArray(row.skills),
          is_active: row.is_active !== false,
        }))
      } catch {
        return []
      }
    }
    if (isMissingPortalUserColumnError(e) || isMissingAccountRoleColumnError(e)) {
      const rows = await sql`
        SELECT r.id, r.name, r.phone, r.skills, r.is_active
        FROM receptionists r
        WHERE r.portal_user_id IS NOT NULL
          AND r.is_active = true
          AND ${tag} = ANY(r.skills)
        ORDER BY r.name ASC
      `
      return (rows as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        name: String(row.name),
        phone: String(row.phone),
        skills: parseSkillsArray(row.skills),
        is_active: row.is_active !== false,
      }))
    }
    if (isMissingEndedAtColumnError(e)) {
      // call_logs.ended_at not migrated yet (scripts/007). Detect a live call via
      // status + recency only, which is equivalent for the busy-receptionist filter.
      console.warn(
        "[db] listAvailablePlatformReceptionistsForIndustryTag: ended_at missing — run scripts/007-call-quality-metrics.sql in Neon."
      )
      try {
        const rows = await sql`
          SELECT r.id, r.name, r.phone, r.skills, r.is_active
          FROM receptionists r
          INNER JOIN users u ON u.id = r.portal_user_id
          WHERE r.portal_user_id IS NOT NULL
            AND r.is_active = true
            AND coalesce(u.account_role, 'receptionist') = 'receptionist'
            AND (
              ${tag} = ANY(r.skills)
              OR EXISTS (
                SELECT 1 FROM unnest(r.skills) AS skill_slug
                WHERE split_part(replace(skill_slug, '-', '_'), '_', 1) = ${tag}
              )
            )
            AND (
              NOT EXISTS (
                SELECT 1 FROM receptionist_badges rb
                WHERE rb.user_id = r.portal_user_id AND rb.status = 'certified'
              )
              OR EXISTS (
                SELECT 1 FROM receptionist_badges rb
                INNER JOIN certifications cert ON cert.id = rb.certification_id
                WHERE rb.user_id = r.portal_user_id
                  AND rb.status = 'certified'
                  AND rb.active_toggle = true
                  AND split_part(replace(cert.code_identifier, '-', '_'), '_', 1) = ${tag}
              )
            )
            AND NOT EXISTS (
              SELECT 1 FROM call_logs cl
              WHERE cl.routed_to_receptionist_id = r.id
                AND lower(cl.status) IN ('answered', 'in-progress', 'ringing')
                AND cl.created_at > (now() - interval '2 hours')
            )
          ORDER BY r.name ASC
        `
        return (rows as Record<string, unknown>[]).map((row) => ({
          id: String(row.id),
          name: String(row.name),
          phone: String(row.phone),
          skills: parseSkillsArray(row.skills),
          is_active: row.is_active !== false,
        }))
      } catch (inner) {
        if (isMissingCertificationsTableError(inner)) {
          const rows = await sql`
            SELECT r.id, r.name, r.phone, r.skills, r.is_active
            FROM receptionists r
            INNER JOIN users u ON u.id = r.portal_user_id
            WHERE r.portal_user_id IS NOT NULL
              AND r.is_active = true
              AND coalesce(u.account_role, 'receptionist') = 'receptionist'
              AND (
                ${tag} = ANY(r.skills)
                OR EXISTS (
                  SELECT 1 FROM unnest(r.skills) AS skill_slug
                  WHERE split_part(replace(skill_slug, '-', '_'), '_', 1) = ${tag}
                )
              )
              AND NOT EXISTS (
                SELECT 1 FROM call_logs cl
                WHERE cl.routed_to_receptionist_id = r.id
                  AND lower(cl.status) IN ('answered', 'in-progress', 'ringing')
                  AND cl.created_at > (now() - interval '2 hours')
              )
            ORDER BY r.name ASC
          `
          return (rows as Record<string, unknown>[]).map((row) => ({
            id: String(row.id),
            name: String(row.name),
            phone: String(row.phone),
            skills: parseSkillsArray(row.skills),
            is_active: row.is_active !== false,
          }))
        }
        throw inner
      }
    }
    throw e
  }
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
    pay_mode: "PER_MINUTE",
    flat_rate_usd: 2.5,
    is_active: true,
    skills: [],
    created_at: new Date().toISOString(),
  }
}

// ============================================
// Global Lyncr network agents (`048`/`049`) — receptionists.user_id IS NULL.
// Shared, platform-managed agents that any business can route to via the hybrid pool.
// ============================================

/** A shared Lyncr network agent (no owning business). `user_id` is intentionally NULL. */
export type GlobalNetworkReceptionist = {
  id: string
  name: string
  phone: string
  skills: string[]
  is_active: boolean
  created_at: string
}

/** Insert a shared global Lyncr network agent (receptionists.user_id = NULL). Requires migration 048. */
export async function insertGlobalNetworkReceptionist(params: {
  name: string
  phone: string
  skills?: string[]
}): Promise<GlobalNetworkReceptionist> {
  const sql = getSql()
  const id = crypto.randomUUID()
  const phone = normalizePhoneNumberE164(params.phone)
  const nameParts = params.name.trim().split(/\s+/)
  const initials =
    nameParts.length >= 2
      ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
      : params.name.slice(0, 2).toUpperCase()
  const colors = ["bg-primary", "bg-chart-2", "bg-chart-5", "bg-chart-3", "bg-chart-4"]
  const color = colors[Math.floor(Math.random() * colors.length)]
  // Slugify every tag to the canonical form the line side uses (lowercase, spaces/dashes -> underscores),
  // splitting any comma-joined entries, then dedupe + drop blanks. This keeps stored skills like
  // "auto_detailing" matchable against a line's normalized industry_tag.
  const skills = Array.from(
    new Set(
      (params.skills ?? [])
        .flatMap((s) => String(s).split(","))
        .map((s) => normalizeRoutingPoolSkillTag(s))
        .filter(Boolean)
    )
  )

  // user_id NULL requires the 048 ALTER (DROP NOT NULL). If it hasn't run this INSERT throws (23502).
  await sql`
    INSERT INTO receptionists (id, user_id, name, phone, initials, color, rate_per_minute, is_active, created_at)
    VALUES (${id}, ${null}, ${params.name.trim()}, ${phone}, ${initials}, ${color}, 0.25, true, now())
  `

  if (skills.length > 0) {
    try {
      await sql`UPDATE receptionists SET skills = ${skills}::text[] WHERE id = ${id}`
    } catch (e) {
      if (!isMissingReceptionistSkillsColumnError(e)) throw e
    }
  }

  return {
    id,
    name: params.name.trim(),
    phone,
    skills,
    is_active: true,
    created_at: new Date().toISOString(),
  }
}

/**
 * Persist the Telnyx SIP credential a receptionist was provisioned with (`050`/`051`).
 * Stores the auto-generated sip_username + the credential id used to mint WebRTC tokens.
 * Tolerates a pre-migration DB: if `sip_credential_id` (051) is missing it still saves the
 * username (050); if both are missing it no-ops. Clears the inbound routing cache so the
 * WEB dial path can pick up the new username on the next call.
 */
export async function setReceptionistSipCredential(
  receptionistId: string,
  creds: { sipUsername: string; credentialId: string }
): Promise<void> {
  const sql = getSql()
  try {
    await sql`
      UPDATE receptionists
      SET sip_username = ${creds.sipUsername}, sip_credential_id = ${creds.credentialId}
      WHERE id = ${receptionistId}
    `
  } catch (e) {
    if (pgErrorCode(e) !== "42703") throw e
    // 051 (sip_credential_id) not applied yet — still save the username (050) so WEB dial resolves.
    try {
      await sql`UPDATE receptionists SET sip_username = ${creds.sipUsername} WHERE id = ${receptionistId}`
    } catch (e2) {
      if (pgErrorCode(e2) !== "42703") throw e2
    }
  }
  clearIncomingRoutingCache()
}

/** List every shared global Lyncr network agent (receptionists.user_id IS NULL), newest first. */
export async function listGlobalNetworkReceptionists(): Promise<GlobalNetworkReceptionist[]> {
  const sql = getSql()
  const mapRow = (row: Record<string, unknown>): GlobalNetworkReceptionist => ({
    id: String(row.id),
    name: String(row.name),
    phone: String(row.phone),
    skills: parseSkillsArray(row.skills),
    is_active: row.is_active !== false,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  })
  try {
    const rows = await sql`
      SELECT id, name, phone, skills, is_active, created_at
      FROM receptionists
      WHERE user_id IS NULL
      ORDER BY created_at DESC
    `
    return (rows as Record<string, unknown>[]).map(mapRow)
  } catch (e) {
    // Pre-042 schema has no skills column — read without it.
    if (!isMissingReceptionistSkillsColumnError(e)) throw e
    const rows = await sql`
      SELECT id, name, phone, is_active, created_at
      FROM receptionists
      WHERE user_id IS NULL
      ORDER BY created_at DESC
    `
    return (rows as Record<string, unknown>[]).map(mapRow)
  }
}

/**
 * Shared Lyncr network agents (user_id IS NULL) available for a skill tag — active and not on a live call.
 * Network agents are platform-vetted and may not have a portal login, so this query deliberately skips
 * the portal_user_id / certification gating used for private staff and matches on skills only.
 */
export async function listAvailableNetworkReceptionistsForIndustryTag(
  industryTag: string
): Promise<PlatformRoutingPoolReceptionist[]> {
  const sql = getSql()
  const tag = normalizeRoutingPoolSkillTag(industryTag)
  if (!tag) return []
  const mapRow = (row: Record<string, unknown>): PlatformRoutingPoolReceptionist => ({
    id: String(row.id),
    name: String(row.name),
    phone: String(row.phone),
    skills: parseSkillsArray(row.skills),
    is_active: row.is_active !== false,
  })
  try {
    const rows = await sql`
      SELECT r.id, r.name, r.phone, r.skills, r.is_active
      FROM receptionists r
      WHERE r.user_id IS NULL
        AND r.is_active = true
        AND (
          ${tag} = ANY(r.skills)
          OR EXISTS (
            -- Symmetric, token-aware skill match. Normalize each stored skill to a slug, then match when:
            --   * the slug equals the tag exactly ("detailing_core" = "detailing_core"), OR
            --   * the line tag is one of the skill's underscore tokens ("detailing" ∈ "auto_detailing"), OR
            --   * the base families line up ("auto_detailing" ↔ "auto_wash" both start "auto").
            SELECT 1 FROM unnest(r.skills) AS raw_skill
            CROSS JOIN LATERAL (
              SELECT lower(replace(replace(raw_skill, '-', '_'), ' ', '_')) AS slug
            ) sk
            WHERE sk.slug = ${tag}
              OR ${tag} = ANY(string_to_array(sk.slug, '_'))
              OR split_part(sk.slug, '_', 1) = split_part(${tag}, '_', 1)
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM call_logs cl
          WHERE cl.routed_to_receptionist_id = r.id
            AND lower(cl.status) IN ('answered', 'in-progress', 'ringing')
            AND cl.created_at > (now() - interval '2 hours')
        )
      ORDER BY r.name ASC
    `
    return (rows as Record<string, unknown>[]).map(mapRow)
  } catch (e) {
    if (isMissingReceptionistSkillsColumnError(e)) return []
    throw e
  }
}

// Update a receptionist
export async function updateReceptionist(
  receptionistId: string,
  userId: string,
  updates: Partial<
    Pick<Receptionist, "name" | "phone" | "is_active" | "rate_per_minute" | "pay_mode" | "flat_rate_usd" | "routing_endpoint">
  >
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
  if (updates.pay_mode !== undefined) {
    try {
      await sql`UPDATE receptionists SET pay_mode = ${updates.pay_mode} WHERE id = ${receptionistId} AND user_id = ${userId}`
    } catch (e) {
      if (!isMissingReceptionistPayColumnError(e)) throw e
    }
  }
  if (updates.flat_rate_usd !== undefined) {
    try {
      await sql`UPDATE receptionists SET flat_rate_usd = ${updates.flat_rate_usd} WHERE id = ${receptionistId} AND user_id = ${userId}`
    } catch (e) {
      if (!isMissingReceptionistPayColumnError(e)) throw e
    }
  }
  if (updates.routing_endpoint !== undefined) {
    // 050 column — tolerate it not existing yet (42703) so the rest of the update still applies.
    const endpoint = updates.routing_endpoint === "WEB" ? "WEB" : "CELL"
    try {
      await sql`UPDATE receptionists SET routing_endpoint = ${endpoint} WHERE id = ${receptionistId} AND user_id = ${userId}`
    } catch (e) {
      if (pgErrorCode(e) !== "42703") throw e
    }
  }
  clearIncomingRoutingCache()
  // Recompute inbound snapshots so the voice fast path picks up the new endpoint right away.
  void syncInboundDialSnapshotForUser(userId).catch(() => {})
}

// Delete a receptionist
export async function deleteReceptionist(receptionistId: string, userId: string): Promise<void> {
  const sql = getSql()
  await sql`DELETE FROM receptionists WHERE id = ${receptionistId} AND user_id = ${userId}`
  clearIncomingRoutingCache()
  void syncInboundDialSnapshotForUser(userId).catch(() => {})
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
        credit_balance_cents, billing_plan, is_platform_admin, account_role
      FROM users WHERE LOWER(email) = LOWER(${email}) LIMIT 1
    `
    return pack(rows[0])
  } catch (e) {
    if (isMissingAccountRoleColumnError(e)) {
      try {
        const rows = await sql`
          SELECT id, email, name, phone, business_name, inbound_receptionist_whisper_enabled, industry, telnyx_ai_assistant_id, password_hash, created_at,
            credit_balance_cents, billing_plan, is_platform_admin
          FROM users WHERE LOWER(email) = LOWER(${email}) LIMIT 1
        `
        return pack(rows[0])
      } catch (e2) {
        if (isMissingBillingColumnsError(e2)) {
          return getAuthUserByEmailWithoutBillingColumns(email)
        }
        throw e2
      }
    }
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
  account_role?: "owner" | "receptionist" | "field_tech"
}): Promise<User> {
  const sql = getSql()
  const id = crypto.randomUUID()
  const industry = defaultProfileFromUserIndustry(params.industry)
  const accountRole =
    params.account_role === "receptionist"
      ? "receptionist"
      : params.account_role === "field_tech"
        ? "field_tech"
        : "owner"
  try {
    await sql`
      INSERT INTO users (id, email, name, phone, business_name, industry, password_hash, account_role, created_at)
      VALUES (${id}, ${params.email}, ${params.name}, ${params.phone}, ${params.business_name}, ${industry}, ${params.password_hash}, ${accountRole}, now())
    `
  } catch (e) {
    if (isMissingAccountRoleColumnError(e)) {
      try {
        await sql`
          INSERT INTO users (id, email, name, phone, business_name, industry, password_hash, created_at)
          VALUES (${id}, ${params.email}, ${params.name}, ${params.phone}, ${params.business_name}, ${industry}, ${params.password_hash}, now())
        `
      } catch (e2) {
        if (!isMissingIndustryColumnError(e2)) throw e2
        await sql`
          INSERT INTO users (id, email, name, phone, business_name, password_hash, created_at)
          VALUES (${id}, ${params.email}, ${params.name}, ${params.phone}, ${params.business_name}, ${params.password_hash}, now())
        `
      }
    } else if (isMissingIndustryColumnError(e)) {
      try {
        await sql`
          INSERT INTO users (id, email, name, phone, business_name, password_hash, account_role, created_at)
          VALUES (${id}, ${params.email}, ${params.name}, ${params.phone}, ${params.business_name}, ${params.password_hash}, ${accountRole}, now())
        `
      } catch (e2) {
        if (!isMissingAccountRoleColumnError(e2)) throw e2
        await sql`
          INSERT INTO users (id, email, name, phone, business_name, password_hash, created_at)
          VALUES (${id}, ${params.email}, ${params.name}, ${params.phone}, ${params.business_name}, ${params.password_hash}, now())
        `
      }
    } else {
      throw e
    }
  }
  if (accountRole === "owner") {
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
  }
  return {
    id,
    email: params.email,
    name: params.name,
    phone: params.phone,
    business_name: params.business_name,
    account_role: accountRole,
    inbound_receptionist_whisper_enabled: true,
    industry,
    telnyx_ai_assistant_id: null,
    created_at: new Date().toISOString(),
    credit_balance_cents: 0,
    billing_plan: "trial",
    is_platform_admin: false,
    answered_call_customer_popup_enabled: true,
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
    master_toggle_mode: parseMasterToggleMode(row.master_toggle_mode),
    admin_notification_preferences: parseAdminNotificationPreferences(row.admin_notification_preferences),
    answered_call_customer_popup_enabled:
      row.answered_call_customer_popup_enabled === null || row.answered_call_customer_popup_enabled === undefined
        ? true
        : pgBool(row.answered_call_customer_popup_enabled),
    account_role: normalizeAccountRole(row.account_role),
  }
}

/** Map a raw DB account_role to the typed union (defaults to owner). */
function normalizeAccountRole(raw: unknown): "owner" | "receptionist" | "field_tech" {
  const v = String(raw ?? "owner")
  if (v === "receptionist") return "receptionist"
  if (v === "field_tech") return "field_tech"
  return "owner"
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

// Fast routing lookup for incoming voice webhooks (snapshot row first, full joins as fallback).
/** Missing optional phone_numbers inbound snapshot columns (scripts/036). */
function isMissingInboundDialSnapshotColumnError(e: unknown): boolean {
  if (pgErrorCode(e) !== "42703") return false
  const msg = pgErrorMessage(e)
  return (
    msg.includes("inbound_dial_e164") ||
    msg.includes("inbound_routing_updated_at") ||
    msg.includes("inbound_ai_ring_owner_first") ||
    msg.includes("inbound_caller_greeting_enabled")
  )
}

function mapIncomingRoutingRowFromDb(row: Record<string, unknown>): IncomingRoutingRow {
  return {
    user_id: String(row.user_id),
    user_name: String(row.user_name),
    business_name: row.business_name != null ? String(row.business_name) : "My Business",
    inbound_receptionist_whisper_enabled: inboundWhisperEnabledFromRoutingRow(row),
    owner_phone: String(row.owner_phone),
    selected_receptionist_id: row.selected_receptionist_id ? String(row.selected_receptionist_id) : null,
    fallback_type: (row.fallback_type as RoutingConfig["fallback_type"]) || "owner",
    ring_timeout_seconds: Number(row.ring_timeout_seconds ?? 30),
    ai_ring_owner_first: pgBool(row.ai_ring_owner_first),
    receptionist_name: row.receptionist_name ? String(row.receptionist_name) : null,
    receptionist_phone: row.receptionist_phone ? String(row.receptionist_phone) : null,
    // Normalize to the two valid values; anything missing/unknown is treated as the safe 'CELL' (PSTN) default.
    receptionist_routing_endpoint:
      String(row.receptionist_routing_endpoint ?? "").toUpperCase() === "WEB" ? "WEB" : "CELL",
    receptionist_sip_username: row.receptionist_sip_username ? String(row.receptionist_sip_username) : null,
    phone_line_label: row.phone_line_label != null ? String(row.phone_line_label) : "Main Line",
    phone_line_friendly_name: row.phone_line_friendly_name != null ? String(row.phone_line_friendly_name) : "",
    account_status: row.account_status != null ? String(row.account_status) : "active",
    active_phone_count: 1,
    primary_phone_number: row.primary_phone_number != null ? String(row.primary_phone_number) : "",
    admin_routing_override_phone:
      row.admin_routing_override_phone != null ? String(row.admin_routing_override_phone) : null,
    organization_name: row.organization_name != null ? String(row.organization_name) : "",
    inbound_caller_greeting_enabled:
      row.inbound_caller_greeting_enabled != null ? pgBool(row.inbound_caller_greeting_enabled) : true,
  }
}

/** PSTN leg to ring on inbound — admin override, then receptionist, then owner cell. */
function resolveInboundSnapshotDialE164(row: IncomingRoutingRow): string | null {
  const adminOverride = formatAdminRoutingOverridePhoneForTelnyx(row.admin_routing_override_phone)
  if (adminOverride) return adminOverride
  if (row.receptionist_phone?.trim()) {
    const dial = normalizePhoneNumberE164(row.receptionist_phone)
    if (isReasonablePstnDialString(dial)) return dial
  }
  if (!row.selected_receptionist_id?.trim() && row.owner_phone?.trim()) {
    const dial = normalizePhoneNumberE164(row.owner_phone)
    if (isReasonablePstnDialString(dial)) return dial
  }
  return null
}

async function writeInboundRoutingSnapshot(
  normalized: string,
  digitKey: string,
  row: IncomingRoutingByNumber
): Promise<void> {
  const sql = getSql()
  try {
    if (!row) {
      await sql`
        UPDATE phone_numbers
        SET
          inbound_routing_updated_at = now(),
          inbound_dial_e164 = NULL,
          inbound_receptionist_id = NULL,
          inbound_receptionist_name = NULL,
          inbound_fallback_type = 'owner',
          inbound_ring_timeout_seconds = 30,
          inbound_account_status = 'active',
          inbound_ai_ring_owner_first = false
        WHERE status = 'active'
          AND (
            number = ${normalized}
            OR regexp_replace(number, '\\D', '', 'g') = ${digitKey}
          )
      `
      // Clear the endpoint mirror too (guarded so a missing column never blocks the clear).
      await writeInboundEndpointSnapshot(normalized, digitKey, null, null)
      return
    }
    await sql`
      UPDATE phone_numbers
      SET
        inbound_dial_e164 = ${resolveInboundSnapshotDialE164(row)},
        inbound_receptionist_id = ${row.selected_receptionist_id},
        inbound_receptionist_name = ${row.receptionist_name},
        inbound_fallback_type = ${row.fallback_type},
        inbound_ring_timeout_seconds = ${row.ring_timeout_seconds},
        inbound_account_status = ${row.account_status},
        inbound_ai_ring_owner_first = ${row.ai_ring_owner_first},
        inbound_caller_greeting_enabled = ${row.inbound_caller_greeting_enabled !== false},
        inbound_routing_updated_at = now()
      WHERE status = 'active'
        AND (
          number = ${normalized}
          OR regexp_replace(number, '\\D', '', 'g') = ${digitKey}
        )
    `
    // Endpoint mirror (050). Separate guarded write so a pre-migration missing column
    // can never block the core snapshot above. 42703 = "undefined_column" → ignore.
    await writeInboundEndpointSnapshot(
      normalized,
      digitKey,
      row.receptionist_routing_endpoint,
      row.receptionist_sip_username
    )
  } catch (e) {
    if (isMissingInboundDialSnapshotColumnError(e)) return
    throw e
  }
}

/** Guarded snapshot write for the 050 endpoint columns — tolerates the column not existing yet. */
async function writeInboundEndpointSnapshot(
  normalized: string,
  digitKey: string,
  endpoint: "WEB" | "CELL" | null,
  sipUsername: string | null
): Promise<void> {
  const sql = getSql()
  try {
    await sql`
      UPDATE phone_numbers
      SET
        inbound_routing_endpoint = ${endpoint},
        inbound_sip_username = ${sipUsername}
      WHERE status = 'active'
        AND (
          number = ${normalized}
          OR regexp_replace(number, '\\D', '', 'g') = ${digitKey}
        )
    `
  } catch (e) {
    // 42703 = undefined_column (migration 050 not applied yet). Anything else is a real error.
    if (pgErrorCode(e) !== "42703") throw e
  }
}

/** Recompute snapshot from full routing joins (dashboard save / backfill). */
export async function syncInboundDialSnapshotForNumber(toNumber: string): Promise<void> {
  const normalized = normalizePhoneNumberE164(toNumber)
  if (!normalized) return
  const digitKey = phoneDigitsKey(toNumber)
  let full = await resolveIncomingRoutingFromDb(normalized, digitKey)
  if (full?.selected_receptionist_id?.trim() && !full.receptionist_phone?.trim()) {
    const rec = await getReceptionist(full.selected_receptionist_id)
    if (rec?.phone?.trim() && String(rec.user_id) === String(full.user_id)) {
      const dial = normalizePhoneNumberE164(rec.phone)
      full = {
        ...full,
        receptionist_phone: isReasonablePstnDialString(dial) ? dial : rec.phone.trim(),
        receptionist_name: rec.name ?? full.receptionist_name,
      }
    }
  }
  if (full?.receptionist_phone?.trim()) {
    const dial = normalizePhoneNumberE164(full.receptionist_phone)
    if (isReasonablePstnDialString(dial)) {
      full = { ...full, receptionist_phone: dial }
    }
  } else if (full?.owner_phone?.trim()) {
    const dial = normalizePhoneNumberE164(full.owner_phone)
    if (isReasonablePstnDialString(dial)) {
      full = { ...full, owner_phone: dial }
    }
  }
  await writeInboundRoutingSnapshot(normalized, digitKey, full)
  storeIncomingRoutingInMemory(normalized, full)
}

export async function syncInboundDialSnapshotForUser(userId: string): Promise<void> {
  const numbers = await getPhoneNumbers(userId)
  const active = numbers.filter((n) => n.status === "active")
  if (active.length > 0) {
    await Promise.all(active.map((n) => syncInboundDialSnapshotForNumber(n.number)))
    return
  }
  const profile = await getOnboardingProfile(userId)
  const reserved = profile?.reserved_number?.trim()
  if (reserved) {
    await syncInboundDialSnapshotForNumber(reserved)
  }
}

/** Fallback when phone_numbers has no active row — match onboarding_profiles.reserved_number. */
async function fetchIncomingRoutingByReservedNumberFromDb(
  normalized: string,
  digitKey: string
): Promise<IncomingRoutingByNumber> {
  if (digitKey.length < 10) return null
  const sql = getSql()
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
      COALESCE(
        CASE WHEN rc_spec.id IS NOT NULL THEN rc_spec.inbound_caller_greeting_enabled ELSE NULL END,
        rc_def.inbound_caller_greeting_enabled,
        true
      ) AS inbound_caller_greeting_enabled,
      reff.name AS receptionist_name,
      reff.phone AS receptionist_phone,
      to_jsonb(reff) ->> 'routing_endpoint' AS receptionist_routing_endpoint,
      to_jsonb(reff) ->> 'sip_username' AS receptionist_sip_username,
      COALESCE(NULLIF(trim(pn.label), ''), 'Main Line') AS phone_line_label,
      COALESCE(pn.friendly_name, '') AS phone_line_friendly_name,
      COALESCE(op.account_status, 'active') AS account_status,
      COALESCE(
        NULLIF(trim(pn.admin_routing_override_phone), ''),
        NULLIF(trim(org.admin_routing_override_phone), '')
      ) AS admin_routing_override_phone,
      COALESCE(NULLIF(trim(org.name), ''), '') AS organization_name,
      COALESCE(NULLIF(trim(pn.number), ''), op.reserved_number, '') AS primary_phone_number
    FROM onboarding_profiles op
    JOIN users u ON u.id = op.user_id
    LEFT JOIN phone_numbers pn ON pn.user_id = u.id AND pn.status = 'active'
    LEFT JOIN organizations org ON org.id = pn.organization_id
    LEFT JOIN LATERAL (
      SELECT rc.*
      FROM routing_config rc
      WHERE rc.user_id = u.id
        AND rc.business_number IS NOT NULL
        AND (
          rc.business_number = COALESCE(pn.number, op.reserved_number)
          OR regexp_replace(COALESCE(rc.business_number, ''), '\\D', '', 'g') = regexp_replace(COALESCE(pn.number, op.reserved_number), '\\D', '', 'g')
          OR (
            length(regexp_replace(COALESCE(rc.business_number, ''), '\\D', '', 'g')) >= 10
            AND length(regexp_replace(COALESCE(pn.number, op.reserved_number), '\\D', '', 'g')) >= 10
            AND right(regexp_replace(COALESCE(rc.business_number, ''), '\\D', '', 'g'), 10)
              = right(regexp_replace(COALESCE(pn.number, op.reserved_number), '\\D', '', 'g'), 10)
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
    WHERE op.reserved_number IS NOT NULL
      AND trim(op.reserved_number) <> ''
      AND (
        op.reserved_number = ${normalized}
        OR regexp_replace(op.reserved_number, '\\D', '', 'g') = ${digitKey}
        OR (
          length(regexp_replace(op.reserved_number, '\\D', '', 'g')) >= 10
          AND right(regexp_replace(op.reserved_number, '\\D', '', 'g'), 10) = right(${digitKey}, 10)
        )
      )
    ORDER BY pn.created_at DESC NULLS LAST
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
      COALESCE(
        CASE WHEN rc_spec.id IS NOT NULL THEN rc_spec.inbound_caller_greeting_enabled ELSE NULL END,
        rc_def.inbound_caller_greeting_enabled,
        true
      ) AS inbound_caller_greeting_enabled,
      reff.name AS receptionist_name,
      reff.phone AS receptionist_phone,
      to_jsonb(reff) ->> 'routing_endpoint' AS receptionist_routing_endpoint,
      to_jsonb(reff) ->> 'sip_username' AS receptionist_sip_username,
      COALESCE(NULLIF(trim(pn.label), ''), 'Main Line') AS phone_line_label,
      COALESCE(pn.friendly_name, '') AS phone_line_friendly_name,
      COALESCE(op.account_status, 'active') AS account_status,
      COALESCE(
        NULLIF(trim(pn.admin_routing_override_phone), ''),
        NULLIF(trim(org.admin_routing_override_phone), '')
      ) AS admin_routing_override_phone,
      COALESCE(NULLIF(trim(org.name), ''), '') AS organization_name,
      COALESCE(NULLIF(trim(pn.number), ''), op.reserved_number, '') AS primary_phone_number
    FROM onboarding_profiles op
    JOIN users u ON u.id = op.user_id
    LEFT JOIN phone_numbers pn ON pn.user_id = u.id AND pn.status = 'active'
    LEFT JOIN organizations org ON org.id = pn.organization_id
    LEFT JOIN LATERAL (
      SELECT rc.*
      FROM routing_config rc
      WHERE rc.user_id = u.id
        AND rc.business_number IS NOT NULL
        AND (
          rc.business_number = COALESCE(pn.number, op.reserved_number)
          OR regexp_replace(COALESCE(rc.business_number, ''), '\\D', '', 'g') = regexp_replace(COALESCE(pn.number, op.reserved_number), '\\D', '', 'g')
          OR (
            length(regexp_replace(COALESCE(rc.business_number, ''), '\\D', '', 'g')) >= 10
            AND length(regexp_replace(COALESCE(pn.number, op.reserved_number), '\\D', '', 'g')) >= 10
            AND right(regexp_replace(COALESCE(rc.business_number, ''), '\\D', '', 'g'), 10)
              = right(regexp_replace(COALESCE(pn.number, op.reserved_number), '\\D', '', 'g'), 10)
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
    WHERE op.reserved_number IS NOT NULL
      AND trim(op.reserved_number) <> ''
      AND (
        op.reserved_number = ${normalized}
        OR regexp_replace(op.reserved_number, '\\D', '', 'g') = ${digitKey}
        OR (
          length(regexp_replace(op.reserved_number, '\\D', '', 'g')) >= 10
          AND right(regexp_replace(op.reserved_number, '\\D', '', 'g'), 10) = right(${digitKey}, 10)
        )
      )
    ORDER BY pn.created_at DESC NULLS LAST
    LIMIT 1
  `
  }

  const row = rows[0]
  if (!row) return null

  const value = mapIncomingRoutingRowFromDb(row as Record<string, unknown>)
  storeIncomingRoutingInMemory(normalized, value)
  return value
}

// Full routing lookup (joins routing_config + receptionists). Used to build snapshots and fallbacks.
async function fetchIncomingRoutingFullFromDb(
  normalized: string,
  digitKey: string
): Promise<IncomingRoutingByNumber> {
  const sql = getSql()
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
      COALESCE(
        CASE WHEN rc_spec.id IS NOT NULL THEN rc_spec.inbound_caller_greeting_enabled ELSE NULL END,
        rc_def.inbound_caller_greeting_enabled,
        true
      ) AS inbound_caller_greeting_enabled,
      reff.name AS receptionist_name,
      reff.phone AS receptionist_phone,
      to_jsonb(reff) ->> 'routing_endpoint' AS receptionist_routing_endpoint,
      to_jsonb(reff) ->> 'sip_username' AS receptionist_sip_username,
      COALESCE(NULLIF(trim(pn.label), ''), 'Main Line') AS phone_line_label,
      COALESCE(pn.friendly_name, '') AS phone_line_friendly_name,
      COALESCE(op.account_status, 'active') AS account_status,
      COALESCE(
        NULLIF(trim(pn.admin_routing_override_phone), ''),
        NULLIF(trim(org.admin_routing_override_phone), '')
      ) AS admin_routing_override_phone,
      COALESCE(NULLIF(trim(org.name), ''), '') AS organization_name,
      pn.number AS primary_phone_number
    FROM phone_numbers pn
    JOIN users u ON u.id = pn.user_id
    LEFT JOIN organizations org ON org.id = pn.organization_id
    LEFT JOIN onboarding_profiles op ON op.user_id = u.id
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
        pn.number = ${normalized}
        OR regexp_replace(pn.number, '\\D', '', 'g') = ${digitKey}
        OR (
          length(${digitKey}) >= 10
          AND length(regexp_replace(pn.number, '\\D', '', 'g')) >= 10
          AND right(regexp_replace(pn.number, '\\D', '', 'g'), 10) = right(${digitKey}, 10)
        )
      )
    LIMIT 1
  `
  } catch (e) {
    if (!isMissingInboundReceptionistWhisperColumnError(e) && !isMissingInboundCallerGreetingColumnError(e)) throw e
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
      COALESCE(
        CASE WHEN rc_spec.id IS NOT NULL THEN rc_spec.inbound_caller_greeting_enabled ELSE NULL END,
        rc_def.inbound_caller_greeting_enabled,
        true
      ) AS inbound_caller_greeting_enabled,
      reff.name AS receptionist_name,
      reff.phone AS receptionist_phone,
      to_jsonb(reff) ->> 'routing_endpoint' AS receptionist_routing_endpoint,
      to_jsonb(reff) ->> 'sip_username' AS receptionist_sip_username,
      COALESCE(NULLIF(trim(pn.label), ''), 'Main Line') AS phone_line_label,
      COALESCE(pn.friendly_name, '') AS phone_line_friendly_name,
      COALESCE(op.account_status, 'active') AS account_status,
      COALESCE(
        NULLIF(trim(pn.admin_routing_override_phone), ''),
        NULLIF(trim(org.admin_routing_override_phone), '')
      ) AS admin_routing_override_phone,
      COALESCE(NULLIF(trim(org.name), ''), '') AS organization_name,
      pn.number AS primary_phone_number
    FROM phone_numbers pn
    JOIN users u ON u.id = pn.user_id
    LEFT JOIN organizations org ON org.id = pn.organization_id
    LEFT JOIN onboarding_profiles op ON op.user_id = u.id
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
        pn.number = ${normalized}
        OR regexp_replace(pn.number, '\\D', '', 'g') = ${digitKey}
        OR (
          length(${digitKey}) >= 10
          AND length(regexp_replace(pn.number, '\\D', '', 'g')) >= 10
          AND right(regexp_replace(pn.number, '\\D', '', 'g'), 10) = right(${digitKey}, 10)
        )
      )
    LIMIT 1
  `
  }

  const row = rows[0]
  if (!row) return null

  const value = mapIncomingRoutingRowFromDb(row as Record<string, unknown>)
  storeIncomingRoutingInMemory(normalized, value)
  return value
}

/** Snapshot first (fast), then full joins; writes snapshot after a full read. */
async function fetchIncomingRoutingByNumberFromDb(
  normalized: string,
  digitKey: string
): Promise<IncomingRoutingByNumber> {
  const snap = await fetchInboundDialSnapshotSql(normalized, digitKey)
  if (snap) {
    storeIncomingRoutingInMemory(normalized, snap)
    return snap
  }
  const resolved = await resolveIncomingRoutingFromDb(normalized, digitKey)
  void writeInboundRoutingSnapshot(normalized, digitKey, resolved).catch(() => {})
  if (!resolved) {
    storeIncomingRoutingInMemory(normalized, null)
  }
  return resolved
}

function getIncomingRoutingFromDataCache(
  normalized: string,
  digitKey: string
): Promise<IncomingRoutingByNumber> {
  const run = unstable_cache(
    async () => fetchIncomingRoutingByNumberFromDb(normalized, digitKey),
    ["incoming-routing-v6", normalized, digitKey],
    {
      revalidate: 120,
      tags: [INCOMING_ROUTING_DATA_TAG, `incoming-routing-${normalized}`],
    }
  )
  return run()
}

export async function getIncomingRoutingByNumber(
  toNumber: string,
  options?: { bypassCache?: boolean; lite?: boolean }
): Promise<IncomingRoutingByNumber> {
  const normalized = normalizePhoneNumberE164(toNumber)
  if (!normalized) return null
  const digitKey = phoneDigitsKey(toNumber)

  if (!options?.bypassCache) {
    const cached = incomingRoutingCache.get(normalized)
    if (cached && cached.expiresAt > Date.now()) return cached.value
    return getIncomingRoutingFromDataCache(normalized, digitKey)
  }

  revalidateIncomingRoutingDataCache(normalized)
  return fetchIncomingRoutingByNumberFromDb(normalized, digitKey)
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
        answered_call_customer_popup_enabled, account_role, master_toggle_mode, admin_notification_preferences
      FROM users WHERE id = ${userId} LIMIT 1
    `
    return rows[0] ? parseUserRow(rows[0]) : null
  } catch (initialErr) {
    let e: unknown = initialErr
    if (isMissingAdminNotificationPreferencesColumnError(e)) {
      try {
        const rows = await sql`
          SELECT id, email, name, phone, business_name, inbound_receptionist_whisper_enabled, industry, telnyx_ai_assistant_id, created_at,
            credit_balance_cents, billing_plan, is_platform_admin,
            answered_call_customer_popup_enabled, account_role, master_toggle_mode
          FROM users WHERE id = ${userId} LIMIT 1
        `
        return rows[0] ? parseUserRow(rows[0]) : null
      } catch (e2) {
        e = e2
      }
    }
    if (isMissingMasterToggleModeColumnError(e)) {
      try {
        const rows = await sql`
          SELECT id, email, name, phone, business_name, inbound_receptionist_whisper_enabled, industry, telnyx_ai_assistant_id, created_at,
            credit_balance_cents, billing_plan, is_platform_admin,
            answered_call_customer_popup_enabled, account_role
          FROM users WHERE id = ${userId} LIMIT 1
        `
        return rows[0] ? parseUserRow(rows[0]) : null
      } catch (e2) {
        if (isMissingAccountRoleColumnError(e2)) {
          e = e2
        } else if (
          pgErrorCode(e2) === "42703" &&
          pgErrorMessage(e2).includes("answered_call_customer_popup_enabled")
        ) {
          e = e2
        } else if (isMissingBillingColumnsError(e2)) {
          return getUserWithoutBillingColumnsInSelect(userId)
        } else {
          throw e2
        }
      }
    }
    if (isMissingAccountRoleColumnError(e)) {
      try {
        const rows = await sql`
          SELECT id, email, name, phone, business_name, inbound_receptionist_whisper_enabled, industry, telnyx_ai_assistant_id, created_at,
            credit_balance_cents, billing_plan, is_platform_admin,
            answered_call_customer_popup_enabled
          FROM users WHERE id = ${userId} LIMIT 1
        `
        return rows[0] ? parseUserRow(rows[0]) : null
      } catch (e2) {
        if (pgErrorCode(e2) === "42703" && pgErrorMessage(e2).includes("answered_call_customer_popup_enabled")) {
          try {
            const rows = await sql`
              SELECT id, email, name, phone, business_name, inbound_receptionist_whisper_enabled, industry, telnyx_ai_assistant_id, created_at,
                credit_balance_cents, billing_plan, is_platform_admin
              FROM users WHERE id = ${userId} LIMIT 1
            `
            return rows[0] ? parseUserRow(rows[0]) : null
          } catch (e3) {
            if (isMissingBillingColumnsError(e3)) {
              return getUserWithoutBillingColumnsInSelect(userId)
            }
            throw e3
          }
        }
        if (isMissingBillingColumnsError(e2)) {
          return getUserWithoutBillingColumnsInSelect(userId)
        }
        throw e2
      }
    }
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

/** Persist one platform-admin notification channel toggle. */
export async function updateAdminNotificationPreference(
  userId: string,
  key: keyof AdminNotificationPreferences,
  enabled: boolean
): Promise<AdminNotificationPreferences> {
  const sql = getSql()
  const current = (await getUser(userId))?.admin_notification_preferences
  const merged = { ...parseAdminNotificationPreferences(current), [key]: enabled }
  try {
    await sql`
      UPDATE users
      SET admin_notification_preferences = ${JSON.stringify(merged)}::jsonb
      WHERE id = ${userId}
    `
    return merged
  } catch (e) {
    if (isMissingAdminNotificationPreferencesColumnError(e)) {
      throw new Error(
        "admin_notification_preferences requires scripts/080-admin-notification-preferences.sql in Neon."
      )
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
export async function insertCallLog(log: Omit<CallLog, "id" | "created_at">): Promise<string | null> {
  const sql = getSql()
  const sid = (log.provider_call_sid || "").trim() || `zing-${crypto.randomUUID()}`
  const fromNum = (log.from_number || "").trim() || "Unknown"
  const toNum = (log.to_number || "").trim() || "Unknown"

  try {
    const rows = await sql`
      INSERT INTO call_logs (
        user_id, provider_call_sid, from_number, to_number, caller_name,
        call_type, status, duration_seconds, routed_to_receptionist_id,
        routed_to_name, has_recording, recording_url, recording_duration_seconds, first_ring_at
      ) VALUES (
        ${log.user_id}, ${sid}, ${fromNum}, ${toNum}, ${log.caller_name},
        ${log.call_type}, ${log.status}, ${log.duration_seconds}, ${log.routed_to_receptionist_id},
        ${log.routed_to_name}, ${log.has_recording}, ${log.recording_url}, ${log.recording_duration_seconds}, now()
      )
      RETURNING id
    `
    const callLogId = rows[0]?.id != null ? String(rows[0].id) : null
    void notifyInboundCallInitiatedTelemetry(log, sid, fromNum, toNum, callLogId)
    return callLogId
  } catch (e) {
    const code = pgErrorCode(e)
    const msg = pgErrorMessage(e)
    // Neon not migrated with scripts/007 — no first_ring_at column
    if (code === "42703" && msg.includes("first_ring_at")) {
      const rows = await sql`
        INSERT INTO call_logs (
          user_id, provider_call_sid, from_number, to_number, caller_name,
          call_type, status, duration_seconds, routed_to_receptionist_id,
          routed_to_name, has_recording, recording_url, recording_duration_seconds
        ) VALUES (
          ${log.user_id}, ${sid}, ${fromNum}, ${toNum}, ${log.caller_name},
          ${log.call_type}, ${log.status}, ${log.duration_seconds}, ${log.routed_to_receptionist_id},
          ${log.routed_to_name}, ${log.has_recording}, ${log.recording_url}, ${log.recording_duration_seconds}
        )
        RETURNING id
      `
      const callLogId = rows[0]?.id != null ? String(rows[0].id) : null
      void notifyInboundCallInitiatedTelemetry(log, sid, fromNum, toNum, callLogId)
      return callLogId
    }
    // Legacy DB: twilio_call_sid NOT NULL — duplicate sid into both columns
    if (msg.includes("twilio_call_sid")) {
      try {
        const rows = await sql`
          INSERT INTO call_logs (
            user_id, provider_call_sid, twilio_call_sid, from_number, to_number, caller_name,
            call_type, status, duration_seconds, routed_to_receptionist_id,
            routed_to_name, has_recording, recording_url, recording_duration_seconds, first_ring_at
          ) VALUES (
            ${log.user_id}, ${sid}, ${sid}, ${fromNum}, ${toNum}, ${log.caller_name},
            ${log.call_type}, ${log.status}, ${log.duration_seconds}, ${log.routed_to_receptionist_id},
            ${log.routed_to_name}, ${log.has_recording}, ${log.recording_url}, ${log.recording_duration_seconds}, now()
          )
          RETURNING id
        `
        const callLogId = rows[0]?.id != null ? String(rows[0].id) : null
        void notifyInboundCallInitiatedTelemetry(log, sid, fromNum, toNum, callLogId)
        return callLogId
      } catch (e2) {
        const m2 = pgErrorMessage(e2)
        if (pgErrorCode(e2) === "42703" && m2.includes("first_ring_at")) {
          const rows = await sql`
            INSERT INTO call_logs (
              user_id, provider_call_sid, twilio_call_sid, from_number, to_number, caller_name,
              call_type, status, duration_seconds, routed_to_receptionist_id,
              routed_to_name, has_recording, recording_url, recording_duration_seconds
            ) VALUES (
              ${log.user_id}, ${sid}, ${sid}, ${fromNum}, ${toNum}, ${log.caller_name},
              ${log.call_type}, ${log.status}, ${log.duration_seconds}, ${log.routed_to_receptionist_id},
              ${log.routed_to_name}, ${log.has_recording}, ${log.recording_url}, ${log.recording_duration_seconds}
            )
            RETURNING id
          `
          const callLogId = rows[0]?.id != null ? String(rows[0].id) : null
          void notifyInboundCallInitiatedTelemetry(log, sid, fromNum, toNum, callLogId)
          return callLogId
        }
        throw e2
      }
    }
    throw e
  }
}

/** Push intake sheet + HUD tick when a new inbound call row is created (ringing). */
async function notifyInboundCallInitiatedTelemetry(
  log: Omit<CallLog, "id" | "created_at">,
  sid: string,
  fromNum: string,
  toNum: string,
  callLogId: string | null
): Promise<void> {
  if (log.call_type !== "incoming" || log.status !== "ringing") return
  try {
    const { publishOwnerEvent } = await import("@/lib/realtime/pusher-server")
    const line = await getActivePhoneNumberByE164(toNum).catch(() => null)
    await publishOwnerEvent(log.user_id, "call-initiated", {
      call_sid: sid,
      call_log_id: callLogId,
      from_number: fromNum,
      to_number: toNum,
      organization_id: line?.organization_id ?? null,
    })
  } catch (e) {
    console.warn("[db] call-initiated telemetry publish failed:", e)
  }
}

/** Push call-answered so the intake sheet opens as soon as the caller is bridged. */
async function notifyInboundCallAnsweredTelemetry(params: {
  ownerUserId: string
  callSid: string
  callLogId: string
  fromNumber: string
  toNumber: string
  answeredAt: string | null
}): Promise<void> {
  try {
    const { broadcastCallAnswered } = await import("@/lib/call-telemetry-realtime")
    await broadcastCallAnswered({
      ownerUserId: params.ownerUserId,
      callSid: params.callSid,
      callLogId: params.callLogId,
      fromNumber: params.fromNumber,
      toNumber: params.toNumber,
      organizationId: null,
      answeredAt: params.answeredAt,
    })
  } catch (e) {
    console.warn("[db] call-answered telemetry publish failed:", e)
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
  updates: Partial<
    Pick<
      CallLog,
      | "status"
      | "duration_seconds"
      | "call_type"
      | "has_recording"
      | "recording_url"
      | "recording_duration_seconds"
      | "answered_at"
      | "ended_at"
      | "setup_duration_ms"
      | "post_dial_delay_ms"
      | "routed_to_name"
    >
  >
): Promise<void> {
  const sql = getSql()
  if (updates.status !== undefined) {
    await sql`UPDATE call_logs SET status = ${updates.status} WHERE provider_call_sid = ${providerCallSid} OR twilio_call_sid = ${providerCallSid}`
  }
  if (updates.duration_seconds !== undefined) {
    // Keep the longest known talk time — status webhooks often arrive with 0 after dial callbacks already logged seconds.
    await sql`
      UPDATE call_logs
      SET duration_seconds = GREATEST(COALESCE(duration_seconds, 0), ${updates.duration_seconds})
      WHERE provider_call_sid = ${providerCallSid} OR twilio_call_sid = ${providerCallSid}
    `
  }
  if (updates.call_type !== undefined) {
    await sql`UPDATE call_logs SET call_type = ${updates.call_type} WHERE provider_call_sid = ${providerCallSid} OR twilio_call_sid = ${providerCallSid}`
  }
  if (updates.has_recording !== undefined) {
    await sql`UPDATE call_logs SET has_recording = ${updates.has_recording}, recording_url = ${updates.recording_url ?? null}, recording_duration_seconds = ${updates.recording_duration_seconds ?? null} WHERE provider_call_sid = ${providerCallSid} OR twilio_call_sid = ${providerCallSid}`
  }
  // Timing columns come from scripts/007-call-quality-metrics.sql. Ignore writes
  // when that migration hasn't run yet so call routing/sandbox still works.
  if (updates.answered_at !== undefined) {
    try {
      await sql`UPDATE call_logs SET answered_at = ${updates.answered_at ?? null} WHERE provider_call_sid = ${providerCallSid} OR twilio_call_sid = ${providerCallSid}`
    } catch (e) {
      if (!isMissing007TimingColumnError(e)) throw e
    }
  }
  if (updates.ended_at !== undefined) {
    try {
      await sql`UPDATE call_logs SET ended_at = ${updates.ended_at ?? null} WHERE provider_call_sid = ${providerCallSid} OR twilio_call_sid = ${providerCallSid}`
    } catch (e) {
      if (!isMissing007TimingColumnError(e)) throw e
    }
  }
  if (updates.setup_duration_ms !== undefined) {
    try {
      await sql`UPDATE call_logs SET setup_duration_ms = ${updates.setup_duration_ms ?? null} WHERE provider_call_sid = ${providerCallSid} OR twilio_call_sid = ${providerCallSid}`
    } catch (e) {
      if (!isMissing007TimingColumnError(e)) throw e
    }
  }
  if (updates.post_dial_delay_ms !== undefined) {
    try {
      await sql`UPDATE call_logs SET post_dial_delay_ms = ${updates.post_dial_delay_ms ?? null} WHERE provider_call_sid = ${providerCallSid} OR twilio_call_sid = ${providerCallSid}`
    } catch (e) {
      if (!isMissing007TimingColumnError(e)) throw e
    }
  }
  if (updates.routed_to_name !== undefined) {
    await sql`UPDATE call_logs SET routed_to_name = ${updates.routed_to_name ?? null} WHERE provider_call_sid = ${providerCallSid} OR twilio_call_sid = ${providerCallSid}`
  }
}

/**
 * Close out lingering sandbox mock calls (provider_call_sid like 'sandbox-mock-%') for an owner.
 * Sandbox sims never get a real status callback, so an in-progress row would otherwise make the
 * receptionist look busy for 2 hours and block the next simulate. Returns rows updated.
 */
export async function closeStaleSandboxMockCalls(userId: string): Promise<number> {
  const sql = getSql()
  try {
    // Stamp ended_at so the live-status HUD (which filters ended_at IS NULL) clears the call.
    const rows = await sql`
      UPDATE call_logs
      SET status = 'completed', ended_at = COALESCE(ended_at, now())
      WHERE user_id = ${userId}
        AND provider_call_sid LIKE 'sandbox-mock-%'
        AND (ended_at IS NULL OR lower(status) IN ('answered', 'in-progress', 'ringing'))
      RETURNING id
    `
    return (rows as unknown[]).length
  } catch (e) {
    if (!isMissing007TimingColumnError(e)) {
      console.warn("[db] closeStaleSandboxMockCalls:", pgErrorMessage(e))
      return 0
    }
    // No ended_at column — fall back to status only.
    try {
      const rows = await sql`
        UPDATE call_logs
        SET status = 'completed'
        WHERE user_id = ${userId}
          AND provider_call_sid LIKE 'sandbox-mock-%'
          AND lower(status) IN ('answered', 'in-progress', 'ringing')
        RETURNING id
      `
      return (rows as unknown[]).length
    } catch (inner) {
      console.warn("[db] closeStaleSandboxMockCalls fallback:", pgErrorMessage(inner))
      return 0
    }
  }
}

/** Resolve account owner from a Telnyx/Twilio call SID (for usage billing side-effects). */
export async function getCallLogUserIdByProviderSid(providerCallSid: string): Promise<string | null> {
  const sid = providerCallSid.trim()
  if (!sid) return null
  const sql = getSql()
  const rows = await sql`
    SELECT user_id FROM call_logs
    WHERE provider_call_sid = ${sid} OR twilio_call_sid = ${sid}
    LIMIT 1
  `
  return rows[0]?.user_id != null ? String(rows[0].user_id) : null
}

function isPgTruthy(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t" || value === "true"
}

/** Snapshot a finished call row for owner-channel Pusher telemetry (HUD metric deltas). */
export async function getCallLogSnapshotForTelemetry(providerCallSid: string): Promise<{
  id: string
  user_id: string
  from_number: string
  to_number: string
  duration_seconds: number
  call_type: string
  status: string
  answered_at: string | null
  ended_at: string | null
  routed_to_name: string | null
  organization_id: string | null
} | null> {
  const sid = providerCallSid.trim()
  if (!sid) return null
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT cl.id, cl.user_id, cl.from_number, cl.to_number, cl.duration_seconds, cl.call_type, cl.status,
             cl.answered_at, cl.ended_at, cl.routed_to_name, pn.organization_id
      FROM call_logs cl
      LEFT JOIN phone_numbers pn ON pn.user_id = cl.user_id
        AND regexp_replace(coalesce(pn.number, ''), '\\D', '', 'g')
          = regexp_replace(coalesce(cl.to_number, ''), '\\D', '', 'g')
      WHERE cl.provider_call_sid = ${sid} OR cl.twilio_call_sid = ${sid}
      LIMIT 1
    `
    const row = rows[0]
    if (!row?.user_id) return null
    return {
      id: String(row.id),
      user_id: String(row.user_id),
      from_number: String(row.from_number ?? ""),
      to_number: String(row.to_number ?? ""),
      duration_seconds: row.duration_seconds == null ? 0 : Number(row.duration_seconds),
      call_type: String(row.call_type ?? ""),
      status: String(row.status ?? ""),
      answered_at: row.answered_at ? String(row.answered_at) : null,
      ended_at: row.ended_at ? String(row.ended_at) : null,
      routed_to_name: row.routed_to_name ? String(row.routed_to_name) : null,
      organization_id: row.organization_id != null ? String(row.organization_id) : null,
    }
  } catch {
    const rows = await sql`
      SELECT id, user_id, from_number, to_number, duration_seconds, call_type, status, answered_at, ended_at, routed_to_name
      FROM call_logs
      WHERE provider_call_sid = ${sid} OR twilio_call_sid = ${sid}
      LIMIT 1
    `
    const row = rows[0]
    if (!row?.user_id) return null
    return {
      id: String(row.id),
      user_id: String(row.user_id),
      from_number: String(row.from_number ?? ""),
      to_number: String(row.to_number ?? ""),
      duration_seconds: row.duration_seconds == null ? 0 : Number(row.duration_seconds),
      call_type: String(row.call_type ?? ""),
      status: String(row.status ?? ""),
      answered_at: row.answered_at ? String(row.answered_at) : null,
      ended_at: row.ended_at ? String(row.ended_at) : null,
      routed_to_name: row.routed_to_name ? String(row.routed_to_name) : null,
      organization_id: null,
    }
  }
}

// Record a provider status event and derive setup timing metrics.
export async function recordCallStatusEvent(
  providerCallSid: string,
  callStatus: string,
  durationSeconds: number,
  occurredAtIso?: string,
  options?: { skipAnsweredTelemetry?: boolean }
): Promise<void> {
  const sql = getSql()
  const normalizedStatus = callStatus.trim().toLowerCase().replace(/_/g, "-")
  const occurredAt = occurredAtIso ? new Date(occurredAtIso) : new Date()
  const providerSid = providerCallSid.trim()
  try {
    const rows = await sql`
      WITH target AS (
        SELECT id, user_id, from_number, to_number, call_type, answered_at
        FROM call_logs
        WHERE provider_call_sid = ${providerSid} OR twilio_call_sid = ${providerSid}
        LIMIT 1
      ),
      updated AS (
        UPDATE call_logs cl
        SET
          status = ${normalizedStatus},
          duration_seconds = CASE
            WHEN ${normalizedStatus} IN ('completed', 'busy', 'failed', 'no-answer', 'canceled')
              AND cl.answered_at IS NOT NULL THEN
              GREATEST(
                ${durationSeconds},
                EXTRACT(EPOCH FROM (${occurredAt} - cl.answered_at))::int
              )
            ELSE GREATEST(COALESCE(cl.duration_seconds, 0), ${durationSeconds})
          END,
          answered_at = CASE
            WHEN ${normalizedStatus} IN ('answered', 'in-progress') AND cl.answered_at IS NULL THEN ${occurredAt}
            ELSE cl.answered_at
          END,
          ended_at = CASE
            WHEN ${normalizedStatus} IN ('completed', 'busy', 'failed', 'no-answer', 'canceled') THEN ${occurredAt}
            ELSE cl.ended_at
          END,
          setup_duration_ms = CASE
            WHEN ${normalizedStatus} IN ('answered', 'in-progress', 'completed') AND cl.first_ring_at IS NOT NULL THEN
              EXTRACT(EPOCH FROM (${occurredAt} - cl.first_ring_at))::int * 1000
            ELSE cl.setup_duration_ms
          END,
          post_dial_delay_ms = CASE
            WHEN ${normalizedStatus} IN ('answered', 'in-progress', 'completed') AND cl.first_ring_at IS NOT NULL THEN
              EXTRACT(EPOCH FROM (${occurredAt} - cl.first_ring_at))::int * 1000
            ELSE cl.post_dial_delay_ms
          END
        FROM target t
        WHERE cl.id = t.id
        RETURNING cl.id, cl.user_id, cl.from_number, cl.to_number, cl.call_type, cl.answered_at
      )
      SELECT
        u.id,
        u.user_id,
        u.from_number,
        u.to_number,
        u.call_type,
        u.answered_at,
        (t.answered_at IS NULL AND u.answered_at IS NOT NULL) AS newly_answered
      FROM updated u
      JOIN target t ON t.id = u.id
    `
    const row = rows[0] as
      | {
          id: string
          user_id: string
          from_number: string
          to_number: string
          call_type: string
          answered_at: Date | string | null
          newly_answered: boolean | string | number
        }
      | undefined
    if (
      row &&
      isPgTruthy(row.newly_answered) &&
      row.call_type === "incoming" &&
      !options?.skipAnsweredTelemetry
    ) {
      void notifyInboundCallAnsweredTelemetry({
        ownerUserId: String(row.user_id),
        callSid: providerSid,
        callLogId: String(row.id),
        fromNumber: String(row.from_number ?? ""),
        toNumber: String(row.to_number ?? ""),
        answeredAt: row.answered_at ? String(row.answered_at) : null,
      })
    }
  } catch (e) {
    // scripts/007 timing columns not migrated yet — fall back to status + duration only.
    if (!isMissing007TimingColumnError(e)) throw e
    await sql`
      UPDATE call_logs
      SET
        status = ${normalizedStatus},
        duration_seconds = GREATEST(COALESCE(duration_seconds, 0), ${durationSeconds})
      WHERE provider_call_sid = ${providerCallSid} OR twilio_call_sid = ${providerCallSid}
    `
  }
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

/** Today's call HUD metrics for the routing strip (workspace-scoped via business line DIDs). */
export async function getDailyCallTelemetryForOwner(
  sessionUserId: string,
  organizationId?: string | null,
  timezone?: string | null
): Promise<{
  daily_calls: number
  missed_calls: number
  avg_talk_seconds: number
  daily_talk_seconds: number
  weekly_talk_seconds: number
  monthly_talk_seconds: number
  /** Business owner whose call_logs + Pusher channel back these metrics. */
  telemetry_owner_user_id: string
}> {
  const sql = getSql()
  const orgUuid =
    organizationId && !organizationId.startsWith("legacy-") ? organizationId.trim() : null

  let telemetryOwnerUserId = sessionUserId
  if (orgUuid) {
    const org = await getOrganizationById(orgUuid)
    if (org?.owner_user_id) telemetryOwnerUserId = org.owner_user_id
  }

  let lineNumbers: string[] | null = null
  if (orgUuid) {
    const lines = await getPhoneNumbers(telemetryOwnerUserId, orgUuid)
    lineNumbers = [
      ...new Set(
        lines
          .map((line) => normalizePhoneNumberE164(line.number))
          .filter((n) => n.length >= 10)
      ),
    ]
    if (lineNumbers.length === 0) {
      return {
        daily_calls: 0,
        missed_calls: 0,
        avg_talk_seconds: 0,
        daily_talk_seconds: 0,
        weekly_talk_seconds: 0,
        monthly_talk_seconds: 0,
        telemetry_owner_user_id: telemetryOwnerUserId,
      }
    }
  }

  const talkableWhere = sql`
    talk_seconds > 0
    AND call_type IS DISTINCT FROM 'missed'
    AND call_type IS DISTINCT FROM 'voicemail'
  `

  const missedWhere = sql`
    call_type IN ('missed', 'voicemail')
    OR lower(COALESCE(status, '')) IN ('no-answer', 'busy', 'missed', 'canceled', 'cancelled')
    OR (
      call_type = 'incoming'
      AND lower(COALESCE(status, '')) IN ('completed', 'canceled', 'cancelled')
      AND NOT (
        answered_at IS NOT NULL
        AND ended_at IS NOT NULL
        AND answered_at < ended_at - interval '2 seconds'
      )
    )
  `

  const tz = sanitizeIanaTimezone(timezone)
  const rollingDayMatch = sql`created_at >= now() - interval '24 hours'`
  const localDayMatch = sql`date_trunc('day', timezone(${tz}, created_at)) = date_trunc('day', timezone(${tz}, now()))`
  const localWeekMatch = sql`date_trunc('week', timezone(${tz}, created_at)) = date_trunc('week', timezone(${tz}, now()))`
  const localMonthMatch = sql`date_trunc('month', timezone(${tz}, created_at)) = date_trunc('month', timezone(${tz}, now()))`
  /** Week ∩ month — avoids weekly > monthly when Mon–Sun spans two months (e.g. Jun 30 + July). */
  const localWeekInMonthMatch = sql`${localWeekMatch} AND ${localMonthMatch}`

  const rows = lineNumbers
    ? await sql`
        WITH scoped AS (
          SELECT
            created_at,
            call_type,
            status,
            answered_at,
            routed_to_name,
            ended_at,
            GREATEST(
              0,
              COALESCE(duration_seconds, 0),
              COALESCE(recording_duration_seconds, 0),
              CASE
                WHEN answered_at IS NOT NULL AND ended_at IS NOT NULL
                  THEN EXTRACT(EPOCH FROM (ended_at - answered_at))::int
                ELSE 0
              END
            ) AS talk_seconds
          FROM call_logs
          WHERE user_id = ${telemetryOwnerUserId}
            AND to_number = ANY(${lineNumbers})
        )
        SELECT
          COUNT(*) FILTER (WHERE ${rollingDayMatch})::int AS daily_calls,
          COUNT(*) FILTER (
            WHERE ${localDayMatch}
              AND (${missedWhere})
          )::int AS missed_calls,
          COALESCE(
            AVG(talk_seconds) FILTER (
              WHERE ${rollingDayMatch} AND ${talkableWhere}
            ),
            0
          )::float8 AS avg_talk_seconds,
          COALESCE(
            SUM(talk_seconds) FILTER (
              WHERE ${rollingDayMatch} AND ${talkableWhere}
            ),
            0
          )::int AS daily_talk_seconds,
          COALESCE(
            SUM(talk_seconds) FILTER (
              WHERE ${localWeekInMonthMatch} AND ${talkableWhere}
            ),
            0
          )::int AS weekly_talk_seconds,
          COALESCE(
            SUM(talk_seconds) FILTER (
              WHERE ${localMonthMatch} AND ${talkableWhere}
            ),
            0
          )::int AS monthly_talk_seconds
        FROM scoped
      `
    : await sql`
        WITH scoped AS (
          SELECT
            created_at,
            call_type,
            status,
            answered_at,
            routed_to_name,
            ended_at,
            GREATEST(
              0,
              COALESCE(duration_seconds, 0),
              COALESCE(recording_duration_seconds, 0),
              CASE
                WHEN answered_at IS NOT NULL AND ended_at IS NOT NULL
                  THEN EXTRACT(EPOCH FROM (ended_at - answered_at))::int
                ELSE 0
              END
            ) AS talk_seconds
          FROM call_logs
          WHERE user_id = ${telemetryOwnerUserId}
        )
        SELECT
          COUNT(*) FILTER (WHERE ${rollingDayMatch})::int AS daily_calls,
          COUNT(*) FILTER (
            WHERE ${localDayMatch}
              AND (${missedWhere})
          )::int AS missed_calls,
          COALESCE(
            AVG(talk_seconds) FILTER (
              WHERE ${rollingDayMatch} AND ${talkableWhere}
            ),
            0
          )::float8 AS avg_talk_seconds,
          COALESCE(
            SUM(talk_seconds) FILTER (
              WHERE ${rollingDayMatch} AND ${talkableWhere}
            ),
            0
          )::int AS daily_talk_seconds,
          COALESCE(
            SUM(talk_seconds) FILTER (
              WHERE ${localWeekInMonthMatch} AND ${talkableWhere}
            ),
            0
          )::int AS weekly_talk_seconds,
          COALESCE(
            SUM(talk_seconds) FILTER (
              WHERE ${localMonthMatch} AND ${talkableWhere}
            ),
            0
          )::int AS monthly_talk_seconds
        FROM scoped
      `

  const row = rows[0] as Record<string, unknown> | undefined
  return {
    daily_calls: Number(row?.daily_calls ?? 0),
    missed_calls: Number(row?.missed_calls ?? 0),
    avg_talk_seconds: Number(row?.avg_talk_seconds ?? 0),
    daily_talk_seconds: Number(row?.daily_talk_seconds ?? 0),
    weekly_talk_seconds: Number(row?.weekly_talk_seconds ?? 0),
    monthly_talk_seconds: Number(row?.monthly_talk_seconds ?? 0),
    telemetry_owner_user_id: telemetryOwnerUserId,
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
    disposition: row.disposition != null ? String(row.disposition) : null,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }
}

/** Leads + customer saves linked to recent call logs (Live Activity enrichment). */
export async function fetchCallActivityEnrichmentRows(
  userId: string,
  callLogIds: string[],
  callerPhonesE164: string[]
): Promise<{
  leadRows: Record<string, unknown>[]
  customerCallLogIds: Set<string>
}> {
  const sql = getSql()
  const ids = [...new Set(callLogIds.map((id) => id.trim()).filter(Boolean))]
  const phones = [...new Set(callerPhonesE164.map((p) => p.trim()).filter(Boolean))]
  const vapiKeys = ids.map((id) => `${id}-intake-job`)
  if (ids.length === 0 && phones.length === 0) {
    return { leadRows: [], customerCallLogIds: new Set() }
  }

  let leadRows: Record<string, unknown>[] = []

  async function queryLeadsMinimal(): Promise<Record<string, unknown>[]> {
    if (phones.length > 0 && vapiKeys.length > 0 && ids.length > 0) {
      return (await sql`
        SELECT id, caller_e164, collected, summary, created_at, vapi_call_id
        FROM ai_leads
        WHERE user_id = ${userId}
          AND (
            caller_e164 = ANY(${phones})
            OR vapi_call_id = ANY(${vapiKeys})
            OR collected->>'call_log_id' = ANY(${ids})
          )
        ORDER BY created_at DESC
        LIMIT 300
      `) as Record<string, unknown>[]
    }
    if (phones.length > 0 && vapiKeys.length > 0) {
      return (await sql`
        SELECT id, caller_e164, collected, summary, created_at, vapi_call_id
        FROM ai_leads
        WHERE user_id = ${userId}
          AND (caller_e164 = ANY(${phones}) OR vapi_call_id = ANY(${vapiKeys}))
        ORDER BY created_at DESC
        LIMIT 300
      `) as Record<string, unknown>[]
    }
    if (phones.length > 0) {
      return (await sql`
        SELECT id, caller_e164, collected, summary, created_at, vapi_call_id
        FROM ai_leads
        WHERE user_id = ${userId} AND caller_e164 = ANY(${phones})
        ORDER BY created_at DESC
        LIMIT 300
      `) as Record<string, unknown>[]
    }
    if (vapiKeys.length > 0) {
      return (await sql`
        SELECT id, caller_e164, collected, summary, created_at, vapi_call_id
        FROM ai_leads
        WHERE user_id = ${userId} AND vapi_call_id = ANY(${vapiKeys})
        ORDER BY created_at DESC
        LIMIT 300
      `) as Record<string, unknown>[]
    }
    return (await sql`
      SELECT id, caller_e164, collected, summary, created_at, vapi_call_id
      FROM ai_leads
      WHERE user_id = ${userId} AND collected->>'call_log_id' = ANY(${ids})
      ORDER BY created_at DESC
      LIMIT 300
    `) as Record<string, unknown>[]
  }

  async function queryLeadsExtended(): Promise<Record<string, unknown>[]> {
    if (phones.length > 0 && vapiKeys.length > 0 && ids.length > 0) {
      return (await sql`
        SELECT l.id, l.caller_e164, l.collected, l.summary, l.created_at, l.vapi_call_id,
               l.disposition, l.scheduled_at, l.dispatch_status, l.job_status,
               t.name AS assigned_tech_name
        FROM ai_leads l
        LEFT JOIN field_technicians t ON t.portal_user_id = l.assigned_tech_id
        WHERE l.user_id = ${userId}
          AND (
            l.caller_e164 = ANY(${phones})
            OR l.vapi_call_id = ANY(${vapiKeys})
            OR l.collected->>'call_log_id' = ANY(${ids})
          )
        ORDER BY l.created_at DESC
        LIMIT 300
      `) as Record<string, unknown>[]
    }
    return queryLeadsMinimal()
  }

  try {
    leadRows = await queryLeadsExtended()
  } catch (e) {
    if (isUndefinedRelationError(e, "ai_leads")) {
      leadRows = []
    } else {
      console.warn("[db] fetchCallActivityEnrichmentRows extended query failed, using minimal:", e)
      try {
        leadRows = await queryLeadsMinimal()
      } catch (e2) {
        if (isUndefinedRelationError(e2, "ai_leads")) leadRows = []
        else throw e2
      }
    }
  }

  const customerCallLogIds = new Set<string>()
  if (ids.length > 0) {
    try {
      const customerRows = await sql`
        SELECT source_last_call_log_id
        FROM customers
        WHERE user_id = ${userId}
          AND source_last_call_log_id::text = ANY(${ids})
      `
      for (const row of customerRows as Record<string, unknown>[]) {
        const src = row.source_last_call_log_id ? String(row.source_last_call_log_id) : ""
        if (src) customerCallLogIds.add(src)
      }
    } catch (e) {
      if (!isUndefinedRelationError(e, "customers")) {
        console.warn("[db] fetchCallActivityEnrichmentRows customers lookup failed:", e)
      }
    }
  }

  return {
    leadRows,
    customerCallLogIds,
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
      SELECT cl.* FROM call_logs cl
      WHERE cl.user_id = ${userId}
        AND cl.call_type = 'incoming'
        AND cl.answered_at IS NOT NULL
        AND cl.answered_at > (now() - (${withinMinutes}::numeric * interval '1 minute'))
        AND cl.owner_intake_dismissed_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM ai_leads l
          WHERE l.user_id = cl.user_id
            AND (
              l.collected->>'call_log_id' = cl.id::text
              OR l.vapi_call_id = cl.id::text || '-intake-job'
            )
        )
      ORDER BY cl.answered_at DESC
      LIMIT 40
    `
  } catch (e) {
    if (pgErrorCode(e) === "42703") {
      const msg = pgErrorMessage(e)
      if (msg.includes("owner_intake_dismissed_at")) {
        console.warn(
          "[db] listRecentlyAnsweredIncomingCalls: owner_intake_dismissed_at missing — run scripts/083-call-log-owner-intake-dismissed.sql."
        )
        try {
          rows = await sql`
            SELECT cl.* FROM call_logs cl
            WHERE cl.user_id = ${userId}
              AND cl.call_type = 'incoming'
              AND cl.answered_at IS NOT NULL
              AND cl.answered_at > (now() - (${withinMinutes}::numeric * interval '1 minute'))
              AND NOT EXISTS (
                SELECT 1 FROM ai_leads l
                WHERE l.user_id = cl.user_id
                  AND (
                    l.collected->>'call_log_id' = cl.id::text
                    OR l.vapi_call_id = cl.id::text || '-intake-job'
                  )
              )
            ORDER BY cl.answered_at DESC
            LIMIT 40
          `
        } catch (inner) {
          if (pgErrorCode(inner) === "42703" && pgErrorMessage(inner).includes("answered_at")) {
            return []
          }
          throw inner
        }
      } else if (msg.includes("answered_at")) {
        console.warn("[db] listRecentlyAnsweredIncomingCalls: answered_at missing — run scripts/007-call-quality-metrics.sql.")
        return []
      } else {
        throw e
      }
    } else {
      throw e
    }
  }
  return rows.map((row) => parseCallLogRow(row as Record<string, unknown>))
}

/** Inbound calls still ringing — for early intake sheet before answer. */
export async function listRecentlyRingingIncomingCalls(
  userId: string,
  withinMinutes = 5
): Promise<CallLog[]> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT cl.* FROM call_logs cl
      WHERE cl.user_id = ${userId}
        AND cl.call_type = 'incoming'
        AND lower(cl.status) = 'ringing'
        AND cl.answered_at IS NULL
        AND cl.created_at > (now() - (${withinMinutes}::numeric * interval '1 minute'))
        AND cl.owner_intake_dismissed_at IS NULL
      ORDER BY cl.created_at DESC
      LIMIT 20
    `
    return rows.map((row) => parseCallLogRow(row as Record<string, unknown>))
  } catch (e) {
    if (pgErrorCode(e) === "42703") {
      const msg = pgErrorMessage(e)
      if (msg.includes("owner_intake_dismissed_at")) {
        try {
          const rows = await sql`
            SELECT * FROM call_logs
            WHERE user_id = ${userId}
              AND call_type = 'incoming'
              AND lower(status) = 'ringing'
              AND answered_at IS NULL
              AND created_at > (now() - (${withinMinutes}::numeric * interval '1 minute'))
            ORDER BY created_at DESC
            LIMIT 20
          `
          return rows.map((row) => parseCallLogRow(row as Record<string, unknown>))
        } catch (inner) {
          if (pgErrorCode(inner) === "42703" && pgErrorMessage(inner).includes("answered_at")) {
            return []
          }
          throw inner
        }
      }
      if (msg.includes("answered_at")) {
        return []
      }
    }
    throw e
  }
}

/** Owner closed or dispatched the answered-call intake sheet — suppress re-open everywhere. */
export async function markCallLogOwnerIntakeDismissed(
  userId: string,
  callLogId: string
): Promise<boolean> {
  const sql = getSql()
  const id = String(callLogId).trim()
  if (!id) return false
  try {
    const rows = await sql`
      UPDATE call_logs
      SET owner_intake_dismissed_at = COALESCE(owner_intake_dismissed_at, now())
      WHERE id = ${id}::uuid
        AND user_id = ${userId}
      RETURNING id
    `
    return rows.length > 0
  } catch (e) {
    if (pgErrorCode(e) === "42703" && pgErrorMessage(e).includes("owner_intake_dismissed_at")) {
      console.warn(
        "[db] markCallLogOwnerIntakeDismissed: column missing — run scripts/083-call-log-owner-intake-dismissed.sql."
      )
      return true
    }
    throw e
  }
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
  const sourceRaw = row.source_provider != null ? String(row.source_provider).toLowerCase() : "telnyx"
  const lineOverride =
    row.admin_routing_override_phone != null ? String(row.admin_routing_override_phone).trim() || null : null
  const orgOverride =
    row.organization_admin_routing_override_phone != null
      ? String(row.organization_admin_routing_override_phone).trim() || null
      : null
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    organization_id: row.organization_id != null ? String(row.organization_id) : null,
    provider_number_sid: String(row.provider_number_sid ?? row.twilio_sid ?? ""),
    number: String(row.number),
    friendly_name: String(row.friendly_name ?? ""),
    label: String(row.label ?? "Business Line"),
    type: (row.type as "local" | "toll-free") || "local",
    status: (row.status as PhoneNumber["status"]) || "active",
    source_provider: sourceRaw === "external" ? "external" : "telnyx",
    external_verified: Boolean(row.external_verified),
    industry_tag:
      row.industry_tag != null && String(row.industry_tag).trim() !== "" ? String(row.industry_tag).trim() : null,
    routing_pool_mode: parseRoutingPoolMode(row.routing_pool_mode),
    admin_routing_override_phone: lineOverride,
    organization_admin_routing_override_phone: orgOverride,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }
}

function parseOrganizationRow(row: Record<string, unknown>): Organization {
  const org: Organization = {
    id: String(row.id),
    owner_user_id: String(row.owner_user_id),
    name: String(row.name),
    is_default: Boolean(row.is_default),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }
  if (row.sms_registration_status != null) {
    const s = String(row.sms_registration_status).toUpperCase()
    if (s === "PENDING_APPROVAL" || s === "APPROVED" || s === "REJECTED" || s === "NONE") {
      org.sms_registration_status = s as Organization["sms_registration_status"]
    }
  }
  if (row.admin_routing_override_phone != null && String(row.admin_routing_override_phone).trim()) {
    org.admin_routing_override_phone = String(row.admin_routing_override_phone).trim()
  }
  return org
}

function isMissingOrganizationsSchemaError(e: unknown): boolean {
  if (isUndefinedRelationError(e, "organizations")) return true
  if (pgErrorCode(e) !== "42703") return false
  const msg = pgErrorMessage(e).toLowerCase()
  return msg.includes("organization_id") || msg.includes("source_provider") || msg.includes("external_verified")
}

/** List workspaces for an owner (`065`). Returns a synthetic default row when migration not applied yet. */
export async function listOrganizationsForOwner(ownerUserId: string): Promise<Organization[]> {
  const sql = getSql()
  try {
    try {
      const rows = await sql`
        SELECT id, owner_user_id, name, is_default, created_at, sms_registration_status, admin_routing_override_phone
        FROM organizations
        WHERE owner_user_id = ${ownerUserId}
        ORDER BY is_default DESC, created_at ASC
      `
      if (rows.length > 0) return rows.map((r) => parseOrganizationRow(r as Record<string, unknown>))
    } catch (e) {
      if (pgErrorCode(e) === "42703") {
        const rows = await sql`
          SELECT id, owner_user_id, name, is_default, created_at
          FROM organizations
          WHERE owner_user_id = ${ownerUserId}
          ORDER BY is_default DESC, created_at ASC
        `
        if (rows.length > 0) return rows.map((r) => parseOrganizationRow(r as Record<string, unknown>))
      } else if (!isMissingOrganizationsSchemaError(e)) {
        throw e
      }
    }
  } catch (e) {
    if (!isMissingOrganizationsSchemaError(e)) throw e
  }
  const user = await getUser(ownerUserId)
  const name = user?.business_name?.trim() || user?.name?.trim() || "My Business"
  return [
    {
      id: `legacy-${ownerUserId}`,
      owner_user_id: ownerUserId,
      name,
      is_default: true,
      created_at: new Date().toISOString(),
    },
  ]
}

/** Resolve an organization the owner may use (real UUID rows only). */
export async function getOrganizationForOwner(
  organizationId: string,
  ownerUserId: string
): Promise<Organization | null> {
  if (organizationId.startsWith("legacy-")) {
    const list = await listOrganizationsForOwner(ownerUserId)
    return list.find((o) => o.id === organizationId) ?? list[0] ?? null
  }
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT id, owner_user_id, name, is_default, created_at
      FROM organizations
      WHERE id = ${organizationId} AND owner_user_id = ${ownerUserId}
      LIMIT 1
    `
    return rows[0] ? parseOrganizationRow(rows[0] as Record<string, unknown>) : null
  } catch (e) {
    if (isMissingOrganizationsSchemaError(e)) {
      const list = await listOrganizationsForOwner(ownerUserId)
      return list[0] ?? null
    }
    throw e
  }
}

/** Load a workspace row by id (any owner — used when binding technicians to a viewed workspace). */
export async function getOrganizationById(organizationId: string): Promise<Organization | null> {
  if (organizationId.startsWith("legacy-")) return null
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT id, owner_user_id, name, is_default, created_at
      FROM organizations
      WHERE id = ${organizationId}
      LIMIT 1
    `
    return rows[0] ? parseOrganizationRow(rows[0] as Record<string, unknown>) : null
  } catch (e) {
    if (isMissingOrganizationsSchemaError(e)) return null
    throw e
  }
}

export async function getDefaultOrganizationForOwner(ownerUserId: string): Promise<Organization | null> {
  const list = await listOrganizationsForOwner(ownerUserId)
  return list.find((o) => o.is_default) ?? list[0] ?? null
}

/** Real workspace rows (excludes synthetic legacy-* placeholder). */
export async function countRealOrganizationsForOwner(ownerUserId: string): Promise<number> {
  const list = await listOrganizationsForOwner(ownerUserId)
  return list.filter((o) => !o.id.startsWith("legacy-")).length
}

/**
 * Pick organization_id for a new phone line.
 * Multi-workspace owners must pass an explicit org — we do not silently attach to the default business.
 */
export async function resolveOrganizationIdForNewPhoneLine(
  ownerUserId: string,
  explicitOrganizationId?: string | null,
  options?: { assignDefaultOrganization?: boolean }
): Promise<string | null> {
  if (explicitOrganizationId?.trim() && !explicitOrganizationId.startsWith("legacy-")) {
    return explicitOrganizationId.trim()
  }
  if (options?.assignDefaultOrganization === false) return null
  const realOrgCount = await countRealOrganizationsForOwner(ownerUserId)
  if (realOrgCount > 1) return null
  const def = await getDefaultOrganizationForOwner(ownerUserId)
  if (def && !def.id.startsWith("legacy-")) return def.id
  return null
}

/**
 * Move auto-synced "Business Line" rows off the default workspace when they are not tied to that workspace.
 * Runs once per GET /api/numbers/mine for multi-workspace accounts.
 */
export async function repairMisassignedDefaultOrgPhoneLines(ownerUserId: string): Promise<number> {
  const realOrgCount = await countRealOrganizationsForOwner(ownerUserId)
  if (realOrgCount <= 1) return 0

  const defaultOrg = await getDefaultOrganizationForOwner(ownerUserId)
  if (!defaultOrg || defaultOrg.id.startsWith("legacy-")) return 0

  const sql = getSql()
  const ports = await listPortingOrdersForOwner(ownerUserId)
  const portOrgByNumber = new Map<string, string>()
  for (const port of ports) {
    const e164 = normalizePhoneNumberE164(port.phone_number)
    if (!e164) continue
    const orgId = port.organization_id?.trim()
    if (orgId && !orgId.startsWith("legacy-")) portOrgByNumber.set(e164, orgId)
  }

  const numbers = await getPhoneNumbers(ownerUserId)
  let fixed = 0
  for (const row of numbers) {
    if (row.organization_id !== defaultOrg.id) continue
    const label = row.label?.trim() || "Business Line"
    if (label !== "Business Line") continue

    const e164 = normalizePhoneNumberE164(row.number)
    const portOrg = portOrgByNumber.get(e164)
    if (portOrg === defaultOrg.id) continue

    if (portOrg) {
      const moved = await sql`
        UPDATE phone_numbers
        SET organization_id = ${portOrg}
        WHERE id = ${row.id} AND user_id = ${ownerUserId}
        RETURNING id
      `
      if (moved.length > 0) fixed += 1
      continue
    }

    const cleared = await sql`
      UPDATE phone_numbers
      SET organization_id = NULL
      WHERE id = ${row.id} AND user_id = ${ownerUserId}
      RETURNING id
    `
    if (cleared.length > 0) fixed += 1
  }

  if (fixed > 0) clearIncomingRoutingCache()
  return fixed
}

function isMissingSmsRegistrationsTableError(e: unknown): boolean {
  return isUndefinedRelationError(e, "sms_registrations")
}

function parseSmsRegistrationRow(row: Record<string, unknown>): SmsRegistration {
  const status = String(row.status ?? "DRAFT").toUpperCase()
  const normalized: SmsRegistrationStatus =
    status === "PENDING_APPROVAL" || status === "APPROVED" || status === "REJECTED" ? status : "DRAFT"
  return {
    id: String(row.id),
    organization_id: row.organization_id != null ? String(row.organization_id) : null,
    owner_user_id: String(row.owner_user_id),
    legal_business_name: String(row.legal_business_name ?? ""),
    entity_type: String(row.entity_type ?? ""),
    tax_id_ein: row.tax_id_ein != null ? String(row.tax_id_ein) : null,
    street: String(row.street ?? ""),
    city: String(row.city ?? ""),
    state: String(row.state ?? ""),
    postal_code: String(row.postal_code ?? ""),
    use_case_description: String(row.use_case_description ?? ""),
    status: normalized,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  }
}

export async function getSmsRegistrationForOwner(
  ownerUserId: string,
  organizationId?: string | null
): Promise<SmsRegistration | null> {
  return getSmsRegistrationForOrganization(ownerUserId, organizationId)
}

/** Load SMS compliance form data for a specific workspace. */
export async function getSmsRegistrationForOrganization(
  ownerUserId: string,
  organizationId?: string | null
): Promise<SmsRegistration | null> {
  const sql = getSql()
  try {
    const orgUuid =
      organizationId && !organizationId.startsWith("legacy-") ? organizationId : null
    const rows = orgUuid
      ? await sql`
          SELECT * FROM sms_registrations
          WHERE owner_user_id = ${ownerUserId} AND organization_id = ${orgUuid}
          ORDER BY updated_at DESC
          LIMIT 1
        `
      : await sql`
          SELECT * FROM sms_registrations
          WHERE owner_user_id = ${ownerUserId} AND organization_id IS NULL
          ORDER BY updated_at DESC
          LIMIT 1
        `
    return rows[0] ? parseSmsRegistrationRow(rows[0] as Record<string, unknown>) : null
  } catch (e) {
    if (isMissingSmsRegistrationsTableError(e)) return null
    throw e
  }
}

export async function upsertSmsRegistration(params: {
  owner_user_id: string
  organization_id: string | null
  legal_business_name: string
  entity_type: string
  tax_id_ein?: string | null
  street: string
  city: string
  state: string
  postal_code: string
  use_case_description: string
  status: SmsRegistrationStatus
}): Promise<SmsRegistration> {
  const sql = getSql()
  const orgId = params.organization_id?.startsWith("legacy-") ? null : params.organization_id
  if (!orgId) {
    throw new Error(
      "An active business workspace is required for SMS registration. Choose a workspace in the dashboard switcher."
    )
  }
  const existing = await getSmsRegistrationForOrganization(params.owner_user_id, orgId)

  if (existing) {
    const rows = await sql`
      UPDATE sms_registrations
      SET
        legal_business_name = ${params.legal_business_name},
        entity_type = ${params.entity_type},
        tax_id_ein = ${params.tax_id_ein ?? null},
        street = ${params.street},
        city = ${params.city},
        state = ${params.state},
        postal_code = ${params.postal_code},
        use_case_description = ${params.use_case_description},
        status = ${params.status},
        updated_at = now()
      WHERE id = ${existing.id} AND owner_user_id = ${params.owner_user_id}
      RETURNING *
    `
    return parseSmsRegistrationRow(rows[0] as Record<string, unknown>)
  }

  const id = crypto.randomUUID()
  const rows = await sql`
    INSERT INTO sms_registrations (
      id, organization_id, owner_user_id, legal_business_name, entity_type, tax_id_ein,
      street, city, state, postal_code, use_case_description, status, created_at, updated_at
    )
    VALUES (
      ${id}, ${orgId}, ${params.owner_user_id}, ${params.legal_business_name}, ${params.entity_type},
      ${params.tax_id_ein ?? null}, ${params.street}, ${params.city}, ${params.state},
      ${params.postal_code}, ${params.use_case_description}, ${params.status}, now(), now()
    )
    RETURNING *
  `
  return parseSmsRegistrationRow(rows[0] as Record<string, unknown>)
}

export async function setOrganizationSmsRegistrationStatus(
  organizationId: string,
  ownerUserId: string,
  status: SmsRegistrationOrgStatus
): Promise<void> {
  if (organizationId.startsWith("legacy-")) return
  const sql = getSql()
  try {
    await sql`
      UPDATE organizations
      SET sms_registration_status = ${status}
      WHERE id = ${organizationId} AND owner_user_id = ${ownerUserId}
    `
  } catch (e) {
    if (isMissingOrganizationsSchemaError(e)) return
    if (pgErrorCode(e) === "42703") return
    throw e
  }
}

export async function getOrganizationSmsRegistrationStatus(
  organizationId: string,
  ownerUserId: string
): Promise<SmsRegistrationOrgStatus | null> {
  if (organizationId.startsWith("legacy-")) return null
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT sms_registration_status FROM organizations
      WHERE id = ${organizationId} AND owner_user_id = ${ownerUserId}
      LIMIT 1
    `
    const raw = rows[0]?.sms_registration_status
    if (raw == null) return "NONE"
    const s = String(raw).toUpperCase()
    if (s === "PENDING_APPROVAL" || s === "APPROVED" || s === "REJECTED") return s
    return "NONE"
  } catch (e) {
    if (isMissingOrganizationsSchemaError(e) || pgErrorCode(e) === "42703") return null
    throw e
  }
}

function isMissingSmsMessagesTableError(e: unknown): boolean {
  return isUndefinedRelationError(e, "sms_messages")
}

function parseSmsMessageRow(row: Record<string, unknown>): SmsMessage {
  return {
    id: String(row.id),
    organization_id: row.organization_id != null ? String(row.organization_id) : null,
    owner_user_id: String(row.owner_user_id),
    phone_number_id: row.phone_number_id != null ? String(row.phone_number_id) : null,
    direction: String(row.direction) === "outbound" ? "outbound" : "inbound",
    from_number: String(row.from_number ?? ""),
    to_number: String(row.to_number ?? ""),
    body: String(row.body ?? ""),
    customer_phone: String(row.customer_phone ?? ""),
    telnyx_message_id: row.telnyx_message_id != null ? String(row.telnyx_message_id) : null,
    status: String(row.status ?? "received"),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }
}

export async function insertSmsMessage(params: {
  organization_id: string | null
  owner_user_id: string
  phone_number_id?: string | null
  direction: "inbound" | "outbound"
  from_number: string
  to_number: string
  body: string
  customer_phone: string
  telnyx_message_id?: string | null
  status?: string
}): Promise<SmsMessage | null> {
  const sql = getSql()
  const id = crypto.randomUUID()
  try {
    const rows = await sql`
      INSERT INTO sms_messages (
        id, organization_id, owner_user_id, phone_number_id, direction,
        from_number, to_number, body, customer_phone, telnyx_message_id, status, created_at
      )
      VALUES (
        ${id}, ${params.organization_id}, ${params.owner_user_id}, ${params.phone_number_id ?? null},
        ${params.direction}, ${params.from_number}, ${params.to_number}, ${params.body},
        ${params.customer_phone}, ${params.telnyx_message_id ?? null}, ${params.status ?? "received"}, now()
      )
      RETURNING *
    `
    return parseSmsMessageRow(rows[0] as Record<string, unknown>)
  } catch (e) {
    if (isMissingSmsMessagesTableError(e)) return null
    throw e
  }
}

export async function listSmsMessagesForOrganization(
  ownerUserId: string,
  organizationId: string,
  limit = 100
): Promise<SmsMessage[]> {
  if (organizationId.startsWith("legacy-")) return []
  const sql = getSql()
  const cap = Math.min(Math.max(limit, 1), 500)
  try {
    const rows = await sql`
      SELECT * FROM sms_messages
      WHERE owner_user_id = ${ownerUserId} AND organization_id = ${organizationId}
      ORDER BY created_at DESC
      LIMIT ${cap}
    `
    return rows.map((r) => parseSmsMessageRow(r as Record<string, unknown>))
  } catch (e) {
    if (isMissingSmsMessagesTableError(e)) return []
    throw e
  }
}

function parsePortingOrderRow(row: Record<string, unknown>): PortingOrder {
  const status = String(row.status ?? "pending").toLowerCase()
  const allowed: PortingOrderStatus[] = [
    "pending",
    "processing",
    "completed",
    "rejected",
    "action_required",
    "pending_info",
    "submitted",
    "pending_carrier_review",
  ]
  const normalized: PortingOrderStatus = allowed.includes(status as PortingOrderStatus)
    ? (status as PortingOrderStatus)
    : "pending"
  return {
    id: String(row.id),
    owner_user_id: String(row.owner_user_id),
    organization_id: row.organization_id != null ? String(row.organization_id) : null,
    phone_number: String(row.phone_number),
    current_carrier: String(row.current_carrier ?? ""),
    account_number: String(row.account_number ?? ""),
    pin_or_sid: row.pin_or_sid != null ? String(row.pin_or_sid) : null,
    status: normalized,
    telnyx_order_id: row.telnyx_order_id != null ? String(row.telnyx_order_id) : null,
    telnyx_status: row.telnyx_status != null ? String(row.telnyx_status) : null,
    carrier_rejection_reason:
      row.carrier_rejection_reason != null ? String(row.carrier_rejection_reason) : null,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  }
}

function isMissingPortingOrdersTableError(e: unknown): boolean {
  return isUndefinedRelationError(e, "porting_orders")
}

export function mapTelnyxStatusToPortingOrderStatus(telnyxStatus: string): PortingOrderStatus {
  const s = telnyxStatus.toLowerCase().trim().replace(/_/g, "-")
  if (s === "ported") return "completed"
  if (["rejected", "failed", "cancelled", "canceled"].includes(s)) return "rejected"
  if (s === "exception") return "action_required"
  if (s === "submitted") return "submitted"
  if (s === "draft") return "pending_carrier_review"
  if (
    [
      "in-process",
      "foc-date-confirmed",
      "port-activating",
      "activation-in-progress",
      "foc-date-confirmed-pending",
    ].includes(s)
  ) {
    return "processing"
  }
  return "pending"
}

export async function createPortingOrder(params: {
  owner_user_id: string
  organization_id: string | null
  phone_number: string
  current_carrier: string
  account_number: string
  pin_or_sid?: string | null
  status?: PortingOrderStatus
  telnyx_order_id?: string | null
  telnyx_status?: string | null
}): Promise<PortingOrder> {
  const sql = getSql()
  const id = crypto.randomUUID()
  const status = params.status ?? "pending"
  const rows = await sql`
    INSERT INTO porting_orders (
      id, owner_user_id, organization_id, phone_number, current_carrier, account_number,
      pin_or_sid, status, telnyx_order_id, telnyx_status, created_at, updated_at
    )
    VALUES (
      ${id}, ${params.owner_user_id}, ${params.organization_id}, ${normalizePhoneNumberE164(params.phone_number)},
      ${params.current_carrier}, ${params.account_number}, ${params.pin_or_sid ?? null},
      ${status}, ${params.telnyx_order_id ?? null}, ${params.telnyx_status ?? null}, now(), now()
    )
    RETURNING *
  `
  return parsePortingOrderRow(rows[0] as Record<string, unknown>)
}

export async function listPortingOrdersForOwner(
  ownerUserId: string,
  organizationId?: string | null
): Promise<PortingOrder[]> {
  const sql = getSql()
  try {
    const rows =
      organizationId && !organizationId.startsWith("legacy-")
        ? await sql`
            SELECT po.* FROM porting_orders po
            WHERE po.owner_user_id = ${ownerUserId}
              AND (
                po.organization_id = ${organizationId}
                OR (
                  po.organization_id IS NULL
                  AND EXISTS (
                    SELECT 1 FROM phone_numbers pn
                    WHERE pn.user_id = ${ownerUserId}
                      AND pn.organization_id = ${organizationId}
                      AND pn.number = po.phone_number
                  )
                )
              )
            ORDER BY po.created_at DESC
            LIMIT 20
          `
        : await sql`
            SELECT * FROM porting_orders
            WHERE owner_user_id = ${ownerUserId}
            ORDER BY created_at DESC
            LIMIT 20
          `
    return rows.map((r) => parsePortingOrderRow(r as Record<string, unknown>))
  } catch (e) {
    if (isMissingPortingOrdersTableError(e)) return []
    throw e
  }
}

/** E.164 list from completed port orders (newest first) — used to pick the public main line. */
export async function listCompletedPortPhoneNumbersForOwner(
  ownerUserId: string,
  organizationId?: string | null
): Promise<string[]> {
  const sql = getSql()
  try {
    const rows =
      organizationId && !organizationId.startsWith("legacy-")
        ? await sql`
            SELECT po.phone_number FROM porting_orders po
            WHERE po.owner_user_id = ${ownerUserId}
              AND po.status = 'completed'
              AND (
                po.organization_id = ${organizationId}
                OR (
                  po.organization_id IS NULL
                  AND EXISTS (
                    SELECT 1 FROM phone_numbers pn
                    WHERE pn.user_id = ${ownerUserId}
                      AND pn.organization_id = ${organizationId}
                      AND pn.number = po.phone_number
                  )
                )
              )
            ORDER BY po.updated_at DESC
            LIMIT 10
          `
        : await sql`
            SELECT phone_number FROM porting_orders
            WHERE owner_user_id = ${ownerUserId} AND status = 'completed'
            ORDER BY updated_at DESC
            LIMIT 10
          `
    return rows
      .map((r) => normalizePhoneNumberE164(String((r as Record<string, unknown>).phone_number ?? "")))
      .filter(Boolean)
  } catch (e) {
    if (isMissingPortingOrdersTableError(e)) return []
    throw e
  }
}

/** Latest completed port row for a DID (org-scoped when provided). */
export async function getCompletedPortingOrderForPhone(
  ownerUserId: string,
  phoneNumber: string,
  organizationId?: string | null
): Promise<PortingOrder | null> {
  const sql = getSql()
  const e164 = normalizePhoneNumberE164(phoneNumber)
  const owner = ownerUserId.trim()
  if (!e164 || !owner) return null
  const orgUuid = organizationId?.trim() && !organizationId.startsWith("legacy-") ? organizationId.trim() : null
  try {
    const rows = orgUuid
      ? await sql`
          SELECT * FROM porting_orders
          WHERE owner_user_id = ${owner}
            AND phone_number = ${e164}
            AND organization_id = ${orgUuid}
            AND status = 'completed'
          ORDER BY updated_at DESC
          LIMIT 1
        `
      : await sql`
          SELECT * FROM porting_orders
          WHERE owner_user_id = ${owner} AND phone_number = ${e164} AND status = 'completed'
          ORDER BY updated_at DESC
          LIMIT 1
        `
    return rows[0] ? parsePortingOrderRow(rows[0] as Record<string, unknown>) : null
  } catch (e) {
    if (isMissingPortingOrdersTableError(e)) return null
    throw e
  }
}

/** Load one porting order by primary key (admin desk). */
export async function getPortingOrderById(orderId: string): Promise<PortingOrder | null> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT * FROM porting_orders WHERE id = ${orderId} LIMIT 1
    `
    return rows[0] ? parsePortingOrderRow(rows[0] as Record<string, unknown>) : null
  } catch (e) {
    if (isMissingPortingOrdersTableError(e)) return null
    throw e
  }
}

/** Owner-scoped porting order lookup (dashboard drawer). */
export async function getPortingOrderByIdForOwner(
  orderId: string,
  ownerUserId: string
): Promise<PortingOrder | null> {
  const order = await getPortingOrderById(orderId)
  if (!order || order.owner_user_id !== ownerUserId) return null
  return order
}

function isMissingCarrierRejectionColumnError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.includes("carrier_rejection_reason")
}

export async function rejectPortingOrderWithReason(
  ownerUserId: string,
  telnyxOrderId: string,
  carrierRejectionReason: string
): Promise<PortingOrder | null> {
  const sql = getSql()
  const reason = carrierRejectionReason.trim().slice(0, 4000)
  if (!reason) return null
  try {
    const rows = await sql`
      UPDATE porting_orders
      SET
        status = 'rejected',
        telnyx_status = COALESCE(NULLIF(trim(telnyx_status), ''), 'rejected'),
        carrier_rejection_reason = ${reason},
        updated_at = now()
      WHERE owner_user_id = ${ownerUserId} AND telnyx_order_id = ${telnyxOrderId}
      RETURNING *
    `
    return rows[0] ? parsePortingOrderRow(rows[0] as Record<string, unknown>) : null
  } catch (e) {
    if (isMissingPortingOrdersTableError(e)) return null
    if (isMissingCarrierRejectionColumnError(e)) {
      const rows = await sql`
        UPDATE porting_orders
        SET status = 'rejected', telnyx_status = COALESCE(NULLIF(trim(telnyx_status), ''), 'rejected'), updated_at = now()
        WHERE owner_user_id = ${ownerUserId} AND telnyx_order_id = ${telnyxOrderId}
        RETURNING *
      `
      return rows[0] ? parsePortingOrderRow(rows[0] as Record<string, unknown>) : null
    }
    throw e
  }
}

/** Mark order action_required when Telnyx porting desk leaves a carrier comment. */
export async function markPortingOrderActionRequired(
  ownerUserId: string,
  telnyxOrderId: string,
  note?: string | null
): Promise<PortingOrder | null> {
  const sql = getSql()
  const reason = note?.trim().slice(0, 4000) || null
  try {
    const rows = await sql`
      UPDATE porting_orders
      SET
        status = 'action_required',
        telnyx_status = COALESCE(NULLIF(trim(telnyx_status), ''), 'exception'),
        carrier_rejection_reason = COALESCE(${reason}, carrier_rejection_reason),
        updated_at = now()
      WHERE owner_user_id = ${ownerUserId} AND telnyx_order_id = ${telnyxOrderId}
      RETURNING *
    `
    return rows[0] ? parsePortingOrderRow(rows[0] as Record<string, unknown>) : null
  } catch (e) {
    if (isMissingPortingOrdersTableError(e)) return null
    if (isMissingCarrierRejectionColumnError(e)) {
      const rows = await sql`
        UPDATE porting_orders
        SET status = 'action_required', telnyx_status = COALESCE(NULLIF(trim(telnyx_status), ''), 'exception'), updated_at = now()
        WHERE owner_user_id = ${ownerUserId} AND telnyx_order_id = ${telnyxOrderId}
        RETURNING *
      `
      return rows[0] ? parsePortingOrderRow(rows[0] as Record<string, unknown>) : null
    }
    throw e
  }
}

/** Update local porting_orders columns after an admin correction. */
export async function patchPortingOrderFields(
  orderId: string,
  updates: {
    account_number?: string
    pin_or_sid?: string | null
    telnyx_status?: string
    status?: PortingOrderStatus
    carrier_rejection_reason?: string | null
    current_carrier?: string
  }
): Promise<PortingOrder | null> {
  const current = await getPortingOrderById(orderId)
  if (!current) return null
  const sql = getSql()
  try {
    const rows = await sql`
      UPDATE porting_orders
      SET
        account_number = ${updates.account_number ?? current.account_number},
        pin_or_sid = ${updates.pin_or_sid !== undefined ? updates.pin_or_sid : current.pin_or_sid},
        telnyx_status = ${updates.telnyx_status ?? current.telnyx_status},
        status = ${updates.status ?? current.status},
        carrier_rejection_reason = ${
          updates.carrier_rejection_reason !== undefined
            ? updates.carrier_rejection_reason
            : current.carrier_rejection_reason ?? null
        },
        current_carrier = ${updates.current_carrier ?? current.current_carrier},
        updated_at = now()
      WHERE id = ${orderId}
      RETURNING *
    `
    return rows[0] ? parsePortingOrderRow(rows[0] as Record<string, unknown>) : null
  } catch (e) {
    if (isMissingPortingOrdersTableError(e)) return null
    if (isMissingCarrierRejectionColumnError(e)) {
      const rows = await sql`
        UPDATE porting_orders
        SET
          account_number = ${updates.account_number ?? current.account_number},
          pin_or_sid = ${updates.pin_or_sid !== undefined ? updates.pin_or_sid : current.pin_or_sid},
          telnyx_status = ${updates.telnyx_status ?? current.telnyx_status},
          status = ${updates.status ?? current.status},
          updated_at = now()
        WHERE id = ${orderId}
        RETURNING *
      `
      return rows[0] ? parsePortingOrderRow(rows[0] as Record<string, unknown>) : null
    }
    throw e
  }
}

export async function getPortingOrderByTelnyxOrderId(
  ownerUserId: string,
  telnyxOrderId: string
): Promise<PortingOrder | null> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT * FROM porting_orders
      WHERE owner_user_id = ${ownerUserId} AND telnyx_order_id = ${telnyxOrderId}
      ORDER BY created_at DESC
      LIMIT 1
    `
    return rows[0] ? parsePortingOrderRow(rows[0] as Record<string, unknown>) : null
  } catch (e) {
    if (isMissingPortingOrdersTableError(e)) return null
    throw e
  }
}

/** Webhook fallback — match any in-flight order by Telnyx ticket id (no owner filter). */
export async function getPortingOrderByTelnyxOrderIdGlobal(
  telnyxOrderId: string
): Promise<PortingOrder | null> {
  const sql = getSql()
  const id = telnyxOrderId.trim()
  if (!id) return null
  try {
    const rows = await sql`
      SELECT * FROM porting_orders
      WHERE telnyx_order_id = ${id}
      ORDER BY updated_at DESC
      LIMIT 1
    `
    return rows[0] ? parsePortingOrderRow(rows[0] as Record<string, unknown>) : null
  } catch (e) {
    if (isMissingPortingOrdersTableError(e)) return null
    throw e
  }
}

/** Webhook fallback — match in-flight port by E.164 billing / port line (owner-scoped). */
export async function getPortingOrderByPhoneNumberForOwner(
  ownerUserId: string,
  phoneNumber: string,
  organizationId?: string | null
): Promise<PortingOrder | null> {
  const sql = getSql()
  const e164 = normalizePhoneNumberE164(phoneNumber)
  const owner = ownerUserId.trim()
  if (!e164 || !owner) return null
  const orgUuid = organizationId?.trim() && !organizationId.startsWith("legacy-") ? organizationId.trim() : null
  try {
    const rows = orgUuid
      ? await sql`
          SELECT * FROM porting_orders
          WHERE owner_user_id = ${owner}
            AND phone_number = ${e164}
            AND organization_id = ${orgUuid}
            AND status <> 'completed'
          ORDER BY updated_at DESC
          LIMIT 1
        `
      : await sql`
          SELECT * FROM porting_orders
          WHERE owner_user_id = ${owner} AND phone_number = ${e164} AND status <> 'completed'
          ORDER BY updated_at DESC
          LIMIT 1
        `
    return rows[0] ? parsePortingOrderRow(rows[0] as Record<string, unknown>) : null
  } catch (e) {
    if (isMissingPortingOrdersTableError(e)) return null
    throw e
  }
}

/** @deprecated Use getPortingOrderByPhoneNumberForOwner — global phone lookup (last resort). */
export async function getPortingOrderByPhoneNumber(phoneNumber: string): Promise<PortingOrder | null> {
  const sql = getSql()
  const e164 = normalizePhoneNumberE164(phoneNumber)
  if (!e164) return null
  try {
    const rows = await sql`
      SELECT * FROM porting_orders
      WHERE phone_number = ${e164} AND status <> 'completed'
      ORDER BY updated_at DESC
      LIMIT 1
    `
    return rows[0] ? parsePortingOrderRow(rows[0] as Record<string, unknown>) : null
  } catch (e) {
    if (isMissingPortingOrdersTableError(e)) return null
    throw e
  }
}

export async function updatePortingOrderByTelnyxOrderId(
  ownerUserId: string,
  telnyxOrderId: string,
  updates: { status: PortingOrderStatus; telnyx_status: string; current_carrier?: string }
): Promise<PortingOrder | null> {
  const sql = getSql()
  try {
    const rows = await sql`
      UPDATE porting_orders
      SET
        status = ${updates.status},
        telnyx_status = ${updates.telnyx_status},
        current_carrier = COALESCE(${updates.current_carrier ?? null}, current_carrier),
        carrier_rejection_reason = CASE
          WHEN ${updates.status} = 'completed' THEN NULL
          ELSE carrier_rejection_reason
        END,
        updated_at = now()
      WHERE owner_user_id = ${ownerUserId} AND telnyx_order_id = ${telnyxOrderId}
      RETURNING *
    `
    return rows[0] ? parsePortingOrderRow(rows[0] as Record<string, unknown>) : null
  } catch (e) {
    if (isMissingPortingOrdersTableError(e)) return null
    throw e
  }
}

export async function updatePortingOrderStatus(
  id: string,
  ownerUserId: string,
  updates: { status?: PortingOrderStatus; telnyx_status?: string | null }
): Promise<PortingOrder | null> {
  const sql = getSql()
  try {
    if (updates.status != null && updates.telnyx_status != null) {
      const rows = await sql`
        UPDATE porting_orders
        SET status = ${updates.status}, telnyx_status = ${updates.telnyx_status}, updated_at = now()
        WHERE id = ${id} AND owner_user_id = ${ownerUserId}
        RETURNING *
      `
      return rows[0] ? parsePortingOrderRow(rows[0] as Record<string, unknown>) : null
    }
    if (updates.status != null) {
      const rows = await sql`
        UPDATE porting_orders
        SET status = ${updates.status}, updated_at = now()
        WHERE id = ${id} AND owner_user_id = ${ownerUserId}
        RETURNING *
      `
      return rows[0] ? parsePortingOrderRow(rows[0] as Record<string, unknown>) : null
    }
    if (updates.telnyx_status != null) {
      const rows = await sql`
        UPDATE porting_orders
        SET telnyx_status = ${updates.telnyx_status}, updated_at = now()
        WHERE id = ${id} AND owner_user_id = ${ownerUserId}
        RETURNING *
      `
      return rows[0] ? parsePortingOrderRow(rows[0] as Record<string, unknown>) : null
    }
    return null
  } catch (e) {
    if (isMissingPortingOrdersTableError(e)) return null
    throw e
  }
}

export async function createOrganizationForOwner(
  ownerUserId: string,
  name: string
): Promise<Organization> {
  const sql = getSql()
  const trimmed = name.trim()
  if (trimmed.length < 2) throw new Error("Business name must be at least 2 characters")
  const id = crypto.randomUUID()
  const rows = await sql`
    INSERT INTO organizations (id, owner_user_id, name, is_default, created_at)
    VALUES (${id}, ${ownerUserId}, ${trimmed}, false, now())
    RETURNING id, owner_user_id, name, is_default, created_at
  `
  return parseOrganizationRow(rows[0] as Record<string, unknown>)
}

/** Rename a workspace the owner controls (`065`). */
export async function updateOrganizationNameForOwner(
  organizationId: string,
  ownerUserId: string,
  name: string
): Promise<Organization> {
  if (organizationId.startsWith("legacy-")) {
    throw new Error("This workspace cannot be renamed until multi-business migration is applied")
  }
  const trimmed = name.trim()
  if (trimmed.length < 2) throw new Error("Business name must be at least 2 characters")
  const sql = getSql()
  const rows = await sql`
    UPDATE organizations
    SET name = ${trimmed}
    WHERE id = ${organizationId} AND owner_user_id = ${ownerUserId}
    RETURNING id, owner_user_id, name, is_default, created_at
  `
  if (!rows[0]) throw new Error("Workspace not found")
  return parseOrganizationRow(rows[0] as Record<string, unknown>)
}

/** Release one line (any in-use status) and strip inbound snapshot fields. */
async function releasePhoneLineInWorkspace(phoneNumberId: string, userId: string): Promise<void> {
  const sql = getSql()
  await sql`
    UPDATE phone_numbers
    SET
      status = 'released',
      inbound_dial_e164 = NULL,
      inbound_receptionist_id = NULL,
      inbound_receptionist_name = NULL,
      inbound_fallback_type = NULL,
      inbound_ring_timeout_seconds = NULL,
      inbound_account_status = NULL,
      inbound_ai_ring_owner_first = false,
      inbound_routing_updated_at = NULL
    WHERE id = ${phoneNumberId}
      AND user_id = ${userId}
      AND status IN ('active', 'porting', 'pending')
  `
}

/**
 * Delete a workspace: release its lines, remove per-number routing rows, delete the org.
 * Returns the workspace id the UI should activate next.
 */
export async function deleteOrganizationForOwner(
  organizationId: string,
  ownerUserId: string
): Promise<{ deleted_id: string; fallback_organization_id: string }> {
  if (organizationId.startsWith("legacy-")) {
    throw new Error("This workspace cannot be deleted")
  }

  const orgs = await listOrganizationsForOwner(ownerUserId)
  const realOrgs = orgs.filter((o) => !o.id.startsWith("legacy-"))
  if (realOrgs.length <= 1) {
    throw new Error("You must keep at least one business workspace")
  }

  const target = realOrgs.find((o) => o.id === organizationId)
  if (!target) throw new Error("Workspace not found")

  const sql = getSql()
  const lines = await getPhoneNumbers(ownerUserId, organizationId)

  for (const line of lines) {
    if (line.status === "active" || line.status === "porting" || line.status === "pending") {
      await releasePhoneLineInWorkspace(line.id, ownerUserId)
    }
    const normalized = normalizePhoneNumberE164(line.number)
    const digitKey = phoneDigitsKey(line.number)
    if (normalized) {
      await sql`
        DELETE FROM routing_config
        WHERE user_id = ${ownerUserId}
          AND business_number IS NOT NULL
          AND (
            business_number = ${normalized}
            OR regexp_replace(business_number, '\\D', '', 'g') = ${digitKey}
          )
      `
    }
  }

  const remaining = realOrgs.filter((o) => o.id !== organizationId)
  if (target.is_default && remaining.length > 0) {
    const nextDefault = remaining[0]!
    await sql`
      UPDATE organizations SET is_default = false WHERE owner_user_id = ${ownerUserId}
    `
    await sql`
      UPDATE organizations SET is_default = true WHERE id = ${nextDefault.id} AND owner_user_id = ${ownerUserId}
    `
  }

  const deleted = await sql`
    DELETE FROM organizations
    WHERE id = ${organizationId} AND owner_user_id = ${ownerUserId}
    RETURNING id
  `
  if (!deleted[0]) throw new Error("Workspace not found")

  const refreshed = await listOrganizationsForOwner(ownerUserId)
  const fallback =
    refreshed.find((o) => o.is_default && !o.id.startsWith("legacy-")) ??
    refreshed.find((o) => !o.id.startsWith("legacy-")) ??
    null
  if (!fallback) throw new Error("No workspace remains after delete")

  clearIncomingRoutingCache()
  void syncInboundDialSnapshotForUser(ownerUserId).catch(() => {})

  return { deleted_id: organizationId, fallback_organization_id: fallback.id }
}

/** Active Telnyx-linked lines ordered oldest-first — for picking a valid platform SMS sender. */
export async function listProviderLinkedActiveNumbers(limit = 25): Promise<string[]> {
  const sql = getSql()
  const rows = (await sql`
    SELECT number
    FROM phone_numbers
    WHERE status = 'active'
      AND nullif(trim(coalesce(provider_number_sid, twilio_sid, '')), '') IS NOT NULL
    ORDER BY created_at ASC
    LIMIT ${limit}
  `) as Record<string, unknown>[]
  return rows
    .map((row) => String(row.number ?? "").trim())
    .filter(Boolean)
}

/** First active line linked to Telnyx (has provider SID) — usable as outbound SMS "from". */
export async function getProviderLinkedActiveNumber(userId?: string): Promise<string | null> {
  const sql = getSql()
  const pick = (rows: Record<string, unknown>[]) => {
    const row = rows[0] as { number?: string } | undefined
    const number = row?.number?.trim()
    return number || null
  }
  if (userId) {
    const rows = await sql`
      SELECT number
      FROM phone_numbers
      WHERE user_id = ${userId}
        AND status = 'active'
        AND nullif(trim(coalesce(provider_number_sid, twilio_sid, '')), '') IS NOT NULL
      ORDER BY created_at ASC
      LIMIT 1
    `
    const fromAccount = pick(rows as Record<string, unknown>[])
    if (fromAccount) return fromAccount
  }
  const rows = await sql`
    SELECT number
    FROM phone_numbers
    WHERE status = 'active'
      AND nullif(trim(coalesce(provider_number_sid, twilio_sid, '')), '') IS NOT NULL
    ORDER BY created_at ASC
    LIMIT 1
  `
  return pick(rows as Record<string, unknown>[])
}

/** First real (non-555) owner phone on the platform — used for sandbox SMS E2E when env unset. */
export async function getPlatformLeadAlertTestRecipientE164(): Promise<string | null> {
  const sql = getSql()
  const rows = await sql`
    SELECT phone
    FROM users
    WHERE phone IS NOT NULL
      AND trim(phone) <> ''
      AND phone NOT LIKE '+100%'
      AND regexp_replace(phone, '\\D', '', 'g') NOT LIKE '%555%'
    ORDER BY created_at ASC
    LIMIT 5
  `
  for (const row of rows as { phone?: string }[]) {
    const phone = row.phone?.trim()
    if (!phone) continue
    const digits = phone.replace(/\D/g, "")
    if (digits.length >= 10 && digits.length <= 15) return phone
  }
  return null
}

// Get phone numbers for a user (optionally scoped to one organization workspace).
export async function getPhoneNumbers(userId: string, organizationId?: string | null): Promise<PhoneNumber[]> {
  const sql = getSql()
  const orgFilter =
    organizationId && !organizationId.startsWith("legacy-") ? organizationId : null
  const mapRows = (rows: unknown[]) => rows.map((r) => parsePhoneNumberRow(r as Record<string, unknown>))
  try {
    if (orgFilter) {
      const rows = await sql`
        SELECT pn.id, pn.user_id, pn.organization_id, pn.provider_number_sid, pn.twilio_sid, pn.number, pn.friendly_name,
          pn.label, pn.type, pn.status, pn.industry_tag, pn.routing_pool_mode, pn.source_provider, pn.external_verified,
          pn.created_at, pn.admin_routing_override_phone,
          org.admin_routing_override_phone AS organization_admin_routing_override_phone
        FROM phone_numbers pn
        LEFT JOIN organizations org ON org.id = pn.organization_id
        WHERE pn.user_id = ${userId}
          AND pn.organization_id = ${orgFilter}
        ORDER BY pn.created_at ASC
      `
      return mapRows(rows)
    }
    const rows = await sql`
      SELECT pn.id, pn.user_id, pn.organization_id, pn.provider_number_sid, pn.twilio_sid, pn.number, pn.friendly_name,
        pn.label, pn.type, pn.status, pn.industry_tag, pn.routing_pool_mode, pn.source_provider, pn.external_verified,
        pn.created_at, pn.admin_routing_override_phone,
        org.admin_routing_override_phone AS organization_admin_routing_override_phone
      FROM phone_numbers pn
      LEFT JOIN organizations org ON org.id = pn.organization_id
      WHERE pn.user_id = ${userId}
      ORDER BY pn.created_at ASC
    `
    return mapRows(rows)
  } catch (e) {
    if (!isMissingPhoneLineAdminOverrideColumnError(e) && !isMissingOrganizationsSchemaError(e)) throw e
    if (orgFilter) {
      const rows = await sql`
        SELECT id, user_id, organization_id, provider_number_sid, twilio_sid, number, friendly_name, label, type, status,
          industry_tag, routing_pool_mode, source_provider, external_verified, created_at
        FROM phone_numbers
        WHERE user_id = ${userId}
          AND organization_id = ${orgFilter}
        ORDER BY created_at ASC
      `
      return mapRows(rows)
    }
    const rows = await sql`
      SELECT id, user_id, organization_id, provider_number_sid, twilio_sid, number, friendly_name, label, type, status,
        industry_tag, routing_pool_mode, source_provider, external_verified, created_at
      FROM phone_numbers WHERE user_id = ${userId} ORDER BY created_at ASC
    `
    return mapRows(rows)
  }
}

/** One owned line by database id — used before release / patch. */
export async function getPhoneNumberByIdForUser(
  phoneNumberId: string,
  userId: string
): Promise<PhoneNumber | null> {
  const sql = getSql()
  const rows = await sql`
    SELECT id, user_id, provider_number_sid, twilio_sid, number, friendly_name, label, type, status, created_at
    FROM phone_numbers
    WHERE id = ${phoneNumberId} AND user_id = ${userId}
    LIMIT 1
  `
  return rows[0] ? parsePhoneNumberRow(rows[0] as Record<string, unknown>) : null
}

/** Mark a line released and clear inbound routing snapshot so webhooks ignore it. */
export async function markPhoneNumberReleasedForUser(
  phoneNumberId: string,
  userId: string
): Promise<boolean> {
  const sql = getSql()
  const rows = await sql`
    UPDATE phone_numbers
    SET
      status = 'released',
      inbound_dial_e164 = NULL,
      inbound_receptionist_id = NULL,
      inbound_receptionist_name = NULL,
      inbound_fallback_type = NULL,
      inbound_ring_timeout_seconds = NULL,
      inbound_account_status = NULL,
      inbound_ai_ring_owner_first = false,
      inbound_routing_updated_at = NULL
    WHERE id = ${phoneNumberId}
      AND user_id = ${userId}
      AND status = 'active'
    RETURNING id
  `
  if (rows.length > 0) {
    clearIncomingRoutingCache()
  }
  return rows.length > 0
}

/**
 * Hide mistaken `phone_numbers` rows that mirror the owner's cell once a real inbound DID exists.
 * Does not call Telnyx release — the owner's cell is not a purchased business line.
 */
export async function archiveOwnerCellMirroredBusinessLines(
  ownerUserId: string,
  preferredInboundE164?: string | null
): Promise<number> {
  const user = await getUser(ownerUserId)
  const ownerPhone = user?.phone?.trim()
  if (!ownerPhone) return 0

  const numbers = await getPhoneNumbers(ownerUserId)
  const realInbound = numbers.filter(
    (row) =>
      (row.status === "active" || row.status === "pending" || row.status === "porting") &&
      !lineMatchesOwnerCell(row.number, ownerPhone)
  )
  if (realInbound.length === 0) return 0

  const preferred = preferredInboundE164?.trim()
    ? normalizePhoneNumberE164(preferredInboundE164)
    : null

  let archived = 0
  for (const row of numbers) {
    if (row.status !== "active" && row.status !== "pending" && row.status !== "porting") continue
    if (!lineMatchesOwnerCell(row.number, ownerPhone)) continue
    if (preferred && normalizePhoneNumberE164(row.number) === preferred) continue
    const ok = await markPhoneNumberReleasedForUser(row.id, ownerUserId)
    if (ok) archived += 1
  }
  return archived
}

/**
 * First active business DID for this user — used when Telnyx Dial `action` webhook loses `bn` or sends `To` as the owner’s cell (so per-number AI fallback was misread as default voicemail).
 */
export async function getPrimaryActiveBusinessNumberE164(userId: string): Promise<string | null> {
  const user = await getUser(userId)
  const list = await getPhoneNumbers(userId)
  const ownerPhone = user?.phone?.trim() || null
  const candidates = list.filter(
    (p) =>
      p.status === "active" &&
      !lineMatchesOwnerCell(p.number, ownerPhone)
  )
  const row = candidates[0] ?? list.find((p) => p.status === "active") ?? list[0]
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
  organization_id?: string | null
  source_provider?: "telnyx" | "external"
  external_verified?: boolean
  /** When false, leave organization_id null unless explicitly passed (multi-workspace safe). */
  assign_default_organization?: boolean
}): Promise<PhoneNumber> {
  const sql = getSql()
  const id = crypto.randomUUID()
  const numberE164 = normalizePhoneNumberE164(params.number)
  const organizationId = await resolveOrganizationIdForNewPhoneLine(
    params.user_id,
    params.organization_id ?? null,
    { assignDefaultOrganization: params.assign_default_organization !== false }
  )
  const source = params.source_provider ?? "telnyx"
  const extVerified = params.external_verified ?? source === "external"
  try {
    await sql`
      INSERT INTO phone_numbers (
        id, user_id, organization_id, provider_number_sid, twilio_sid, number, friendly_name, label, type, status,
        source_provider, external_verified, created_at
      )
      VALUES (
        ${id},
        ${params.user_id},
        ${organizationId},
        ${params.provider_number_sid || ""},
        ${params.provider_number_sid || ""},
        ${numberE164},
        ${params.friendly_name},
        ${params.label || "Business Line"},
        ${params.type || "local"},
        ${params.status || "active"},
        ${source},
        ${extVerified},
        now()
      )
    `
  } catch (e) {
    if (!isMissingOrganizationsSchemaError(e)) throw e
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
  }
  return {
    id,
    user_id: params.user_id,
    organization_id: organizationId,
    provider_number_sid: params.provider_number_sid || "",
    number: numberE164,
    friendly_name: params.friendly_name,
    label: params.label || "Business Line",
    type: params.type || "local",
    status: params.status || "active",
    source_provider: source,
    external_verified: extVerified,
    industry_tag: null,
    routing_pool_mode: "sequential",
    created_at: new Date().toISOString(),
  }
}

/** Register an externally hosted DID (Twilio transfer) — active immediately, no carrier port. */
export async function insertExternalPhoneLine(params: {
  user_id: string
  organization_id: string
  number: string
  label: string
}): Promise<PhoneNumber> {
  const org = await getOrganizationForOwner(params.organization_id, params.user_id)
  if (!org) throw new Error("Workspace not found")
  const normalized = normalizePhoneNumberE164(params.number)
  const existing = await getPhoneNumberByNumberAndStatus(normalized, "active")
  if (existing && existing.user_id !== params.user_id) {
    throw new Error("That number is already registered on another Lyncr account")
  }
  if (existing && existing.user_id === params.user_id) {
    return existing
  }
  const display = params.label.trim() || "External Line"
  return insertPhoneNumber({
    user_id: params.user_id,
    organization_id: org.id.startsWith("legacy-") ? null : org.id,
    number: normalized,
    friendly_name: normalized,
    label: display,
    type: "local",
    status: "active",
    provider_number_sid: "external",
    source_provider: "external",
    external_verified: true,
  })
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
  organization_id?: string | null
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
  const organizationId = await resolveOrganizationIdForNewPhoneLine(
    params.user_id,
    params.organization_id ?? null
  )
  await insertPhoneNumber({
    user_id: params.user_id,
    organization_id: organizationId,
    number: e164,
    friendly_name: e164,
    label: params.label,
    type: "local",
    status: "porting",
    provider_number_sid: params.port_order_id,
    source_provider: "telnyx",
  })
}

// Update a phone number (e.g. after port complete)
export async function updatePhoneNumber(
  phoneNumberId: string,
  userId: string,
  updates: Partial<Pick<PhoneNumber, "provider_number_sid" | "status" | "number" | "friendly_name">>
): Promise<void> {
  const sql = getSql()
  if (updates.number !== undefined) {
    await sql`UPDATE phone_numbers SET number = ${updates.number} WHERE id = ${phoneNumberId} AND user_id = ${userId}`
  }
  if (updates.friendly_name !== undefined) {
    await sql`UPDATE phone_numbers SET friendly_name = ${updates.friendly_name} WHERE id = ${phoneNumberId} AND user_id = ${userId}`
  }
  if (updates.provider_number_sid !== undefined) {
    await sql`UPDATE phone_numbers SET provider_number_sid = ${updates.provider_number_sid}, twilio_sid = ${updates.provider_number_sid} WHERE id = ${phoneNumberId} AND user_id = ${userId}`
  }
  if (updates.status !== undefined) {
    await sql`UPDATE phone_numbers SET status = ${updates.status} WHERE id = ${phoneNumberId} AND user_id = ${userId}`
  }
}

/** Set skill-pool routing fields on an owned phone line (`042-skill-routing-pool.sql`). */
export async function patchPhoneNumberPoolSettings(
  phoneNumberId: string,
  userId: string,
  settings: { industry_tag: string; routing_pool_mode?: "sequential" | "simultaneous" }
): Promise<boolean> {
  const sql = getSql()
  const tag = settings.industry_tag.trim()
  const mode = settings.routing_pool_mode ?? "simultaneous"
  try {
    const rows = await sql`
      UPDATE phone_numbers
      SET industry_tag = ${tag}, routing_pool_mode = ${mode}
      WHERE id = ${phoneNumberId} AND user_id = ${userId}
      RETURNING id
    `
    if (rows.length > 0) clearIncomingRoutingCache()
    return rows.length > 0
  } catch (e) {
    if (!isMissingIndustryTagColumnError(e)) throw e
    return false
  }
}

/** Default routing_config industry tag for skill-pool fallback. */
export async function patchRoutingConfigIndustryTag(userId: string, industryTag: string): Promise<void> {
  const sql = getSql()
  const tag = industryTag.trim()
  try {
    await sql`
      UPDATE routing_config
      SET industry_tag = ${tag}, updated_at = now()
      WHERE user_id = ${userId} AND business_number IS NULL
    `
    clearIncomingRoutingCache()
  } catch (e) {
    const msg = pgErrorMessage(e)
    if (pgErrorCode(e) === "42703" && msg.includes("industry_tag")) return
    throw e
  }
}

/** Upsert a certification course row from static module JSON (dev sandbox + migrations). */
export async function upsertCertificationModule(params: {
  code_identifier: string
  name: string
  module_data: CertificationModuleData
}): Promise<Certification | null> {
  const sql = getSql()
  const moduleJson = JSON.stringify(params.module_data)
  try {
    const rows = await sql`
      INSERT INTO certifications (name, code_identifier, module_data)
      VALUES (${params.name}, ${params.code_identifier}, ${moduleJson}::jsonb)
      ON CONFLICT (code_identifier) DO UPDATE SET
        name = EXCLUDED.name,
        module_data = EXCLUDED.module_data
      RETURNING id, name, code_identifier, module_data, created_at
    `
    const row = rows[0]
    if (!row) throw new Error("upsertCertificationModule: no row returned")
    return parseCertificationRow(row as Record<string, unknown>)
  } catch (e) {
    if (isMissingCertificationsTableError(e)) return null
    throw e
  }
}

/**
 * Updates display fields on a row the user owns. Returns false if no row matched (wrong id / other account).
 * Clears incoming-call routing cache when label or friendly_name changes so voice webhooks read fresh values.
 */
export async function patchPhoneNumberForUser(
  phoneNumberId: string, // `phone_numbers.id` UUID
  userId: string, // Owner id — UPDATE is scoped so you cannot edit someone else’s number
  updates: Partial<Pick<PhoneNumber, "label" | "friendly_name" | "organization_id">> // At least one field should be set by the caller
): Promise<boolean> {
  const sql = getSql() // Shared SQL client (Neon serverless)
  if (
    updates.label === undefined &&
    updates.friendly_name === undefined &&
    updates.organization_id === undefined
  ) {
    return false // Nothing to write — treat as failed patch
  }
  if (updates.organization_id !== undefined && updates.organization_id !== null) {
    const org = await getOrganizationForOwner(updates.organization_id, userId)
    if (!org || org.id.startsWith("legacy-")) return false
  }
  let rows: { id: string }[] // Rows returned by RETURNING id (empty array ⇒ no permission / wrong id)
  if (
    updates.label !== undefined &&
    updates.friendly_name !== undefined &&
    updates.organization_id !== undefined
  ) {
    rows = await sql`
      UPDATE phone_numbers
      SET label = ${updates.label}, friendly_name = ${updates.friendly_name}, organization_id = ${updates.organization_id ?? null}
      WHERE id = ${phoneNumberId} AND user_id = ${userId}
      RETURNING id
    `
  } else if (updates.label !== undefined && updates.friendly_name !== undefined) {
    rows = await sql`
      UPDATE phone_numbers
      SET label = ${updates.label}, friendly_name = ${updates.friendly_name}
      WHERE id = ${phoneNumberId} AND user_id = ${userId}
      RETURNING id
    `
  } else if (updates.label !== undefined && updates.organization_id !== undefined) {
    rows = await sql`
      UPDATE phone_numbers
      SET label = ${updates.label}, organization_id = ${updates.organization_id ?? null}
      WHERE id = ${phoneNumberId} AND user_id = ${userId}
      RETURNING id
    `
  } else if (updates.friendly_name !== undefined && updates.organization_id !== undefined) {
    rows = await sql`
      UPDATE phone_numbers
      SET friendly_name = ${updates.friendly_name}, organization_id = ${updates.organization_id ?? null}
      WHERE id = ${phoneNumberId} AND user_id = ${userId}
      RETURNING id
    `
  } else if (updates.organization_id !== undefined) {
    rows = await sql`
      UPDATE phone_numbers
      SET organization_id = ${updates.organization_id ?? null}
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

/** Update SMS delivery outcome on a saved ai_leads row. */
export async function updateAiLeadSmsOutcome(
  leadId: string,
  outcome: { sms_sent: boolean; sms_error: string | null }
): Promise<void> {
  const sql = getSql()
  try {
    await sql`
      UPDATE ai_leads
      SET sms_sent = ${outcome.sms_sent}, sms_error = ${outcome.sms_error}
      WHERE id = ${leadId}
    `
  } catch (e) {
    if (isUndefinedRelationError(e, "ai_leads")) return
    throw e
  }
}

/** Persist instant SMS lead alert preferences on onboarding_profiles. */
export async function updateNotificationPreferencesDb(params: {
  userId: string
  sms_leads_enabled: boolean
  dispatch_sms_phone: string | null
  notification_phone?: string | null
}): Promise<OnboardingProfile> {
  await ensureOnboardingProfile(params.userId)
  const sql = getSql()
  const notificationPhone =
    params.notification_phone !== undefined ? params.notification_phone : null
  try {
    await sql`
      UPDATE onboarding_profiles
      SET
        sms_leads_enabled = ${params.sms_leads_enabled},
        dispatch_sms_phone = ${params.dispatch_sms_phone},
        notification_phone = coalesce(${notificationPhone}, notification_phone),
        updated_at = now()
      WHERE user_id = ${params.userId}
    `
    const profile = await getOnboardingProfile(params.userId)
    if (!profile) throw new Error("Profile not found")
    return profile
  } catch (e) {
    if (isMissingSmsNotificationColumnError(e)) {
      throw new Error(
        "SMS notification settings require migrations 044-sms-lead-notifications.sql and 045-dispatch-sms-phone.sql in Neon."
      )
    }
    throw e
  }
}

/** Owner-scoped leads for the CRM dashboard (all non-dispatched rows for this user). */
export async function listAiLeadsForDashboard(userId: string, limit = 50): Promise<
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

  const mapRows = (rows: Record<string, unknown>[]) =>
    rows.map((r) => ({
      id: String(r.id),
      caller_e164: r.caller_e164 != null ? String(r.caller_e164) : null,
      intent_slug: r.intent_slug != null ? String(r.intent_slug) : null,
      collected: (r.collected as Record<string, unknown>) || {},
      summary: r.summary != null ? String(r.summary) : null,
      sms_sent: Boolean(r.sms_sent),
      sms_error: r.sms_error != null ? String(r.sms_error) : null,
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    }))

  try {
    const rows = await sql`
      SELECT id, caller_e164, intent_slug, collected, summary, sms_sent, sms_error, created_at
      FROM ai_leads
      WHERE user_id = ${userId}
        AND lower(coalesce(nullif(trim(dispatch_status), ''), nullif(trim(collected->>'dispatch_status'), ''), '')) <> 'dispatched'
      ORDER BY created_at DESC
      LIMIT ${lim}
    `
    return mapRows(rows as Record<string, unknown>[])
  } catch (e) {
    if (pgErrorCode(e) === "42703") {
      try {
        const rows = await sql`
          SELECT id, caller_e164, intent_slug, collected, summary, sms_sent, sms_error, created_at
          FROM ai_leads
          WHERE user_id = ${userId}
          ORDER BY created_at DESC
          LIMIT ${lim}
        `
        return mapRows(rows as Record<string, unknown>[])
      } catch (e2) {
        if (isUndefinedRelationError(e2, "ai_leads")) {
          console.warn(
            "[db] Table ai_leads is missing. Run scripts/010-ai-leads-intake.sql in the Neon SQL Editor."
          )
          return []
        }
        throw e2
      }
    }
    if (isUndefinedRelationError(e, "ai_leads")) {
      console.warn(
        "[db] Table ai_leads is missing. Run scripts/010-ai-leads-intake.sql in the Neon SQL Editor."
      )
      return []
    }
    throw e
  }
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

  const mapRows = (rows: Record<string, unknown>[]) =>
    rows.map((r) => ({
      id: String(r.id),
      caller_e164: r.caller_e164 != null ? String(r.caller_e164) : null,
      intent_slug: r.intent_slug != null ? String(r.intent_slug) : null,
      collected: (r.collected as Record<string, unknown>) || {},
      summary: r.summary != null ? String(r.summary) : null,
      sms_sent: Boolean(r.sms_sent),
      sms_error: r.sms_error != null ? String(r.sms_error) : null,
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    }))

  try {
    const rows = await sql`
      SELECT id, caller_e164, intent_slug, collected, summary, sms_sent, sms_error, created_at
      FROM ai_leads
      WHERE user_id = ${userId}
        AND NOT (
          lower(coalesce(nullif(trim(dispatch_status), ''), nullif(trim(collected->>'dispatch_status'), ''), '')) = 'unassigned_pool'
          AND lower(coalesce(nullif(trim(disposition), ''), nullif(trim(collected->>'disposition'), ''), '')) = 'booked'
          AND coalesce(collected->>'pending_callback', 'false') NOT IN ('true', 'yes', '1')
        )
        AND lower(coalesce(nullif(trim(dispatch_status), ''), nullif(trim(collected->>'dispatch_status'), ''), '')) <> 'dispatched'
      ORDER BY created_at DESC
      LIMIT ${lim}
    `
    return mapRows(rows as Record<string, unknown>[])
  } catch (e) {
    if (pgErrorCode(e) === "42703") {
      try {
        const rows = await sql`
          SELECT id, caller_e164, intent_slug, collected, summary, sms_sent, sms_error, created_at
          FROM ai_leads
          WHERE user_id = ${userId}
            AND NOT (
              lower(coalesce(collected->>'dispatch_status', '')) = 'unassigned_pool'
              AND lower(coalesce(collected->>'disposition', '')) = 'booked'
              AND coalesce(collected->>'pending_callback', 'false') NOT IN ('true', 'yes', '1')
            )
            AND lower(coalesce(collected->>'dispatch_status', '')) <> 'dispatched'
          ORDER BY created_at DESC
          LIMIT ${lim}
        `
        return mapRows(rows as Record<string, unknown>[])
      } catch (e2) {
        if (isUndefinedRelationError(e2, "ai_leads")) {
          console.warn(
            "[db] Table ai_leads is missing. Run scripts/010-ai-leads-intake.sql in the Neon SQL Editor."
          )
          return []
        }
        throw e2
      }
    }
    if (isUndefinedRelationError(e, "ai_leads")) {
      console.warn(
        "[db] Table ai_leads is missing. Run scripts/010-ai-leads-intake.sql in the Neon SQL Editor."
      )
      return []
    }
    throw e
  }
}

/** Backfill legacy pending rows that were saved into the hopper pipeline by mistake. */
export async function reconcileMiscategorizedCrmLeads(userId: string): Promise<void> {
  const sql = getSql()
  const patch = JSON.stringify({
    dispatch_status: CRM_LEAD_STATUS,
    status: CRM_LEAD_STATUS,
    sales_recovery_stage: "pending_callbacks",
  })
  try {
    await sql`
      UPDATE ai_leads
      SET
        dispatch_status = ${CRM_LEAD_STATUS},
        job_status = ${CRM_LEAD_STATUS},
        disposition = coalesce(nullif(trim(disposition), ''), 'PENDING_TIME'),
        collected = coalesce(collected, '{}'::jsonb) || ${patch}::jsonb
      WHERE user_id = ${userId}
        AND (
          lower(coalesce(nullif(trim(dispatch_status), ''), nullif(trim(collected->>'dispatch_status'), ''), ''))
            IN ('', ${UNASSIGNED_CALLBACK_STATUS}, ${UNASSIGNED_POOL_STATUS})
          AND (
            lower(coalesce(nullif(trim(disposition), ''), nullif(trim(collected->>'disposition'), ''), '')) = 'pending_time'
            OR coalesce(collected->>'pending_callback', 'false') IN ('true', 'yes', '1')
            OR coalesce(collected->>'source', '') LIKE '%pending_callback%'
            OR lower(coalesce(nullif(trim(dispatch_status), ''), nullif(trim(collected->>'dispatch_status'), ''), ''))
              = ${UNASSIGNED_CALLBACK_STATUS}
          )
        )
    `
  } catch (e) {
    if (pgErrorCode(e) === "42703" || isUndefinedRelationError(e, "ai_leads")) return
    throw e
  }
}

/** Save or update the operator "Action Required" note on a CRM lead. */
export async function updateAiLeadActionRequired(
  userId: string,
  leadId: string,
  actionRequired: string,
  salesRecoveryStage?: string | null
): Promise<boolean> {
  const sql = getSql()
  const note = actionRequired.trim()
  if (!note) return false
  const stage = salesRecoveryStage?.trim() || null
  const patch = JSON.stringify({
    action_required: note,
    action_required_label: note,
    action_required_updated_at: new Date().toISOString(),
    ...(stage ? { sales_recovery_stage: stage } : {}),
  })
  try {
    const rows = await sql`
      UPDATE ai_leads
      SET collected = coalesce(collected, '{}'::jsonb) || ${patch}::jsonb
      WHERE id = ${leadId} AND user_id = ${userId}
      RETURNING id
    `
    return rows.length > 0
  } catch (e) {
    if (isUndefinedRelationError(e, "ai_leads")) return false
    throw e
  }
}

/** Move a CRM lead into the scheduler hopper as an active unassigned booking. */
export async function convertAiLeadToUnassignedPool(params: {
  ownerUserId: string
  leadId: string
  organizationId?: string | null
}): Promise<boolean> {
  const sql = getSql()
  const orgId = params.organizationId?.trim() || null
  const patch = JSON.stringify({
    dispatch_status: "unassigned_pool",
    job_status: "UNASSIGNED",
    disposition: "BOOKED",
    converted_from_crm_at: new Date().toISOString(),
    source: "crm_convert",
  })
  try {
    const rows =
      orgId != null
        ? await sql`
            UPDATE ai_leads
            SET
              disposition = 'BOOKED',
              dispatch_status = 'unassigned_pool',
              job_status = 'UNASSIGNED',
              organization_id = coalesce(organization_id, ${orgId}::uuid),
              collected = coalesce(collected, '{}'::jsonb) || ${patch}::jsonb
            WHERE id = ${params.leadId} AND user_id = ${params.ownerUserId}
            RETURNING id
          `
        : await sql`
            UPDATE ai_leads
            SET
              disposition = 'BOOKED',
              dispatch_status = 'unassigned_pool',
              job_status = 'UNASSIGNED',
              collected = coalesce(collected, '{}'::jsonb) || ${patch}::jsonb
            WHERE id = ${params.leadId} AND user_id = ${params.ownerUserId}
            RETURNING id
          `
    return rows.length > 0
  } catch (e) {
    if (isUndefinedRelationError(e, "ai_leads")) return false
    throw e
  }
}

/** When intake logs a lost lead, pull any matching hopper/CRM ai_leads row off the scheduler pool. */
export async function markAiLeadAsCrmLost(params: {
  ownerUserId: string
  callLogId?: string | null
  phoneE164?: string | null
  failureReason?: string | null
}): Promise<void> {
  const sql = getSql()
  const callLogId = params.callLogId?.trim() || null
  const phone = params.phoneE164?.trim() ? normalizePhoneNumberE164(params.phoneE164.trim()) : null
  const failureReason = params.failureReason?.trim() || null
  const subStatus =
    failureReason?.toLowerCase().includes("price") && failureReason.toLowerCase().includes("high")
      ? "price_too_high"
      : null
  const patch = JSON.stringify({
    disposition: "PRICE_REJECTED",
    dispatch_status: LOST_LEAD_STATUS,
    status: LOST_LEAD_STATUS,
    ...(subStatus ? { sub_status: subStatus, sales_recovery_stage: "price_recovery" } : {}),
    failure_reason: failureReason,
    is_salvageable: true,
    source: "answered_call_intake_lost",
  })
  try {
    if (callLogId) {
      await sql`
        UPDATE ai_leads
        SET
          disposition = 'PRICE_REJECTED',
          dispatch_status = ${LOST_LEAD_STATUS},
          job_status = ${LOST_LEAD_STATUS},
          is_salvageable = true,
          collected = coalesce(collected, '{}'::jsonb) || ${patch}::jsonb
        WHERE user_id = ${params.ownerUserId}
          AND (
            id = ${callLogId}
            OR collected->>'call_log_id' = ${callLogId}
          )
      `
    }
    if (phone) {
      await sql`
        UPDATE ai_leads
        SET
          disposition = 'PRICE_REJECTED',
          dispatch_status = ${LOST_LEAD_STATUS},
          job_status = ${LOST_LEAD_STATUS},
          is_salvageable = true,
          collected = coalesce(collected, '{}'::jsonb) || ${patch}::jsonb
        WHERE user_id = ${params.ownerUserId}
          AND caller_e164 = ${phone}
          AND coalesce(dispatch_status, collected->>'dispatch_status', '') IN (
            'unassigned_pool',
            ${UNASSIGNED_CALLBACK_STATUS},
            ${CRM_LEAD_STATUS},
            ${LOST_LEAD_STATUS}
          )
          AND created_at > now() - interval '7 days'
      `
    }
  } catch (e) {
    if (isUndefinedRelationError(e, "ai_leads")) return
    throw e
  }
}

// ============================================
// Field technicians + job dispatch (scripts/061)
// ============================================

function isMissingFieldTechTableError(e: unknown): boolean {
  return isUndefinedRelationError(e, "field_technicians")
}

function isMissingAssignedTechColumnError(e: unknown): boolean {
  if (pgErrorCode(e) !== "42703") return false
  const msg = pgErrorMessage(e)
  return msg.includes("assigned_tech_id") || msg.includes("job_status")
}

function isMissingFieldTechOrganizationColumnError(e: unknown): boolean {
  if (pgErrorCode(e) !== "42703") return false
  const msg = pgErrorMessage(e)
  return msg.includes("organization_id") && msg.includes("field_technicians")
}

function parseFieldTechnicianRow(row: Record<string, unknown>): FieldTechnician {
  return {
    id: String(row.id),
    owner_user_id: String(row.user_id),
    organization_id: row.organization_id != null ? String(row.organization_id) : null,
    portal_user_id: row.portal_user_id != null ? String(row.portal_user_id) : null,
    name: String(row.name ?? ""),
    phone: String(row.phone ?? ""),
    email: row.email != null ? String(row.email) : null,
    is_active: row.is_active == null ? true : pgBool(row.is_active),
    invite_pending: String(row.invite_status ?? "").toLowerCase() === "invited",
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }
}

/** All technicians on an owner's roster (optionally scoped to one workspace). */
export async function listFieldTechnicians(
  ownerUserId: string,
  organizationId?: string | null
): Promise<FieldTechnician[]> {
  const sql = getSql()
  const orgFilter =
    organizationId && !organizationId.startsWith("legacy-") ? organizationId : null
  try {
    if (orgFilter) {
      const realOrgCount = await countRealOrganizationsForOwner(ownerUserId)
      const rows =
        realOrgCount > 1
          ? await sql`
              SELECT ft.id, ft.user_id, ft.organization_id, ft.portal_user_id, ft.name, ft.phone, ft.is_active, ft.created_at,
                     u.email AS email, u.invite_status AS invite_status
              FROM field_technicians ft
              LEFT JOIN users u ON u.id = ft.portal_user_id
              WHERE ft.user_id = ${ownerUserId}
                AND ft.organization_id = ${orgFilter}
              ORDER BY ft.created_at DESC
            `
          : await sql`
              SELECT ft.id, ft.user_id, ft.organization_id, ft.portal_user_id, ft.name, ft.phone, ft.is_active, ft.created_at,
                     u.email AS email, u.invite_status AS invite_status
              FROM field_technicians ft
              LEFT JOIN users u ON u.id = ft.portal_user_id
              WHERE ft.user_id = ${ownerUserId}
                AND (ft.organization_id = ${orgFilter} OR ft.organization_id IS NULL)
              ORDER BY ft.created_at DESC
            `
      return rows.map(parseFieldTechnicianRow)
    }
    const rows = await sql`
      SELECT ft.id, ft.user_id, ft.organization_id, ft.portal_user_id, ft.name, ft.phone, ft.is_active, ft.created_at,
             u.email AS email, u.invite_status AS invite_status
      FROM field_technicians ft
      LEFT JOIN users u ON u.id = ft.portal_user_id
      WHERE ft.user_id = ${ownerUserId}
      ORDER BY ft.created_at DESC
    `
    return rows.map(parseFieldTechnicianRow)
  } catch (e) {
    if (isMissingFieldTechTableError(e)) return []
    if (isMissingFieldTechOrganizationColumnError(e)) {
      return listFieldTechniciansLegacy(ownerUserId)
    }
    // invite_status missing (pre-054/064) → retry without it.
    if (pgErrorCode(e) === "42703") {
      try {
        const rows = orgFilter
          ? await sql`
              SELECT ft.id, ft.user_id, ft.organization_id, ft.portal_user_id, ft.name, ft.phone, ft.is_active, ft.created_at,
                     u.email AS email
              FROM field_technicians ft
              LEFT JOIN users u ON u.id = ft.portal_user_id
              WHERE ft.user_id = ${ownerUserId}
                AND ft.organization_id = ${orgFilter}
              ORDER BY ft.created_at DESC
            `
          : await sql`
              SELECT ft.id, ft.user_id, ft.organization_id, ft.portal_user_id, ft.name, ft.phone, ft.is_active, ft.created_at,
                     u.email AS email
              FROM field_technicians ft
              LEFT JOIN users u ON u.id = ft.portal_user_id
              WHERE ft.user_id = ${ownerUserId}
              ORDER BY ft.created_at DESC
            `
        return rows.map(parseFieldTechnicianRow)
      } catch (e2) {
        if (isMissingFieldTechTableError(e2)) return []
        if (isMissingFieldTechOrganizationColumnError(e2)) {
          return listFieldTechniciansLegacy(ownerUserId)
        }
        throw e2
      }
    }
    throw e
  }
}

async function listFieldTechniciansLegacy(ownerUserId: string): Promise<FieldTechnician[]> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT ft.id, ft.user_id, ft.portal_user_id, ft.name, ft.phone, ft.is_active, ft.created_at,
             u.email AS email, u.invite_status AS invite_status
      FROM field_technicians ft
      LEFT JOIN users u ON u.id = ft.portal_user_id
      WHERE ft.user_id = ${ownerUserId}
      ORDER BY ft.created_at DESC
    `
    return rows.map(parseFieldTechnicianRow)
  } catch (e) {
    if (isMissingFieldTechTableError(e)) return []
    throw e
  }
}

/** Count active receptionists on an owner's roster (admin control hub). */
export async function countActiveReceptionistsForOwner(ownerUserId: string): Promise<number> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT count(*)::int AS c FROM receptionists
      WHERE user_id = ${ownerUserId} AND is_active = true
    `
    return Number(rows[0]?.c ?? 0)
  } catch (e) {
    if (isUndefinedRelationError(e, "receptionists")) return 0
    throw e
  }
}

/** Count active field technicians on an owner's roster (admin control hub). */
export async function countActiveFieldTechniciansForOwner(ownerUserId: string): Promise<number> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT count(*)::int AS c FROM field_technicians
      WHERE user_id = ${ownerUserId} AND is_active = true
    `
    return Number(rows[0]?.c ?? 0)
  } catch (e) {
    if (isMissingFieldTechTableError(e)) return 0
    throw e
  }
}

/** Insert a technician roster row linking the owner to the tech's login user. */
export async function insertFieldTechnician(params: {
  owner_user_id: string
  portal_user_id: string
  name: string
  phone: string
  organization_id?: string | null
}): Promise<FieldTechnician> {
  const sql = getSql()
  const id = crypto.randomUUID()
  const organizationId = await resolveOrganizationIdForNewPhoneLine(
    params.owner_user_id,
    params.organization_id ?? null
  )
  try {
    await sql`
      INSERT INTO field_technicians (id, user_id, organization_id, portal_user_id, name, phone, is_active, created_at)
      VALUES (${id}, ${params.owner_user_id}, ${organizationId}, ${params.portal_user_id}, ${params.name}, ${params.phone}, true, now())
    `
  } catch (e) {
    if (!isMissingFieldTechOrganizationColumnError(e)) throw e
    await sql`
      INSERT INTO field_technicians (id, user_id, portal_user_id, name, phone, is_active, created_at)
      VALUES (${id}, ${params.owner_user_id}, ${params.portal_user_id}, ${params.name}, ${params.phone}, true, now())
    `
  }
  return {
    id,
    owner_user_id: params.owner_user_id,
    organization_id: organizationId,
    portal_user_id: params.portal_user_id,
    name: params.name,
    phone: params.phone,
    email: null,
    is_active: true,
    created_at: new Date().toISOString(),
  }
}

/** Fetch one roster row for an owner (used after manual create). */
export async function getFieldTechnicianByIdForOwner(
  ownerUserId: string,
  technicianId: string
): Promise<FieldTechnician | null> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT ft.id, ft.user_id, ft.portal_user_id, ft.name, ft.phone, ft.is_active, ft.created_at,
             u.email AS email, u.invite_status AS invite_status
      FROM field_technicians ft
      LEFT JOIN users u ON u.id = ft.portal_user_id
      WHERE ft.user_id = ${ownerUserId} AND ft.id = ${technicianId}
      LIMIT 1
    `
    return rows[0] ? parseFieldTechnicianRow(rows[0] as Record<string, unknown>) : null
  } catch (e) {
    if (isMissingFieldTechTableError(e)) return null
    if (pgErrorCode(e) === "42703") {
      try {
        const rows = await sql`
          SELECT ft.id, ft.user_id, ft.portal_user_id, ft.name, ft.phone, ft.is_active, ft.created_at,
                 u.email AS email
          FROM field_technicians ft
          LEFT JOIN users u ON u.id = ft.portal_user_id
          WHERE ft.user_id = ${ownerUserId} AND ft.id = ${technicianId}
          LIMIT 1
        `
        return rows[0] ? parseFieldTechnicianRow(rows[0] as Record<string, unknown>) : null
      } catch (e2) {
        if (isMissingFieldTechTableError(e2)) return null
        throw e2
      }
    }
    throw e
  }
}

/** Resolve the tech roster row for a logged-in field_tech user (by their login id). */
export async function getFieldTechnicianByPortalUserId(
  portalUserId: string
): Promise<FieldTechnician | null> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT ft.id, ft.user_id, ft.portal_user_id, ft.name, ft.phone, ft.is_active, ft.created_at,
             u.email AS email
      FROM field_technicians ft
      LEFT JOIN users u ON u.id = ft.portal_user_id
      WHERE ft.portal_user_id = ${portalUserId}
      LIMIT 1
    `
    return rows[0] ? parseFieldTechnicianRow(rows[0]) : null
  } catch (e) {
    if (isMissingFieldTechTableError(e)) return null
    throw e
  }
}

/** Toggle a technician active/inactive (owner-scoped). */
export async function setFieldTechnicianActive(
  ownerUserId: string,
  techId: string,
  isActive: boolean
): Promise<void> {
  const sql = getSql()
  await sql`
    UPDATE field_technicians SET is_active = ${isActive}
    WHERE id = ${techId} AND user_id = ${ownerUserId}
  `
}

/** Move a technician to another workspace or update active flag. */
export async function patchFieldTechnicianForOwner(
  ownerUserId: string,
  techId: string,
  updates: { is_active?: boolean; organization_id?: string | null }
): Promise<boolean> {
  const sql = getSql()
  if (updates.organization_id !== undefined && updates.organization_id !== null) {
    const org = await getOrganizationForOwner(updates.organization_id, ownerUserId)
    if (!org || org.id.startsWith("legacy-")) return false
  }
  if (updates.is_active !== undefined && updates.organization_id !== undefined) {
    const rows = await sql`
      UPDATE field_technicians
      SET is_active = ${updates.is_active}, organization_id = ${updates.organization_id ?? null}
      WHERE id = ${techId} AND user_id = ${ownerUserId}
      RETURNING id
    `
    return rows.length > 0
  }
  if (updates.organization_id !== undefined) {
    const rows = await sql`
      UPDATE field_technicians
      SET organization_id = ${updates.organization_id ?? null}
      WHERE id = ${techId} AND user_id = ${ownerUserId}
      RETURNING id
    `
    return rows.length > 0
  }
  if (updates.is_active !== undefined) {
    await setFieldTechnicianActive(ownerUserId, techId, updates.is_active)
    return true
  }
  return false
}

/** Read a job site + customer from a lead's collected JSONB. */
function dispatchJobFromRow(row: Record<string, unknown>): DispatchJob {
  const collected = (row.collected as Record<string, unknown>) || {}
  const pick = (keys: string[]): string | null => {
    for (const k of keys) {
      const v = collected[k]
      if (typeof v === "string" && v.trim()) return v.trim()
    }
    return null
  }
  const lat = firstNumericField(collected, ["customer_lat", "lat", "latitude", "geo_lat", "location_lat", "service_lat"])
  const lng = firstNumericField(collected, ["customer_lng", "lng", "longitude", "geo_lng", "location_lng", "service_lng", "lon"])
  const pickBool = (keys: string[]): boolean | null => {
    for (const k of keys) {
      const v = collected[k]
      if (typeof v === "boolean") return v
      if (v === "true" || v === 1 || v === "t") return true
      if (v === "false" || v === 0 || v === "f") return false
    }
    return null
  }
  return {
    id: String(row.id),
    customer_name: pick(["customer_name", "name", "caller_name", "contact_name"]),
    customer_phone:
      pick(["callback_number", "caller_number", "phone", "callback"]) ||
      (row.caller_e164 != null ? String(row.caller_e164) : null),
    location: pick(["location", "service_address", "address", "job_address", "address_line1"]),
    summary: row.summary != null ? String(row.summary) : null,
    job_status: row.job_status != null ? String(row.job_status) : null,
    assigned_tech_id: row.assigned_tech_id != null ? String(row.assigned_tech_id) : null,
    assigned_tech_name: row.assigned_tech_name != null ? String(row.assigned_tech_name) : null,
    latitude: lat != null && Math.abs(lat) <= 90 ? lat : null,
    longitude: lng != null && Math.abs(lng) <= 180 ? lng : null,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    field_verification_required: pickBool(["field_verification_required"]),
  }
}

/** Booked jobs for the owner's dispatch feed, with any current tech assignment. */
export async function listOwnerBookedJobs(ownerUserId: string, limit = 50): Promise<DispatchJob[]> {
  const sql = getSql()
  const lim = Math.min(Math.max(limit, 1), 100)
  try {
    const rows = await sql`
      SELECT l.id, l.caller_e164, l.collected, l.summary, l.job_status, l.assigned_tech_id, l.created_at,
             t.name AS assigned_tech_name
      FROM ai_leads l
      LEFT JOIN field_technicians t ON t.portal_user_id = l.assigned_tech_id
      WHERE l.user_id = ${ownerUserId}
        AND (l.disposition = 'BOOKED' OR l.collected->>'disposition' = 'BOOKED')
      ORDER BY l.created_at DESC
      LIMIT ${lim}
    `
    return rows.map(dispatchJobFromRow)
  } catch (e) {
    // Pre-061 (no assigned_tech_id/job_status) or pre-058 (no disposition col) → fall back to JSONB-only.
    if (isMissingAssignedTechColumnError(e) || (pgErrorCode(e) === "42703" && pgErrorMessage(e).includes("disposition"))) {
      try {
        const rows = await sql`
          SELECT id, caller_e164, collected, summary, created_at
          FROM ai_leads
          WHERE user_id = ${ownerUserId} AND collected->>'disposition' = 'BOOKED'
          ORDER BY created_at DESC
          LIMIT ${lim}
        `
        return rows.map(dispatchJobFromRow)
      } catch (e2) {
        if (isUndefinedRelationError(e2, "ai_leads")) return []
        throw e2
      }
    }
    if (isUndefinedRelationError(e, "ai_leads")) return []
    throw e
  }
}

function schedulerEventFromRow(row: Record<string, unknown>): import("@/lib/types").SchedulerEvent {
  const collected = (row.collected as Record<string, unknown>) || {}
  const pick = (keys: string[]): string | null => {
    for (const k of keys) {
      const v = collected[k]
      if (typeof v === "string" && v.trim()) return v.trim()
    }
    return null
  }
  const pickNum = (keys: string[]): number | null => {
    for (const k of keys) {
      const v = collected[k]
      if (typeof v === "number" && Number.isFinite(v)) return v
      if (v != null && String(v).trim()) {
        const n = Number(v)
        if (Number.isFinite(n)) return n
      }
    }
    return null
  }
  const pickBool = (keys: string[]): boolean | null => {
    for (const k of keys) {
      const v = collected[k]
      if (typeof v === "boolean") return v
      if (v === "true" || v === 1 || v === "t") return true
      if (v === "false" || v === 0 || v === "f") return false
    }
    return null
  }
  const pricingMeta =
    collected.pricing_metadata != null && typeof collected.pricing_metadata === "object"
      ? (collected.pricing_metadata as Record<string, unknown>)
      : null
  const createdAt =
    row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? "")
  const scheduledRaw = row.scheduled_at ?? collected.scheduled_at ?? collected.preferred_time
  const scheduledAt =
    scheduledRaw instanceof Date
      ? scheduledRaw.toISOString()
      : scheduledRaw != null && String(scheduledRaw).trim()
        ? String(scheduledRaw)
        : createdAt
  const hasStructuredSchedule =
    row.scheduled_at != null && String(row.scheduled_at).trim() !== ""
      ? true
      : pick(["scheduled_at", "preferred_time"]) != null
  const disposition =
    row.disposition != null && String(row.disposition).trim()
      ? String(row.disposition)
      : pick(["disposition"])
  const durationRaw = collected.duration_minutes
  const durationMinutes =
    typeof durationRaw === "number" && Number.isFinite(durationRaw)
      ? durationRaw
      : parseInt(String(durationRaw ?? "60"), 10) || 60
  const latRaw = collected.customer_lat
  const lngRaw = collected.customer_lng
  const latitude =
    typeof latRaw === "number" && Number.isFinite(latRaw)
      ? latRaw
      : latRaw != null && String(latRaw).trim()
        ? Number(latRaw)
        : null
  const longitude =
    typeof lngRaw === "number" && Number.isFinite(lngRaw)
      ? lngRaw
      : lngRaw != null && String(lngRaw).trim()
        ? Number(lngRaw)
        : null
  return {
    id: String(row.id),
    customer_name: pick(["customer_name", "name", "caller_name", "contact_name"]),
    customer_phone:
      pick(["callback_number", "caller_number", "phone", "callback"]) ||
      (row.caller_e164 != null ? String(row.caller_e164) : null),
    location: pick(["job_address", "location", "service_address", "address", "address_line1"]),
    summary: row.summary != null ? String(row.summary) : null,
    disposition,
    scheduled_at: scheduledAt,
    scheduled_tentative: !hasStructuredSchedule,
    created_at: createdAt,
    job_type: pick(["job_type", "service_type", "service_package"]),
    duration_minutes: durationMinutes,
    assigned_tech_id:
      row.assigned_tech_id != null && String(row.assigned_tech_id).trim()
        ? String(row.assigned_tech_id)
        : pick(["assigned_tech_id"]),
    assigned_tech_name:
      row.assigned_tech_name != null && String(row.assigned_tech_name).trim()
        ? String(row.assigned_tech_name)
        : pick(["assigned_tech_name"]),
    vehicle_year: pick(["vehicle_year", "year"]),
    vehicle_make: pick(["vehicle_make", "make"]),
    vehicle_model: pick(["vehicle_model", "model"]),
    vehicle_vin: pick(["vehicle_vin", "vin"]),
    job_notes: pick(["job_notes", "notes", "symptoms"]),
    region: pick(["region", "state"]),
    postal_code: pick(["postal_code", "job_address_postal_code", "zip_code", "zipCode"]),
    latitude: latitude != null && Number.isFinite(latitude) ? latitude : null,
    longitude: longitude != null && Number.isFinite(longitude) ? longitude : null,
    job_status:
      row.job_status != null && String(row.job_status).trim()
        ? String(row.job_status)
        : pick(["job_status"]),
    dispatch_status:
      row.dispatch_status != null && String(row.dispatch_status).trim()
        ? String(row.dispatch_status)
        : pick(["dispatch_status"]),
    completed_at: pick(["completed_at"]),
    quoted_price_cents:
      pickNum(["last_quoted_price_cents", "quoted_price_cents"]) ??
      (pricingMeta?.quoted_price_cents != null && Number.isFinite(Number(pricingMeta.quoted_price_cents))
        ? Number(pricingMeta.quoted_price_cents)
        : null),
    service_quote_type_id:
      pick(["service_quote_type_id"]) ??
      (pricingMeta?.service_type_id != null ? String(pricingMeta.service_type_id) : null),
    key_fcc_id: pick(["key_fcc_id", "fcc_id"]),
    key_frequency: pick(["key_frequency"]),
    key_chipset: pick(["key_chipset", "chip_id"]),
    key_style: pick(["key_style"]),
    key_variant_id: pick(["key_variant_id"]),
    key_profile_id: pick(["key_profile_id"]),
    discount_applied: pick(["discount_applied"]),
    baseline_quoted_price_cents: pickNum(["baseline_quoted_price_cents"]),
    field_verification_required: pickBool(["field_verification_required"]),
  }
}

function isMissingSchedulerColumnError(e: unknown): boolean {
  if (pgErrorCode(e) !== "42703") return false
  const msg = pgErrorMessage(e)
  return msg.includes("scheduled_at") || msg.includes("organization_id")
}

/** Load one scheduler lead row — works before scripts/074 (no scheduled_at column). */
async function selectSchedulerLeadById(
  sql: ReturnType<typeof neon>,
  leadId: string
): Promise<Record<string, unknown> | undefined> {
  try {
    const rows = await sql`
      SELECT l.id, l.caller_e164, l.collected, l.summary, l.disposition, l.scheduled_at, l.created_at,
             l.assigned_tech_id, t.name AS assigned_tech_name
      FROM ai_leads l
      LEFT JOIN field_technicians t ON t.portal_user_id = l.assigned_tech_id
      WHERE l.id = ${leadId}
      LIMIT 1
    `
    return rows[0] as Record<string, unknown> | undefined
  } catch (e) {
    if (!isMissingSchedulerColumnError(e) && pgErrorCode(e) !== "42703") throw e
    try {
      const rows = await sql`
        SELECT l.id, l.caller_e164, l.collected, l.summary, l.disposition, l.created_at,
               l.assigned_tech_id, t.name AS assigned_tech_name
        FROM ai_leads l
        LEFT JOIN field_technicians t ON t.portal_user_id = l.assigned_tech_id
        WHERE l.id = ${leadId}
        LIMIT 1
      `
      return rows[0] as Record<string, unknown> | undefined
    } catch (e2) {
      if (isMissingAssignedTechColumnError(e2) || pgErrorCode(e2) === "42703") {
        const rows = await sql`
          SELECT id, caller_e164, collected, summary, disposition, created_at
          FROM ai_leads
          WHERE id = ${leadId}
          LIMIT 1
        `
        return rows[0] as Record<string, unknown> | undefined
      }
      throw e2
    }
  }
}

function syntheticSchedulerEventFromCreate(params: {
  id: string
  customerName: string
  customerPhoneE164: string
  summary: string
  jobType: string
  duration: number
  scheduledAtIso: string
  techId: string | null
  assignedTechName: string | null
  vehicleYear: string | null
  vehicleMake: string | null
  vehicleModel: string | null
  jobNotes: string | null
  jobAddress: string | null
}): import("@/lib/types").SchedulerEvent {
  return {
    id: params.id,
    customer_name: params.customerName,
    customer_phone: params.customerPhoneE164,
    location: params.jobAddress,
    summary: params.summary,
    disposition: "BOOKED",
    scheduled_at: params.scheduledAtIso,
    scheduled_tentative: false,
    created_at: new Date().toISOString(),
    job_type: params.jobType,
    duration_minutes: params.duration,
    assigned_tech_id: params.techId,
    assigned_tech_name: params.assignedTechName,
    vehicle_year: params.vehicleYear,
    vehicle_make: params.vehicleMake,
    vehicle_model: params.vehicleModel,
    job_notes: params.jobNotes,
    latitude: null,
    longitude: null,
    job_status: params.techId ? "assigned" : null,
    dispatch_status: params.techId ? "DISPATCHED" : "unassigned_pool",
  }
}

/** Calendar events for the owner scheduler (BOOKED + PENDING_TIME in date range). */
export async function listOwnerSchedulerEvents(params: {
  ownerUserId: string
  fromIso: string
  toIso: string
  organizationId?: string | null
  limit?: number
}): Promise<import("@/lib/types").SchedulerEvent[]> {
  const sql = getSql()
  const lim = Math.min(Math.max(params.limit ?? 200, 1), 500)
  const orgId = params.organizationId?.trim() || null
  try {
    const rows = orgId
      ? await sql`
          SELECT l.id, l.caller_e164, l.collected, l.summary, l.disposition, l.scheduled_at, l.created_at,
                 l.assigned_tech_id, l.job_status, l.dispatch_status, t.name AS assigned_tech_name
          FROM ai_leads l
          LEFT JOIN field_technicians t ON t.portal_user_id = l.assigned_tech_id
          WHERE l.user_id = ${params.ownerUserId}
            AND (
              disposition IN ('BOOKED', 'PENDING_TIME')
              OR collected->>'disposition' IN ('BOOKED', 'PENDING_TIME')
            )
            AND COALESCE(scheduled_at, created_at) >= ${params.fromIso}::timestamptz
            AND COALESCE(scheduled_at, created_at) <= ${params.toIso}::timestamptz
            AND (organization_id IS NULL OR organization_id = ${orgId}::uuid)
          ORDER BY COALESCE(scheduled_at, created_at) ASC
          LIMIT ${lim}
        `
      : await sql`
          SELECT l.id, l.caller_e164, l.collected, l.summary, l.disposition, l.scheduled_at, l.created_at,
                 l.assigned_tech_id, l.job_status, l.dispatch_status, t.name AS assigned_tech_name
          FROM ai_leads l
          LEFT JOIN field_technicians t ON t.portal_user_id = l.assigned_tech_id
          WHERE l.user_id = ${params.ownerUserId}
            AND (
              disposition IN ('BOOKED', 'PENDING_TIME')
              OR collected->>'disposition' IN ('BOOKED', 'PENDING_TIME')
            )
            AND COALESCE(scheduled_at, created_at) >= ${params.fromIso}::timestamptz
            AND COALESCE(scheduled_at, created_at) <= ${params.toIso}::timestamptz
          ORDER BY COALESCE(scheduled_at, created_at) ASC
          LIMIT ${lim}
        `
    return rows.map((r) => schedulerEventFromRow(r as Record<string, unknown>))
  } catch (e) {
    if (isMissingSchedulerColumnError(e)) {
      try {
        const rows = await sql`
          SELECT id, caller_e164, collected, summary, disposition, created_at
          FROM ai_leads
          WHERE user_id = ${params.ownerUserId}
            AND (
              disposition IN ('BOOKED', 'PENDING_TIME')
              OR collected->>'disposition' IN ('BOOKED', 'PENDING_TIME')
            )
            AND created_at >= ${params.fromIso}::timestamptz
            AND created_at <= ${params.toIso}::timestamptz
          ORDER BY created_at ASC
          LIMIT ${lim}
        `
        return rows.map((r) => schedulerEventFromRow(r as Record<string, unknown>))
      } catch (e2) {
        if (isUndefinedRelationError(e2, "ai_leads")) return []
        throw e2
      }
    }
    if (pgErrorCode(e) === "42703" && pgErrorMessage(e).includes("disposition")) {
      try {
        const rows = await sql`
          SELECT id, caller_e164, collected, summary, created_at
          FROM ai_leads
          WHERE user_id = ${params.ownerUserId}
            AND collected->>'disposition' IN ('BOOKED', 'PENDING_TIME')
            AND created_at >= ${params.fromIso}::timestamptz
            AND created_at <= ${params.toIso}::timestamptz
          ORDER BY created_at ASC
          LIMIT ${lim}
        `
        return rows.map((r) => schedulerEventFromRow(r as Record<string, unknown>))
      } catch (e2) {
        if (isUndefinedRelationError(e2, "ai_leads")) return []
        throw e2
      }
    }
    if (isUndefinedRelationError(e, "ai_leads")) return []
    throw e
  }
}

/** Owner sets structured appointment time on a lead (scheduler drag/reschedule). */
export async function updateLeadScheduledAt(
  ownerUserId: string,
  leadId: string,
  scheduledAtIso: string
): Promise<boolean> {
  const sql = getSql()
  try {
    const rows = await sql`
      UPDATE ai_leads
      SET scheduled_at = ${scheduledAtIso}::timestamptz
      WHERE id = ${leadId} AND user_id = ${ownerUserId}
      RETURNING id
    `
    return rows.length > 0
  } catch (e) {
    if (isMissingSchedulerColumnError(e)) return false
    throw e
  }
}

/** Fetch one scheduler lead for the owner (pool or calendar). */
export async function getOwnerSchedulerEventById(
  ownerUserId: string,
  leadId: string
): Promise<import("@/lib/types").SchedulerEvent | null> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT l.id, l.caller_e164, l.collected, l.summary, l.disposition, l.scheduled_at, l.created_at,
             l.assigned_tech_id, l.job_status, l.dispatch_status, t.name AS assigned_tech_name
      FROM ai_leads l
      LEFT JOIN field_technicians t ON t.portal_user_id = l.assigned_tech_id
      WHERE l.id = ${leadId} AND l.user_id = ${ownerUserId}
      LIMIT 1
    `
    if (rows.length === 0) return null
    return schedulerEventFromRow(rows[0] as Record<string, unknown>)
  } catch (e) {
    if (isMissingSchedulerColumnError(e)) {
      try {
        const rows = await sql`
          SELECT id, caller_e164, collected, summary, disposition, created_at
          FROM ai_leads
          WHERE id = ${leadId} AND user_id = ${ownerUserId}
          LIMIT 1
        `
        if (rows.length === 0) return null
        return schedulerEventFromRow(rows[0] as Record<string, unknown>)
      } catch (e2) {
        if (isUndefinedRelationError(e2, "ai_leads")) return null
        throw e2
      }
    }
    if (isUndefinedRelationError(e, "ai_leads")) return null
    throw e
  }
}

/** Owner removes a booked job / hopper entry from the scheduler. */
export async function deleteOwnerSchedulerJob(ownerUserId: string, leadId: string): Promise<boolean> {
  const sql = getSql()
  try {
    const rows = await sql`
      DELETE FROM ai_leads
      WHERE id = ${leadId} AND user_id = ${ownerUserId}
      RETURNING id
    `
    return rows.length > 0
  } catch (e) {
    if (isUndefinedRelationError(e, "ai_leads")) return false
    throw e
  }
}

/** Owner edits job details from the scheduler detail drawer. */
export async function updateOwnerSchedulerJob(params: {
  ownerUserId: string
  leadId: string
  customerName: string
  customerPhoneE164: string
  jobType: string
  scheduledAtIso?: string | null
  durationMinutes?: number
  assignedTechPortalUserId?: string | null
  assignedTechName?: string | null
  vehicleYear?: string | null
  vehicleMake?: string | null
  vehicleModel?: string | null
  vehicleVin?: string | null
  jobAddress?: string | null
  jobNotes?: string | null
  serviceQuoteTypeId?: string | null
  quotedPriceCents?: number | null
  distanceMiles?: number | null
  keyFccId?: string | null
  keyFrequency?: string | null
  keyChipset?: string | null
  keyStyle?: string | null
  keyVariantId?: string | null
  keyProfileId?: string | null
  discountApplied?: string | null
  baselineQuotedPriceCents?: number | null
  fieldVerificationRequired?: boolean | null
  dispatchStatus?: string | null
  isSalvageable?: boolean | null
}): Promise<import("@/lib/types").SchedulerEvent | null> {
  const sql = getSql()
  const existingRows = await sql`
    SELECT id, assigned_tech_id
    FROM ai_leads
    WHERE id = ${params.leadId} AND user_id = ${params.ownerUserId}
    LIMIT 1
  `
  if (existingRows.length === 0) return null

  const existingTechId =
    existingRows[0].assigned_tech_id != null && String(existingRows[0].assigned_tech_id).trim()
      ? String(existingRows[0].assigned_tech_id)
      : null
  const techIdProvided = params.assignedTechPortalUserId !== undefined
  const newTechId = techIdProvided ? params.assignedTechPortalUserId?.trim() || null : existingTechId

  const customerName = params.customerName.trim()
  let jobType = params.jobType.trim() || "Other"
  if (params.serviceQuoteTypeId?.trim()) {
    jobType = dispatchJobTypeFromServiceQuoteTypeId(params.serviceQuoteTypeId.trim() as ServiceQuoteTypeId)
  }
  const vehicleYear = params.vehicleYear?.trim() || null
  const vehicleMake = params.vehicleMake?.trim() || null
  const vehicleModel = params.vehicleModel?.trim() || null
  const jobAddress = params.jobAddress !== undefined ? params.jobAddress?.trim() || null : undefined
  const jobNotes = params.jobNotes !== undefined ? params.jobNotes?.trim() || null : undefined
  const vehicleLabel = [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(" ")
  const summary = [jobType, vehicleLabel || null, customerName].filter(Boolean).join(" — ")

  const collectedPatch: Record<string, unknown> = {
    customer_name: customerName,
    callback_number: params.customerPhoneE164,
    caller_number: params.customerPhoneE164,
    phone: params.customerPhoneE164,
    job_type: jobType,
  }

  if (params.durationMinutes != null) {
    collectedPatch.duration_minutes = Math.min(Math.max(params.durationMinutes, 15), 480)
  }
  if (vehicleYear) {
    collectedPatch.vehicle_year = vehicleYear
    collectedPatch.year = vehicleYear
  } else {
    collectedPatch.vehicle_year = null
    collectedPatch.year = null
  }
  if (vehicleMake) {
    collectedPatch.vehicle_make = vehicleMake
    collectedPatch.make = vehicleMake
  } else {
    collectedPatch.vehicle_make = null
    collectedPatch.make = null
  }
  if (vehicleModel) {
    collectedPatch.vehicle_model = vehicleModel
    collectedPatch.model = vehicleModel
  } else {
    collectedPatch.vehicle_model = null
    collectedPatch.model = null
  }
  if (params.vehicleVin !== undefined) {
    const vin = params.vehicleVin?.trim() || null
    collectedPatch.vehicle_vin = vin
    collectedPatch.vin = vin
  }
  if (jobAddress !== undefined) {
    collectedPatch.job_address = jobAddress
    collectedPatch.location = jobAddress
    collectedPatch.service_address = jobAddress
    collectedPatch.job_address_full = jobAddress
    if (!jobAddress) {
      collectedPatch.customer_lat = null
      collectedPatch.customer_lng = null
    }
  }
  if (jobNotes !== undefined) {
    collectedPatch.job_notes = jobNotes
    collectedPatch.notes = jobNotes
  }
  if (params.assignedTechName !== undefined) {
    collectedPatch.assigned_tech_name = params.assignedTechName?.trim() || null
  }
  if (params.serviceQuoteTypeId !== undefined) {
    collectedPatch.service_quote_type_id = params.serviceQuoteTypeId?.trim() || null
  }
  if (params.keyFccId !== undefined) {
    const v = params.keyFccId?.trim() || null
    collectedPatch.key_fcc_id = v
    collectedPatch.fcc_id = v
  }
  if (params.keyFrequency !== undefined) {
    collectedPatch.key_frequency = params.keyFrequency?.trim() || null
  }
  if (params.keyChipset !== undefined) {
    const v = params.keyChipset?.trim() || null
    collectedPatch.key_chipset = v
    collectedPatch.chip_id = v
  }
  if (params.keyStyle !== undefined) {
    collectedPatch.key_style = params.keyStyle?.trim() || null
  }
  if (params.fieldVerificationRequired !== undefined) {
    collectedPatch.field_verification_required = params.fieldVerificationRequired === true
  }
  if (params.keyVariantId !== undefined) {
    collectedPatch.key_variant_id = params.keyVariantId?.trim() || null
  }
  if (params.keyProfileId !== undefined) {
    collectedPatch.key_profile_id = params.keyProfileId?.trim() || null
  }
  if (params.quotedPriceCents != null && params.quotedPriceCents > 0) {
    collectedPatch.last_quoted_price_cents = Math.round(params.quotedPriceCents)
    collectedPatch.quoted_price_cents = Math.round(params.quotedPriceCents)
  }
  if (params.baselineQuotedPriceCents != null && params.baselineQuotedPriceCents > 0) {
    collectedPatch.baseline_quoted_price_cents = Math.round(params.baselineQuotedPriceCents)
  }
  if (params.discountApplied !== undefined) {
    const discount = params.discountApplied?.trim() || null
    collectedPatch.discount_applied = discount
    collectedPatch.negotiation_outcome = discount ? "booked_with_discount" : null
  }
  if (params.dispatchStatus !== undefined) {
    collectedPatch.dispatch_status = params.dispatchStatus?.trim() || "unassigned_pool"
  }
  if (params.isSalvageable !== undefined) {
    collectedPatch.is_salvageable = params.isSalvageable === true
  }
  if (
    params.serviceQuoteTypeId?.trim() &&
    params.quotedPriceCents != null &&
    params.quotedPriceCents > 0
  ) {
    const { rateCard, source: rateCardSource } = await getOwnerServiceRateCard(params.ownerUserId)
    const quote = calculateServiceQuote({
      serviceTypeId: params.serviceQuoteTypeId.trim() as ServiceQuoteTypeId,
      vehicleYear: vehicleYear ?? undefined,
      vehicleMake: vehicleMake ?? undefined,
      vehicleModel: vehicleModel ?? undefined,
      rateCard,
      rateCardSource,
      distanceMiles: params.distanceMiles ?? null,
      keyStyle: params.keyStyle ?? undefined,
      keyChipset: params.keyChipset ?? undefined,
      keyVariantId: params.keyVariantId ?? undefined,
    })
    collectedPatch.pricing_metadata = buildIntakePricingMetadata({
      quote: { ...quote, totalCents: Math.round(params.quotedPriceCents) },
      vehicleYear,
      vehicleMake,
      vehicleModel,
      rateCardSource,
    })
  }

  const patchJson = JSON.stringify(collectedPatch)
  const scheduledAtIso = params.scheduledAtIso?.trim() || null

  try {
    if (scheduledAtIso) {
      await sql`
        UPDATE ai_leads
        SET caller_e164 = ${params.customerPhoneE164},
            summary = ${summary},
            scheduled_at = ${scheduledAtIso}::timestamptz,
            collected = coalesce(collected, '{}'::jsonb) || ${patchJson}::jsonb
        WHERE id = ${params.leadId} AND user_id = ${params.ownerUserId}
      `
    } else {
      await sql`
        UPDATE ai_leads
        SET caller_e164 = ${params.customerPhoneE164},
            summary = ${summary},
            collected = coalesce(collected, '{}'::jsonb) || ${patchJson}::jsonb
        WHERE id = ${params.leadId} AND user_id = ${params.ownerUserId}
      `
    }
  } catch (e) {
    if (isMissingSchedulerColumnError(e)) return null
    throw e
  }

  if (params.dispatchStatus !== undefined) {
    await setLeadDispatchStatus(params.leadId, params.dispatchStatus.trim() || "unassigned_pool")
  }
  if (params.isSalvageable !== undefined) {
    try {
      await sql`
        UPDATE ai_leads
        SET is_salvageable = ${params.isSalvageable === true}
        WHERE id = ${params.leadId} AND user_id = ${params.ownerUserId}
      `
    } catch (e) {
      if (!isMissingSchedulerColumnError(e)) throw e
    }
  }

  const explicitDispatch = params.dispatchStatus?.trim().toLowerCase()
  const shouldClearTechForPipeline =
    explicitDispatch != null &&
    explicitDispatch !== "dispatched" &&
    existingTechId != null &&
    !techIdProvided

  if (techIdProvided && newTechId !== existingTechId) {
    if (params.dispatchStatus !== undefined) {
      try {
        await sql`
          UPDATE ai_leads
          SET assigned_tech_id = ${newTechId},
              job_status = ${newTechId ? "assigned" : null}
          WHERE id = ${params.leadId} AND user_id = ${params.ownerUserId}
        `
      } catch (e) {
        if (isMissingSchedulerColumnError(e)) return null
        throw e
      }
      const techPatch = newTechId
        ? {
            assigned_tech_id: newTechId,
            assigned_tech_name: params.assignedTechName?.trim() || null,
            dispatch_status: params.dispatchStatus.trim(),
          }
        : {
            assigned_tech_id: null,
            assigned_tech_name: null,
            dispatch_status: params.dispatchStatus.trim(),
          }
      try {
        await sql`
          UPDATE ai_leads
          SET collected = coalesce(collected, '{}'::jsonb) || ${JSON.stringify(techPatch)}::jsonb
          WHERE id = ${params.leadId}
        `
      } catch {
        /* collected mirror optional */
      }
    } else {
      await assignJobToTech(params.ownerUserId, params.leadId, newTechId)
    }
  } else if (shouldClearTechForPipeline) {
    try {
      await sql`
        UPDATE ai_leads
        SET assigned_tech_id = null,
            job_status = null
        WHERE id = ${params.leadId} AND user_id = ${params.ownerUserId}
      `
    } catch (e) {
      if (isMissingSchedulerColumnError(e)) return null
      throw e
    }
    try {
      await sql`
        UPDATE ai_leads
        SET collected = coalesce(collected, '{}'::jsonb) || ${JSON.stringify({
          assigned_tech_id: null,
          assigned_tech_name: null,
        })}::jsonb
        WHERE id = ${params.leadId}
      `
    } catch {
      /* collected mirror optional */
    }
  }

  return getOwnerSchedulerEventById(params.ownerUserId, params.leadId)
}

/** Stamp scheduled_at when receptionist intake includes a parseable preferred time. */
export async function setLeadScheduledAt(leadId: string, scheduledAtIso: string): Promise<void> {
  const sql = getSql()
  try {
    await sql`
      UPDATE ai_leads SET scheduled_at = ${scheduledAtIso}::timestamptz WHERE id = ${leadId}
    `
  } catch (e) {
    if (isMissingSchedulerColumnError(e)) return
    throw e
  }
}

/** Owner manually books an appointment from the scheduler UI. */
export async function createOwnerSchedulerAppointment(params: {
  ownerUserId: string
  organizationId?: string | null
  customerName: string
  customerPhoneE164: string
  jobType: string
  scheduledAtIso: string
  durationMinutes: number
  assignedTechPortalUserId?: string | null
  assignedTechName?: string | null
  vehicleYear?: string | null
  vehicleMake?: string | null
  vehicleModel?: string | null
  jobAddress?: string | null
  jobNotes?: string | null
  structuredAddress?: {
    formatted: string
    street_number: string
    route: string
    locality: string
    postal_code: string
    admin_area: string
    lat?: number | null
    lng?: number | null
  } | null
  extraCollected?: Record<string, unknown>
}): Promise<import("@/lib/types").SchedulerEvent> {
  const sql = getSql()
  const id = crypto.randomUUID()
  const duration = Math.min(Math.max(params.durationMinutes, 15), 480)
  const jobType = params.jobType.trim() || "Other"
  const customerName = params.customerName.trim()
  const vehicleYear = params.vehicleYear?.trim() || null
  const vehicleMake = params.vehicleMake?.trim() || null
  const vehicleModel = params.vehicleModel?.trim() || null
  const jobAddress = params.structuredAddress?.formatted?.trim() || params.jobAddress?.trim() || null
  const jobNotes = params.jobNotes?.trim() || null
  const vehicleLabel = [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(" ")
  const summary = [jobType, vehicleLabel || null, customerName].filter(Boolean).join(" — ")
  const techId = params.assignedTechPortalUserId?.trim() || null
  const dispatchStatus = techId ? "DISPATCHED" : "unassigned_pool"
  const collected = {
    customer_name: customerName,
    job_type: jobType,
    duration_minutes: duration,
    disposition: "BOOKED",
    dispatch_status: dispatchStatus,
    is_salvageable: false,
    source: "owner_manual_scheduler",
    scheduled_at: params.scheduledAtIso,
    ...(vehicleYear ? { vehicle_year: vehicleYear, year: vehicleYear } : {}),
    ...(vehicleMake ? { vehicle_make: vehicleMake, make: vehicleMake } : {}),
    ...(vehicleModel ? { vehicle_model: vehicleModel, model: vehicleModel } : {}),
    ...(jobAddress ? { job_address: jobAddress, location: jobAddress, service_address: jobAddress } : {}),
    ...(params.structuredAddress
      ? {
          job_address_full: params.structuredAddress.formatted,
          job_address_street_number: params.structuredAddress.street_number,
          job_address_route: params.structuredAddress.route,
          job_address_locality: params.structuredAddress.locality,
          job_address_postal_code: params.structuredAddress.postal_code,
          job_address_admin_area: params.structuredAddress.admin_area,
          ...(params.structuredAddress.lat != null ? { customer_lat: params.structuredAddress.lat } : {}),
          ...(params.structuredAddress.lng != null ? { customer_lng: params.structuredAddress.lng } : {}),
        }
      : {}),
    ...(jobNotes ? { job_notes: jobNotes, notes: jobNotes } : {}),
    ...(params.extraCollected ?? {}),
    ...(techId ? { assigned_tech_id: techId } : {}),
    ...(params.assignedTechName?.trim() ? { assigned_tech_name: params.assignedTechName.trim() } : {}),
  }
  const collectedJson = JSON.stringify(collected)
  const orgId = params.organizationId?.trim() || null

  try {
    if (orgId) {
      await sql`
        INSERT INTO ai_leads (
          id, user_id, organization_id, caller_e164, intent_slug, collected, summary,
          disposition, dispatch_status, is_salvageable, scheduled_at,
          assigned_tech_id, job_status, sms_sent, sms_error, vapi_call_id, created_at
        ) VALUES (
          ${id}, ${params.ownerUserId}, ${orgId}::uuid, ${params.customerPhoneE164},
          'owner_manual_scheduler', ${collectedJson}::jsonb, ${summary},
          'BOOKED', ${dispatchStatus}, false, ${params.scheduledAtIso}::timestamptz,
          ${techId}, ${techId ? "assigned" : null}, false, null, ${`${id}-manual`}, now()
        )
      `
    } else {
      await sql`
        INSERT INTO ai_leads (
          id, user_id, caller_e164, intent_slug, collected, summary,
          disposition, dispatch_status, is_salvageable, scheduled_at,
          assigned_tech_id, job_status, sms_sent, sms_error, vapi_call_id, created_at
        ) VALUES (
          ${id}, ${params.ownerUserId}, ${params.customerPhoneE164},
          'owner_manual_scheduler', ${collectedJson}::jsonb, ${summary},
          'BOOKED', ${dispatchStatus}, false, ${params.scheduledAtIso}::timestamptz,
          ${techId}, ${techId ? "assigned" : null}, false, null, ${`${id}-manual`}, now()
        )
      `
    }
  } catch (e) {
    if (isMissingSchedulerColumnError(e) || pgErrorCode(e) === "42703") {
      await sql`
        INSERT INTO ai_leads (
          id, user_id, caller_e164, intent_slug, collected, summary, sms_sent, sms_error, vapi_call_id, created_at
        ) VALUES (
          ${id}, ${params.ownerUserId}, ${params.customerPhoneE164},
          'owner_manual_scheduler', ${collectedJson}::jsonb, ${summary}, false, null, ${`${id}-manual`}, now()
        )
      `
      await applyLeadDisposition(id, {
        disposition: "BOOKED",
        dispatch_status: dispatchStatus,
        is_salvageable: false,
      })
      await setLeadScheduledAt(id, params.scheduledAtIso)
      if (techId) await assignJobToTech(params.ownerUserId, id, techId)
      else await setLeadDispatchStatus(id, dispatchStatus)
    } else if (pgErrorCode(e) === "23503" && orgId && pgErrorMessage(e).includes("organization_id")) {
      // Workspace FK missing — save without organization_id so booking still succeeds.
      await sql`
        INSERT INTO ai_leads (
          id, user_id, caller_e164, intent_slug, collected, summary,
          disposition, dispatch_status, is_salvageable, scheduled_at,
          assigned_tech_id, job_status, sms_sent, sms_error, vapi_call_id, created_at
        ) VALUES (
          ${id}, ${params.ownerUserId}, ${params.customerPhoneE164},
          'owner_manual_scheduler', ${collectedJson}::jsonb, ${summary},
          'BOOKED', ${dispatchStatus}, false, ${params.scheduledAtIso}::timestamptz,
          ${techId}, ${techId ? "assigned" : null}, false, null, ${`${id}-manual`}, now()
        )
      `.catch(async (e2) => {
        if (isMissingSchedulerColumnError(e2) || pgErrorCode(e2) === "42703") {
          await sql`
            INSERT INTO ai_leads (
              id, user_id, caller_e164, intent_slug, collected, summary, sms_sent, sms_error, vapi_call_id, created_at
            ) VALUES (
              ${id}, ${params.ownerUserId}, ${params.customerPhoneE164},
              'owner_manual_scheduler', ${collectedJson}::jsonb, ${summary}, false, null, ${`${id}-manual`}, now()
            )
          `
          await applyLeadDisposition(id, {
            disposition: "BOOKED",
            dispatch_status: dispatchStatus,
            is_salvageable: false,
          })
          await setLeadScheduledAt(id, params.scheduledAtIso)
          if (techId) await assignJobToTech(params.ownerUserId, id, techId)
          else await setLeadDispatchStatus(id, dispatchStatus)
          return
        }
        throw e2
      })
    } else {
      throw e
    }
  }

  if (techId) {
    await assignJobToTech(params.ownerUserId, id, techId).catch(() => {})
  } else {
    await setLeadDispatchStatus(id, dispatchStatus).catch(() => {})
  }

  const row = await selectSchedulerLeadById(sql, id)
  if (!row) {
    return syntheticSchedulerEventFromCreate({
      id,
      customerName,
      customerPhoneE164: params.customerPhoneE164,
      summary,
      jobType,
      duration,
      scheduledAtIso: params.scheduledAtIso,
      techId,
      assignedTechName: params.assignedTechName ?? null,
      vehicleYear,
      vehicleMake,
      vehicleModel,
      jobNotes,
      jobAddress,
    })
  }
  return schedulerEventFromRow(row)
}

/** Jobs dispatched to a specific tech (their login user id). */
export async function listJobsForTech(techUserId: string, limit = 50): Promise<DispatchJob[]> {
  const sql = getSql()
  const lim = Math.min(Math.max(limit, 1), 100)
  try {
    const rows = await sql`
      SELECT id, caller_e164, collected, summary, job_status, assigned_tech_id, created_at
      FROM ai_leads
      WHERE assigned_tech_id = ${techUserId}
      ORDER BY created_at DESC
      LIMIT ${lim}
    `
    return rows.map(dispatchJobFromRow)
  } catch (e) {
    if (isMissingAssignedTechColumnError(e) || isUndefinedRelationError(e, "ai_leads")) return []
    throw e
  }
}

/** Assign (or clear) the tech on a booked job. Owner-scoped + parameterized. Returns false if not found. */
export async function assignJobToTech(
  ownerUserId: string,
  leadId: string,
  techUserId: string | null
): Promise<boolean> {
  const sql = getSql()
  const rows = await sql`
    UPDATE ai_leads
    SET assigned_tech_id = ${techUserId},
        job_status = ${techUserId ? "assigned" : null}
    WHERE id = ${leadId} AND user_id = ${ownerUserId}
    RETURNING id
  `
  if (rows.length === 0) return false
  const dispatchStatus = techUserId ? "DISPATCHED" : "unassigned_pool"
  await setLeadDispatchStatus(leadId, dispatchStatus)
  const patch = techUserId
    ? { assigned_tech_id: techUserId, dispatch_status: dispatchStatus }
    : { assigned_tech_id: null, assigned_tech_name: null, dispatch_status: dispatchStatus }
  try {
    await sql`
      UPDATE ai_leads
      SET collected = coalesce(collected, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb
      WHERE id = ${leadId}
    `
  } catch {
    /* collected mirror optional */
  }
  return true
}

function poolJobFromRow(row: Record<string, unknown>): import("@/lib/types").UnassignedPoolJob {
  const ev = schedulerEventFromRow(row)
  return {
    id: ev.id,
    customer_name: ev.customer_name,
    customer_phone: ev.customer_phone,
    location: ev.location,
    neighborhood: neighborhoodFromLocation(ev.location),
    summary: ev.summary,
    job_type: ev.job_type,
    vehicle_year: ev.vehicle_year,
    vehicle_make: ev.vehicle_make,
    vehicle_model: ev.vehicle_model,
    job_notes: ev.job_notes,
    region: ev.region,
    postal_code: ev.postal_code,
    scheduled_at: ev.scheduled_tentative ? null : ev.scheduled_at,
    duration_minutes: ev.duration_minutes,
    dispatch_status:
      row.dispatch_status != null && String(row.dispatch_status).trim()
        ? String(row.dispatch_status)
        : "unassigned_pool",
    created_at: ev.created_at,
    latitude: ev.latitude,
    longitude: ev.longitude,
    quoted_price_cents: ev.quoted_price_cents,
    service_quote_type_id: ev.service_quote_type_id,
    key_fcc_id: ev.key_fcc_id,
    key_frequency: ev.key_frequency,
    key_chipset: ev.key_chipset,
    key_style: ev.key_style,
    key_variant_id: ev.key_variant_id,
    key_profile_id: ev.key_profile_id,
    discount_applied: ev.discount_applied,
    baseline_quoted_price_cents: ev.baseline_quoted_price_cents,
    field_verification_required: ev.field_verification_required,
  }
}

function activePipelineJobFromRow(row: Record<string, unknown>): import("@/lib/types").ActivePipelineJob {
  const ev = schedulerEventFromRow(row)
  const base = poolJobFromRow(row)
  return {
    ...base,
    scheduled_at: ev.scheduled_tentative ? null : ev.scheduled_at,
    job_status: ev.job_status,
    assigned_tech_id: ev.assigned_tech_id,
    assigned_tech_name: ev.assigned_tech_name,
  }
}

/** All non-completed pipeline jobs for one calendar day (+ open hopper jobs). */
export async function listOwnerActivePipelineJobsForDay(params: {
  ownerUserId: string
  dayKey: string
  organizationId?: string | null
  limit?: number
}): Promise<import("@/lib/types").ActivePipelineJob[]> {
  const sql = getSql()
  const lim = Math.min(Math.max(params.limit ?? 150, 1), 300)
  const orgId = params.organizationId?.trim() || null
  const { fromIso, toIso } = localDayRangeIso(params.dayKey)

  try {
    const rows = orgId
      ? await sql`
          SELECT l.id, l.caller_e164, l.collected, l.summary, l.disposition, l.scheduled_at, l.created_at,
                 l.assigned_tech_id, l.job_status, l.dispatch_status, t.name AS assigned_tech_name
          FROM ai_leads l
          LEFT JOIN field_technicians t ON t.portal_user_id = l.assigned_tech_id
          WHERE l.user_id = ${params.ownerUserId}
            AND (l.job_status IS NULL OR l.job_status <> 'completed')
            AND (
              l.disposition IN ('BOOKED', 'PENDING_TIME')
              OR l.collected->>'disposition' IN ('BOOKED', 'PENDING_TIME')
            )
            AND l.assigned_tech_id IS NOT NULL
            AND TRIM(l.assigned_tech_id) <> ''
            AND (
              l.job_status IS NULL
              OR LOWER(TRIM(l.job_status)) NOT IN ('completed', 'unassigned')
            )
            AND l.scheduled_at IS NOT NULL
            AND l.scheduled_at >= ${fromIso}::timestamptz
            AND l.scheduled_at < ${toIso}::timestamptz
            AND (l.organization_id IS NULL OR l.organization_id = ${orgId}::uuid)
          ORDER BY COALESCE(l.scheduled_at, l.created_at) ASC
          LIMIT ${lim}
        `
      : await sql`
          SELECT l.id, l.caller_e164, l.collected, l.summary, l.disposition, l.scheduled_at, l.created_at,
                 l.assigned_tech_id, l.job_status, l.dispatch_status, t.name AS assigned_tech_name
          FROM ai_leads l
          LEFT JOIN field_technicians t ON t.portal_user_id = l.assigned_tech_id
          WHERE l.user_id = ${params.ownerUserId}
            AND (l.job_status IS NULL OR l.job_status <> 'completed')
            AND (
              l.disposition IN ('BOOKED', 'PENDING_TIME')
              OR l.collected->>'disposition' IN ('BOOKED', 'PENDING_TIME')
            )
            AND l.assigned_tech_id IS NOT NULL
            AND TRIM(l.assigned_tech_id) <> ''
            AND (
              l.job_status IS NULL
              OR LOWER(TRIM(l.job_status)) NOT IN ('completed', 'unassigned')
            )
            AND l.scheduled_at IS NOT NULL
            AND l.scheduled_at >= ${fromIso}::timestamptz
            AND l.scheduled_at < ${toIso}::timestamptz
          ORDER BY COALESCE(l.scheduled_at, l.created_at) ASC
          LIMIT ${lim}
        `
    return rows.map((r) => activePipelineJobFromRow(r as Record<string, unknown>))
  } catch (e) {
    if (isMissingSchedulerColumnError(e) || isMissingAssignedTechColumnError(e)) {
      return []
    }
    if (isUndefinedRelationError(e, "ai_leads")) return []
    throw e
  }
}

/** Active unassigned jobs in the hopper for one owner workspace. */
export async function listOwnerUnassignedPoolJobs(params: {
  ownerUserId: string
  organizationId?: string | null
  limit?: number
}): Promise<import("@/lib/types").UnassignedPoolJob[]> {
  const sql = getSql()
  const lim = Math.min(Math.max(params.limit ?? 100, 1), 200)
  const orgId = params.organizationId?.trim() || null
  try {
    const rows = orgId
      ? await sql`
          SELECT l.id, l.caller_e164, l.collected, l.summary, l.disposition, l.scheduled_at, l.created_at,
                 l.assigned_tech_id, l.dispatch_status, t.name AS assigned_tech_name
          FROM ai_leads l
          LEFT JOIN field_technicians t ON t.portal_user_id = l.assigned_tech_id
          WHERE l.user_id = ${params.ownerUserId}
            AND l.assigned_tech_id IS NULL
            AND (l.job_status IS NULL OR l.job_status <> 'completed')
            AND (
              l.disposition = 'BOOKED'
              OR l.collected->>'disposition' = 'BOOKED'
            )
            AND coalesce(nullif(trim(l.dispatch_status), ''), nullif(trim(l.collected->>'dispatch_status'), '')) = 'unassigned_pool'
            AND coalesce(nullif(trim(l.dispatch_status), ''), nullif(trim(l.collected->>'dispatch_status'), ''))
              NOT IN (${CRM_LEAD_STATUS}, ${LOST_LEAD_STATUS}, ${UNASSIGNED_CALLBACK_STATUS})
            AND (l.organization_id IS NULL OR l.organization_id = ${orgId}::uuid)
          ORDER BY l.created_at DESC
          LIMIT ${lim}
        `
      : await sql`
          SELECT l.id, l.caller_e164, l.collected, l.summary, l.disposition, l.scheduled_at, l.created_at,
                 l.assigned_tech_id, l.dispatch_status, t.name AS assigned_tech_name
          FROM ai_leads l
          LEFT JOIN field_technicians t ON t.portal_user_id = l.assigned_tech_id
          WHERE l.user_id = ${params.ownerUserId}
            AND l.assigned_tech_id IS NULL
            AND (l.job_status IS NULL OR l.job_status <> 'completed')
            AND (
              l.disposition = 'BOOKED'
              OR l.collected->>'disposition' = 'BOOKED'
            )
            AND coalesce(nullif(trim(l.dispatch_status), ''), nullif(trim(l.collected->>'dispatch_status'), '')) = 'unassigned_pool'
            AND coalesce(nullif(trim(l.dispatch_status), ''), nullif(trim(l.collected->>'dispatch_status'), ''))
              NOT IN (${CRM_LEAD_STATUS}, ${LOST_LEAD_STATUS}, ${UNASSIGNED_CALLBACK_STATUS})
          ORDER BY l.created_at DESC
          LIMIT ${lim}
        `
    return rows.map((r) => poolJobFromRow(r as Record<string, unknown>))
  } catch (e) {
    if (isMissingSchedulerColumnError(e) || isMissingAssignedTechColumnError(e)) {
      try {
        const rows = await sql`
          SELECT id, caller_e164, collected, summary, disposition, created_at
          FROM ai_leads
          WHERE user_id = ${params.ownerUserId}
            AND collected->>'disposition' IN ('BOOKED', 'PENDING_TIME')
            AND (collected->>'assigned_tech_id' IS NULL OR collected->>'assigned_tech_id' = '')
          ORDER BY created_at DESC
          LIMIT ${lim}
        `
        return rows.map((r) => poolJobFromRow(r as Record<string, unknown>))
      } catch (e2) {
        if (isUndefinedRelationError(e2, "ai_leads")) return []
        throw e2
      }
    }
    if (isUndefinedRelationError(e, "ai_leads")) return []
    throw e
  }
}

/** Unassigned pool jobs visible to a field tech (same owner roster). */
export async function listUnassignedPoolForTech(techUserId: string, limit = 30): Promise<import("@/lib/types").UnassignedPoolJob[]> {
  const sql = getSql()
  const lim = Math.min(Math.max(limit, 1), 100)
  try {
    const rows = await sql`
      SELECT l.id, l.caller_e164, l.collected, l.summary, l.disposition, l.scheduled_at, l.created_at,
             l.assigned_tech_id, l.dispatch_status, NULL::text AS assigned_tech_name
      FROM ai_leads l
      INNER JOIN field_technicians ft ON ft.user_id = l.user_id AND ft.portal_user_id = ${techUserId} AND ft.is_active = true
      WHERE l.assigned_tech_id IS NULL
        AND (l.job_status IS NULL OR l.job_status <> 'completed')
        AND (
          l.disposition = 'BOOKED'
          OR l.collected->>'disposition' = 'BOOKED'
        )
        AND coalesce(nullif(trim(l.dispatch_status), ''), nullif(trim(l.collected->>'dispatch_status'), '')) = 'unassigned_pool'
      ORDER BY l.created_at DESC
      LIMIT ${lim}
    `
    return rows.map((r) => poolJobFromRow(r as Record<string, unknown>))
  } catch (e) {
    if (isMissingAssignedTechColumnError(e) || isUndefinedRelationError(e, "ai_leads")) return []
    throw e
  }
}

/** Tech claims an unassigned hopper job (atomic — fails if already taken). */
export async function claimUnassignedJobForTech(
  techUserId: string,
  leadId: string
): Promise<{ ok: boolean; ownerUserId: string | null; techName: string | null }> {
  const sql = getSql()
  try {
    const rows = await sql`
      UPDATE ai_leads l
      SET assigned_tech_id = ${techUserId},
          job_status = 'assigned',
          dispatch_status = 'DISPATCHED',
          collected = jsonb_set(
            jsonb_set(
              coalesce(l.collected, '{}'::jsonb),
              '{assigned_tech_id}',
              to_jsonb(${techUserId}::text),
              true
            ),
            '{dispatch_status}',
            '"DISPATCHED"'::jsonb,
            true
          )
      FROM field_technicians ft
      WHERE l.id = ${leadId}
        AND l.assigned_tech_id IS NULL
        AND (l.job_status IS NULL OR l.job_status <> 'completed')
        AND ft.user_id = l.user_id
        AND ft.portal_user_id = ${techUserId}
        AND ft.is_active = true
      RETURNING l.user_id AS owner_user_id, ft.name AS tech_name
    `
    const row = rows[0] as { owner_user_id?: string; tech_name?: string } | undefined
    if (!row?.owner_user_id) return { ok: false, ownerUserId: null, techName: null }
    const techName = row.tech_name != null ? String(row.tech_name) : null
    if (techName) {
      await sql`
        UPDATE ai_leads
        SET collected = jsonb_set(
          coalesce(collected, '{}'::jsonb),
          '{assigned_tech_name}',
          to_jsonb(${techName}::text),
          true
        )
        WHERE id = ${leadId}
      `
    }
    return { ok: true, ownerUserId: String(row.owner_user_id), techName }
  } catch (e) {
    if (isMissingAssignedTechColumnError(e)) return { ok: false, ownerUserId: null, techName: null }
    throw e
  }
}

/** Owner schedules a hopper job onto the calendar and assigns a tech in one step. */
export async function schedulePoolJobAndAssign(params: {
  ownerUserId: string
  leadId: string
  scheduledAtIso: string
  techUserId: string
  techName: string
}): Promise<import("@/lib/types").SchedulerEvent | null> {
  const ok = await updateLeadScheduledAt(params.ownerUserId, params.leadId, params.scheduledAtIso)
  if (!ok) return null
  const assigned = await assignJobToTech(params.ownerUserId, params.leadId, params.techUserId)
  if (!assigned) return null
  const patch = {
    assigned_tech_id: params.techUserId,
    assigned_tech_name: params.techName,
    dispatch_status: "DISPATCHED",
  }
  const sql = getSql()
  await sql`
    UPDATE ai_leads
    SET collected = coalesce(collected, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb
    WHERE id = ${params.leadId}
  `
  const rows = await sql`
    SELECT l.id, l.caller_e164, l.collected, l.summary, l.disposition, l.scheduled_at, l.created_at,
           l.assigned_tech_id, t.name AS assigned_tech_name
    FROM ai_leads l
    LEFT JOIN field_technicians t ON t.portal_user_id = l.assigned_tech_id
    WHERE l.id = ${params.leadId} AND l.user_id = ${params.ownerUserId}
    LIMIT 1
  `
  const row = rows[0] as Record<string, unknown> | undefined
  return row ? schedulerEventFromRow(row) : null
}

/** Search pool + scheduled jobs by customer phone (E.164 or digits). */
export async function searchOwnerJobsByPhone(params: {
  ownerUserId: string
  phoneQuery: string
  organizationId?: string | null
}): Promise<import("@/lib/types").SchedulerPhoneLookupResult> {
  const e164 = normalizePhoneNumberE164(params.phoneQuery)
  const digits = phoneDigitsKey(e164 || params.phoneQuery)
  if (digits.length < 7) return { pool: [], scheduled: [] }

  const sql = getSql()
  const orgId = params.organizationId?.trim() || null
  const phonePattern = `%${digits.slice(-10)}%`

  try {
    const rows = orgId
      ? await sql`
          SELECT l.id, l.caller_e164, l.collected, l.summary, l.disposition, l.scheduled_at, l.created_at,
                 l.assigned_tech_id, l.dispatch_status, t.name AS assigned_tech_name
          FROM ai_leads l
          LEFT JOIN field_technicians t ON t.portal_user_id = l.assigned_tech_id
          WHERE l.user_id = ${params.ownerUserId}
            AND (l.organization_id IS NULL OR l.organization_id = ${orgId}::uuid)
            AND (
              l.caller_e164 = ${e164}
              OR regexp_replace(l.caller_e164, '\\D', '', 'g') LIKE ${phonePattern}
              OR regexp_replace(coalesce(l.collected->>'callback_number', ''), '\\D', '', 'g') LIKE ${phonePattern}
              OR regexp_replace(coalesce(l.collected->>'phone', ''), '\\D', '', 'g') LIKE ${phonePattern}
            )
            AND (
              l.disposition IN ('BOOKED', 'PENDING_TIME')
              OR l.collected->>'disposition' IN ('BOOKED', 'PENDING_TIME')
            )
          ORDER BY coalesce(l.scheduled_at, l.created_at) DESC
          LIMIT 40
        `
      : await sql`
          SELECT l.id, l.caller_e164, l.collected, l.summary, l.disposition, l.scheduled_at, l.created_at,
                 l.assigned_tech_id, l.dispatch_status, t.name AS assigned_tech_name
          FROM ai_leads l
          LEFT JOIN field_technicians t ON t.portal_user_id = l.assigned_tech_id
          WHERE l.user_id = ${params.ownerUserId}
            AND (
              l.caller_e164 = ${e164}
              OR regexp_replace(l.caller_e164, '\\D', '', 'g') LIKE ${phonePattern}
              OR regexp_replace(coalesce(l.collected->>'callback_number', ''), '\\D', '', 'g') LIKE ${phonePattern}
              OR regexp_replace(coalesce(l.collected->>'phone', ''), '\\D', '', 'g') LIKE ${phonePattern}
            )
            AND (
              l.disposition IN ('BOOKED', 'PENDING_TIME')
              OR l.collected->>'disposition' IN ('BOOKED', 'PENDING_TIME')
            )
          ORDER BY coalesce(l.scheduled_at, l.created_at) DESC
          LIMIT 40
        `
    const pool: import("@/lib/types").UnassignedPoolJob[] = []
    const scheduled: import("@/lib/types").SchedulerEvent[] = []
    for (const r of rows) {
      const row = r as Record<string, unknown>
      const hasTech =
        row.assigned_tech_id != null && String(row.assigned_tech_id).trim() !== ""
      if (hasTech) scheduled.push(schedulerEventFromRow(row))
      else pool.push(poolJobFromRow(row))
    }
    return { pool, scheduled }
  } catch (e) {
    if (isUndefinedRelationError(e, "ai_leads")) return { pool: [], scheduled: [] }
    throw e
  }
}

/** Tech updates field progress on a job assigned to them. Returns false if not their job. */
export async function setJobStatusForTech(
  techUserId: string,
  leadId: string,
  status: string
): Promise<boolean> {
  const sql = getSql()
  const rows = await sql`
    UPDATE ai_leads
    SET job_status = ${status}
    WHERE id = ${leadId} AND assigned_tech_id = ${techUserId}
    RETURNING id
  `
  return rows.length > 0
}

/** Owner updates field progress from the dispatch console drawer. */
export async function setJobStatusForOwner(
  ownerUserId: string,
  leadId: string,
  status: string
): Promise<boolean> {
  const sql = getSql()
  const rows =
    status === "completed"
      ? await sql`
          UPDATE ai_leads
          SET job_status = ${status},
              collected = jsonb_set(
                coalesce(collected, '{}'::jsonb),
                '{completed_at}',
                to_jsonb(now()::timestamptz::text),
                true
              )
          WHERE id = ${leadId} AND user_id = ${ownerUserId}
          RETURNING id
        `
      : await sql`
          UPDATE ai_leads
          SET job_status = ${status}
          WHERE id = ${leadId} AND user_id = ${ownerUserId}
          RETURNING id
        `
  return rows.length > 0
}

/**
 * Pick the best available on-duty technician for an owner to auto-dispatch a fresh booking to.
 * Prefers an idle tech, then any active tech without a live status, then busy ones. Null when the
 * owner has no active technician with a login (so we just leave the job for manual assignment).
 */
export async function resolveDispatchTechForOwner(ownerUserId: string): Promise<string | null> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT ft.portal_user_id
      FROM field_technicians ft
      JOIN users u ON u.id = ft.portal_user_id
      WHERE ft.user_id = ${ownerUserId} AND ft.is_active = true AND ft.portal_user_id IS NOT NULL
      ORDER BY CASE COALESCE(u.tech_status, 'idle')
                 WHEN 'idle' THEN 0
                 WHEN 'en_route' THEN 2
                 WHEN 'on_site' THEN 3
                 ELSE 1
               END,
               ft.created_at ASC
      LIMIT 1
    `
    return rows[0]?.portal_user_id != null ? String(rows[0].portal_user_id) : null
  } catch (e) {
    if (isMissingFieldTechTableError(e)) return null
    // tech_status column missing (pre-062) → fall back to oldest active tech.
    if (pgErrorCode(e) === "42703") {
      try {
        const rows = await sql`
          SELECT portal_user_id FROM field_technicians
          WHERE user_id = ${ownerUserId} AND is_active = true AND portal_user_id IS NOT NULL
          ORDER BY created_at ASC LIMIT 1
        `
        return rows[0]?.portal_user_id != null ? String(rows[0].portal_user_id) : null
      } catch (e2) {
        if (isMissingFieldTechTableError(e2)) return null
        throw e2
      }
    }
    throw e
  }
}

/** Stamp a lead's dispatch_status on both the indexed column and the collected JSONB mirror. */
export async function setLeadDispatchStatus(leadId: string, dispatchStatus: string): Promise<void> {
  const sql = getSql()
  try {
    await sql`UPDATE ai_leads SET dispatch_status = ${dispatchStatus} WHERE id = ${leadId}`
  } catch (e) {
    if (pgErrorCode(e) !== "42703" && !isUndefinedRelationError(e, "ai_leads")) throw e
  }
  try {
    await sql`
      UPDATE ai_leads
      SET collected = jsonb_set(coalesce(collected, '{}'::jsonb), '{dispatch_status}', to_jsonb(${dispatchStatus}::text), true)
      WHERE id = ${leadId}
    `
  } catch (e) {
    if (!isUndefinedRelationError(e, "ai_leads")) throw e
  }
}

/** Persist geocoded coordinates + structured address columns on ai_leads. */
export async function setLeadStructuredAddress(
  leadId: string,
  addr: {
    formatted: string
    street_number: string
    route: string
    locality: string
    postal_code: string
    admin_area: string
    lat?: number | null
    lng?: number | null
  }
): Promise<void> {
  const sql = getSql()
  const patch: Record<string, unknown> = {
    job_address: addr.formatted,
    job_address_full: addr.formatted,
    location: addr.formatted,
    service_address: addr.formatted,
    job_address_street_number: addr.street_number,
    job_address_route: addr.route,
    job_address_locality: addr.locality,
    job_address_postal_code: addr.postal_code,
    job_address_admin_area: addr.admin_area,
  }
  if (addr.lat != null && Number.isFinite(addr.lat)) patch.customer_lat = addr.lat
  if (addr.lng != null && Number.isFinite(addr.lng)) patch.customer_lng = addr.lng
  const patchJson = JSON.stringify(patch)
  try {
    await sql`
      UPDATE ai_leads
      SET collected = coalesce(collected, '{}'::jsonb) || ${patchJson}::jsonb,
          job_address_full = ${addr.formatted},
          job_address_street_number = ${addr.street_number},
          job_address_route = ${addr.route},
          job_address_locality = ${addr.locality},
          job_address_postal_code = ${addr.postal_code},
          job_address_admin_area = ${addr.admin_area}
      WHERE id = ${leadId}
    `
  } catch (e) {
    if (pgErrorCode(e) === "42703") {
      try {
        await sql`
          UPDATE ai_leads
          SET collected = coalesce(collected, '{}'::jsonb) || ${patchJson}::jsonb
          WHERE id = ${leadId}
        `
      } catch (e2) {
        if (!isUndefinedRelationError(e2, "ai_leads")) throw e2
      }
      return
    }
    if (!isUndefinedRelationError(e, "ai_leads")) throw e
  }
}

/** Persist a geocoded service address onto a lead's collected JSONB (drives the arrival geofence). */
export async function setLeadCoordinates(leadId: string, lat: number, lng: number): Promise<void> {
  const sql = getSql()
  try {
    await sql`
      UPDATE ai_leads
      SET collected = jsonb_set(
            jsonb_set(coalesce(collected, '{}'::jsonb), '{customer_lat}', to_jsonb(${lat}::float8), true),
            '{customer_lng}', to_jsonb(${lng}::float8), true)
      WHERE id = ${leadId}
    `
  } catch (e) {
    if (!isUndefinedRelationError(e, "ai_leads")) throw e
  }
}

export interface TechActiveJobGeo {
  leadId: string
  job_status: string | null
  customer_lat: number
  customer_lng: number
}

function firstNumericField(collected: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = collected[k]
    if (typeof v === "number" && Number.isFinite(v)) return v
    if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v)
  }
  return null
}

/**
 * The tech's most-recent active job that carries customer coordinates (so we can geofence "arrived").
 * Returns null when no active job has logged lat/lng — auto-arrive simply no-ops in that case.
 */
export async function getActiveJobGeoForTech(techUserId: string): Promise<TechActiveJobGeo | null> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT id, collected, job_status FROM ai_leads
      WHERE assigned_tech_id = ${techUserId} AND job_status IN ('assigned', 'en_route', 'arrived')
      ORDER BY created_at DESC LIMIT 5
    `
    for (const r of rows) {
      const c = (r.collected as Record<string, unknown>) || {}
      const lat = firstNumericField(c, ["customer_lat", "lat", "latitude", "geo_lat", "location_lat", "service_lat"])
      const lng = firstNumericField(c, ["customer_lng", "lng", "longitude", "geo_lng", "location_lng", "service_lng", "lon"])
      if (lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        return { leadId: String(r.id), job_status: r.job_status != null ? String(r.job_status) : null, customer_lat: lat, customer_lng: lng }
      }
    }
    return null
  } catch (e) {
    if (isMissingAssignedTechColumnError(e) || isUndefinedRelationError(e, "ai_leads")) return null
    throw e
  }
}

/** Active techs that have a last-known coordinate, for the owner's live dispatch map. */
export async function listTechLiveLocations(ownerUserId: string): Promise<TechLiveLocation[]> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT ft.portal_user_id AS tech_user_id, ft.name,
             u.tech_status AS status, u.current_latitude AS lat, u.current_longitude AS lng
      FROM field_technicians ft
      JOIN users u ON u.id = ft.portal_user_id
      WHERE ft.user_id = ${ownerUserId}
        AND ft.is_active = true
        AND ft.portal_user_id IS NOT NULL
        AND u.current_latitude IS NOT NULL
        AND u.current_longitude IS NOT NULL
    `
    return rows
      .map((r) => ({
        tech_user_id: String(r.tech_user_id),
        name: r.name != null ? String(r.name) : "Technician",
        status: r.status != null ? String(r.status) : null,
        latitude: Number(r.lat),
        longitude: Number(r.lng),
      }))
      .filter((t) => Number.isFinite(t.latitude) && Number.isFinite(t.longitude))
  } catch (e) {
    // Pre-062 (no current_latitude/tech_status) or no tech table yet → nothing to plot.
    if (isMissingFieldTechTableError(e) || pgErrorCode(e) === "42703") return []
    throw e
  }
}

/** Owner id for a job (used to broadcast owner events when a tech updates a job). */
export async function getOwnerIdForLead(leadId: string): Promise<string | null> {
  const sql = getSql()
  try {
    const rows = await sql`SELECT user_id FROM ai_leads WHERE id = ${leadId} LIMIT 1`
    return rows[0]?.user_id != null ? String(rows[0].user_id) : null
  } catch (e) {
    if (isUndefinedRelationError(e, "ai_leads")) return null
    throw e
  }
}

/** Create a job invoice raised on-site by a tech. */
export async function createJobInvoice(params: {
  lead_id: string | null
  owner_user_id: string
  tech_user_id: string | null
  customer_name: string | null
  customer_phone: string | null
  line_items: InvoiceLineItem[]
  subtotal_cents: number
  tax_cents: number
  total_cents: number
  payment_status: JobInvoice["payment_status"]
  payment_method: JobInvoice["payment_method"]
  card_last4: string | null
}): Promise<JobInvoice> {
  const sql = getSql()
  const id = crypto.randomUUID()
  const paidAt = params.payment_status === "paid" ? new Date() : null
  await sql`
    INSERT INTO job_invoices
      (id, lead_id, owner_user_id, tech_user_id, customer_name, customer_phone, line_items,
       subtotal_cents, tax_cents, total_cents, payment_status, payment_method, card_last4, created_at, paid_at)
    VALUES
      (${id}, ${params.lead_id}, ${params.owner_user_id}, ${params.tech_user_id}, ${params.customer_name},
       ${params.customer_phone}, ${JSON.stringify(params.line_items)}::jsonb, ${params.subtotal_cents},
       ${params.tax_cents}, ${params.total_cents}, ${params.payment_status}, ${params.payment_method},
       ${params.card_last4}, now(), ${paidAt})
  `
  return {
    id,
    lead_id: params.lead_id,
    owner_user_id: params.owner_user_id,
    tech_user_id: params.tech_user_id,
    customer_name: params.customer_name,
    customer_phone: params.customer_phone,
    line_items: params.line_items,
    subtotal_cents: params.subtotal_cents,
    tax_cents: params.tax_cents,
    total_cents: params.total_cents,
    payment_status: params.payment_status,
    payment_method: params.payment_method,
    card_last4: params.card_last4,
    created_at: new Date().toISOString(),
    paid_at: paidAt ? paidAt.toISOString() : null,
  }
}

/** Whether the owner has marked a merchant processor as configured (gates real card capture). */
export async function getOwnerMerchantConfigured(ownerUserId: string): Promise<boolean> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT merchant_configured FROM onboarding_profiles WHERE user_id = ${ownerUserId} LIMIT 1
    `
    return rows[0]?.merchant_configured === true
  } catch (e) {
    if (pgErrorCode(e) === "42703") return false
    if (isMissingOnboardingProfilesTableError(e)) return false
    throw e
  }
}

// ============================================
// Tech tracking, badges, SMS engine settings, scheduled SMS (scripts/062)
// ============================================

function isMissingTechTrackingColumnError(e: unknown): boolean {
  if (pgErrorCode(e) !== "42703") return false
  const msg = pgErrorMessage(e)
  return (
    msg.includes("current_latitude") ||
    msg.includes("current_longitude") ||
    msg.includes("tech_status") ||
    msg.includes("earned_badges")
  )
}

function isMissingSmsEngineColumnError(e: unknown): boolean {
  if (pgErrorCode(e) !== "42703") return false
  const msg = pgErrorMessage(e)
  return msg.includes("sms_booking") || msg.includes("sms_route") || msg.includes("sms_review") || msg.includes("google_review_url")
}

/** Persist a tech's live coordinates + status (no-op until scripts/062). */
export async function updateTechLocation(
  userId: string,
  latitude: number | null,
  longitude: number | null,
  status: string | null
): Promise<void> {
  const sql = getSql()
  try {
    await sql`
      UPDATE users
      SET current_latitude = ${latitude}, current_longitude = ${longitude}, tech_status = ${status}
      WHERE id = ${userId}
    `
  } catch (e) {
    if (isMissingTechTrackingColumnError(e)) return
    throw e
  }
}

/** Persist computed earned badge ids onto the tech's user row. */
export async function setTechEarnedBadges(userId: string, badgeIds: string[]): Promise<void> {
  const sql = getSql()
  try {
    await sql`UPDATE users SET earned_badges = ${JSON.stringify(badgeIds)}::jsonb WHERE id = ${userId}`
  } catch (e) {
    if (isMissingTechTrackingColumnError(e)) return
    throw e
  }
}

/** Job/invoice counters a tech's performance badges are derived from. */
export async function getTechJobMetrics(
  techUserId: string
): Promise<{ completed: number; total_invoiced_cents: number; paid_invoices: number }> {
  const sql = getSql()
  let completed = 0
  try {
    const rows = await sql`
      SELECT COUNT(*)::int AS n FROM ai_leads
      WHERE assigned_tech_id = ${techUserId} AND job_status = 'completed'
    `
    completed = Number(rows[0]?.n ?? 0)
  } catch (e) {
    if (!isMissingAssignedTechColumnError(e) && !isUndefinedRelationError(e, "ai_leads")) throw e
  }

  let totalInvoiced = 0
  let paid = 0
  try {
    const rows = await sql`
      SELECT COALESCE(SUM(total_cents), 0)::bigint AS sum_cents,
             COUNT(*) FILTER (WHERE payment_status = 'paid')::int AS paid_n
      FROM job_invoices
      WHERE tech_user_id = ${techUserId}
    `
    totalInvoiced = Number(rows[0]?.sum_cents ?? 0)
    paid = Number(rows[0]?.paid_n ?? 0)
  } catch (e) {
    if (!isUndefinedRelationError(e, "job_invoices")) throw e
  }
  return { completed, total_invoiced_cents: totalInvoiced, paid_invoices: paid }
}

/** Full dispatch context for a single lead (any disposition), used by the SMS pipeline. */
export async function getLeadDispatchContext(leadId: string): Promise<LeadDispatchContext | null> {
  const sql = getSql()
  let rows: Record<string, unknown>[]
  try {
    rows = await sql`
      SELECT id, user_id, caller_e164, collected, summary, job_status, assigned_tech_id
      FROM ai_leads WHERE id = ${leadId} LIMIT 1
    `
  } catch (e) {
    if (isMissingAssignedTechColumnError(e)) {
      rows = await sql`SELECT id, user_id, caller_e164, collected, summary FROM ai_leads WHERE id = ${leadId} LIMIT 1`
    } else if (isUndefinedRelationError(e, "ai_leads")) {
      return null
    } else {
      throw e
    }
  }
  const row = rows[0]
  if (!row) return null
  const collected = (row.collected as Record<string, unknown>) || {}
  const pick = (keys: string[]): string | null => {
    for (const k of keys) {
      const v = collected[k]
      if (typeof v === "string" && v.trim()) return v.trim()
    }
    return null
  }
  return {
    lead_id: String(row.id),
    owner_user_id: String(row.user_id),
    customer_name: pick(["customer_name", "name", "caller_name", "contact_name"]),
    customer_phone:
      pick(["callback_number", "caller_number", "phone", "callback"]) ||
      (row.caller_e164 != null ? String(row.caller_e164) : null),
    location: pick(["location", "service_address", "address", "job_address", "address_line1"]),
    time_slot: pick(["time_slot", "appointment_time", "slot", "appointment", "scheduled_time", "when"]),
    summary: row.summary != null ? String(row.summary) : null,
    assigned_tech_id: row.assigned_tech_id != null ? String(row.assigned_tech_id) : null,
    job_status: row.job_status != null ? String(row.job_status) : null,
  }
}

function defaultOwnerSmsSettings(): OwnerSmsSettings {
  return {
    sms_booking_enabled: false,
    sms_route_enabled: false,
    sms_review_enabled: false,
    sms_booking_template: null,
    sms_route_template: null,
    sms_review_template: null,
    google_review_url: null,
  }
}

/** Read the owner's automated-SMS settings (defaults until scripts/062 runs). */
export async function getOwnerSmsSettings(userId: string): Promise<OwnerSmsSettings> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT sms_booking_enabled, sms_route_enabled, sms_review_enabled,
             sms_booking_template, sms_route_template, sms_review_template, google_review_url
      FROM onboarding_profiles WHERE user_id = ${userId} LIMIT 1
    `
    const row = rows[0]
    if (!row) return defaultOwnerSmsSettings()
    return {
      sms_booking_enabled: row.sms_booking_enabled === true,
      sms_route_enabled: row.sms_route_enabled === true,
      sms_review_enabled: row.sms_review_enabled === true,
      sms_booking_template: row.sms_booking_template != null ? String(row.sms_booking_template) : null,
      sms_route_template: row.sms_route_template != null ? String(row.sms_route_template) : null,
      sms_review_template: row.sms_review_template != null ? String(row.sms_review_template) : null,
      google_review_url: row.google_review_url != null ? String(row.google_review_url) : null,
    }
  } catch (e) {
    if (isMissingSmsEngineColumnError(e) || isMissingOnboardingProfilesTableError(e) || isWrongLegacyProfilesTableError(e)) {
      return defaultOwnerSmsSettings()
    }
    throw e
  }
}

/** Upsert the owner's automated-SMS settings (only provided fields change). */
export async function updateOwnerSmsSettings(
  userId: string,
  updates: Partial<OwnerSmsSettings>
): Promise<OwnerSmsSettings> {
  await ensureOnboardingProfile(userId)
  const sql = getSql()
  const cur = await getOwnerSmsSettings(userId)
  const next: OwnerSmsSettings = {
    sms_booking_enabled: updates.sms_booking_enabled ?? cur.sms_booking_enabled,
    sms_route_enabled: updates.sms_route_enabled ?? cur.sms_route_enabled,
    sms_review_enabled: updates.sms_review_enabled ?? cur.sms_review_enabled,
    sms_booking_template:
      updates.sms_booking_template !== undefined ? updates.sms_booking_template : cur.sms_booking_template,
    sms_route_template:
      updates.sms_route_template !== undefined ? updates.sms_route_template : cur.sms_route_template,
    sms_review_template:
      updates.sms_review_template !== undefined ? updates.sms_review_template : cur.sms_review_template,
    google_review_url: updates.google_review_url !== undefined ? updates.google_review_url : cur.google_review_url,
  }
  await sql`
    UPDATE onboarding_profiles SET
      sms_booking_enabled = ${next.sms_booking_enabled},
      sms_route_enabled = ${next.sms_route_enabled},
      sms_review_enabled = ${next.sms_review_enabled},
      sms_booking_template = ${next.sms_booking_template},
      sms_route_template = ${next.sms_route_template},
      sms_review_template = ${next.sms_review_template},
      google_review_url = ${next.google_review_url},
      updated_at = now()
    WHERE user_id = ${userId}
  `
  return next
}

/** Queue an SMS to be sent later (e.g. the post-job review request). */
export async function insertScheduledSms(params: {
  owner_user_id: string
  lead_id: string | null
  to_e164: string
  body: string
  phase: string
  send_after: Date
}): Promise<void> {
  const sql = getSql()
  await sql`
    INSERT INTO scheduled_sms (owner_user_id, lead_id, to_e164, body, phase, send_after, status, created_at)
    VALUES (${params.owner_user_id}, ${params.lead_id}, ${params.to_e164}, ${params.body}, ${params.phase}, ${params.send_after.toISOString()}, 'pending', now())
  `
}

export interface DueScheduledSms {
  id: string
  owner_user_id: string
  to_e164: string
  body: string
}

/** Scheduled texts that are now due (status pending, send_after in the past). */
export async function listDueScheduledSms(limit = 20): Promise<DueScheduledSms[]> {
  const sql = getSql()
  const lim = Math.min(Math.max(limit, 1), 50)
  try {
    const rows = await sql`
      SELECT id, owner_user_id, to_e164, body
      FROM scheduled_sms
      WHERE status = 'pending' AND send_after <= now()
      ORDER BY send_after ASC
      LIMIT ${lim}
    `
    return rows.map((r: Record<string, unknown>) => ({
      id: String(r.id),
      owner_user_id: String(r.owner_user_id),
      to_e164: String(r.to_e164),
      body: String(r.body),
    }))
  } catch (e) {
    if (isUndefinedRelationError(e, "scheduled_sms")) return []
    throw e
  }
}

/** Atomically claim a scheduled SMS so concurrent flushers can't double-send it. */
export async function claimScheduledSms(id: string): Promise<boolean> {
  const sql = getSql()
  const rows = await sql`
    UPDATE scheduled_sms SET status = 'sending'
    WHERE id = ${id} AND status = 'pending'
    RETURNING id
  `
  return rows.length > 0
}

export async function markScheduledSmsSent(id: string): Promise<void> {
  const sql = getSql()
  await sql`UPDATE scheduled_sms SET status = 'sent', sent_at = now() WHERE id = ${id}`
}

export async function markScheduledSmsFailed(id: string, error: string): Promise<void> {
  const sql = getSql()
  await sql`UPDATE scheduled_sms SET status = 'failed', error = ${error.slice(0, 240)} WHERE id = ${id}`
}

export type LeadDisposition = "BOOKED" | "PENDING_TIME" | "PRICE_REJECTED" | "FAILED"

export interface DispositionedLead {
  id: string
  caller_e164: string | null
  intent_slug: string | null
  summary: string | null
  collected: Record<string, unknown>
  disposition: LeadDisposition | null
  dispatch_status: string | null
  is_salvageable: boolean
  created_at: string
}

function parseDispositionedLeadRow(r: Record<string, unknown>): DispositionedLead {
  const collected = (r.collected as Record<string, unknown>) || {}
  const dispositionRaw =
    (r.disposition != null ? String(r.disposition) : null) ??
    (typeof collected.disposition === "string" ? collected.disposition : null)
  const disposition =
    dispositionRaw === "BOOKED" || dispositionRaw === "PRICE_REJECTED" ? dispositionRaw : null
  const dispatch_status =
    r.dispatch_status != null
      ? String(r.dispatch_status)
      : typeof collected.dispatch_status === "string"
        ? collected.dispatch_status
        : null
  const is_salvageable =
    r.is_salvageable === true || r.is_salvageable === "t" || collected.is_salvageable === true
  return {
    id: String(r.id),
    caller_e164: r.caller_e164 != null ? String(r.caller_e164) : null,
    intent_slug: r.intent_slug != null ? String(r.intent_slug) : null,
    summary: r.summary != null ? String(r.summary) : null,
    collected,
    disposition,
    dispatch_status,
    is_salvageable,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }
}

/**
 * Best-effort stamp of the dedicated disposition columns (scripts/058). The same keys are always
 * written into ai_leads.collected by the log-job route, so this is a no-op-safe enhancement that is
 * skipped when the migration hasn't run yet.
 */
export async function applyLeadDisposition(
  leadId: string,
  params: { disposition: LeadDisposition; dispatch_status: string | null; is_salvageable: boolean }
): Promise<void> {
  const sql = getSql()
  try {
    await sql`
      UPDATE ai_leads
      SET disposition = ${params.disposition},
          dispatch_status = ${params.dispatch_status},
          is_salvageable = ${params.is_salvageable}
      WHERE id = ${leadId}
    `
  } catch (e) {
    if (pgErrorCode(e) === "42703" || isUndefinedRelationError(e, "ai_leads")) return
    throw e
  }
}

/** PRICE_REJECTED leads the owner can try to rescue (filters JSONB so it works pre-migration). */
export async function listSalvageableLeads(userId: string, limit = 25): Promise<DispositionedLead[]> {
  const sql = getSql()
  const lim = Math.min(Math.max(limit, 1), 100)
  try {
    const rows = await sql`
      SELECT id, caller_e164, intent_slug, collected, summary, created_at,
             collected ->> 'disposition' AS disposition,
             collected ->> 'dispatch_status' AS dispatch_status,
             (collected ->> 'is_salvageable') = 'true' AS is_salvageable
      FROM ai_leads
      WHERE user_id = ${userId}
        AND collected ->> 'disposition' = 'PRICE_REJECTED'
        AND collected ->> 'is_salvageable' = 'true'
      ORDER BY created_at DESC
      LIMIT ${lim}
    `
    return rows.map((r) => parseDispositionedLeadRow(r as Record<string, unknown>))
  } catch (e) {
    if (isUndefinedRelationError(e, "ai_leads")) return []
    throw e
  }
}

/** BOOKED leads created after `sinceIso` — drives the owner's live booking toast feed. */
export async function listRecentBookedLeads(
  userId: string,
  sinceIso: string,
  limit = 20
): Promise<DispositionedLead[]> {
  const sql = getSql()
  const lim = Math.min(Math.max(limit, 1), 50)
  try {
    const rows = await sql`
      SELECT id, caller_e164, intent_slug, collected, summary, created_at,
             collected ->> 'disposition' AS disposition,
             collected ->> 'dispatch_status' AS dispatch_status,
             (collected ->> 'is_salvageable') = 'true' AS is_salvageable
      FROM ai_leads
      WHERE user_id = ${userId}
        AND collected ->> 'disposition' = 'BOOKED'
        AND created_at > ${sinceIso}
      ORDER BY created_at DESC
      LIMIT ${lim}
    `
    return rows.map((r) => parseDispositionedLeadRow(r as Record<string, unknown>))
  } catch (e) {
    if (isUndefinedRelationError(e, "ai_leads")) return []
    throw e
  }
}

/** Save the operator's transcribed job notes onto the call log (deploy-safe — no-op until scripts/060). */
export async function setCallLogInternalNotes(
  providerCallSidOrId: string,
  notes: string
): Promise<void> {
  const key = providerCallSidOrId.trim()
  if (!key) return
  const sql = getSql()
  try {
    await sql`
      UPDATE call_logs
      SET internal_notes = ${notes}
      WHERE provider_call_sid = ${key} OR twilio_call_sid = ${key} OR id::text = ${key}
    `
  } catch (e) {
    if (pgErrorCode(e) === "42703") return
    throw e
  }
}

/** True when the receptionist is opted into the mobile voice wrap-up callback (false until scripts/060). */
export async function getReceptionistIsMobileOperator(receptionistId: string): Promise<boolean> {
  const id = receptionistId.trim()
  if (!id) return false
  const sql = getSql()
  try {
    const rows = await sql`SELECT is_mobile_operator FROM receptionists WHERE id = ${id} LIMIT 1`
    return rows[0]?.is_mobile_operator === true
  } catch (e) {
    if (pgErrorCode(e) === "42703") return false
    throw e
  }
}

export interface CallContactInfo {
  user_id: string
  from_number: string | null
  caller_name: string | null
  to_number: string | null
}

/** Customer contact fields for a call (used by the owner dispatch SMS). */
export async function getCallContactByProviderSid(providerCallSid: string): Promise<CallContactInfo | null> {
  const sid = providerCallSid.trim()
  if (!sid) return null
  const sql = getSql()
  const rows = await sql`
    SELECT user_id, from_number, caller_name, to_number
    FROM call_logs
    WHERE provider_call_sid = ${sid} OR twilio_call_sid = ${sid}
    ORDER BY created_at DESC
    LIMIT 1
  `
  const row = rows[0]
  if (!row) return null
  return {
    user_id: String(row.user_id),
    from_number: row.from_number != null ? String(row.from_number) : null,
    caller_name: row.caller_name != null ? String(row.caller_name) : null,
    to_number: row.to_number != null ? String(row.to_number) : null,
  }
}

/** Best-effort job site + customer name from the most recent captured lead for this caller. */
export async function getLatestLeadContextForCaller(
  userId: string,
  callerE164: string | null
): Promise<{ location: string | null; customerName: string | null } | null> {
  if (!callerE164?.trim()) return null
  const sql = getSql()
  let rows: Record<string, unknown>[]
  try {
    rows = await sql`
      SELECT collected, summary
      FROM ai_leads
      WHERE user_id = ${userId} AND caller_e164 = ${callerE164}
      ORDER BY created_at DESC
      LIMIT 1
    `
  } catch (e) {
    if (isUndefinedRelationError(e, "ai_leads")) return null
    throw e
  }
  const row = rows[0]
  if (!row) return null
  const collected = (row.collected as Record<string, unknown>) || {}
  const pick = (keys: string[]): string | null => {
    for (const k of keys) {
      const v = collected[k]
      if (typeof v === "string" && v.trim()) return v.trim()
    }
    return null
  }
  return {
    location: pick(["location", "service_address", "address", "job_address", "address_line1", "vehicle_location"]),
    customerName: pick(["customer_name", "name", "caller_name", "contact_name"]),
  }
}

/** Stamp the call_logs row's final disposition (deploy-safe — no-op until scripts/059 runs). */
export async function setCallLogDisposition(
  providerCallSidOrId: string,
  disposition: LeadDisposition
): Promise<void> {
  const key = providerCallSidOrId.trim()
  if (!key) return
  const sql = getSql()
  try {
    await sql`
      UPDATE call_logs
      SET disposition = ${disposition}
      WHERE provider_call_sid = ${key} OR twilio_call_sid = ${key} OR id::text = ${key}
    `
  } catch (e) {
    if (pgErrorCode(e) === "42703") return
    throw e
  }
}

export interface CallCellHandoffInfo {
  id: string
  user_id: string
  routed_to_receptionist_id: string | null
  from_number: string | null
  status: string
  duration_seconds: number
  answered: boolean
}

/** Minimal call row used by the post-call disposition SMS (status webhook). */
export async function getCallCellHandoffInfo(providerCallSid: string): Promise<CallCellHandoffInfo | null> {
  const sid = providerCallSid.trim()
  if (!sid) return null
  const sql = getSql()
  let rows: Record<string, unknown>[]
  try {
    rows = await sql`
      SELECT id, user_id, routed_to_receptionist_id, from_number, status, duration_seconds, answered_at
      FROM call_logs
      WHERE provider_call_sid = ${sid} OR twilio_call_sid = ${sid}
      ORDER BY created_at DESC
      LIMIT 1
    `
  } catch {
    // answered_at (scripts/007) may not exist — retry without it.
    rows = await sql`
      SELECT id, user_id, routed_to_receptionist_id, from_number, status, duration_seconds
      FROM call_logs
      WHERE provider_call_sid = ${sid} OR twilio_call_sid = ${sid}
      ORDER BY created_at DESC
      LIMIT 1
    `
  }
  const row = rows[0]
  if (!row) return null
  const duration = Number(row.duration_seconds ?? 0) || 0
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    routed_to_receptionist_id: row.routed_to_receptionist_id ? String(row.routed_to_receptionist_id) : null,
    from_number: row.from_number != null ? String(row.from_number) : null,
    status: String(row.status ?? ""),
    duration_seconds: duration,
    answered: row.answered_at != null || duration > 0,
  }
}

export interface CallAdminOverrideDispatchInfo {
  id: string
  user_id: string
  from_number: string | null
  override_phone: string
  workspace_name: string
}

/** Call row + override technician phone for post-call dispatch SMS (admin override path). */
export async function getCallAdminOverrideDispatchInfo(
  providerCallSid: string
): Promise<CallAdminOverrideDispatchInfo | null> {
  const sid = providerCallSid.trim()
  if (!sid) return null
  const sql = getSql()
  let rows: Record<string, unknown>[]
  try {
    rows = await sql`
      SELECT
        cl.id,
        cl.user_id,
        cl.from_number,
        cl.to_number,
        COALESCE(
          NULLIF(trim(pn.admin_routing_override_phone), ''),
          NULLIF(trim(org.admin_routing_override_phone), '')
        ) AS override_phone,
        COALESCE(
          NULLIF(trim(org.name), ''),
          NULLIF(trim(u.business_name), ''),
          'Your business'
        ) AS workspace_name
      FROM call_logs cl
      JOIN users u ON u.id = cl.user_id
      LEFT JOIN phone_numbers pn ON pn.status = 'active'
        AND (
          pn.number = cl.to_number
          OR regexp_replace(pn.number, '\\D', '', 'g') = regexp_replace(COALESCE(cl.to_number, ''), '\\D', '', 'g')
        )
      LEFT JOIN organizations org ON org.id = pn.organization_id
      WHERE (cl.provider_call_sid = ${sid} OR cl.twilio_call_sid = ${sid})
        AND cl.routed_to_name = 'Admin routing override'
      ORDER BY cl.created_at DESC
      LIMIT 1
    `
  } catch (e) {
    if (pgErrorCode(e) !== "42703") throw e
    return null
  }
  const row = rows[0]
  if (!row) return null
  const overridePhone = row.override_phone != null ? String(row.override_phone).trim() : ""
  if (!overridePhone) return null
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    from_number: row.from_number != null ? String(row.from_number) : null,
    override_phone: overridePhone,
    workspace_name: row.workspace_name != null ? String(row.workspace_name) : "Your business",
  }
}

/**
 * Record that we texted a receptionist's cell for a call outcome. Idempotent per call
 * (`provider_call_sid` unique) — returns the new row id, or null when one already existed
 * (so the status webhook only texts once even if Telnyx re-posts the completed event).
 */
export async function createPendingSmsDisposition(params: {
  userId: string
  callLogId: string | null
  providerCallSid: string
  receptionistId: string | null
  receptionistName: string | null
  receptionistPhoneE164: string
  callerNumber: string | null
  businessName: string | null
}): Promise<string | null> {
  const sql = getSql()
  try {
    const rows = await sql`
      INSERT INTO pending_sms_dispositions (
        user_id, call_log_id, provider_call_sid, receptionist_id, receptionist_name,
        receptionist_phone_e164, caller_number, business_name
      ) VALUES (
        ${params.userId},
        ${params.callLogId},
        ${params.providerCallSid},
        ${params.receptionistId},
        ${params.receptionistName},
        ${params.receptionistPhoneE164},
        ${params.callerNumber},
        ${params.businessName}
      )
      ON CONFLICT (provider_call_sid) DO NOTHING
      RETURNING id
    `
    return rows[0]?.id != null ? String(rows[0].id) : null
  } catch (e) {
    if (isUndefinedRelationError(e, "pending_sms_dispositions")) {
      console.warn("[db] pending_sms_dispositions missing — run scripts/059-cell-fallback-dispositions.sql in Neon.")
      return null
    }
    throw e
  }
}

export interface PendingSmsDisposition {
  id: string
  user_id: string
  call_log_id: string | null
  provider_call_sid: string
  receptionist_id: string | null
  receptionist_name: string | null
  caller_number: string | null
  business_name: string | null
}

/** Newest still-open outcome prompt texted to this cell within the window (default 12h). */
export async function findOpenPendingSmsDispositionByPhone(
  phoneE164: string,
  withinHours = 12
): Promise<PendingSmsDisposition | null> {
  const phone = phoneE164.trim()
  if (!phone) return null
  const sql = getSql()
  let rows: Record<string, unknown>[]
  try {
    rows = await sql`
      SELECT id, user_id, call_log_id, provider_call_sid, receptionist_id, receptionist_name, caller_number, business_name
      FROM pending_sms_dispositions
      WHERE receptionist_phone_e164 = ${phone}
        AND responded_at IS NULL
        AND created_at > (now() - (${withinHours}::numeric * interval '1 hour'))
      ORDER BY created_at DESC
      LIMIT 1
    `
  } catch (e) {
    if (isUndefinedRelationError(e, "pending_sms_dispositions")) return null
    throw e
  }
  const row = rows[0]
  if (!row) return null
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    call_log_id: row.call_log_id ? String(row.call_log_id) : null,
    provider_call_sid: String(row.provider_call_sid),
    receptionist_id: row.receptionist_id ? String(row.receptionist_id) : null,
    receptionist_name: row.receptionist_name ? String(row.receptionist_name) : null,
    caller_number: row.caller_number ? String(row.caller_number) : null,
    business_name: row.business_name ? String(row.business_name) : null,
  }
}

/** Close out a pending prompt once the operator's numeric reply is parsed. */
export async function resolvePendingSmsDisposition(id: string, status: LeadDisposition): Promise<void> {
  const sql = getSql()
  try {
    await sql`
      UPDATE pending_sms_dispositions
      SET status = ${status}, responded_at = now()
      WHERE id = ${id}
    `
  } catch (e) {
    if (isUndefinedRelationError(e, "pending_sms_dispositions")) return
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
  organizationId?: string | null
  telnyxEventId: string
  portingOrderId: string | null
  eventType: string
  title: string
  body: string
  rawPayload: unknown
}): Promise<boolean> {
  const sql = getSql()
  const rawJson = JSON.stringify(params.rawPayload ?? null)
  const orgId = params.organizationId?.trim() || null
  try {
    const rows = orgId
      ? await sql`
          INSERT INTO porting_notifications (
            user_id, organization_id, telnyx_event_id, porting_order_id, event_type, title, body, raw_payload
          ) VALUES (
            ${params.userId},
            ${orgId},
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
      : await sql`
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
    if (isUndefinedRelationError(e, "organization_id") || String(e).includes("organization_id")) {
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
      } catch (retryErr) {
        if (isUndefinedRelationError(retryErr, "porting_notifications")) return false
        throw retryErr
      }
    }
    throw e
  }
}

export async function listPortingNotifications(
  userId: string,
  limit: number = 50,
  portingOrderId?: string | null
): Promise<PortingNotification[]> {
  const sql = getSql()
  const orderFilter = portingOrderId?.trim() || null
  try {
    const rows = orderFilter
      ? await sql`
          SELECT id, user_id, telnyx_event_id, porting_order_id, event_type, title, body, read_at, created_at
          FROM porting_notifications
          WHERE user_id = ${userId} AND porting_order_id = ${orderFilter}
          ORDER BY created_at DESC
          LIMIT ${Math.min(Math.max(limit, 1), 100)}
        `
      : await sql`
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

/** Chronological porting webhook log for one Telnyx order id (admin timeline). */
export async function listPortingNotificationsChronological(
  userId: string,
  telnyxOrderId: string,
  limit: number = 100
): Promise<PortingNotification[]> {
  const sql = getSql()
  const orderFilter = telnyxOrderId.trim()
  if (!orderFilter) return []
  try {
    const rows = await sql`
      SELECT id, user_id, telnyx_event_id, porting_order_id, event_type, title, body, read_at, created_at
      FROM porting_notifications
      WHERE user_id = ${userId} AND porting_order_id = ${orderFilter}
      ORDER BY created_at ASC
      LIMIT ${Math.min(Math.max(limit, 1), 200)}
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
    if (isUndefinedRelationError(e, "porting_notifications")) return []
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

export async function countUnreadPortingNotificationsForOrder(
  userId: string,
  telnyxOrderId: string
): Promise<number> {
  const sql = getSql()
  const orderId = telnyxOrderId.trim()
  if (!orderId) return 0
  try {
    const rows = await sql`
      SELECT count(*)::int AS c FROM porting_notifications
      WHERE user_id = ${userId} AND porting_order_id = ${orderId} AND read_at IS NULL
    `
    const row = rows[0] as { c?: number } | undefined
    return row?.c != null ? Number(row.c) : 0
  } catch (e) {
    if (isUndefinedRelationError(e, "porting_notifications")) return 0
    throw e
  }
}

/** Unread porting alerts with workspace order id + phone for the notification bell. */
export async function listUnreadPortingNotificationsEnriched(
  userId: string,
  organizationId?: string | null,
  limit: number = 30
): Promise<import("@/lib/types").PortingNotificationEnriched[]> {
  const sql = getSql()
  const orgId = organizationId?.trim() || null
  const capped = Math.min(Math.max(limit, 1), 50)
  try {
    const rows = orgId
      ? await sql`
          SELECT
            pn.id,
            pn.user_id,
            pn.telnyx_event_id,
            pn.porting_order_id,
            pn.event_type,
            pn.title,
            pn.body,
            pn.read_at,
            pn.created_at,
            po.id AS workspace_port_order_id,
            po.phone_number
          FROM porting_notifications pn
          LEFT JOIN porting_orders po
            ON po.telnyx_order_id = pn.porting_order_id
           AND po.owner_user_id = pn.user_id
          WHERE pn.user_id = ${userId}
            AND pn.read_at IS NULL
            AND (po.organization_id = ${orgId} OR pn.organization_id = ${orgId})
          ORDER BY pn.created_at DESC
          LIMIT ${capped}
        `
      : await sql`
          SELECT
            pn.id,
            pn.user_id,
            pn.telnyx_event_id,
            pn.porting_order_id,
            pn.event_type,
            pn.title,
            pn.body,
            pn.read_at,
            pn.created_at,
            po.id AS workspace_port_order_id,
            po.phone_number
          FROM porting_notifications pn
          LEFT JOIN porting_orders po
            ON po.telnyx_order_id = pn.porting_order_id
           AND po.owner_user_id = pn.user_id
          WHERE pn.user_id = ${userId}
            AND pn.read_at IS NULL
          ORDER BY pn.created_at DESC
          LIMIT ${capped}
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
      workspace_port_order_id:
        row.workspace_port_order_id != null ? String(row.workspace_port_order_id) : null,
      phone_number: row.phone_number != null ? String(row.phone_number) : null,
    }))
  } catch (e) {
    if (isUndefinedRelationError(e, "porting_notifications")) return []
    if (isUndefinedRelationError(e, "organization_id") || String(e).includes("organization_id")) {
      const rows = await sql`
        SELECT
          pn.id,
          pn.user_id,
          pn.telnyx_event_id,
          pn.porting_order_id,
          pn.event_type,
          pn.title,
          pn.body,
          pn.read_at,
          pn.created_at,
          po.id AS workspace_port_order_id,
          po.phone_number
        FROM porting_notifications pn
        LEFT JOIN porting_orders po
          ON po.telnyx_order_id = pn.porting_order_id
         AND po.owner_user_id = pn.user_id
        WHERE pn.user_id = ${userId}
          AND pn.read_at IS NULL
        ORDER BY pn.created_at DESC
        LIMIT ${capped}
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
        workspace_port_order_id:
          row.workspace_port_order_id != null ? String(row.workspace_port_order_id) : null,
        phone_number: row.phone_number != null ? String(row.phone_number) : null,
      }))
    }
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

export async function pingNeonDatabase(): Promise<boolean> {
  const sql = getSql()
  try {
    await sql`SELECT 1 AS ok`
    return true
  } catch {
    return false
  }
}

/** Operator KPI strip — onboarding_profiles counts + carrier credit sum. */
export async function getLyncrAdminMetrics(): Promise<Omit<LyncrAdminMetrics, "health" | "telnyx_routing_pool">> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT
        (SELECT count(*)::int FROM onboarding_profiles) AS total_users,
        (SELECT count(*)::int FROM onboarding_profiles WHERE has_active_subscription = true) AS active_subscriptions,
        (SELECT coalesce(sum(carrier_credit), 0)::numeric FROM onboarding_profiles) AS total_carrier_credit
    `
    const row = rows[0] as Record<string, unknown> | undefined
    return {
      total_users: Number(row?.total_users ?? 0),
      active_subscriptions: Number(row?.active_subscriptions ?? 0),
      total_carrier_credit: Number(row?.total_carrier_credit ?? 0),
    }
  } catch (e) {
    if (isMissingOnboardingProfilesTableError(e) || isWrongLegacyProfilesTableError(e)) {
      const rows = await sql`SELECT count(*)::int AS total_users FROM users`
      return {
        total_users: Number((rows[0] as { total_users?: number })?.total_users ?? 0),
        active_subscriptions: 0,
        total_carrier_credit: 0,
      }
    }
    if (isMissingOnboardingProfileColumnError(e)) {
      const rows = await sql`
        SELECT
          (SELECT count(*)::int FROM onboarding_profiles) AS total_users,
          (SELECT count(*)::int FROM onboarding_profiles WHERE has_active_subscription = true) AS active_subscriptions
      `
      const row = rows[0] as Record<string, unknown> | undefined
      return {
        total_users: Number(row?.total_users ?? 0),
        active_subscriptions: Number(row?.active_subscriptions ?? 0),
        total_carrier_credit: 0,
      }
    }
    throw e
  }
}

/** Workspaces + active lines for platform-admin operator invite picker. */
export async function listAdminOperatorWorkspaceOptions(): Promise<
  import("@/lib/types").AdminOperatorWorkspaceOption[]
> {
  const sql = getSql()
  try {
    const rows = (await sql`
      SELECT
        o.id AS organization_id,
        coalesce(nullif(trim(o.name), ''), nullif(trim(u.business_name), ''), 'Unnamed workspace') AS business_name,
        u.email AS owner_email,
        pn.number AS line_e164,
        pn.label AS line_label
      FROM organizations o
      JOIN users u ON u.id = o.owner_user_id
      LEFT JOIN phone_numbers pn ON pn.organization_id = o.id AND pn.status = 'active'
      WHERE o.id NOT LIKE 'legacy-%'
      ORDER BY business_name ASC, pn.created_at ASC NULLS LAST
    `) as Record<string, unknown>[]

    const seen = new Set<string>()
    const options: import("@/lib/types").AdminOperatorWorkspaceOption[] = []
    for (const row of rows) {
      const orgId = String(row.organization_id)
      const line = row.line_e164 != null ? String(row.line_e164) : null
      const key = `${orgId}:${line ?? ""}`
      if (seen.has(key)) continue
      seen.add(key)
      options.push({
        organization_id: orgId,
        business_name: String(row.business_name ?? "Unnamed workspace"),
        owner_email: String(row.owner_email ?? ""),
        line_e164: line,
        line_label: row.line_label != null ? String(row.line_label) : null,
      })
    }

    if (options.length > 0) return options

    const fallback = (await sql`
      SELECT
        u.id AS organization_id,
        coalesce(nullif(trim(u.business_name), ''), 'Unnamed business') AS business_name,
        u.email AS owner_email,
        pn.number AS line_e164,
        pn.label AS line_label
      FROM users u
      LEFT JOIN phone_numbers pn ON pn.user_id = u.id AND pn.status = 'active'
      WHERE coalesce(u.account_role, 'owner') = 'owner'
        AND nullif(trim(u.business_name), '') IS NOT NULL
      ORDER BY business_name ASC, pn.created_at ASC NULLS LAST
      LIMIT 100
    `) as Record<string, unknown>[]

    for (const row of fallback) {
      const orgId = String(row.organization_id)
      const line = row.line_e164 != null ? String(row.line_e164) : null
      const key = `${orgId}:${line ?? ""}`
      if (seen.has(key)) continue
      seen.add(key)
      options.push({
        organization_id: orgId,
        business_name: String(row.business_name ?? "Unnamed business"),
        owner_email: String(row.owner_email ?? ""),
        line_e164: line,
        line_label: row.line_label != null ? String(row.line_label) : null,
      })
    }
    return options
  } catch (e) {
    console.error("[db] listAdminOperatorWorkspaceOptions:", e)
    return []
  }
}

/** All accounts for the operator directory table. */
export async function listLyncrAdminDirectory(): Promise<LyncrAdminDirectoryRow[]> {
  const sql = getSql()
  const mapRow = (row: Record<string, unknown>) => ({
    user_id: String(row.user_id),
    email: String(row.email ?? ""),
    account_role: (String(row.account_role ?? "owner") === "receptionist" ? "receptionist" : "owner") as
      | "owner"
      | "receptionist",
    role: ((): "OWNER" | "RECEPTIONIST" | "ADMIN" => {
      const r = String(row.role ?? "").toUpperCase()
      return r === "RECEPTIONIST" || r === "OWNER" ? r : "ADMIN"
    })(),
    business_name: String(row.business_name ?? ""),
    receptionist_skills: parseSkillsArray(row.receptionist_skills),
    has_active_subscription: pgBool(row.has_active_subscription),
    subscription_tier: String(row.subscription_tier ?? "free_trial"),
    phone_number: row.phone_number != null ? String(row.phone_number) : null,
    carrier_credit: Number(row.carrier_credit ?? 0),
    total_calls_routed: Number(row.total_calls_routed ?? 0),
    total_minutes_used: Number(row.total_minutes_used ?? 0),
    account_status: String(row.account_status ?? "active"),
    custom_routing_note: row.custom_routing_note != null ? String(row.custom_routing_note) : null,
  })
  try {
    const rows = await sql`
      SELECT
        u.id AS user_id,
        u.email,
        coalesce(u.account_role, 'owner') AS account_role,
        coalesce(u.business_name, '') AS business_name,
        CASE
          WHEN coalesce(u.account_role, '') = 'receptionist'
               OR EXISTS (SELECT 1 FROM receptionists rr WHERE rr.portal_user_id = u.id)
            THEN 'RECEPTIONIST'
          WHEN nullif(trim(u.business_name), '') IS NOT NULL THEN 'OWNER'
          ELSE 'ADMIN'
        END AS role,
        (
          SELECT r.skills
          FROM receptionists r
          WHERE r.portal_user_id = u.id
          LIMIT 1
        ) AS receptionist_skills,
        coalesce(op.has_active_subscription, false) AS has_active_subscription,
        coalesce(op.subscription_tier, 'free_trial') AS subscription_tier,
        coalesce(op.carrier_credit, 0)::numeric AS carrier_credit,
        coalesce(op.total_calls_routed, stats.call_count, 0)::int AS total_calls_routed,
        coalesce(op.total_minutes_used, stats.minutes_used, 0)::numeric AS total_minutes_used,
        coalesce(op.account_status, 'active') AS account_status,
        op.custom_routing_note,
        coalesce(
          nullif(trim(u.phone), ''),
          (
            SELECT pn.number
            FROM phone_numbers pn
            WHERE pn.user_id = u.id AND pn.status = 'active'
            ORDER BY pn.created_at ASC
            LIMIT 1
          )
        ) AS phone_number
      FROM users u
      LEFT JOIN onboarding_profiles op ON op.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT
          count(*)::int AS call_count,
          round(coalesce(sum(cl.duration_seconds), 0)::numeric / 60.0, 2) AS minutes_used
        FROM call_logs cl
        WHERE cl.user_id = u.id
      ) stats ON true
      ORDER BY u.created_at DESC
    `
    return (rows as Record<string, unknown>[]).map(mapRow)
  } catch (e) {
    if (isMissingOnboardingProfileColumnError(e) || isMissingAccountRoleColumnError(e) || isMissingReceptionistSkillsColumnError(e)) {
      const rows = await sql`
        SELECT
          u.id AS user_id,
          u.email,
          'owner' AS account_role,
          coalesce(u.business_name, '') AS business_name,
          CASE
            WHEN EXISTS (SELECT 1 FROM receptionists rr WHERE rr.portal_user_id = u.id) THEN 'RECEPTIONIST'
            WHEN nullif(trim(u.business_name), '') IS NOT NULL THEN 'OWNER'
            ELSE 'ADMIN'
          END AS role,
          NULL::text[] AS receptionist_skills,
          coalesce(op.has_active_subscription, false) AS has_active_subscription,
          coalesce(op.subscription_tier, 'free_trial') AS subscription_tier,
          coalesce(op.carrier_credit, 0)::numeric AS carrier_credit,
          coalesce(stats.call_count, 0)::int AS total_calls_routed,
          coalesce(stats.minutes_used, 0)::numeric AS total_minutes_used,
          'active' AS account_status,
          NULL::text AS custom_routing_note,
          coalesce(
            nullif(trim(u.phone), ''),
            (
              SELECT pn.number
              FROM phone_numbers pn
              WHERE pn.user_id = u.id AND pn.status = 'active'
              ORDER BY pn.created_at ASC
              LIMIT 1
            )
          ) AS phone_number
        FROM users u
        LEFT JOIN onboarding_profiles op ON op.user_id = u.id
        LEFT JOIN LATERAL (
          SELECT
            count(*)::int AS call_count,
            round(coalesce(sum(cl.duration_seconds), 0)::numeric / 60.0, 2) AS minutes_used
          FROM call_logs cl
          WHERE cl.user_id = u.id
        ) stats ON true
        ORDER BY u.created_at DESC
      `
      return (rows as Record<string, unknown>[]).map(mapRow)
    }
    throw e
  }
}

/** Atomically adjust onboarding_profiles.carrier_credit (admin override). */
// ============================================
// Platform admin: live traffic, tenant feature flags, operator payout ledger (scripts/063)
// ============================================

/** Canonical admin-controlled premium feature ids. */
export const ADMIN_FEATURE_FLAGS = ["field_tech_hud", "sms_automation"] as const

/** In-progress calls across all tenants for the admin Live Traffic Pulse. */
export async function listActiveCallTraffic(): Promise<AdminLiveCall[]> {
  const sql = getSql()
  const TERMINAL = ["completed", "no-answer", "failed", "busy", "canceled", "cancelled", "voicemail", "missed"]

  const mapRow = (r: Record<string, unknown>): AdminLiveCall => {
    const answeredAt = r.answered_at != null ? String(r.answered_at) : null
    const status = String(r.status ?? "")
    return {
      id: String(r.id),
      business_name: String(r.business_name ?? "").trim() || "Unnamed business",
      email: String(r.email ?? ""),
      operator: r.routed_to_name != null && String(r.routed_to_name).trim() ? String(r.routed_to_name) : null,
      from_number: String(r.from_number ?? ""),
      status,
      started_at: String(r.started_at ?? r.created_at ?? new Date().toISOString()),
      connected: answeredAt != null || status === "in-progress" || status === "answered",
    }
  }

  try {
    const rows = await sql`
      SELECT cl.id, cl.from_number, cl.routed_to_name, cl.status, cl.answered_at,
             COALESCE(cl.answered_at, cl.first_ring_at, cl.created_at) AS started_at,
             cl.created_at, u.business_name, u.email
      FROM call_logs cl
      JOIN users u ON u.id = cl.user_id
      WHERE cl.ended_at IS NULL
        AND cl.created_at > now() - interval '2 hours'
        AND lower(cl.status) <> ALL(${TERMINAL})
      ORDER BY started_at DESC
      LIMIT 50
    `
    return rows.map(mapRow)
  } catch (e) {
    // Deploy-safe: ended_at / answered_at / first_ring_at may not exist on older DBs.
    if (pgErrorCode(e) !== "42703") throw e
    const rows = await sql`
      SELECT cl.id, cl.from_number, cl.routed_to_name, cl.status, cl.created_at AS started_at, cl.created_at,
             u.business_name, u.email
      FROM call_logs cl
      JOIN users u ON u.id = cl.user_id
      WHERE cl.created_at > now() - interval '10 minutes'
        AND lower(cl.status) <> ALL(${TERMINAL})
      ORDER BY cl.created_at DESC
      LIMIT 50
    `
    return rows.map(mapRow)
  }
}

/** Most recent calls across every tenant for the platform-admin call history widget. */
export async function listRecentCallHistory(limit = 50): Promise<AdminCallHistoryRow[]> {
  const sql = getSql()
  const lim = Math.min(Math.max(limit, 1), 200)
  const mapRow = (r: Record<string, unknown>): AdminCallHistoryRow => ({
    id: String(r.id),
    // provider_call_sid is our trunk identifier; surfaced as call_uuid per the admin spec.
    call_uuid: r.call_uuid != null ? String(r.call_uuid) : "",
    direction: r.direction != null ? String(r.direction) : "",
    from_number: r.from_number != null ? String(r.from_number) : "",
    to_number: r.to_number != null ? String(r.to_number) : "",
    status: r.status != null ? String(r.status) : "",
    duration_seconds: Number(r.duration_seconds ?? 0) || 0,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at ?? ""),
  })
  try {
    const rows = await sql`
      SELECT id,
             provider_call_sid AS call_uuid,
             call_type AS direction,
             from_number,
             to_number,
             status,
             duration_seconds,
             created_at
      FROM call_logs
      ORDER BY created_at DESC
      LIMIT ${lim}
    `
    return rows.map(mapRow)
  } catch (e) {
    if (isUndefinedRelationError(e, "call_logs")) return []
    throw e
  }
}

/** Read a tenant's admin feature overrides (empty until scripts/063). */
export async function getProfileFeatureFlags(userId: string): Promise<Record<string, boolean>> {
  const sql = getSql()
  try {
    const rows = await sql`SELECT feature_flags FROM onboarding_profiles WHERE user_id = ${userId} LIMIT 1`
    const raw = rows[0]?.feature_flags
    if (raw && typeof raw === "object") {
      const out: Record<string, boolean> = {}
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) out[k] = v === true
      return out
    }
    return {}
  } catch (e) {
    if (pgErrorCode(e) === "42703" || isMissingOnboardingProfilesTableError(e) || isWrongLegacyProfilesTableError(e)) {
      return {}
    }
    throw e
  }
}

/** Toggle a single tenant feature override. Returns the full flag map. */
export async function setProfileFeatureFlag(
  userId: string,
  flag: string,
  enabled: boolean
): Promise<Record<string, boolean>> {
  await ensureOnboardingProfile(userId)
  const sql = getSql()
  try {
    await sql`
      UPDATE onboarding_profiles
      SET feature_flags = jsonb_set(coalesce(feature_flags, '{}'::jsonb), ARRAY[${flag}], to_jsonb(${enabled}::boolean), true),
          updated_at = now()
      WHERE user_id = ${userId}
    `
  } catch (e) {
    if (pgErrorCode(e) === "42703") {
      throw new Error("feature_flags column missing — run scripts/063-admin-ops-controls.sql in Neon.")
    }
    throw e
  }
  return getProfileFeatureFlags(userId)
}

function mapOperatorPayoutRow(r: Record<string, unknown>): OperatorPayoutRow {
  const rate = Number(r.rate_per_minute ?? 0)
  const minutes = Number(r.minutes ?? 0)
  const earned = Math.round(minutes * rate * 100) / 100
  const paid = Math.round(Number(r.total_paid ?? 0) * 100) / 100
  const accrued = Math.max(0, Math.round((earned - paid) * 100) / 100)
  return {
    receptionist_id: String(r.id),
    name: String(r.name ?? "Agent"),
    phone: String(r.phone ?? ""),
    is_active: r.is_active !== false,
    is_network_agent: r.user_id == null,
    rate_per_minute: rate,
    total_calls: Number(r.calls ?? 0),
    total_minutes: Math.round(minutes * 100) / 100,
    avg_answer_ms: r.avg_answer_ms != null ? Math.round(Number(r.avg_answer_ms)) : null,
    earned_usd: earned,
    paid_usd: paid,
    accrued_usd: accrued,
    last_paid_at: r.last_paid_at != null ? String(r.last_paid_at) : null,
  }
}

/** Per-receptionist payout metrics: minutes, answer speed, earned/paid/accrued. */
export async function listOperatorPayouts(): Promise<OperatorPayoutRow[]> {
  const sql = getSql()

  // Stats subquery — avg_answer_ms is best-effort (column may be missing).
  const buildQuery = (withAnswerSpeed: boolean, withLedger: boolean) => {
    const answerSpeed = withAnswerSpeed ? sql`AVG(post_dial_delay_ms) AS avg_answer_ms` : sql`NULL AS avg_answer_ms`
    const ledgerJoin = withLedger
      ? sql`LEFT JOIN (
              SELECT receptionist_id AS rid, SUM(amount_usd) AS total_paid, MAX(created_at) AS last_paid_at
              FROM payout_ledger GROUP BY receptionist_id
            ) paid ON paid.rid = r.id`
      : sql``
    const paidCols = withLedger
      ? sql`COALESCE(paid.total_paid, 0) AS total_paid, paid.last_paid_at`
      : sql`0 AS total_paid, NULL AS last_paid_at`
    return sql`
      SELECT r.id, r.name, r.phone, r.user_id, r.rate_per_minute, r.is_active,
             COALESCE(stats.calls, 0) AS calls,
             COALESCE(stats.minutes, 0) AS minutes,
             stats.avg_answer_ms,
             ${paidCols}
      FROM receptionists r
      LEFT JOIN (
        SELECT routed_to_receptionist_id AS rid,
               COUNT(*) AS calls,
               SUM(duration_seconds) / 60.0 AS minutes,
               ${answerSpeed}
        FROM call_logs
        WHERE routed_to_receptionist_id IS NOT NULL
        GROUP BY routed_to_receptionist_id
      ) stats ON stats.rid = r.id
      ${ledgerJoin}
      ORDER BY r.is_active DESC, minutes DESC NULLS LAST
    `
  }

  let withAnswerSpeed = true
  let withLedger = true
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const rows = await buildQuery(withAnswerSpeed, withLedger)
      return rows.map((r) => mapOperatorPayoutRow(r as Record<string, unknown>))
    } catch (e) {
      if (isUndefinedRelationError(e, "payout_ledger") && withLedger) {
        withLedger = false
        continue
      }
      if (pgErrorCode(e) === "42703" && withAnswerSpeed) {
        withAnswerSpeed = false
        continue
      }
      throw e
    }
  }
  return []
}

/** Current accrued snapshot for one receptionist (server-trusted amount for Mark Paid). */
export async function getOperatorPayoutSnapshot(receptionistId: string): Promise<OperatorPayoutRow | null> {
  const all = await listOperatorPayouts()
  return all.find((r) => r.receptionist_id === receptionistId) ?? null
}

/** Log a payout (balance reset) transaction in the ledger. */
export async function recordOperatorPayout(params: {
  receptionistId: string
  amountUsd: number
  minutesPaid: number
  note?: string | null
  adminUserId: string
}): Promise<{ id: string }> {
  const sql = getSql()
  try {
    const rows = await sql`
      INSERT INTO payout_ledger (receptionist_id, amount_usd, minutes_paid, note, created_by, created_at)
      VALUES (${params.receptionistId}, ${params.amountUsd}, ${params.minutesPaid}, ${params.note ?? null}, ${params.adminUserId}, now())
      RETURNING id
    `
    return { id: String(rows[0]?.id) }
  } catch (e) {
    if (isUndefinedRelationError(e, "payout_ledger")) {
      throw new Error("payout_ledger table missing — run scripts/063-admin-ops-controls.sql in Neon.")
    }
    throw e
  }
}

export async function adminAdjustProfileCarrierCredit(params: {
  userId: string
  amountUsd: number
}): Promise<{ user_id: string; carrier_credit_after: number }> {
  const sql = getSql()
  const delta = Number(params.amountUsd)
  if (!Number.isFinite(delta) || delta === 0) {
    throw new Error("amount must be a non-zero finite number")
  }
  await ensureOnboardingProfile(params.userId)
  try {
    const rows = await sql`
      WITH updated AS (
        UPDATE onboarding_profiles
        SET
          carrier_credit = ROUND((coalesce(carrier_credit, 0)::numeric + ${delta}::numeric), 2),
          updated_at = now()
        WHERE user_id = ${params.userId}
        RETURNING user_id, carrier_credit
      )
      UPDATE users u
      SET credit_balance_cents = GREATEST(0, ROUND((updated.carrier_credit * 100)::numeric)::int)
      FROM updated
      WHERE u.id = updated.user_id
      RETURNING updated.user_id, updated.carrier_credit
    `
    const row = rows[0] as { user_id?: string; carrier_credit?: number | string } | undefined
    if (!row?.user_id) {
      throw new Error("User profile not found")
    }
    return {
      user_id: String(row.user_id),
      carrier_credit_after: Number(row.carrier_credit ?? 0),
    }
  } catch (e) {
    if (isMissingOnboardingProfileColumnError(e)) {
      throw new Error("carrier_credit column missing — run scripts/028-subscription-tier-carrier-credit.sql in Neon.")
    }
    throw e
  }
}

/** Set subscription override + tier (business when active, free_trial when inactive). */
export async function adminToggleUserSubscription(
  userId: string,
  hasActive: boolean
): Promise<{ user_id: string; has_active_subscription: boolean; subscription_tier: string }> {
  await ensureOnboardingProfile(userId)
  const subscription_tier = hasActive ? "business" : "free_trial"
  const profile = await updateOnboardingProfile(userId, {
    has_active_subscription: hasActive,
    subscription_tier,
  })
  return {
    user_id: userId,
    has_active_subscription: profile.has_active_subscription,
    subscription_tier: profile.subscription_tier,
  }
}

/** Read account_status for voice routing guard — direct column read (never use profile fallbacks). */
export async function getUserAccountStatus(userId: string): Promise<string> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT account_status
      FROM onboarding_profiles
      WHERE user_id = ${userId}
      LIMIT 1
    `
    const row = rows[0] as { account_status?: string | null } | undefined
    if (!row || row.account_status == null) return "active"
    return parseAccountStatus(row.account_status) ?? "active"
  } catch (e) {
    if (
      isMissingOnboardingProfileColumnError(e) ||
      isMissingOnboardingProfilesTableError(e) ||
      isWrongLegacyProfilesTableError(e)
    ) {
      return "active"
    }
    throw e
  }
}

/** Fast DID → account_status lookup (no routing_config joins — for suspension guard hot path). */
async function lookupAccountStatusByInboundDid(toNumber: string): Promise<{
  user_id: string
  account_status: string
} | null> {
  const digitKey = phoneDigitsKey(toNumber)
  if (digitKey.length < 10) return null

  const cached = blockedInboundStatusCache.get(digitKey)
  if (cached && cached.expiresAt > Date.now()) {
    return { user_id: cached.user_id, account_status: cached.account_status }
  }

  const sql = getSql()
  try {
    const rows = await sql`
      SELECT u.id AS user_id, COALESCE(op.account_status, 'active') AS account_status
      FROM phone_numbers pn
      JOIN users u ON u.id = pn.user_id
      LEFT JOIN onboarding_profiles op ON op.user_id = u.id
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
    const row = rows[0] as { user_id?: string; account_status?: string | null } | undefined
    if (!row?.user_id) return null
    const account_status = parseAccountStatus(row.account_status) ?? "active"
    if (isAccountRoutingBlocked(account_status)) {
      blockedInboundStatusCache.set(digitKey, {
        expiresAt: Date.now() + BLOCKED_INBOUND_STATUS_CACHE_TTL_MS,
        account_status,
        user_id: String(row.user_id),
      })
    }
    return { user_id: String(row.user_id), account_status }
  } catch (e) {
    if (!isMissingOnboardingProfileColumnError(e)) throw e
    const rows = await sql`
      SELECT u.id AS user_id
      FROM phone_numbers pn
      JOIN users u ON u.id = pn.user_id
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
    const row = rows[0] as { user_id?: string } | undefined
    if (!row?.user_id) return null
    const account_status = await getUserAccountStatus(String(row.user_id))
    return { user_id: String(row.user_id), account_status }
  }
}

/** Resolve account owner from inbound DID and return suspension status (for webhook guard). */
export async function getAccountStatusForInboundNumber(toNumber: string): Promise<{
  user_id: string | null
  account_status: string
}> {
  const lookup = await lookupAccountStatusByInboundDid(toNumber)
  if (!lookup) return { user_id: null, account_status: "active" }
  return lookup
}

/** Operator overrides: status, notes, manual DID, admin routing override, hard reset lines. */

/** Ensure an active phone_numbers row exists when the account only has onboarding_profiles.reserved_number. */
async function ensureActivePhoneNumberFromReserved(userId: string): Promise<void> {
  const numbers = await getPhoneNumbers(userId)
  if (numbers.some((p) => p.status === "active" && p.number?.trim())) return
  const profile = await getOnboardingProfile(userId)
  const raw = profile?.reserved_number?.trim()
  if (!raw) return
  const numberE164 = normalizePhoneNumberE164(raw)
  if (!isReasonablePstnDialString(numberE164)) return
  const defaultOrg = await getDefaultOrganizationForOwner(userId)
  const orgId =
    defaultOrg && !defaultOrg.id.startsWith("legacy-") ? defaultOrg.id : null
  const sql = getSql()
  const existing = numbers.find((p) => ["active", "pending", "porting"].includes(p.status))
  if (existing) {
    await sql`
      UPDATE phone_numbers
      SET
        number = ${numberE164},
        friendly_name = ${numberE164},
        status = 'active',
        organization_id = COALESCE(organization_id, ${orgId})
      WHERE id = ${existing.id} AND user_id = ${userId}
    `
    return
  }
  const phoneId = crypto.randomUUID()
  await sql`
    INSERT INTO phone_numbers (id, user_id, organization_id, provider_number_sid, twilio_sid, number, friendly_name, label, type, status, created_at)
    VALUES (
      ${phoneId},
      ${userId},
      ${orgId},
      '',
      '',
      ${numberE164},
      ${numberE164},
      'Admin assigned',
      'local',
      'active',
      now()
    )
  `
}

export async function adminApplyUserOverride(params: {
  userId: string
  targetStatus?: string
  adminNotes?: string | null
  manualPhoneOverride?: string | null
  /** Set/clear override on one phone line (requires phoneLineId). */
  adminRoutingOverridePhone?: string | null
  phoneLineId?: string | null
  /** Set/clear override for every line in a workspace when line override is unset. */
  organizationId?: string | null
  /** Batch line overrides from the admin drawer. */
  phoneLineRoutingOverrides?: { phoneLineId: string; adminRoutingOverridePhone: string | null }[]
  resetActiveLines?: boolean
}): Promise<AdminUserOverrideResult> {
  const userId = params.userId.trim()
  if (!userId) throw new Error("userId is required")
  await ensureOnboardingProfile(userId)
  const sql = getSql()

  if (params.resetActiveLines) {
    await sql`DELETE FROM phone_numbers WHERE user_id = ${userId} AND status IN ('active', 'pending', 'porting')`
    await sql`
      UPDATE onboarding_profiles
      SET
        carrier_credit = 0,
        reserved_number = NULL,
        reserved_number_display = NULL,
        updated_at = now()
      WHERE user_id = ${userId}
    `
    await sql`UPDATE users SET credit_balance_cents = 0 WHERE id = ${userId}`
    clearIncomingRoutingCache()
  } else {
    const profileBefore = await getOnboardingProfile(userId)
    const shouldWriteStatus = params.targetStatus !== undefined
    const shouldWriteNotes = params.adminNotes !== undefined
    const shouldWritePhone =
      params.manualPhoneOverride !== undefined &&
      params.manualPhoneOverride !== null &&
      String(params.manualPhoneOverride).trim().length > 0

    if (shouldWriteStatus || shouldWriteNotes || shouldWritePhone) {
      let nextStatus = profileBefore?.account_status ?? "active"
      if (shouldWriteStatus) {
        const parsed = parseAccountStatus(params.targetStatus)
        if (!parsed) throw new Error("targetStatus must be active, suspended, or flagged")
        nextStatus = parsed
      }

      const nextNote = shouldWriteNotes
        ? params.adminNotes === null
          ? null
          : String(params.adminNotes).trim() || null
        : (profileBefore?.custom_routing_note ?? null)

      let numberE164: string | null = null
      if (shouldWritePhone) {
        numberE164 = normalizePhoneNumberE164(String(params.manualPhoneOverride))
        if (!isReasonablePstnDialString(numberE164)) {
          throw new Error("manualPhoneOverride must be a valid phone number")
        }
      }

      const reservedNumber = numberE164 ?? profileBefore?.reserved_number ?? null
      const txnStatements: ReturnType<typeof sql>[] = [
        sql`
          UPDATE onboarding_profiles
          SET
            account_status = ${nextStatus},
            custom_routing_note = ${nextNote},
            reserved_number = ${reservedNumber},
            reserved_number_display = ${reservedNumber},
            reserved_number_method = ${numberE164 ? "buy" : profileBefore?.reserved_number_method ?? null},
            updated_at = now()
          WHERE user_id = ${userId}
        `,
      ]

      if (numberE164) {
        const numbers = await getPhoneNumbers(userId)
        const active = numbers.find((p) => p.status === "active")
        if (active) {
          txnStatements.push(
            sql`
              UPDATE phone_numbers
              SET number = ${numberE164}, friendly_name = ${numberE164}
              WHERE id = ${active.id} AND user_id = ${userId}
            `
          )
        } else {
          const phoneId = crypto.randomUUID()
          txnStatements.push(
            sql`
              INSERT INTO phone_numbers (id, user_id, provider_number_sid, twilio_sid, number, friendly_name, label, type, status, created_at)
              VALUES (
                ${phoneId},
                ${userId},
                '',
                '',
                ${numberE164},
                ${numberE164},
                'Admin assigned',
                'local',
                'active',
                now()
              )
            `
          )
        }
      }

      try {
        await sql.transaction(txnStatements)
      } catch (e) {
        if (isMissingOnboardingProfileColumnError(e)) {
          throw new Error("Admin overrides require scripts/034-admin-profile-metrics.sql in Neon.")
        }
        throw e
      }
      clearIncomingRoutingCache()
      if (shouldWriteStatus) {
        const nums = await getPhoneNumbers(userId)
        primeBlockedInboundStatusForUser(userId, nextStatus, nums.map((p) => p.number))
      }
      void syncInboundDialSnapshotForUser(userId).catch(() => {})
    }

    if (
      params.adminRoutingOverridePhone !== undefined ||
      (params.phoneLineRoutingOverrides && params.phoneLineRoutingOverrides.length > 0)
    ) {
      const batch = params.phoneLineRoutingOverrides ?? []
      if (params.adminRoutingOverridePhone !== undefined) {
        const phoneLineId = params.phoneLineId?.trim()
        const organizationId = params.organizationId?.trim()
        if (!phoneLineId && !organizationId) {
          throw new Error("phoneLineId or organizationId is required when setting adminRoutingOverridePhone")
        }
        batch.push({
          phoneLineId: phoneLineId ?? "",
          adminRoutingOverridePhone: params.adminRoutingOverridePhone,
          organizationId: organizationId ?? null,
        } as { phoneLineId: string; adminRoutingOverridePhone: string | null; organizationId?: string | null })
      }

      for (const item of batch) {
        const orgId = (item as { organizationId?: string | null }).organizationId?.trim()
        const lineId = item.phoneLineId?.trim()
        let overrideE164: string | null = null
        const rawOverride = item.adminRoutingOverridePhone
        if (rawOverride !== null && String(rawOverride).trim().length > 0) {
          overrideE164 = formatAdminRoutingOverridePhoneForTelnyx(String(rawOverride))
          if (!overrideE164) {
            throw new Error("adminRoutingOverridePhone must be a valid phone number")
          }
        }

        if (orgId && !lineId) {
          const orgRows = await sql`
            UPDATE organizations
            SET admin_routing_override_phone = ${overrideE164}
            WHERE id = ${orgId} AND owner_user_id = ${userId}
            RETURNING id
          `
          if (!orgRows[0]) throw new Error("Workspace not found for this owner")
          const orgLines = await getPhoneNumbers(userId, orgId)
          await Promise.all(
            orgLines.filter((l) => l.status === "active").map((l) => syncInboundDialSnapshotForNumber(l.number))
          )
          continue
        }

        if (!lineId) continue
        try {
          const updated = await sql`
            UPDATE phone_numbers
            SET admin_routing_override_phone = ${overrideE164}
            WHERE id = ${lineId} AND user_id = ${userId}
            RETURNING number
          `
          if (!updated[0]) throw new Error("Phone line not found for this owner")
          const lineNumber = String((updated[0] as { number?: string }).number ?? "")
          if (lineNumber) await syncInboundDialSnapshotForNumber(lineNumber)
        } catch (e) {
          if (isMissingPhoneLineAdminOverrideColumnError(e)) {
            throw new Error("Admin routing override requires scripts/073-scoped-admin-routing-override.sql in Neon.")
          }
          throw e
        }
      }

      clearIncomingRoutingCache()
      void syncInboundDialSnapshotForUser(userId).catch(() => {})
    }
  }

  const profile = await getOnboardingProfile(userId)
  const numbers = await getPhoneNumbers(userId)
  const primary = numbers.find((p) => p.status === "active") ?? null
  return {
    user_id: userId,
    account_status: profile?.account_status ?? "active",
    custom_routing_note: profile?.custom_routing_note ?? null,
    phone_number: primary?.number ?? null,
    carrier_credit: profile?.carrier_credit ?? 0,
    reset_active_lines: params.resetActiveLines === true,
  }
}

/** Effective PSTN override for one line (line-level wins over workspace). */
export function effectiveAdminRoutingOverrideForPhoneLine(
  line: Pick<PhoneNumber, "admin_routing_override_phone" | "organization_admin_routing_override_phone">
): string | null {
  return resolveScopedAdminRoutingOverrideE164(
    line.admin_routing_override_phone,
    line.organization_admin_routing_override_phone
  )
}

/** @deprecated Global owner override removed in 073 — always returns null. */
export async function getAdminRoutingOverridePhone(_userId: string): Promise<string | null> {
  return null
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
        u.phone,
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
      phone: String(row.phone ?? ""),
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

/**
 * Operator action: update a user's phone in ONE atomic SQL transaction, mirrored across the
 * `users` row and any linked `receptionists` row (matched by portal_user_id) so the receptionist's
 * profile number never drifts from their login. Returns the normalized E.164 value that was stored.
 */
export async function adminUpdateUserPhone(
  userId: string,
  newPhone: string
): Promise<{ phone: string }> {
  const sql = getSql()
  const phone = normalizePhoneNumberE164(newPhone)
  const [userRows] = await sql.transaction([
    sql`UPDATE users SET phone = ${phone} WHERE id = ${userId} RETURNING id`,
    sql`UPDATE receptionists SET phone = ${phone} WHERE portal_user_id = ${userId}`,
  ])
  if (!Array.isArray(userRows) || userRows.length === 0) {
    throw new Error("User not found")
  }
  return { phone }
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
        u.phone,
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
      phone: String(row.phone ?? ""),
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
/** True when a billing_ledger row already exists for this checkout reference (idempotent credit packs). */
export async function billingLedgerHasEntry(
  userId: string,
  reference: string,
  reason: string
): Promise<boolean> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT 1 FROM billing_ledger
      WHERE user_id = ${userId} AND reference = ${reference} AND reason = ${reason}
      LIMIT 1
    `
    return rows.length > 0
  } catch (e) {
    if (isUndefinedRelationError(e, "billing_ledger")) {
      return false
    }
    throw e
  }
}

/** Update users.billing_plan after Stripe subscription sync. */
export async function updateUserBillingPlan(userId: string, plan: string): Promise<void> {
  const sql = getSql()
  await sql`UPDATE users SET billing_plan = ${plan} WHERE id = ${userId}`
}

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
    try {
      await sql`
        UPDATE onboarding_profiles
        SET carrier_credit = ROUND((${balanceAfter}::numeric / 100.0), 2), updated_at = now()
        WHERE user_id = ${params.target_user_id}
      `
      if (balanceAfter / 100 >= 3) {
        try {
          await sql`
            UPDATE onboarding_profiles
            SET low_balance_notified = false, updated_at = now()
            WHERE user_id = ${params.target_user_id}
          `
        } catch {
          // low_balance_notified column may be missing before scripts/029
        }
      }
    } catch {
      // carrier_credit column may be missing before scripts/028
    }
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

/** Count active business lines for subscription tier limits. */
export async function countActivePhoneNumbers(userId: string): Promise<number> {
  const sql = getSql()
  const rows = await sql`
    SELECT count(*)::int AS c
    FROM phone_numbers
    WHERE user_id = ${userId} AND status = 'active'
  `
  const row = rows[0] as { c?: number } | undefined
  return Number(row?.c ?? 0)
}

/** Adjust prepaid carrier credit (USD) and keep users.credit_balance_cents in sync. */
export async function adjustUserCarrierCredit(params: {
  userId: string
  deltaUsd: number
  reason: string
  reference?: string | null
  meta?: Record<string, unknown>
  actorUserId?: string
}): Promise<{ carrier_credit_after: number; balance_after_cents: number }> {
  const deltaCents = Math.round(params.deltaUsd * 100)
  if (!Number.isFinite(deltaCents) || deltaCents === 0) {
    throw new Error("deltaUsd must be a non-zero finite number")
  }
  const { balance_after_cents } = await adminAdjustUserCreditBalance({
    target_user_id: params.userId,
    delta_cents: deltaCents,
    reason: params.reason,
    actor_user_id: params.actorUserId ?? params.userId,
    reference: params.reference ?? null,
    meta: params.meta,
  })
  const profile = await getOnboardingProfile(params.userId)
  const carrierAfter =
    profile?.carrier_credit != null ? Number(profile.carrier_credit) : balance_after_cents / 100
  return { carrier_credit_after: carrierAfter, balance_after_cents }
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
    subscription_tier: row.subscription_tier != null ? String(row.subscription_tier) : "free_trial",
    carrier_credit: row.carrier_credit != null ? Number(row.carrier_credit) : 0,
    low_balance_notified: pgBool(row.low_balance_notified),
    billing_cycle_start: pgTimestamptzToIso(row.billing_cycle_start),
    billing_cycle_end: pgTimestamptzToIso(row.billing_cycle_end),
    stripe_customer_id: row.stripe_customer_id != null ? String(row.stripe_customer_id) : null,
    stripe_subscription_id: row.stripe_subscription_id != null ? String(row.stripe_subscription_id) : null,
    total_calls_routed: row.total_calls_routed != null ? Number(row.total_calls_routed) : 0,
    total_minutes_used: row.total_minutes_used != null ? Number(row.total_minutes_used) : 0,
    account_status: row.account_status != null ? String(row.account_status) : "active",
    custom_routing_note: row.custom_routing_note != null ? String(row.custom_routing_note) : null,
    sms_leads_enabled: row.sms_leads_enabled === true || row.sms_leads_enabled === "t",
    notification_phone: row.notification_phone != null ? String(row.notification_phone) : null,
    dispatch_sms_phone: row.dispatch_sms_phone != null ? String(row.dispatch_sms_phone) : null,
    updated_at: pgTimestamptzToIso(row.updated_at) ?? new Date().toISOString(),
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

/**
 * Owner-authored instructions shown to the live Lyncr operators answering this business's calls.
 * Stored on onboarding_profiles.routing_instructions (scripts/055). Isolated from the main profile
 * reader so a pre-migration deploy can't break profile loads — returns null until the column exists.
 */
export async function getRoutingInstructions(userId: string): Promise<string | null> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT routing_instructions FROM onboarding_profiles WHERE user_id = ${userId} LIMIT 1
    `
    const row = rows[0] as Record<string, unknown> | undefined
    return row && row.routing_instructions != null ? String(row.routing_instructions) : null
  } catch (e) {
    if (
      pgErrorCode(e) === "42703" ||
      isMissingOnboardingProfilesTableError(e) ||
      isWrongLegacyProfilesTableError(e)
    ) {
      return null
    }
    throw e
  }
}

/** Save (or clear) the owner's live-operator instructions. Throws a friendly hint until 055 is applied. */
export async function setRoutingInstructions(userId: string, text: string): Promise<string> {
  await ensureOnboardingProfile(userId)
  const sql = getSql()
  const value = text.trim() === "" ? null : text
  try {
    await sql`
      UPDATE onboarding_profiles
      SET routing_instructions = ${value}, updated_at = now()
      WHERE user_id = ${userId}
    `
    return value ?? ""
  } catch (e) {
    if (pgErrorCode(e) === "42703") {
      throw new Error(
        "Operator instructions need migration 055 — run scripts/055-routing-instructions.sql in Neon."
      )
    }
    throw e
  }
}

/**
 * Company briefing for the receptionist web-phone screen-pop. Resolves business_name (users),
 * business_instructions (routing_instructions, scripts/055), and business_hours / service_rules
 * (scripts/057) for a business owner. Deploy-safe: missing 055/057 columns degrade to null.
 */
export async function getCompanyBriefingByOwnerId(ownerId: string): Promise<CompanyBriefing | null> {
  const sql = getSql()
  const userRows = await sql`SELECT business_name FROM users WHERE id = ${ownerId} LIMIT 1`
  const u = userRows[0] as Record<string, unknown> | undefined
  if (!u) return null

  const business_instructions = await getRoutingInstructions(ownerId)

  let business_hours: string | null = null
  let service_rules: string | null = null
  try {
    const rows = await sql`
      SELECT business_hours, service_rules FROM onboarding_profiles WHERE user_id = ${ownerId} LIMIT 1
    `
    const r = rows[0] as Record<string, unknown> | undefined
    business_hours = r?.business_hours != null ? String(r.business_hours) : null
    service_rules = r?.service_rules != null ? String(r.service_rules) : null
  } catch (e) {
    if (
      !(
        pgErrorCode(e) === "42703" ||
        isMissingOnboardingProfilesTableError(e) ||
        isWrongLegacyProfilesTableError(e)
      )
    ) {
      throw e
    }
  }

  return {
    found: true,
    business_name: u.business_name != null ? String(u.business_name).trim() || null : null,
    business_hours,
    service_rules,
    business_instructions,
  }
}

/** Resolve a company briefing from an inbound business line (reserved_number, then phone_numbers). */
export async function getCompanyBriefingByNumber(rawNumber: string): Promise<CompanyBriefing | null> {
  const e164 = normalizePhoneNumberE164(rawNumber)
  if (!e164) return null
  const sql = getSql()

  let ownerId: string | null = null
  try {
    const rows = await sql`SELECT user_id FROM onboarding_profiles WHERE reserved_number = ${e164} LIMIT 1`
    const row = rows[0] as Record<string, unknown> | undefined
    if (row?.user_id) ownerId = String(row.user_id)
  } catch (e) {
    if (!isMissingOnboardingProfilesTableError(e) && !isWrongLegacyProfilesTableError(e)) throw e
  }

  if (!ownerId) {
    try {
      const rows = await sql`SELECT user_id FROM phone_numbers WHERE number = ${e164} LIMIT 1`
      const row = rows[0] as Record<string, unknown> | undefined
      if (row?.user_id) ownerId = String(row.user_id)
    } catch {
      /* table/column gaps → treat as no match */
    }
  }

  if (!ownerId) return null
  return getCompanyBriefingByOwnerId(ownerId)
}

/**
 * "Email Call Recordings" dispatch-alert preference (scripts/056). Isolated + deploy-safe so a
 * pre-migration deploy can't break profile loads — returns false until the column exists.
 */
export async function getEmailRecordingsEnabled(userId: string): Promise<boolean> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT email_recordings_enabled FROM onboarding_profiles WHERE user_id = ${userId} LIMIT 1
    `
    const row = rows[0] as Record<string, unknown> | undefined
    return row?.email_recordings_enabled === true || row?.email_recordings_enabled === "t"
  } catch (e) {
    if (
      pgErrorCode(e) === "42703" ||
      isMissingOnboardingProfilesTableError(e) ||
      isWrongLegacyProfilesTableError(e)
    ) {
      return false
    }
    throw e
  }
}

/** Save the "Email Call Recordings" preference. Throws a friendly hint until 056 is applied. */
export async function setEmailRecordingsEnabled(userId: string, enabled: boolean): Promise<boolean> {
  await ensureOnboardingProfile(userId)
  const sql = getSql()
  try {
    await sql`
      UPDATE onboarding_profiles
      SET email_recordings_enabled = ${enabled}, updated_at = now()
      WHERE user_id = ${userId}
    `
    return enabled
  } catch (e) {
    if (pgErrorCode(e) === "42703") {
      throw new Error(
        "Dispatch-alert prefs need migration 056 — run scripts/056-dispatch-alert-prefs.sql in Neon."
      )
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
             subscription_tier, carrier_credit,
             total_calls_routed, total_minutes_used, account_status, custom_routing_note,
             sms_leads_enabled, notification_phone, dispatch_sms_phone,
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
      // Tier 028 — subscription_tier + carrier_credit when scripts/029 not applied yet.
      try {
        const rows = await sql`
          SELECT user_id, reserved_number, reserved_number_display, reserved_number_method,
                 port_carrier, fallback_type, trade_category, opening_line,
                 has_active_subscription,
                 subscription_tier, carrier_credit,
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
      } catch (tier028Error) {
        if (!isMissingOnboardingProfileColumnError(tier028Error)) throw tier028Error
      }
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
      } catch (billingFallbackError) {
        if (!isMissingOnboardingProfileColumnError(billingFallbackError)) throw billingFallbackError
      }
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
  const subscription_tier =
    updates.subscription_tier !== undefined
      ? updates.subscription_tier
      : existing?.subscription_tier ?? "free_trial"
  const carrier_credit =
    updates.carrier_credit !== undefined
      ? updates.carrier_credit
      : existing?.carrier_credit ?? 0
  const low_balance_notified =
    updates.low_balance_notified !== undefined
      ? updates.low_balance_notified
      : existing?.low_balance_notified ?? false
  const billing_cycle_start = pgTimestamptzToIso(
    updates.billing_cycle_start !== undefined
      ? updates.billing_cycle_start
      : existing?.billing_cycle_start ?? null
  )
  const billing_cycle_end = pgTimestamptzToIso(
    updates.billing_cycle_end !== undefined
      ? updates.billing_cycle_end
      : existing?.billing_cycle_end ?? null
  )
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
        subscription_tier, carrier_credit, low_balance_notified,
        billing_cycle_start, billing_cycle_end,
        stripe_customer_id, stripe_subscription_id,
        updated_at
      )
      VALUES (
        ${userId}, ${reserved_number}, ${reserved_number_display}, ${reserved_number_method},
        ${port_carrier}, ${fallback_type}, ${trade_category}, ${opening_line},
        ${has_active_subscription},
        ${subscription_tier}, ${carrier_credit}, ${low_balance_notified},
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
        subscription_tier = EXCLUDED.subscription_tier,
        carrier_credit = EXCLUDED.carrier_credit,
        low_balance_notified = EXCLUDED.low_balance_notified,
        billing_cycle_start = EXCLUDED.billing_cycle_start,
        billing_cycle_end = EXCLUDED.billing_cycle_end,
        stripe_customer_id = EXCLUDED.stripe_customer_id,
        stripe_subscription_id = EXCLUDED.stripe_subscription_id,
        updated_at = now()
      RETURNING user_id, reserved_number, reserved_number_display, reserved_number_method,
                port_carrier, fallback_type, trade_category, opening_line,
                has_active_subscription,
                subscription_tier, carrier_credit, low_balance_notified,
                billing_cycle_start, billing_cycle_end,
                stripe_customer_id, stripe_subscription_id,
                updated_at
    `
    return mapOnboardingProfileRow(rows[0] as Record<string, unknown>)
  } catch (e) {
    if (isMissingOnboardingProfileColumnError(e)) {
      try {
        const rows = await sql`
          INSERT INTO onboarding_profiles (
            user_id, reserved_number, reserved_number_display, reserved_number_method,
            port_carrier, fallback_type, trade_category, opening_line,
            has_active_subscription,
            subscription_tier, carrier_credit,
            billing_cycle_start, billing_cycle_end,
            stripe_customer_id, stripe_subscription_id,
            updated_at
          )
          VALUES (
            ${userId}, ${reserved_number}, ${reserved_number_display}, ${reserved_number_method},
            ${port_carrier}, ${fallback_type}, ${trade_category}, ${opening_line},
            ${has_active_subscription},
            ${subscription_tier}, ${carrier_credit},
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
            subscription_tier = EXCLUDED.subscription_tier,
            carrier_credit = EXCLUDED.carrier_credit,
            billing_cycle_start = EXCLUDED.billing_cycle_start,
            billing_cycle_end = EXCLUDED.billing_cycle_end,
            stripe_customer_id = EXCLUDED.stripe_customer_id,
            stripe_subscription_id = EXCLUDED.stripe_subscription_id,
            updated_at = now()
          RETURNING user_id, reserved_number, reserved_number_display, reserved_number_method,
                    port_carrier, fallback_type, trade_category, opening_line,
                    has_active_subscription,
                    subscription_tier, carrier_credit,
                    billing_cycle_start, billing_cycle_end,
                    stripe_customer_id, stripe_subscription_id,
                    updated_at
        `
        return mapOnboardingProfileRow(rows[0] as Record<string, unknown>)
      } catch (tier028Error) {
        if (!isMissingOnboardingProfileColumnError(tier028Error)) throw tier028Error
      }
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
    if (profile.stripe_subscription_id?.trim()) {
      const { provisionReservedLineAfterStripePayment } = await import("@/lib/stripe-webhook-sync")
      await provisionReservedLineAfterStripePayment(userId)
      return
    }
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

// Get talk time analytics for a date range (answered inbound legs routed to receptionists).
export async function getAgentTalkTime(
  userId: string,
  startDate: string,
  endDate: string
): Promise<
  {
    receptionist_id: string
    receptionist_name: string
    rate_per_minute: number
    pay_mode: "FLAT_RATE" | "PER_MINUTE"
    flat_rate_usd: number
    total_seconds: number
    total_calls: number
    daily: { date: string; seconds: number; calls: number }[]
  }[]
> {
  const sql = getSql()

  async function queryWithTimingColumns() {
    const summaryRows = await sql`
      WITH legs AS (
        SELECT
          cl.routed_to_receptionist_id AS receptionist_id,
          GREATEST(0, COALESCE(
            CASE
              WHEN cl.answered_at IS NOT NULL AND cl.ended_at IS NOT NULL
                THEN EXTRACT(EPOCH FROM (cl.ended_at - cl.answered_at))::int
            END,
            cl.duration_seconds,
            0
          )) AS talk_seconds,
          date_trunc('day', cl.created_at)::date AS day
        FROM call_logs cl
        WHERE cl.user_id = ${userId}
          AND cl.routed_to_receptionist_id IS NOT NULL
          AND cl.created_at >= ${startDate}::timestamptz
          AND cl.created_at < ${endDate}::timestamptz
          AND lower(cl.status) IN ('answered', 'completed', 'in-progress')
      )
      SELECT
        r.id AS receptionist_id,
        r.name AS receptionist_name,
        r.rate_per_minute,
        r.pay_mode,
        r.flat_rate_usd,
        COUNT(legs.receptionist_id)::int AS total_calls,
        COALESCE(SUM(legs.talk_seconds), 0)::int AS total_seconds
      FROM receptionists r
      LEFT JOIN legs ON legs.receptionist_id = r.id
      WHERE r.user_id = ${userId}
      GROUP BY r.id, r.name, r.rate_per_minute, r.pay_mode, r.flat_rate_usd
      ORDER BY r.name ASC
    `

    const dailyRows = await sql`
      SELECT
        cl.routed_to_receptionist_id AS receptionist_id,
        date_trunc('day', cl.created_at)::date AS day,
        COUNT(*)::int AS calls,
        COALESCE(SUM(
          GREATEST(0, COALESCE(
            CASE
              WHEN cl.answered_at IS NOT NULL AND cl.ended_at IS NOT NULL
                THEN EXTRACT(EPOCH FROM (cl.ended_at - cl.answered_at))::int
            END,
            cl.duration_seconds,
            0
          ))
        ), 0)::int AS seconds
      FROM call_logs cl
      WHERE cl.user_id = ${userId}
        AND cl.routed_to_receptionist_id IS NOT NULL
        AND cl.created_at >= ${startDate}::timestamptz
        AND cl.created_at < ${endDate}::timestamptz
        AND lower(cl.status) IN ('answered', 'completed', 'in-progress')
      GROUP BY cl.routed_to_receptionist_id, date_trunc('day', cl.created_at)::date
      ORDER BY day ASC
    `

    return { summaryRows, dailyRows }
  }

  async function queryWithoutTimingColumns() {
    const summaryRows = await sql`
      WITH legs AS (
        SELECT
          cl.routed_to_receptionist_id AS receptionist_id,
          GREATEST(0, COALESCE(cl.duration_seconds, 0)) AS talk_seconds,
          date_trunc('day', cl.created_at)::date AS day
        FROM call_logs cl
        WHERE cl.user_id = ${userId}
          AND cl.routed_to_receptionist_id IS NOT NULL
          AND cl.created_at >= ${startDate}::timestamptz
          AND cl.created_at < ${endDate}::timestamptz
          AND lower(cl.status) IN ('answered', 'completed', 'in-progress')
      )
      SELECT
        r.id AS receptionist_id,
        r.name AS receptionist_name,
        r.rate_per_minute,
        COUNT(legs.receptionist_id)::int AS total_calls,
        COALESCE(SUM(legs.talk_seconds), 0)::int AS total_seconds
      FROM receptionists r
      LEFT JOIN legs ON legs.receptionist_id = r.id
      WHERE r.user_id = ${userId}
      GROUP BY r.id, r.name, r.rate_per_minute
      ORDER BY r.name ASC
    `

    const dailyRows = await sql`
      SELECT
        cl.routed_to_receptionist_id AS receptionist_id,
        date_trunc('day', cl.created_at)::date AS day,
        COUNT(*)::int AS calls,
        COALESCE(SUM(GREATEST(0, COALESCE(cl.duration_seconds, 0))), 0)::int AS seconds
      FROM call_logs cl
      WHERE cl.user_id = ${userId}
        AND cl.routed_to_receptionist_id IS NOT NULL
        AND cl.created_at >= ${startDate}::timestamptz
        AND cl.created_at < ${endDate}::timestamptz
        AND lower(cl.status) IN ('answered', 'completed', 'in-progress')
      GROUP BY cl.routed_to_receptionist_id, date_trunc('day', cl.created_at)::date
      ORDER BY day ASC
    `

    return { summaryRows, dailyRows }
  }

  let summaryRows: Record<string, unknown>[]
  let dailyRows: Record<string, unknown>[]
  let hasPayColumns = true

  try {
    const result = await queryWithTimingColumns()
    summaryRows = result.summaryRows as Record<string, unknown>[]
    dailyRows = result.dailyRows as Record<string, unknown>[]
  } catch (e) {
    if (isMissingReceptionistPayColumnError(e)) {
      hasPayColumns = false
      const fallback = await queryWithoutTimingColumns()
      summaryRows = fallback.summaryRows as Record<string, unknown>[]
      dailyRows = fallback.dailyRows as Record<string, unknown>[]
    } else if (isMissingCallQualityColumnsError(e) || pgErrorMessage(e).includes("answered_at")) {
      const fallback = await queryWithoutTimingColumns()
      summaryRows = fallback.summaryRows as Record<string, unknown>[]
      dailyRows = fallback.dailyRows as Record<string, unknown>[]
    } else {
      throw e
    }
  }

  const dailyByReceptionist = new Map<string, { date: string; seconds: number; calls: number }[]>()
  for (const row of dailyRows) {
    const receptionistId = String(row.receptionist_id)
    const dayValue = row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day).slice(0, 10)
    const bucket = dailyByReceptionist.get(receptionistId) ?? []
    bucket.push({
      date: dayValue,
      seconds: Number(row.seconds ?? 0),
      calls: Number(row.calls ?? 0),
    })
    dailyByReceptionist.set(receptionistId, bucket)
  }

  return summaryRows.map((row) => {
    const payModeRaw = hasPayColumns ? String(row.pay_mode ?? "PER_MINUTE").toUpperCase() : "PER_MINUTE"
    const receptionistId = String(row.receptionist_id)
    return {
      receptionist_id: receptionistId,
      receptionist_name: String(row.receptionist_name),
      rate_per_minute: Number(row.rate_per_minute ?? 0.25),
      pay_mode: payModeRaw === "FLAT_RATE" ? "FLAT_RATE" : "PER_MINUTE",
      flat_rate_usd: hasPayColumns ? Number(row.flat_rate_usd ?? 2.5) : 2.5,
      total_seconds: Number(row.total_seconds ?? 0),
      total_calls: Number(row.total_calls ?? 0),
      daily: dailyByReceptionist.get(receptionistId) ?? [],
    }
  })
}

/** Current billing cycle window — Stripe period when set, else calendar month UTC. */
export async function getBillingCycleWindowForUser(userId: string): Promise<{ start: string; end: string }> {
  const profile = await getOnboardingProfile(userId)
  const startIso = profile?.billing_cycle_start?.trim()
  const endIso = profile?.billing_cycle_end?.trim()
  if (startIso && endIso) {
    return { start: startIso, end: endIso }
  }
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return { start: start.toISOString(), end: end.toISOString() }
}

/** Receptionist payout metrics for the active billing cycle. */
export async function getReceptionistPayoutMetricsForBillingCycle(
  userId: string
): Promise<{ billing_cycle: { start: string; end: string }; agents: ReceptionistPayoutMetrics[] }> {
  const { calculateReceptionistPayTotal } = await import("@/lib/receptionist-pay")
  const billing_cycle = await getBillingCycleWindowForUser(userId)
  const talkRows = await getAgentTalkTime(userId, billing_cycle.start, billing_cycle.end)

  const agents = talkRows.map((row) => {
    const total_earnings = calculateReceptionistPayTotal({
      payMode: row.pay_mode,
      ratePerMinute: row.rate_per_minute,
      flatRateUsd: row.flat_rate_usd,
      answeredCalls: row.total_calls,
      totalTalkSeconds: row.total_seconds,
    })
    return {
      receptionist_id: row.receptionist_id,
      receptionist_name: row.receptionist_name,
      pay_mode: row.pay_mode,
      rate_per_minute: row.rate_per_minute,
      flat_rate_usd: row.flat_rate_usd,
      answered_calls: row.total_calls,
      total_talk_seconds: row.total_seconds,
      total_talk_minutes: Math.round((row.total_seconds / 60) * 10) / 10,
      total_earnings,
      daily_breakdown: row.daily.map((d) => ({
        date: d.date,
        answered_calls: d.calls,
        talk_seconds: d.seconds,
      })),
    }
  })

  return { billing_cycle, agents }
}

/** Receptionist row linked to a portal login user (`receptionists.portal_user_id`). */
export async function getReceptionistByPortalUserId(portalUserId: string): Promise<Receptionist | null> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT id, user_id, name, phone, initials, color, rate_per_minute, pay_mode, flat_rate_usd, is_active, portal_user_id, created_at,
        -- 050/051 columns read via to_jsonb so a pre-migration DB returns NULL instead of erroring.
        to_jsonb(receptionists) ->> 'routing_endpoint' AS routing_endpoint,
        to_jsonb(receptionists) ->> 'sip_username' AS sip_username,
        to_jsonb(receptionists) ->> 'sip_credential_id' AS sip_credential_id
      FROM receptionists
      WHERE portal_user_id = ${portalUserId}
      LIMIT 1
    `
    return rows[0] ? parseReceptionistRow(rows[0]) : null
  } catch (e) {
    if (!isMissingPortalUserColumnError(e) && !isMissingReceptionistPayColumnError(e)) throw e
    try {
      const rows = await sql`
        SELECT id, user_id, name, phone, initials, color, rate_per_minute, is_active, created_at
        FROM receptionists
        WHERE portal_user_id = ${portalUserId}
        LIMIT 1
      `
      return rows[0] ? parseReceptionistRow(rows[0]) : null
    } catch (e2) {
      if (isMissingPortalUserColumnError(e2)) return null
      throw e2
    }
  }
}

/** Call logs routed to one receptionist (owner account scope). */
export async function listCallLogsForReceptionist(
  ownerUserId: string,
  receptionistId: string,
  options?: { limit?: number; offset?: number; start?: string; end?: string }
): Promise<CallLog[]> {
  const sql = getSql()
  const limit = options?.limit ?? 50
  const offset = options?.offset ?? 0
  const start = options?.start
  const end = options?.end

  let rows: Record<string, unknown>[]
  if (start && end) {
    rows = await sql`
      SELECT * FROM call_logs
      WHERE user_id = ${ownerUserId}
        AND routed_to_receptionist_id = ${receptionistId}
        AND created_at >= ${start}::timestamptz
        AND created_at < ${end}::timestamptz
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
  } else {
    rows = await sql`
      SELECT * FROM call_logs
      WHERE user_id = ${ownerUserId}
        AND routed_to_receptionist_id = ${receptionistId}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
  }
  return rows.map((row) => parseCallLogRow(row))
}

/** In-flight call currently assigned to this receptionist (for live status / HUD panel). */
export async function getActiveCallLogForReceptionist(receptionistId: string): Promise<CallLog | null> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT * FROM call_logs
      WHERE routed_to_receptionist_id = ${receptionistId}
        AND ended_at IS NULL
        AND lower(status) IN ('answered', 'in-progress', 'ringing')
        AND created_at > (now() - interval '2 hours')
      ORDER BY created_at DESC
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    const call = parseCallLogRow(row as Record<string, unknown>)
    if (call.answered_at || /answered|in-progress/i.test(call.status)) return call
    return null
  } catch (e) {
    if (pgErrorCode(e) === "42703" && pgErrorMessage(e).includes("ended_at")) return null
    throw e
  }
}

/** Aggregate talk seconds + answered call count for one receptionist in a date range. */
export async function getReceptionistTalkAggregate(
  ownerUserId: string,
  receptionistId: string,
  startDate: string,
  endDate: string
): Promise<{ answered_calls: number; total_seconds: number }> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT
        COUNT(*)::int AS answered_calls,
        COALESCE(SUM(
          GREATEST(0, COALESCE(
            CASE
              WHEN cl.answered_at IS NOT NULL AND cl.ended_at IS NOT NULL
                THEN EXTRACT(EPOCH FROM (cl.ended_at - cl.answered_at))::int
            END,
            cl.duration_seconds,
            0
          ))
        ), 0)::int AS total_seconds
      FROM call_logs cl
      WHERE cl.user_id = ${ownerUserId}
        AND cl.routed_to_receptionist_id = ${receptionistId}
        AND cl.created_at >= ${startDate}::timestamptz
        AND cl.created_at < ${endDate}::timestamptz
        AND lower(cl.status) IN ('answered', 'completed', 'in-progress')
    `
    const row = rows[0]
    return {
      answered_calls: Number(row?.answered_calls ?? 0),
      total_seconds: Number(row?.total_seconds ?? 0),
    }
  } catch (e) {
    if (isMissingCallQualityColumnsError(e) || pgErrorMessage(e).includes("answered_at")) {
      const rows = await sql`
        SELECT
          COUNT(*)::int AS answered_calls,
          COALESCE(SUM(GREATEST(0, COALESCE(cl.duration_seconds, 0))), 0)::int AS total_seconds
        FROM call_logs cl
        WHERE cl.user_id = ${ownerUserId}
          AND cl.routed_to_receptionist_id = ${receptionistId}
          AND cl.created_at >= ${startDate}::timestamptz
          AND cl.created_at < ${endDate}::timestamptz
          AND lower(cl.status) IN ('answered', 'completed', 'in-progress')
      `
      const row = rows[0]
      return {
        answered_calls: Number(row?.answered_calls ?? 0),
        total_seconds: Number(row?.total_seconds ?? 0),
      }
    }
    throw e
  }
}

function isMissingTeamInvitesTableError(e: unknown): boolean {
  return isUndefinedRelationError(e, "team_invites")
}

function parseTeamInviteRow(row: Record<string, unknown>): TeamInvite {
  const expires_at = pgTimestamptzToIso(row.expires_at) ?? new Date().toISOString()
  const accepted_at = pgTimestamptzToIso(row.accepted_at)
  // Derive status defensively so it's correct even on pre-052 rows (no status column).
  let status: TeamInvite["status"]
  if (accepted_at || String(row.status ?? "").toUpperCase() === "ACCEPTED") status = "ACCEPTED"
  else if (Date.parse(expires_at) < Date.now() || String(row.status ?? "").toUpperCase() === "EXPIRED") status = "EXPIRED"
  else status = "PENDING"
  return {
    id: String(row.id),
    email: row.email != null ? String(row.email) : "",
    first_name: row.first_name != null ? String(row.first_name) : "",
    role: "receptionist",
    token: String(row.token),
    payout_rate_usd: Number(row.payout_rate_usd ?? 2.5),
    invited_by_user_id: String(row.invited_by_user_id),
    expires_at,
    accepted_at,
    accepted_user_id: row.accepted_user_id ? String(row.accepted_user_id) : null,
    created_at: pgTimestamptzToIso(row.created_at) ?? new Date().toISOString(),
    channel: String(row.channel ?? "EMAIL").toUpperCase() === "SMS" ? "SMS" : "EMAIL",
    phone: row.phone ? String(row.phone) : null,
    status,
  }
}

/**
 * Admin-created pending invite for a platform receptionist.
 * Supports EMAIL invites (email + name known up front) and SMS invites (phone only — the
 * invitee fills in name/email at /register). Deploy-safe: if the 052 columns aren't present
 * yet it falls back to the legacy email-only insert.
 */
export async function createTeamInvite(params: {
  token: string
  payout_rate_usd: number
  invited_by_user_id: string
  expires_at: string
  channel?: "EMAIL" | "SMS"
  email?: string | null
  first_name?: string | null
  phone?: string | null
}): Promise<TeamInvite> {
  const sql = getSql()
  const channel: "EMAIL" | "SMS" = params.channel === "SMS" ? "SMS" : "EMAIL"
  const email = params.email?.trim().toLowerCase() || null
  const firstName = params.first_name?.trim() || null
  const phone = params.phone?.trim() || null

  try {
    const rows = await sql`
      INSERT INTO team_invites (
        email, first_name, role, token, payout_rate_usd, invited_by_user_id, expires_at,
        channel, phone, status
      )
      VALUES (
        ${email},
        ${firstName},
        'receptionist',
        ${params.token},
        ${params.payout_rate_usd},
        ${params.invited_by_user_id},
        ${params.expires_at}::timestamptz,
        ${channel},
        ${phone},
        'PENDING'
      )
      RETURNING *
    `
    return parseTeamInviteRow(rows[0] as Record<string, unknown>)
  } catch (e) {
    // 42703 = a 052 column is missing. Email invites can still use the legacy insert.
    if (pgErrorCode(e) !== "42703") throw e
    if (channel !== "EMAIL" || !email || !firstName) {
      throw new Error("Run scripts/052-invite-sms-channel.sql in Neon to enable SMS / profile invites.")
    }
    const rows = await sql`
      INSERT INTO team_invites (
        email, first_name, role, token, payout_rate_usd, invited_by_user_id, expires_at
      )
      VALUES (
        ${email}, ${firstName}, 'receptionist', ${params.token}, ${params.payout_rate_usd},
        ${params.invited_by_user_id}, ${params.expires_at}::timestamptz
      )
      RETURNING *
    `
    return parseTeamInviteRow(rows[0] as Record<string, unknown>)
  }
}

/** Lookup invite by token for signup redemption. */
export async function getTeamInviteByToken(token: string): Promise<TeamInvite | null> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT * FROM team_invites WHERE token = ${token.trim()} LIMIT 1
    `
    return rows[0] ? parseTeamInviteRow(rows[0] as Record<string, unknown>) : null
  } catch (e) {
    if (isMissingTeamInvitesTableError(e)) return null
    throw e
  }
}

/** All team invites created by a user (admin drawer — onboarding queue). */
export async function listTeamInvitesForInviter(invitedByUserId: string): Promise<TeamInvite[]> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT * FROM team_invites
      WHERE invited_by_user_id = ${invitedByUserId}
      ORDER BY created_at DESC
    `
    return rows.map((r) => parseTeamInviteRow(r as Record<string, unknown>))
  } catch (e) {
    if (isMissingTeamInvitesTableError(e)) return []
    throw e
  }
}

/** Public-safe invite preview (valid + pending only). */
export async function getTeamInvitePreview(token: string): Promise<TeamInvitePreview | null> {
  const invite = await getTeamInviteByToken(token)
  if (!invite) return null
  if (invite.accepted_at) return null
  if (Date.parse(invite.expires_at) < Date.now()) return null
  return {
    email: invite.email,
    first_name: invite.first_name,
    payout_rate_usd: invite.payout_rate_usd,
    role: invite.role,
    expires_at: invite.expires_at,
    channel: invite.channel,
    phone: invite.phone,
  }
}

export async function insertReceptionistPortal(params: {
  owner_user_id: string
  portal_user_id: string
  name: string
  phone: string
  flat_rate_usd: number
}): Promise<Receptionist> {
  const sql = getSql()
  const id = crypto.randomUUID()
  const phone = normalizePhoneNumberE164(params.phone)
  const nameParts = params.name.trim().split(/\s+/)
  const initials =
    nameParts.length >= 2
      ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
      : params.name.slice(0, 2).toUpperCase()
  const colors = ["bg-primary", "bg-chart-2", "bg-chart-5", "bg-chart-3", "bg-chart-4"]
  const color = colors[Math.floor(Math.random() * colors.length)]

  try {
    await sql`
      INSERT INTO receptionists (
        id, user_id, name, phone, initials, color, rate_per_minute, pay_mode, flat_rate_usd,
        is_active, portal_user_id, created_at
      )
      VALUES (
        ${id}, ${params.owner_user_id}, ${params.name}, ${phone}, ${initials}, ${color},
        0.25, 'FLAT_RATE', ${params.flat_rate_usd}, true, ${params.portal_user_id}, now()
      )
    `
  } catch (e) {
    if (isMissingPortalUserColumnError(e) || isMissingReceptionistPayColumnError(e)) {
      await sql`
        INSERT INTO receptionists (id, user_id, name, phone, initials, color, rate_per_minute, is_active, created_at)
        VALUES (${id}, ${params.owner_user_id}, ${params.name}, ${phone}, ${initials}, ${color}, 0.25, true, now())
      `
    } else {
      throw e
    }
  }

  const created = await getReceptionist(id)
  if (!created) {
    throw new Error("Failed to load receptionist after invite accept")
  }
  if (created.portal_user_id !== params.portal_user_id) {
    try {
      await sql`
        UPDATE receptionists SET portal_user_id = ${params.portal_user_id}
        WHERE id = ${id} AND user_id = ${params.owner_user_id}
      `
    } catch {
      /* column may be missing pre-migration */
    }
  }
  return {
    ...created,
    portal_user_id: params.portal_user_id,
    pay_mode: "FLAT_RATE",
    flat_rate_usd: params.flat_rate_usd,
  }
}

/** Best-effort link receptionists.portal_user_id (no-op when column missing). */
export async function tryLinkReceptionistPortalUser(
  receptionistId: string,
  ownerUserId: string,
  portalUserId: string
): Promise<void> {
  const sql = getSql()
  try {
    await sql`
      UPDATE receptionists
      SET portal_user_id = ${portalUserId}
      WHERE id = ${receptionistId} AND user_id = ${ownerUserId}
    `
  } catch (e) {
    if (!isMissingPortalUserColumnError(e)) throw e
  }
}

/** Idempotent dev sandbox receptionist — uses createUser + insertReceptionistPortal (schema-safe). */
export async function ensureSandboxTestReceptionistAccount(params: {
  owner_user_id: string
  email: string
  name: string
  phone: string
  password_hash: string
}): Promise<{ portal_user_id: string; receptionist_id: string; created_user: boolean; created_receptionist: boolean }> {
  const sql = getSql()
  const email = params.email.trim().toLowerCase()
  const phone = normalizePhoneNumberE164(params.phone)
  let created_user = false
  let created_receptionist = false

  let existingAuth = await getAuthUserByEmail(email)
  if (!existingAuth) {
    await createUser({
      email,
      name: params.name,
      phone,
      business_name: "Lyncr Receptionist",
      industry: "generic",
      password_hash: params.password_hash,
      account_role: "receptionist",
    })
    created_user = true
    existingAuth = await getAuthUserByEmail(email)
    if (!existingAuth) {
      throw new Error("ensureSandboxTestReceptionistAccount: user row missing after createUser")
    }
  } else {
    await setUserPasswordHash(existingAuth.id, params.password_hash)
  }

  const portalUserId = existingAuth.id

  let receptionist = await getReceptionistByPortalUserId(portalUserId)
  if (!receptionist) {
    try {
      const rows = await sql`
        SELECT id, user_id, name, phone, initials, color, rate_per_minute, pay_mode, flat_rate_usd, is_active, portal_user_id, created_at
        FROM receptionists
        WHERE user_id = ${params.owner_user_id}
          AND LOWER(name) = LOWER(${params.name})
        LIMIT 1
      `
      receptionist = rows[0] ? parseReceptionistRow(rows[0]) : null
    } catch (e) {
      if (!isMissingPortalUserColumnError(e) && !isMissingReceptionistPayColumnError(e)) throw e
      const rows = await sql`
        SELECT id, user_id, name, phone, initials, color, rate_per_minute, is_active, created_at
        FROM receptionists
        WHERE user_id = ${params.owner_user_id}
          AND LOWER(name) = LOWER(${params.name})
        LIMIT 1
      `
      receptionist = rows[0] ? parseReceptionistRow(rows[0]) : null
    }
  }

  if (!receptionist) {
    receptionist = await insertReceptionistPortal({
      owner_user_id: params.owner_user_id,
      portal_user_id: portalUserId,
      name: params.name,
      phone,
      flat_rate_usd: 2.5,
    })
    created_receptionist = true
  } else {
    try {
      await sql`
        UPDATE receptionists
        SET
          user_id = ${params.owner_user_id},
          is_active = true,
          portal_user_id = ${portalUserId},
          name = ${params.name},
          phone = ${phone}
        WHERE id = ${receptionist.id}
      `
    } catch {
      await sql`
        UPDATE receptionists
        SET user_id = ${params.owner_user_id}, is_active = true, name = ${params.name}, phone = ${phone}
        WHERE id = ${receptionist.id}
      `
      try {
        await sql`
          UPDATE receptionists
          SET portal_user_id = ${portalUserId}
          WHERE id = ${receptionist.id} AND user_id = ${params.owner_user_id}
        `
      } catch {
        /* pre-040 schema */
      }
    }
  }

  try {
    await sql`
      UPDATE receptionists
      SET skills = '{}'::text[]
      WHERE id = ${receptionist.id} AND user_id = ${params.owner_user_id}
    `
  } catch (e) {
    if (!isMissingReceptionistSkillsColumnError(e)) throw e
  }

  const loaded = (await getReceptionist(receptionist.id)) ?? receptionist
  return {
    portal_user_id: portalUserId,
    receptionist_id: loaded.id,
    created_user,
    created_receptionist,
  }
}

/** Redeem invite at signup — locks account_role receptionist + portal link. */
export async function acceptTeamInviteSignup(params: {
  token: string
  email: string
  password_hash: string
  phone: string
}): Promise<{ user: User; invite: TeamInvite }> {
  const sql = getSql()
  const invite = await getTeamInviteByToken(params.token)
  if (!invite) {
    throw new Error("Invite not found")
  }
  if (invite.accepted_at) {
    throw new Error("Invite already used")
  }
  if (Date.parse(invite.expires_at) < Date.now()) {
    throw new Error("Invite expired")
  }
  const email = params.email.trim().toLowerCase()
  if (email !== invite.email.trim().toLowerCase()) {
    throw new Error("Email must match the invitation")
  }

  const user = await createUser({
    email,
    name: invite.first_name,
    phone: params.phone,
    business_name: "Lyncr Receptionist",
    industry: "generic",
    password_hash: params.password_hash,
    account_role: "receptionist",
  })

  await insertReceptionistPortal({
    owner_user_id: invite.invited_by_user_id,
    portal_user_id: user.id,
    name: invite.first_name,
    phone: params.phone,
    flat_rate_usd: invite.payout_rate_usd,
  })

  await sql`
    UPDATE team_invites
    SET accepted_at = now(), accepted_user_id = ${user.id}
    WHERE id = ${invite.id} AND accepted_at IS NULL
  `

  return { user: { ...user, account_role: "receptionist" }, invite }
}

/**
 * Redeem an invite from the /register profile-completion page. Unlike the /signup path, the
 * invitee provides their own Full Name here (the invite may not carry one — e.g. SMS invites),
 * and the email comes from the invite for EMAIL channel or from the form for SMS channel.
 * Creates the users + receptionists rows, links them, sets a sip_username placeholder, and
 * marks the invite ACCEPTED. (Sequential writes mirror acceptTeamInviteSignup — the Neon HTTP
 * driver isn't a single interactive transaction.)
 */
export async function acceptReceptionistInviteRegistration(params: {
  token: string
  full_name: string
  phone: string
  password_hash: string
  email?: string | null
}): Promise<{ user: User }> {
  const sql = getSql()
  const invite = await getTeamInviteByToken(params.token)
  if (!invite) throw new Error("Invite not found")
  if (invite.status === "ACCEPTED" || invite.accepted_at) throw new Error("Invite already used")
  if (Date.parse(invite.expires_at) < Date.now()) throw new Error("Invite expired")

  const fullName = params.full_name.trim()
  if (fullName.length < 2) throw new Error("Full name is required")

  // EMAIL invites carry the address; SMS invites need one supplied so the account has a login.
  const email =
    invite.channel === "EMAIL" && invite.email
      ? invite.email.trim().toLowerCase()
      : (params.email ?? "").trim().toLowerCase()
  if (!email.includes("@")) throw new Error("A valid email is required to create your login")

  const phone = normalizePhoneNumberE164(params.phone)

  const user = await createUser({
    email,
    name: fullName,
    phone,
    business_name: "Lyncr Receptionist",
    industry: "generic",
    password_hash: params.password_hash,
    account_role: "receptionist",
  })

  const receptionist = await insertReceptionistPortal({
    owner_user_id: invite.invited_by_user_id,
    portal_user_id: user.id,
    name: fullName,
    phone,
    flat_rate_usd: invite.payout_rate_usd,
  })

  // sip_username placeholder (050) — real Telnyx SIP credential is auto-provisioned on first WEB use.
  try {
    const placeholder = `lyncr_pending_${receptionist.id.replace(/-/g, "").slice(0, 12)}`
    await sql`UPDATE receptionists SET sip_username = ${placeholder} WHERE id = ${receptionist.id}`
  } catch (e) {
    if (pgErrorCode(e) !== "42703") throw e
  }

  // Mark accepted (status column tolerated pre-052).
  try {
    await sql`
      UPDATE team_invites
      SET status = 'ACCEPTED', accepted_at = now(), accepted_user_id = ${user.id}
      WHERE id = ${invite.id} AND accepted_at IS NULL
    `
  } catch (e) {
    if (pgErrorCode(e) !== "42703") throw e
    await sql`
      UPDATE team_invites
      SET accepted_at = now(), accepted_user_id = ${user.id}
      WHERE id = ${invite.id} AND accepted_at IS NULL
    `
  }

  return { user: { ...user, account_role: "receptionist" } }
}

function parseCertificationModuleData(raw: unknown): CertificationModuleData {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { lessons: [], quiz: [] }
  }
  const m = raw as Record<string, unknown>
  const lessons: CertificationLesson[] = Array.isArray(m.lessons)
    ? m.lessons.map((item) => {
        const row = item as Record<string, unknown>
        return {
          id: String(row.id ?? ""),
          title: String(row.title ?? ""),
          body: String(row.body ?? ""),
        }
      })
    : []
  const quiz: CertificationQuizQuestion[] = Array.isArray(m.quiz)
    ? m.quiz.map((item) => {
        const row = item as Record<string, unknown>
        return {
          id: String(row.id ?? ""),
          question: String(row.question ?? ""),
          options: Array.isArray(row.options) ? row.options.map(String) : [],
          correctAnswer: String(row.correctAnswer ?? ""),
        }
      })
    : []
  return {
    ...(m.description != null ? { description: String(m.description) } : {}),
    lessons,
    quiz,
  }
}

function parseCertificationRow(row: Record<string, unknown>): Certification {
  return {
    id: String(row.id),
    name: String(row.name),
    code_identifier: String(row.code_identifier),
    module_data: parseCertificationModuleData(row.module_data),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }
}

function parseReceptionistBadgeRow(row: Record<string, unknown>): ReceptionistBadge {
  const statusRaw = String(row.status ?? "in_progress").toLowerCase()
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    certification_id: String(row.certification_id),
    status: statusRaw === "certified" ? "certified" : "in_progress",
    active_toggle: row.active_toggle !== false,
    earned_at:
      row.earned_at == null
        ? null
        : row.earned_at instanceof Date
          ? row.earned_at.toISOString()
          : String(row.earned_at),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }
}

/** All platform certification courses. */
export async function listCertifications(): Promise<Certification[]> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT id, name, code_identifier, module_data, created_at
      FROM certifications
      ORDER BY name ASC
    `
    return (rows as Record<string, unknown>[]).map(parseCertificationRow)
  } catch (e) {
    if (isMissingCertificationsTableError(e)) return []
    throw e
  }
}

/** Lookup one certification by stable code slug. */
export async function getCertificationByCode(codeIdentifier: string): Promise<Certification | null> {
  const sql = getSql()
  const code = codeIdentifier.trim()
  if (!code) return null
  try {
    const rows = await sql`
      SELECT id, name, code_identifier, module_data, created_at
      FROM certifications
      WHERE code_identifier = ${code}
      LIMIT 1
    `
    return rows[0] ? parseCertificationRow(rows[0] as Record<string, unknown>) : null
  } catch (e) {
    if (isMissingCertificationsTableError(e)) return null
    throw e
  }
}

/** Badges earned / in progress for one portal user. */
export async function listReceptionistBadgesForUser(userId: string): Promise<ReceptionistBadge[]> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT id, user_id, certification_id, status, active_toggle, earned_at, created_at
      FROM receptionist_badges
      WHERE user_id = ${userId}
      ORDER BY created_at ASC
    `
    return (rows as Record<string, unknown>[]).map(parseReceptionistBadgeRow)
  } catch (e) {
    if (isMissingCertificationsTableError(e)) return []
    throw e
  }
}

/** Upsert badge row when a user starts or completes a course. */
export async function upsertReceptionistBadge(params: {
  userId: string
  certificationId: string
  status: ReceptionistBadgeStatus
  activeToggle?: boolean
  earnedAt?: string | null
}): Promise<ReceptionistBadge> {
  const sql = getSql()
  const activeToggle = params.activeToggle !== false
  const earnedAt = params.status === "certified" ? (params.earnedAt ?? new Date().toISOString()) : null
  const rows = await sql`
    INSERT INTO receptionist_badges (user_id, certification_id, status, active_toggle, earned_at)
    VALUES (${params.userId}, ${params.certificationId}, ${params.status}, ${activeToggle}, ${earnedAt})
    ON CONFLICT (user_id, certification_id) DO UPDATE SET
      status = EXCLUDED.status,
      active_toggle = EXCLUDED.active_toggle,
      earned_at = COALESCE(receptionist_badges.earned_at, EXCLUDED.earned_at)
    RETURNING id, user_id, certification_id, status, active_toggle, earned_at, created_at
  `
  const row = rows[0]
  if (!row) throw new Error("upsertReceptionistBadge: no row returned")
  return parseReceptionistBadgeRow(row as Record<string, unknown>)
}

/** Toggle whether a certified specialty is included in live routing queues. */
export async function setReceptionistBadgeActiveToggle(params: {
  userId: string
  certificationId: string
  activeToggle: boolean
}): Promise<ReceptionistBadge | null> {
  const sql = getSql()
  const rows = await sql`
    UPDATE receptionist_badges
    SET active_toggle = ${params.activeToggle}
    WHERE user_id = ${params.userId}
      AND certification_id = ${params.certificationId}
      AND status = 'certified'
    RETURNING id, user_id, certification_id, status, active_toggle, earned_at, created_at
  `
  return rows[0] ? parseReceptionistBadgeRow(rows[0] as Record<string, unknown>) : null
}

/** Append certification codes + routing skill tags onto the linked receptionist row. */
export async function appendReceptionistCertificationSkills(params: {
  portalUserId: string
  codeIdentifier: string
}): Promise<void> {
  const sql = getSql()
  const code = normalizeRoutingPoolSkillTag(params.codeIdentifier)
  const routingTag = routingSkillTagFromCertCode(code)
  const tags = [...new Set([code, routingTag].filter(Boolean))]
  try {
    await sql`
      UPDATE receptionists
      SET skills = (
        SELECT coalesce(array_agg(DISTINCT slug), '{}'::text[])
        FROM unnest(coalesce(receptionists.skills, '{}'::text[]) || ${tags}::text[]) AS slug
        WHERE slug <> ''
      )
      WHERE portal_user_id = ${params.portalUserId}
    `
  } catch (e) {
    if (isMissingReceptionistSkillsColumnError(e) || isMissingPortalUserColumnError(e)) return
    throw e
  }
}

// ============================================================================
// 10DLC SMS compliance registration (scripts/047-messaging-10dlc.sql)
// ============================================================================

function isMissing10DlcTableError(e: unknown): boolean {
  // 42P01 = undefined_table (migration 047 not run yet).
  return pgErrorCode(e) === "42P01" && pgErrorMessage(e).includes("messaging_10dlc_registrations")
}

function isMissing10DlcOrgColumnError(e: unknown): boolean {
  return pgErrorCode(e) === "42703"
}

function parse10DlcRow(row: Record<string, unknown>): Messaging10DlcRegistration {
  const str = (v: unknown): string | null => (v == null ? null : String(v))
  return {
    id: row.id != null ? String(row.id) : undefined,
    organization_id: row.organization_id != null ? String(row.organization_id) : null,
    user_id: String(row.user_id),
    entity_type: (str(row.entity_type) as Messaging10DlcRegistration["entity_type"]) ?? null,
    legal_company_name: str(row.legal_company_name),
    display_name: str(row.display_name),
    ein: str(row.ein),
    vertical: str(row.vertical),
    website: str(row.website),
    contact_first_name: str(row.contact_first_name),
    contact_last_name: str(row.contact_last_name),
    email: str(row.email),
    phone: str(row.phone),
    street: str(row.street),
    city: str(row.city),
    state: str(row.state),
    postal_code: str(row.postal_code),
    country: str(row.country),
    use_case: str(row.use_case),
    campaign_description: str(row.campaign_description),
    sample_message_1: str(row.sample_message_1),
    sample_message_2: str(row.sample_message_2),
    message_flow: str(row.message_flow),
    brand_id: str(row.brand_id),
    campaign_id: str(row.campaign_id),
    assigned_number: str(row.assigned_number),
    status: (str(row.status) as TenDlcStatus) ?? "draft",
    status_detail: str(row.status_detail),
    fee_cents: Number(row.fee_cents ?? 0),
    fee_paid: row.fee_paid === true,
    stripe_session_id: str(row.stripe_session_id),
    created_at: row.created_at ? String(row.created_at) : new Date().toISOString(),
    updated_at: row.updated_at ? String(row.updated_at) : new Date().toISOString(),
  }
}

/** Load a workspace's 10DLC registration (null when none / table missing). */
export async function getMessaging10DlcRegistration(
  userId: string,
  organizationId?: string | null
): Promise<Messaging10DlcRegistration | null> {
  const sql = getSql()
  const orgUuid =
    organizationId && !organizationId.startsWith("legacy-") ? organizationId : null
  try {
    if (orgUuid) {
      const rows = await sql`
        SELECT * FROM messaging_10dlc_registrations
        WHERE user_id = ${userId} AND organization_id = ${orgUuid}
        LIMIT 1
      `
      if (rows[0]) return parse10DlcRow(rows[0] as Record<string, unknown>)
      return null
    }
    const rows = await sql`
      SELECT * FROM messaging_10dlc_registrations WHERE user_id = ${userId} LIMIT 1
    `
    return rows[0] ? parse10DlcRow(rows[0] as Record<string, unknown>) : null
  } catch (e) {
    if (isMissing10DlcTableError(e)) return null
    if (orgUuid && isMissing10DlcOrgColumnError(e)) {
      const rows = await sql`
        SELECT * FROM messaging_10dlc_registrations WHERE user_id = ${userId} LIMIT 1
      `
      return rows[0] ? parse10DlcRow(rows[0] as Record<string, unknown>) : null
    }
    throw e
  }
}

function build10DlcUpdateFields(merged: Messaging10DlcRegistration) {
  const v = <K extends keyof Messaging10DlcRegistration>(k: K): unknown =>
    (merged as Record<string, unknown>)[k as string] ?? null
  return {
    entity_type: v("entity_type"),
    legal_company_name: v("legal_company_name"),
    display_name: v("display_name"),
    ein: v("ein"),
    vertical: v("vertical"),
    website: v("website"),
    contact_first_name: v("contact_first_name"),
    contact_last_name: v("contact_last_name"),
    email: v("email"),
    phone: v("phone"),
    street: v("street"),
    city: v("city"),
    state: v("state"),
    postal_code: v("postal_code"),
    country: v("country") ?? "US",
    use_case: v("use_case"),
    campaign_description: v("campaign_description"),
    sample_message_1: v("sample_message_1"),
    sample_message_2: v("sample_message_2"),
    message_flow: v("message_flow"),
    brand_id: v("brand_id"),
    campaign_id: v("campaign_id"),
    assigned_number: v("assigned_number"),
    status: v("status") ?? "draft",
    status_detail: v("status_detail"),
    fee_cents: Number(merged.fee_cents ?? 0),
    fee_paid: merged.fee_paid === true,
    stripe_session_id: v("stripe_session_id"),
  }
}

export type Upsert10DlcInput = Partial<
  Omit<Messaging10DlcRegistration, "user_id" | "created_at" | "updated_at">
>

/** Insert or update a workspace's 10DLC registration draft + lifecycle fields. */
export async function upsertMessaging10DlcRegistration(
  userId: string,
  input: Upsert10DlcInput,
  organizationId?: string | null
): Promise<Messaging10DlcRegistration> {
  const sql = getSql()
  const orgUuid =
    organizationId && !organizationId.startsWith("legacy-") ? organizationId : null
  const existing = await getMessaging10DlcRegistration(userId, orgUuid)
  const merged = { ...(existing ?? { user_id: userId, organization_id: orgUuid }), ...input }
  const fields = build10DlcUpdateFields(merged as Messaging10DlcRegistration)

  if (existing?.id) {
    await sql`
      UPDATE messaging_10dlc_registrations
      SET
        entity_type = ${fields.entity_type},
        legal_company_name = ${fields.legal_company_name},
        display_name = ${fields.display_name},
        ein = ${fields.ein},
        vertical = ${fields.vertical},
        website = ${fields.website},
        contact_first_name = ${fields.contact_first_name},
        contact_last_name = ${fields.contact_last_name},
        email = ${fields.email},
        phone = ${fields.phone},
        street = ${fields.street},
        city = ${fields.city},
        state = ${fields.state},
        postal_code = ${fields.postal_code},
        country = ${fields.country},
        use_case = ${fields.use_case},
        campaign_description = ${fields.campaign_description},
        sample_message_1 = ${fields.sample_message_1},
        sample_message_2 = ${fields.sample_message_2},
        message_flow = ${fields.message_flow},
        brand_id = ${fields.brand_id},
        campaign_id = ${fields.campaign_id},
        assigned_number = ${fields.assigned_number},
        status = ${fields.status},
        status_detail = ${fields.status_detail},
        fee_cents = ${fields.fee_cents},
        fee_paid = ${fields.fee_paid},
        stripe_session_id = ${fields.stripe_session_id},
        updated_at = now()
      WHERE id = ${existing.id}
    `
    const saved = await getMessaging10DlcRegistration(userId, orgUuid)
    if (!saved) throw new Error("Failed to save 10DLC registration")
    return saved
  }

  if (existing) {
    await sql`
      UPDATE messaging_10dlc_registrations
      SET
        entity_type = ${fields.entity_type},
        legal_company_name = ${fields.legal_company_name},
        display_name = ${fields.display_name},
        ein = ${fields.ein},
        vertical = ${fields.vertical},
        website = ${fields.website},
        contact_first_name = ${fields.contact_first_name},
        contact_last_name = ${fields.contact_last_name},
        email = ${fields.email},
        phone = ${fields.phone},
        street = ${fields.street},
        city = ${fields.city},
        state = ${fields.state},
        postal_code = ${fields.postal_code},
        country = ${fields.country},
        use_case = ${fields.use_case},
        campaign_description = ${fields.campaign_description},
        sample_message_1 = ${fields.sample_message_1},
        sample_message_2 = ${fields.sample_message_2},
        message_flow = ${fields.message_flow},
        brand_id = ${fields.brand_id},
        campaign_id = ${fields.campaign_id},
        assigned_number = ${fields.assigned_number},
        status = ${fields.status},
        status_detail = ${fields.status_detail},
        fee_cents = ${fields.fee_cents},
        fee_paid = ${fields.fee_paid},
        stripe_session_id = ${fields.stripe_session_id},
        updated_at = now()
      WHERE user_id = ${userId}
    `
    const saved = await getMessaging10DlcRegistration(userId, orgUuid)
    if (!saved) throw new Error("Failed to save 10DLC registration")
    return saved
  }

  const rowId = crypto.randomUUID()
  try {
    await sql`
      INSERT INTO messaging_10dlc_registrations (
        id, user_id, organization_id, entity_type, legal_company_name, display_name, ein, vertical, website,
        contact_first_name, contact_last_name, email, phone, street, city, state, postal_code, country,
        use_case, campaign_description, sample_message_1, sample_message_2, message_flow,
        brand_id, campaign_id, assigned_number, status, status_detail, fee_cents, fee_paid, stripe_session_id,
        updated_at
      ) VALUES (
        ${rowId}, ${userId}, ${orgUuid}, ${fields.entity_type}, ${fields.legal_company_name}, ${fields.display_name},
        ${fields.ein}, ${fields.vertical}, ${fields.website}, ${fields.contact_first_name}, ${fields.contact_last_name},
        ${fields.email}, ${fields.phone}, ${fields.street}, ${fields.city}, ${fields.state}, ${fields.postal_code},
        ${fields.country}, ${fields.use_case}, ${fields.campaign_description}, ${fields.sample_message_1},
        ${fields.sample_message_2}, ${fields.message_flow}, ${fields.brand_id}, ${fields.campaign_id},
        ${fields.assigned_number}, ${fields.status}, ${fields.status_detail},
        ${fields.fee_cents}, ${fields.fee_paid}, ${fields.stripe_session_id}, now()
      )
    `
  } catch (e) {
    if (!isMissing10DlcOrgColumnError(e) && !isMissing10DlcTableError(e)) throw e
    await sql`
      INSERT INTO messaging_10dlc_registrations (
        user_id, entity_type, legal_company_name, display_name, ein, vertical, website,
        contact_first_name, contact_last_name, email, phone, street, city, state, postal_code, country,
        use_case, campaign_description, sample_message_1, sample_message_2, message_flow,
        brand_id, campaign_id, assigned_number, status, status_detail, fee_cents, fee_paid, stripe_session_id,
        updated_at
      ) VALUES (
        ${userId}, ${fields.entity_type}, ${fields.legal_company_name}, ${fields.display_name}, ${fields.ein},
        ${fields.vertical}, ${fields.website}, ${fields.contact_first_name}, ${fields.contact_last_name},
        ${fields.email}, ${fields.phone}, ${fields.street}, ${fields.city}, ${fields.state}, ${fields.postal_code},
        ${fields.country}, ${fields.use_case}, ${fields.campaign_description}, ${fields.sample_message_1},
        ${fields.sample_message_2}, ${fields.message_flow}, ${fields.brand_id}, ${fields.campaign_id},
        ${fields.assigned_number}, ${fields.status}, ${fields.status_detail},
        ${fields.fee_cents}, ${fields.fee_paid}, ${fields.stripe_session_id}, now()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        entity_type = EXCLUDED.entity_type,
        legal_company_name = EXCLUDED.legal_company_name,
        display_name = EXCLUDED.display_name,
        ein = EXCLUDED.ein,
        vertical = EXCLUDED.vertical,
        website = EXCLUDED.website,
        contact_first_name = EXCLUDED.contact_first_name,
        contact_last_name = EXCLUDED.contact_last_name,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        street = EXCLUDED.street,
        city = EXCLUDED.city,
        state = EXCLUDED.state,
        postal_code = EXCLUDED.postal_code,
        country = EXCLUDED.country,
        use_case = EXCLUDED.use_case,
        campaign_description = EXCLUDED.campaign_description,
        sample_message_1 = EXCLUDED.sample_message_1,
        sample_message_2 = EXCLUDED.sample_message_2,
        message_flow = EXCLUDED.message_flow,
        brand_id = EXCLUDED.brand_id,
        campaign_id = EXCLUDED.campaign_id,
        assigned_number = EXCLUDED.assigned_number,
        status = EXCLUDED.status,
        status_detail = EXCLUDED.status_detail,
        fee_cents = EXCLUDED.fee_cents,
        fee_paid = EXCLUDED.fee_paid,
        stripe_session_id = EXCLUDED.stripe_session_id,
        updated_at = now()
    `
  }

  const saved = await getMessaging10DlcRegistration(userId, orgUuid)
  if (!saved) throw new Error("Failed to save 10DLC registration")
  return saved
}

