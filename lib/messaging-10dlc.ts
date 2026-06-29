// Orchestration for in-app 10DLC registration: draft → pass-through payment →
// Telnyx brand + campaign submission → status polling → number assignment.

import {
  getMessaging10DlcRegistration,
  upsertMessaging10DlcRegistration,
  getUser,
  setOrganizationSmsRegistrationStatus,
  getSmsRegistrationForOwner,
  upsertSmsRegistration,
  normalizePhoneNumberE164,
} from "@/lib/db"
import { resolveActiveLineFor10DlcAssignment } from "@/lib/primary-business-line"
import {
  TEN_DLC_USE_CASES,
  tenDlcUseCaseMeta,
  createTelnyx10DlcBrand,
  createTelnyx10DlcCampaign,
  getTelnyx10DlcBrandStatus,
  getTelnyx10DlcCampaignStatus,
  assignNumberToTelnyx10DlcCampaign,
  getTelnyx10DlcRegistrationFeeCents,
  isTelnyxBrandNotReadyForCampaignError,
  isTelnyxCampaignOnlyFailure,
  type TenDlcUseCaseKey,
} from "@/lib/telnyx-10dlc"
import { getStripeClient } from "@/lib/stripe-config"
import { getAppUrl } from "@/lib/telnyx"
import { formatUsdFromCents } from "@/lib/billing-pricing"
import type { Messaging10DlcRegistration } from "@/lib/types"

/** Business verticals offered in the form (TCR-accepted subset). */
export const TEN_DLC_VERTICALS: { value: string; label: string }[] = [
  { value: "REAL_ESTATE", label: "Real estate" },
  { value: "PROFESSIONAL", label: "Professional services" },
  { value: "CONSTRUCTION", label: "Construction / trades" },
  { value: "AUTOMOTIVE", label: "Automotive" },
  { value: "RETAIL", label: "Retail" },
  { value: "HEALTHCARE", label: "Healthcare" },
  { value: "TECHNOLOGY", label: "Technology" },
  { value: "TRANSPORTATION", label: "Transportation / logistics" },
  { value: "HOSPITALITY", label: "Hospitality" },
  { value: "AGRICULTURE", label: "Agriculture" },
  { value: "INSURANCE", label: "Insurance" },
  { value: "FINANCIAL", label: "Financial services" },
  { value: "EDUCATION", label: "Education" },
  { value: "NONPROFIT", label: "Non-profit" },
  { value: "ENERGY", label: "Energy / utilities" },
]

export type TenDlcDraftInput = {
  use_case: string
  display_name: string
  legal_company_name?: string
  ein?: string
  vertical: string
  website?: string
  contact_first_name?: string
  contact_last_name?: string
  email: string
  phone?: string
  street?: string
  city?: string
  state?: string
  postal_code?: string
  country?: string
  campaign_description?: string
  sample_message_1?: string
  sample_message_2?: string
  message_flow?: string
}

export type TenDlcActionResult =
  | { ok: true; registration: Messaging10DlcRegistration }
  | { ok: false; error: string }

export function defaultCampaignCopy(displayName: string): {
  description: string
  sample1: string
  sample2: string
  messageFlow: string
} {
  const biz = displayName.trim() || "our business"
  return {
    description: `${biz} sends transactional notifications and lead/appointment alerts to the business owner and staff who requested them.`,
    sample1: `${biz}: New lead — John D. (555-123-4567) requested a callback about service. Reply STOP to opt out.`,
    sample2: `${biz}: Reminder — your appointment is confirmed for 2:00 PM today. Reply HELP for help, STOP to unsubscribe.`,
    messageFlow: `Recipients (the business owner and staff) opt in when they create their ${biz} account and provide their mobile number to receive lead and appointment notifications. They can reply STOP at any time to unsubscribe.`,
  }
}

const SUBMITTED_TO_CARRIER_STATUSES = new Set(["paid", "submitted", "pending_review"])

const BRAND_WAIT_DETAIL =
  "Brand submitted to US carriers. Campaign registration will complete automatically once your brand is verified (usually 1–3 business days)."

