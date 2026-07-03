// Telnyx 10DLC (A2P SMS) brand + campaign registration on behalf of each business.
// lyncr acts as the platform: it submits the business's brand/campaign to The Campaign
// Registry through Telnyx using lyncr's TELNYX_API_KEY. Businesses never touch Telnyx.
//
// Docs: https://developers.telnyx.com/docs/messaging/10dlc

import { getTelnyxApiKey, telnyxHeaders, findTelnyxPhoneNumberId } from "@/lib/telnyx-config"
import type { TenDlcEntityType } from "@/lib/types"

const TELNYX_BASE = "https://api.telnyx.com/v2"

/** Use-case options surfaced to businesses during onboarding. */
export type TenDlcUseCaseKey = "SOLE_PROPRIETOR" | "LOW_VOLUME"

export type TenDlcUseCaseMeta = {
  key: TenDlcUseCaseKey
  label: string
  description: string
  /** TCR entity type implied by this use case. */
  entityType: TenDlcEntityType
  requiresEin: boolean
  /** Fallback fee in USD cents if the live Telnyx cost lookup fails. */
  fallbackFeeCents: number
}

/** Curated use cases that fit small-business lead alerts. */
export const TEN_DLC_USE_CASES: Record<TenDlcUseCaseKey, TenDlcUseCaseMeta> = {
  SOLE_PROPRIETOR: {
    key: "SOLE_PROPRIETOR",
    label: "Sole proprietor (no EIN / Tax ID)",
    description:
      "For solo operators and individuals without a registered business / Tax ID. Lower throughput, cheapest path.",
    entityType: "SOLE_PROPRIETOR",
    requiresEin: false,
    // $4 brand + ~$2/mo campaign (3 mo upfront) ≈ $10
    fallbackFeeCents: 1000,
  },
  LOW_VOLUME: {
    key: "LOW_VOLUME",
    label: "Registered business (EIN) — low volume",
    description:
      "For LLCs / registered businesses with a Tax ID (EIN) that send a low volume of texts. Higher delivery throughput.",
    entityType: "PRIVATE_PROFIT",
    requiresEin: true,
    // $4 brand + ~$10/mo campaign (3 mo upfront) ≈ $34
    fallbackFeeCents: 3400,
  },
}

/** $4 one-time TCR brand registration fee (non-refundable). */
export const TEN_DLC_BRAND_FEE_CENTS = 400

export function tenDlcUseCaseMeta(useCase: string | null | undefined): TenDlcUseCaseMeta | null {
  if (!useCase) return null
  return TEN_DLC_USE_CASES[useCase as TenDlcUseCaseKey] ?? null
}

function telnyxErrorDetail(body: unknown, fallback: string): string {
  const errors = (body as { errors?: { detail?: string; title?: string }[] })?.errors
  return errors?.[0]?.detail || errors?.[0]?.title || fallback
}

/** Turn Telnyx registry fields (string, array, or nested object) into readable text — never "[object Object]". */
export function formatTelnyxRegistryText(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed || trimmed === "[object Object]") return null
    return trimmed
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => formatTelnyxRegistryText(item))
      .filter((part): part is string => Boolean(part?.trim()))
    return parts.length > 0 ? parts.join("; ") : null
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>
    for (const key of ["detail", "message", "reason", "description", "title", "failureReasons"]) {
      const part = formatTelnyxRegistryText(record[key])
      if (part) return part
    }
    try {
      const json = JSON.stringify(value)
      if (json && json !== "{}" && json !== "[]") return json
    } catch {
      /* ignore circular refs */
    }
  }
  return null
}

export type CreateBrandInput = {
  entityType: TenDlcEntityType
  displayName: string
  legalCompanyName?: string | null
  ein?: string | null
  vertical: string
  website?: string | null
  firstName?: string | null
  lastName?: string | null
  email: string
  phone?: string | null
  street?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  country?: string | null
}

export type Telnyx10DlcResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string }

