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

function normalizeRegistryStatus(raw: string): TenDlcRegistryStatus["normalized"] {
  const s = raw.toUpperCase()
  if (["ACTIVE", "APPROVED", "REGISTERED", "VERIFIED", "VETTED_VERIFIED", "SELF_DECLARED"].includes(s))
    return "approved"
  if (["FAILED", "REJECTED", "EXPIRED", "SUSPENDED", "DECLINED", "UNVERIFIED"].includes(s)) return "rejected"
  if (["PENDING", "REVIEW", "IN_PROGRESS", "SUBMITTED", "REGISTRATION_PENDING"].includes(s))
    return "pending_review"
  return "unknown"
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
  const raw = String(data.status ?? "UNKNOWN")
  return { raw, normalized: normalizeRegistryStatus(raw), detail: null }
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