async function saveBrandAwaitingVerification(
  userId: string,
  organizationId: string | null | undefined,
  brandId: string,
  detail?: string
) {
  return upsert10(userId, organizationId, {
    brand_id: brandId,
    status: "pending_review",
    status_detail: detail?.trim() || BRAND_WAIT_DETAIL,
  })
}

/** Rows marked failed because campaign ran before brand verification — restore to pending review. */
async function repairMisclassified10DlcFailure(
  userId: string,
  reg: Messaging10DlcRegistration
): Promise<Messaging10DlcRegistration> {
  if (
    reg.status === "failed" &&
    reg.status_detail &&
    isTelnyxBrandNotReadyForCampaignError(reg.status_detail) &&
    reg.brand_id
  ) {
    return upsert10(userId, reg.organization_id, {
      status: "pending_review",
      status_detail: BRAND_WAIT_DETAIL,
    })
  }
  return reg
}

async function upsert10(
  userId: string,
  organizationId: string | null | undefined,
  fields: Parameters<typeof upsertMessaging10DlcRegistration>[1]
): Promise<Messaging10DlcRegistration> {
  return upsertMessaging10DlcRegistration(userId, fields, organizationId ?? undefined)
}

async function activeLineFor10Dlc(
  userId: string,
  organizationId?: string | null
): Promise<string | null> {
  return resolveActiveLineFor10DlcAssignment(userId, organizationId)
}

/** Keep dashboard sms_registrations + org flag aligned when Telnyx rejects a campaign. */
async function markWorkspaceSmsRegistrationRejected(
  ownerUserId: string,
  organizationId: string
): Promise<void> {
  await setOrganizationSmsRegistrationStatus(organizationId, ownerUserId, "REJECTED").catch(() => {})
  const smsReg = await getSmsRegistrationForOwner(ownerUserId, organizationId)
  if (!smsReg) return
  await upsertSmsRegistration({
    owner_user_id: ownerUserId,
    organization_id: organizationId,
    legal_business_name: smsReg.legal_business_name,
    entity_type: smsReg.entity_type,
    tax_id_ein: smsReg.tax_id_ein,
    street: smsReg.street,
    city: smsReg.city,
    state: smsReg.state,
    postal_code: smsReg.postal_code,
    use_case_description: smsReg.use_case_description,
    status: "REJECTED",
  }).catch((e) => {
    console.warn("[10dlc] sms_registrations reject sync failed:", e)
  })
}

/** Backfill dashboard submissions that never reached the carrier API (no campaign_id). */
export async function ensureMessaging10DlcSubmittedToCarrier(
  userId: string,
  organizationId?: string | null
): Promise<TenDlcActionResult | null> {
  let reg = await getMessaging10DlcRegistration(userId, organizationId)
  if (!reg) return null
  reg = await repairMisclassified10DlcFailure(userId, reg)
  const orgId = organizationId ?? reg.organization_id ?? null
  if (reg.campaign_id?.trim()) return { ok: true, registration: reg }
  if (isTelnyxCampaignOnlyFailure(reg.status_detail)) {
    return submitMessaging10DlcToTelnyx(userId, orgId)
  }
  if (!SUBMITTED_TO_CARRIER_STATUSES.has(reg.status ?? "")) return { ok: true, registration: reg }
  return submitMessaging10DlcToTelnyx(userId, orgId)
}