/** POST /10dlc/brand — register the business identity with TCR ($4). Returns brandId. */
export async function createTelnyx10DlcBrand(
  input: CreateBrandInput
): Promise<Telnyx10DlcResult<{ brandId: string }>> {
  try {
    getTelnyxApiKey()
  } catch {
    return { ok: false, error: "TELNYX_API_KEY is not configured on the server." }
  }

  const body: Record<string, unknown> = {
    entityType: input.entityType,
    displayName: input.displayName,
    vertical: input.vertical,
    email: input.email,
    country: input.country?.trim() || "US",
  }
  if (input.legalCompanyName) body.companyName = input.legalCompanyName
  if (input.ein) body.ein = input.ein.replace(/\D/g, "")
  if (input.website) body.website = input.website
  if (input.firstName) body.firstName = input.firstName
  if (input.lastName) body.lastName = input.lastName
  if (input.phone) body.phone = input.phone
  if (input.street) body.street = input.street
  if (input.city) body.city = input.city
  if (input.state) body.state = input.state
  if (input.postalCode) body.postalCode = input.postalCode

  const res = await fetch(`${TELNYX_BASE}/10dlc/brand`, {
    method: "POST",
    headers: telnyxHeaders(),
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    return { ok: false, error: telnyxErrorDetail(json, "Telnyx rejected the brand registration.") }
  }
  const brandId =
    (json as { brandId?: string; data?: { brandId?: string } }).brandId ??
    (json as { data?: { brandId?: string } }).data?.brandId
  if (!brandId) {
    return { ok: false, error: "Telnyx accepted the brand but returned no brandId." }
  }
  return { ok: true, brandId: String(brandId) }
}

export type CreateCampaignInput = {
  brandId: string
  useCase: TenDlcUseCaseKey
  description: string
  sample1: string
  sample2?: string | null
  messageFlow: string
  /** Shown in opt-out auto-replies (required when subscriberOptout is true). */
  businessName?: string | null
  helpMessage?: string
  optinKeywords?: string
  optinMessage?: string
  optoutKeywords?: string
  optoutMessage?: string
  helpKeywords?: string
}

/** TCR-required auto-reply when a subscriber texts STOP. */
export function buildTenDlcOptoutMessage(businessName: string): string {
  const biz = businessName.trim() || "this business"
  return `You have been unsubscribed from ${biz} messages. No more messages will be sent. Reply START to resubscribe.`
}

/** TCR-required auto-reply when a subscriber texts START/YES. */
export function buildTenDlcOptinMessage(businessName: string): string {
  const biz = businessName.trim() || "this business"
  return `You are subscribed to ${biz} service notifications. Reply STOP to opt out, HELP for help. Msg&data rates may apply.`
}

/** Telnyx requires comma-separated keywords with no spaces (e.g. STOP,UNSUBSCRIBE). */
export function normalizeTenDlcKeywords(raw: string): string {
  return raw
    .split(",")
    .map((k) => k.trim().replace(/\s+/g, ""))
    .filter(Boolean)
    .join(",")
}

/** TCR requires at least one sub-usecase when the primary use case is LOW_VOLUME. */
export const LOW_VOLUME_SUB_USECASES = ["ACCOUNT_NOTIFICATION"] as const

/** POST /10dlc/campaignBuilder — submit the campaign to TCR. Returns campaignId. */
export async function createTelnyx10DlcCampaign(
  input: CreateCampaignInput
): Promise<Telnyx10DlcResult<{ campaignId: string }>> {
  try {
    getTelnyxApiKey()
  } catch {
    return { ok: false, error: "TELNYX_API_KEY is not configured on the server." }
  }

  const biz = input.businessName?.trim() || "this business"
  const helpMessage =
    input.helpMessage ||
    `${biz} support: Reply HELP for help or STOP to unsubscribe. Msg&data rates may apply.`
  const optinMessage = input.optinMessage || buildTenDlcOptinMessage(biz)
  const optoutMessage = input.optoutMessage || buildTenDlcOptoutMessage(biz)

  const body: Record<string, unknown> = {
    brandId: input.brandId,
    usecase: input.useCase,
    description: input.description,
    sample1: input.sample1,
    messageFlow: input.messageFlow,
    helpMessage,
    optinKeywords: normalizeTenDlcKeywords(input.optinKeywords || "START,YES"),
    optinMessage,
    optoutKeywords: normalizeTenDlcKeywords(input.optoutKeywords || "STOP,UNSUBSCRIBE,CANCEL"),
    optoutMessage,
    helpKeywords: normalizeTenDlcKeywords(input.helpKeywords || "HELP"),
    subscriberOptin: true,
    subscriberOptout: true,
    subscriberHelp: true,
    embeddedLink: true,
    embeddedPhone: true,
  }
  if (input.sample2) body.sample2 = input.sample2
  if (input.useCase === "LOW_VOLUME") {
    body.subUsecases = [...LOW_VOLUME_SUB_USECASES]
  }

  const res = await fetch(`${TELNYX_BASE}/10dlc/campaignBuilder`, {
    method: "POST",
    headers: telnyxHeaders(),
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    return { ok: false, error: telnyxErrorDetail(json, "Telnyx rejected the campaign registration.") }
  }
  const campaignId =
    (json as { campaignId?: string; data?: { campaignId?: string } }).campaignId ??
    (json as { data?: { campaignId?: string } }).data?.campaignId
  if (!campaignId) {
    return { ok: false, error: "Telnyx accepted the campaign but returned no campaignId." }
  }
  return { ok: true, campaignId: String(campaignId) }
}

export type TenDlcRegistryStatus = {
  raw: string
  normalized: "approved" | "pending_review" | "rejected" | "unknown"
  detail: string | null
}

/** Map Telnyx/TCR registry status strings to a coarse lifecycle bucket. */
export function normalizeTelnyxRegistryStatus(raw: string): TenDlcRegistryStatus["normalized"] {
  const s = raw.toUpperCase().trim()
  if (!s || s === "UNKNOWN") return "unknown"

  if (
    [
      "ACTIVE",
      "APPROVED",
      "REGISTERED",
      "VERIFIED",
      "VETTED_VERIFIED",
      "SELF_DECLARED",
      "MNO_PROVISIONED",
    ].includes(s)
  ) {
    return "approved"
  }

  if (s.includes("FAILED") || s.includes("REJECTED") || s.includes("SUSPENDED") || s === "EXPIRED" || s === "TCR_EXPIRED") {
    return "rejected"
  }
  if (["DECLINED", "UNVERIFIED", "ERROR"].includes(s)) return "rejected"

  if (
    s.includes("PENDING") ||
    s.includes("REVIEW") ||
    s.includes("ACCEPTED") ||
    s.includes("IN_PROGRESS") ||
    s.includes("SUBMITTED") ||
    s === "CREATED" ||
    s === "REGISTRATION_PENDING"
  ) {
    return "pending_review"
  }

  return "unknown"
}

function normalizeRegistryStatus(raw: string): TenDlcRegistryStatus["normalized"] {
  return normalizeTelnyxRegistryStatus(raw)
}

function pickCampaignRegistryFields(data: Record<string, unknown>): { raw: string; detail: string | null } {
  const campaignStatus = String(data.campaignStatus ?? data.tcrCampaignStatus ?? "").trim()
  const submissionStatus = String(data.submissionStatus ?? "").trim()
  const legacyStatus = String(data.status ?? "").trim()
  const failureReasons = formatTelnyxRegistryText(data.failureReasons)

  let raw = campaignStatus
  if (!raw && submissionStatus === "FAILED") raw = "FAILED"
  if (!raw) raw = legacyStatus || "UNKNOWN"

  const failed =
    campaignStatus.includes("FAILED") ||
    campaignStatus.includes("REJECTED") ||
    normalizeTelnyxRegistryStatus(campaignStatus || raw) === "rejected"

  const detail =
    failureReasons ||
    (failed ? "Campaign creation failed." : null)

  return { raw: campaignStatus || raw, detail: detail || null }
}

/** True when a Telnyx/TCR status string means the registration was rejected. */
export function isTelnyxRegistryRejected(raw: string | null | undefined): boolean {
  const text = String(raw ?? "").trim()
  if (!text) return false
  return normalizeTelnyxRegistryStatus(text) === "rejected"
}

/**
 * Campaign id stored in our DB — ignores rows where brand_id was accidentally saved as campaign_id.
 */
export function effectiveTelnyx10DlcCampaignId(reg: {
  brand_id?: string | null
  campaign_id?: string | null
}): string | null {
  const brandId = reg.brand_id?.trim() || null
  const campaignId = reg.campaign_id?.trim() || null
  if (!campaignId) return null
  if (brandId && campaignId === brandId) return null
  return campaignId
}

export type Telnyx10DlcCampaignRegistryRow = {
  campaignId: string
  raw: string
  normalized: TenDlcRegistryStatus["normalized"]
  detail: string | null
}

/** GET /10dlc/campaign?brandId= — list campaigns so we can read TCR_FAILED even without a stored campaign id. */
export async function listTelnyx10DlcCampaignsForBrand(
  brandId: string
): Promise<Telnyx10DlcCampaignRegistryRow[]> {
  try {
    getTelnyxApiKey()
  } catch {
    return []
  }
  const url = `${TELNYX_BASE}/10dlc/campaign?brandId=${encodeURIComponent(brandId)}&recordsPerPage=50`
  const res = await fetch(url, { headers: telnyxHeaders() })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) return []

  const records = (
    (json as { records?: Record<string, unknown>[] }).records ??
    (json as { data?: Record<string, unknown>[] }).data ??
    []
  ) as Record<string, unknown>[]

  return records
    .map((record) => {
      const campaignId = String(record.campaignId ?? "").trim()
      if (!campaignId) return null
      const picked = pickCampaignRegistryFields(record)
      return {
        campaignId,
        raw: picked.raw,
        normalized: normalizeRegistryStatus(picked.raw),
        detail: picked.detail,
      }
    })
    .filter((row): row is Telnyx10DlcCampaignRegistryRow => row != null)
}

const REGISTRY_STATUS_RANK: Record<TenDlcRegistryStatus["normalized"], number> = {
  rejected: 4,
  pending_review: 3,
  approved: 2,
  unknown: 1,
}

function pickStrongerRegistryStatus(
  current: TenDlcRegistryStatus | null,
  next: TenDlcRegistryStatus
): TenDlcRegistryStatus {
  if (!current) return next
  const currentRank = REGISTRY_STATUS_RANK[current.normalized] ?? 0
  const nextRank = REGISTRY_STATUS_RANK[next.normalized] ?? 0
  return nextRank >= currentRank ? next : current
}

export type PolledTelnyx10DlcRegistryStatus = TenDlcRegistryStatus & {
  /** Real campaign id discovered from Telnyx (may differ from what we stored). */
  resolvedCampaignId: string | null
}

/** Poll campaign + brand list at Telnyx and return the strongest lifecycle signal. */
export async function pollTelnyx10DlcRegistryStatus(reg: {
  brand_id?: string | null
  campaign_id?: string | null
}): Promise<PolledTelnyx10DlcRegistryStatus | null> {
  const brandId = reg.brand_id?.trim() || null
  const storedCampaignId = effectiveTelnyx10DlcCampaignId(reg)

  let best: TenDlcRegistryStatus | null = null
  let resolvedCampaignId: string | null = storedCampaignId

  if (storedCampaignId) {
    const campaign = await getTelnyx10DlcCampaignStatus(storedCampaignId)
    if (campaign && campaign.normalized !== "unknown") {
      best = pickStrongerRegistryStatus(best, campaign)
    }
  }

  if (brandId) {
    const listed = await listTelnyx10DlcCampaignsForBrand(brandId)
    for (const row of listed) {
      const status: TenDlcRegistryStatus = { raw: row.raw, normalized: row.normalized, detail: row.detail }
      best = pickStrongerRegistryStatus(best, status)
      if (row.normalized === "rejected" || !resolvedCampaignId) {
        resolvedCampaignId = row.campaignId
      }
    }

    if (!best || best.normalized === "pending_review" || best.normalized === "unknown") {
      const brand = await getTelnyx10DlcBrandStatus(brandId)
      if (brand && brand.normalized !== "unknown") {
        best = pickStrongerRegistryStatus(best, brand)
      }
    }
  }

  if (!best) return null
  return { ...best, resolvedCampaignId }
}

/** True when Telnyx rejected campaign creation because the brand is not ready yet. */
export function isTelnyxBrandNotReadyForCampaignError(message: string): boolean {
  const blob = message.toLowerCase()
  return (
    blob.includes("pending or failed status") ||
    blob.includes("brand in pending") ||
    blob.includes("brand is not verified") ||
    blob.includes("brand not verified")
  )
}

/** Failed campaign submit with an existing brand — safe to retry campaign without new brand. */
export function isTelnyxCampaignOnlyFailure(detail: string | null | undefined): boolean {
  const text = String(detail ?? "").trim()
  if (!text) return false
  const blob = text.toLowerCase()
  if (!blob.includes("campaign registration failed")) return false
  if (blob.includes("brand registration failed") || blob.includes("brand verification failed")) return false
  return !isTelnyxBrandNotReadyForCampaignError(text)
}

/** GET /10dlc/brand/{id} — current TCR identity verification status. */
export async function getTelnyx10DlcBrandStatus(brandId: string): Promise<TenDlcRegistryStatus | null> {
  try {
    getTelnyxApiKey()
  } catch {
    return null
  }
  const res = await fetch(`${TELNYX_BASE}/10dlc/brand/${encodeURIComponent(brandId)}`, {
    headers: telnyxHeaders(),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    return { raw: "ERROR", normalized: "unknown", detail: telnyxErrorDetail(json, "Brand status lookup failed.") }
  }
  const data = (json as { data?: Record<string, unknown> }).data ?? (json as Record<string, unknown>)
  const raw = String(data.identityStatus ?? data.status ?? "UNKNOWN")
  return { raw, normalized: normalizeRegistryStatus(raw), detail: null }
}

/** GET /10dlc/campaign/{id} — current registry status of a campaign. */
export async function getTelnyx10DlcCampaignStatus(
  campaignId: string
): Promise<TenDlcRegistryStatus | null> {
  try {
    getTelnyxApiKey()
  } catch {
    return null
  }
  const res = await fetch(`${TELNYX_BASE}/10dlc/campaign/${encodeURIComponent(campaignId)}`, {
    headers: telnyxHeaders(),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    return { raw: "ERROR", normalized: "unknown", detail: telnyxErrorDetail(json, "Status lookup failed.") }
  }
  const data = (json as { data?: Record<string, unknown> }).data ?? (json as Record<string, unknown>)
  const picked = pickCampaignRegistryFields(data)
  return {
    raw: picked.raw,
    normalized: normalizeRegistryStatus(picked.raw),
    detail: picked.detail,
  }
}

/**
 * Assign a phone number to an approved campaign so it can send A2P SMS.
 * POST /10dlc/phoneNumberCampaign { phoneNumber, campaignId }.
 */
export async function assignNumberToTelnyx10DlcCampaign(
  e164: string,
  campaignId: string
): Promise<Telnyx10DlcResult<Record<string, never>>> {
  try {
    getTelnyxApiKey()
  } catch {
    return { ok: false, error: "TELNYX_API_KEY is not configured on the server." }
  }
  const res = await fetch(`${TELNYX_BASE}/10dlc/phoneNumberCampaign`, {
    method: "POST",
    headers: telnyxHeaders(),
    body: JSON.stringify({ phoneNumber: e164.trim(), campaignId }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    return { ok: false, error: telnyxErrorDetail(json, "Could not assign the number to the campaign.") }
  }
  return { ok: true }
}

/** GET /10dlc/campaign/usecase/cost — live upfront cost (cents) for a use case, brand fee added. */
export async function getTelnyx10DlcRegistrationFeeCents(useCase: TenDlcUseCaseKey): Promise<number> {
  const meta = TEN_DLC_USE_CASES[useCase]
  try {
    getTelnyxApiKey()
    const res = await fetch(
      `${TELNYX_BASE}/10dlc/campaign/usecase/cost?usecase=${encodeURIComponent(useCase)}`,
      { headers: telnyxHeaders() }
    )
    const json = await res.json().catch(() => ({}))
    if (res.ok) {
      const data = (json as { data?: Record<string, unknown> }).data ?? (json as Record<string, unknown>)
      const upFront = Number(data.upFrontCost ?? data.monthlyCost ?? NaN)
      if (Number.isFinite(upFront) && upFront > 0) {
        return Math.round(upFront * 100) + TEN_DLC_BRAND_FEE_CENTS
      }
    }
  } catch {
    // fall through to fallback
  }
  return meta.fallbackFeeCents
}

export { findTelnyxPhoneNumberId }