/** Validate + save the draft and compute the pass-through fee. Status → pending_payment. */
export async function saveMessaging10DlcDraft(
  userId: string,
  input: TenDlcDraftInput
): Promise<TenDlcActionResult> {
  const meta = tenDlcUseCaseMeta(input.use_case)
  if (!meta) return { ok: false, error: "Choose a valid registration type." }

  const displayName = input.display_name?.trim()
  if (!displayName) return { ok: false, error: "Business display name is required." }
  if (!input.email?.trim()) return { ok: false, error: "A contact email is required." }
  if (!input.vertical?.trim()) return { ok: false, error: "Choose a business vertical." }

  if (meta.requiresEin) {
    const ein = (input.ein ?? "").replace(/\D/g, "")
    if (ein.length !== 9) {
      return { ok: false, error: "A 9-digit EIN / Tax ID is required for a registered business." }
    }
    if (!input.legal_company_name?.trim()) {
      return { ok: false, error: "Legal company name is required for a registered business." }
    }
  }

  const fee = await getTelnyx10DlcRegistrationFeeCents(meta.key)
  const copy = defaultCampaignCopy(displayName)

  const registration = await upsertMessaging10DlcRegistration(userId, {
    use_case: meta.key,
    entity_type: meta.entityType,
    display_name: displayName,
    legal_company_name: input.legal_company_name?.trim() || null,
    ein: meta.requiresEin ? (input.ein ?? "").replace(/\D/g, "") : null,
    vertical: input.vertical.trim(),
    website: input.website?.trim() || null,
    contact_first_name: input.contact_first_name?.trim() || null,
    contact_last_name: input.contact_last_name?.trim() || null,
    email: input.email.trim(),
    phone: input.phone?.trim() || null,
    street: input.street?.trim() || null,
    city: input.city?.trim() || null,
    state: input.state?.trim() || null,
    postal_code: input.postal_code?.trim() || null,
    country: input.country?.trim() || "US",
    campaign_description: input.campaign_description?.trim() || copy.description,
    sample_message_1: input.sample_message_1?.trim() || copy.sample1,
    sample_message_2: input.sample_message_2?.trim() || copy.sample2,
    message_flow: input.message_flow?.trim() || copy.messageFlow,
    fee_cents: fee,
    fee_paid: false,
    status: "pending_payment",
    status_detail: null,
  })
  return { ok: true, registration }
}

/** Create a one-time Stripe Checkout for the pass-through 10DLC fee. */
export async function createMessaging10DlcCheckout(
  userId: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const reg = await getMessaging10DlcRegistration(userId)
  if (!reg) return { ok: false, error: "Fill out the registration form first." }
  if (reg.fee_paid && reg.status !== "rejected") {
    return { ok: false, error: "This registration fee has already been paid." }
  }
  const meta = tenDlcUseCaseMeta(reg.use_case)
  if (!meta) return { ok: false, error: "Re-select your registration type." }

  const cents = reg.fee_cents > 0 ? reg.fee_cents : meta.fallbackFeeCents
  const user = await getUser(userId)
  const appUrl = getAppUrl().replace(/\/$/, "")
  const stripe = getStripeClient()

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    client_reference_id: userId,
    customer_email: user?.email?.trim() || reg.email?.trim() || undefined,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: cents,
          product_data: {
            name: `10DLC SMS registration — ${meta.label}`,
            description:
              "One-time carrier registration (brand + campaign) so your business can send SMS lead alerts. Non-refundable.",
          },
        },
      },
    ],
    metadata: {
      checkout_type: "tendlc_registration",
      user_id: userId,
    },
    success_url: `${appUrl}/dashboard/settings?tendlc_checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/dashboard/settings?tendlc_checkout=cancelled`,
  })

  if (!session.url) return { ok: false, error: "Stripe did not return a checkout URL." }
  await upsertMessaging10DlcRegistration(userId, { stripe_session_id: session.id })
  return { ok: true, url: session.url }
}

/**
 * Submit brand to Telnyx/TCR, then campaign only after the brand is verified.
 * TCR rejects campaign creation while the brand is still pending review.
 */
export async function submitMessaging10DlcToTelnyx(
  userId: string,
  organizationId?: string | null
): Promise<TenDlcActionResult> {
  const orgId = organizationId ?? undefined
  let reg = await getMessaging10DlcRegistration(userId, orgId)
  if (!reg) return { ok: false, error: "No registration found." }
  reg = await repairMisclassified10DlcFailure(userId, reg)
  const meta = tenDlcUseCaseMeta(reg.use_case)
  if (!meta) return { ok: false, error: "Invalid registration type." }

  const displayName = reg.display_name?.trim() || reg.legal_company_name?.trim() || "Business"
  const copy = defaultCampaignCopy(displayName)
  const campaignDescription = reg.campaign_description?.trim() || copy.description
  const sample1 = reg.sample_message_1?.trim() || copy.sample1
  const sample2 = reg.sample_message_2?.trim() || copy.sample2
  const messageFlow = reg.message_flow?.trim() || copy.messageFlow
  const resolvedOrgId = orgId ?? reg.organization_id ?? null
  const campaignOnlyFailure = isTelnyxCampaignOnlyFailure(reg.status_detail)
  const staleBrand =
    (reg.status === "failed" || reg.status === "rejected") && !campaignOnlyFailure

  let brandId = staleBrand ? null : reg.brand_id
  if (!brandId) {
    const brand = await createTelnyx10DlcBrand({
      entityType: meta.entityType,
      displayName,
      legalCompanyName: reg.legal_company_name,
      ein: reg.ein,
      vertical: reg.vertical ?? "PROFESSIONAL",
      website: reg.website,
      firstName: reg.contact_first_name,
      lastName: reg.contact_last_name,
      email: reg.email ?? "",
      phone: reg.phone,
      street: reg.street,
      city: reg.city,
      state: reg.state,
      postalCode: reg.postal_code,
      country: reg.country ?? "US",
    })
    if (!brand.ok) {
      const failed = await upsert10(userId, resolvedOrgId, {
        status: "failed",
        status_detail: `Brand registration failed: ${brand.error}`,
      })
      return { ok: true, registration: failed }
    }
    brandId = brand.brandId
    await upsert10(userId, resolvedOrgId, { brand_id: brandId })
  }

  const brandStatus = await getTelnyx10DlcBrandStatus(brandId)
  if (brandStatus?.normalized === "rejected") {
    const failed = await upsert10(userId, resolvedOrgId, {
      brand_id: brandId,
      status: "failed",
      status_detail: `Brand verification failed (${brandStatus.raw}). Update your business details and resubmit.`,
    })
    return { ok: true, registration: failed }
  }
  if (brandStatus?.normalized !== "approved") {
    const waiting = await saveBrandAwaitingVerification(userId, resolvedOrgId, brandId)
    return { ok: true, registration: waiting }
  }

  let campaignId =
    reg.status === "failed" || reg.status === "rejected" ? null : reg.campaign_id
  if (!campaignId) {
    const campaign = await createTelnyx10DlcCampaign({
      brandId,
      useCase: meta.key as TenDlcUseCaseKey,
      description: campaignDescription,
      sample1,
      sample2,
      messageFlow,
      businessName: displayName,
    })
    if (!campaign.ok) {
      if (isTelnyxBrandNotReadyForCampaignError(campaign.error)) {
        const waiting = await saveBrandAwaitingVerification(
          userId,
          resolvedOrgId,
          brandId,
          "Brand is still being verified at the carrier. Campaign registration will continue automatically once verification completes."
        )
        return { ok: true, registration: waiting }
      }
      const failed = await upsert10(userId, resolvedOrgId, {
        brand_id: brandId,
        status: "failed",
        status_detail: `Campaign registration failed: ${campaign.error}`,
      })
      return { ok: true, registration: failed }
    }
    campaignId = campaign.campaignId
  }

  const updated = await upsert10(userId, resolvedOrgId, {
    brand_id: brandId,
    campaign_id: campaignId,
    campaign_description: campaignDescription,
    sample_message_1: sample1,
    sample_message_2: sample2,
    message_flow: messageFlow,
    status: "pending_review",
    status_detail:
      "Submitted to The Campaign Registry. Carrier review typically takes 5–10 business days.",
  })
  return { ok: true, registration: updated }
}

/** Mark the fee paid (called from the Stripe checkout-completed handler) and submit to Telnyx. */
export async function handleMessaging10DlcPaid(userId: string, sessionId: string): Promise<void> {
  const reg = await getMessaging10DlcRegistration(userId)
  if (!reg) return
  if (reg.fee_paid && reg.campaign_id) return // already processed
  await upsertMessaging10DlcRegistration(userId, {
    fee_paid: true,
    status: "paid",
    stripe_session_id: sessionId,
    status_detail: "Payment received — submitting your registration to carriers.",
  })
  await submitMessaging10DlcToTelnyx(userId, reg.organization_id)
}

/** Poll carrier campaign status; auto-submit stuck rows, then assign the line when approved. */
export async function refreshMessaging10DlcStatus(
  userId: string,
  organizationId?: string | null
): Promise<TenDlcActionResult> {
  await ensureMessaging10DlcSubmittedToCarrier(userId, organizationId)

  const reg = await getMessaging10DlcRegistration(userId, organizationId)
  if (!reg) return { ok: false, error: "No registration found." }
  const resolvedOrgId = organizationId ?? reg.organization_id ?? null

  if (!reg.campaign_id) {
    return { ok: true, registration: reg }
  }

  const status = await getTelnyx10DlcCampaignStatus(reg.campaign_id)
  if (!status) return { ok: true, registration: reg }

  if (status.normalized === "approved") {
    let assigned = reg.assigned_number
    let detail = "Approved — your line can now send SMS lead alerts."
    const targetLine = await activeLineFor10Dlc(userId, resolvedOrgId)
    if (targetLine && normalizePhoneNumberE164(targetLine) !== normalizePhoneNumberE164(assigned ?? "")) {
      assigned = null
    }
    if (!assigned) {
      if (targetLine) {
        const res = await assignNumberToTelnyx10DlcCampaign(targetLine, reg.campaign_id)
        if (res.ok) {
          assigned = targetLine
        } else {
          detail = `Approved, but number assignment needs a retry: ${res.error}`
        }
      } else {
        detail = "Approved — your main line is still porting. Refresh after it is live to attach SMS."
      }
    }
    const updated = await upsert10(userId, resolvedOrgId, {
      status: "approved",
      assigned_number: assigned,
      status_detail: detail,
    })
    if (resolvedOrgId && !resolvedOrgId.startsWith("legacy-")) {
      await setOrganizationSmsRegistrationStatus(resolvedOrgId, userId, "APPROVED").catch(() => {})
    }
    return { ok: true, registration: updated }
  }

  if (status.normalized === "rejected") {
    const detail =
      status.detail ||
      `Carrier registration was rejected (${status.raw}). Update your business details and resubmit.`
    const updated = await upsert10(userId, resolvedOrgId, {
      status: "rejected",
      status_detail: detail,
    })
    if (resolvedOrgId && !resolvedOrgId.startsWith("legacy-")) {
      await markWorkspaceSmsRegistrationRejected(userId, resolvedOrgId)
    }
    return { ok: true, registration: updated }
  }

  if (status.normalized === "pending_review" && reg.status !== "pending_review") {
    const updated = await upsert10(userId, resolvedOrgId, {
      status: "pending_review",
      status_detail:
        reg.status_detail?.trim() ||
        `Carrier review in progress (${status.raw}). This usually takes 1–10 business days.`,
    })
    return { ok: true, registration: updated }
  }

  return { ok: true, registration: reg }
}

export type TenDlcView = {
  registration: Messaging10DlcRegistration | null
  use_cases: { key: string; label: string; description: string; requiresEin: boolean; fee_label: string }[]
  verticals: { value: string; label: string }[]
  /** True when SMS lead alerts can actually deliver (approved + assigned). */
  sms_ready: boolean
}

/** Assemble everything the settings UI needs to render the 10DLC card. */
export async function getMessaging10DlcView(
  userId: string,
  organizationId?: string | null
): Promise<TenDlcView> {
  const registration = await getMessaging10DlcRegistration(userId, organizationId)
  const use_cases = (Object.values(TEN_DLC_USE_CASES)).map((m) => ({
    key: m.key,
    label: m.label,
    description: m.description,
    requiresEin: m.requiresEin,
    fee_label: formatUsdFromCents(m.fallbackFeeCents),
  }))
  const sms_ready = registration?.status === "approved" && Boolean(registration.assigned_number)
  return { registration, use_cases, verticals: TEN_DLC_VERTICALS, sms_ready }
}
