import {
  CARRIER_PROVISIONING_FEE_USD,
  hasEnoughCarrierCredit,
  normalizeSubscriptionTier,
  tierActiveNumberLimit,
  tierUpgradeMessage,
  type SubscriptionTier,
} from "@/lib/subscription-tier"
import { buildServiceContext, canAddNumberWithServiceContext } from "@/lib/service-context"
import {
  adjustUserCarrierCredit,
  countActivePhoneNumbers,
  ensureOnboardingProfile,
  getOnboardingProfile,
  getPhoneNumbers,
  getUser,
  normalizePhoneNumberE164,
} from "@/lib/db"
import { purchaseAndConfigureTelnyxLine } from "@/lib/telnyx-purchase-line"
import { insertPhoneNumber } from "@/lib/db"

export type NumberPurchaseBlockReason = "tier_limit" | "insufficient_credit"

export type NumberPurchaseGateResult =
  | {
      allowed: true
      tier: SubscriptionTier
      active_count: number
      line_limit: number
      carrier_credit: number
    }
  | {
      allowed: false
      reason: NumberPurchaseBlockReason
      message: string
      tier: SubscriptionTier
      active_count: number
      line_limit: number
      carrier_credit: number
      upgrade_message: string | null
    }

async function buildTierGateBase(userId: string, activeCount: number) {
  const [profile, user] = await Promise.all([getOnboardingProfile(userId), getUser(userId)])
  const service = buildServiceContext(
    user ?? { email: "" },
    profile
  )
  return {
    tier: service.subscription_tier,
    active_count: activeCount,
    line_limit: service.active_number_limit,
    carrier_credit: Number(profile?.carrier_credit ?? 0),
    service,
  }
}

/** Whether reserving this E.164 would add a net-new active line (tier limits). */
export async function evaluateNumberReservationGate(
  userId: string,
  reservedE164: string
): Promise<NumberPurchaseGateResult> {
  await ensureOnboardingProfile(userId)
  const normalized = normalizePhoneNumberE164(reservedE164.trim())
  const existing = await getPhoneNumbers(userId)
  const matchingRow = existing.find((row) => normalizePhoneNumberE164(row.number) === normalized)
  const activeCount = await countActivePhoneNumbers(userId)
  const base = await buildTierGateBase(userId, activeCount)
  const { service, ...gateBase } = base

  if (matchingRow) {
    return { allowed: true, ...gateBase }
  }

  if (!canAddNumberWithServiceContext(service, activeCount)) {
    return {
      allowed: false,
      reason: "tier_limit",
      message: tierUpgradeMessage(gateBase.tier) ?? "Your plan does not allow more business numbers.",
      upgrade_message: tierUpgradeMessage(gateBase.tier),
      ...gateBase,
    }
  }

  return { allowed: true, ...gateBase }
}

/** Gate before carrier provisioning — skips tier cap when completing the same reserved line. */
export async function evaluateNumberProvisionGate(
  userId: string,
  reservedE164: string
): Promise<NumberPurchaseGateResult> {
  await ensureOnboardingProfile(userId)
  const normalized = normalizePhoneNumberE164(reservedE164.trim())
  const existing = await getPhoneNumbers(userId)
  const matchingRow = existing.find((row) => normalizePhoneNumberE164(row.number) === normalized)
  const activeCount = await countActivePhoneNumbers(userId)
  const base = await buildTierGateBase(userId, activeCount)
  const { service, ...gateBase } = base

  if (!canAddNumberWithServiceContext(service, activeCount) && !matchingRow) {
    return {
      allowed: false,
      reason: "tier_limit",
      message: tierUpgradeMessage(gateBase.tier) ?? "Your plan does not allow more business numbers.",
      upgrade_message: tierUpgradeMessage(gateBase.tier),
      ...gateBase,
    }
  }

  if (!hasEnoughCarrierCredit(gateBase.carrier_credit)) {
    return {
      allowed: false,
      reason: "insufficient_credit",
      message: `Add at least $${CARRIER_PROVISIONING_FEE_USD.toFixed(2)} carrier credit on the Pay tab before purchasing a line.`,
      upgrade_message: null,
      ...gateBase,
    }
  }

  return { allowed: true, ...gateBase }
}

/** Server-side gate before buying a new business line from the marketplace. */
export async function evaluateNumberPurchaseGate(userId: string): Promise<NumberPurchaseGateResult> {
  await ensureOnboardingProfile(userId)
  const activeCount = await countActivePhoneNumbers(userId)
  const base = await buildTierGateBase(userId, activeCount)
  const { service, ...gateBase } = base

  if (!canAddNumberWithServiceContext(service, activeCount)) {
    return {
      allowed: false,
      reason: "tier_limit",
      message: tierUpgradeMessage(gateBase.tier) ?? "Your plan does not allow more business numbers.",
      upgrade_message: tierUpgradeMessage(gateBase.tier),
      ...gateBase,
    }
  }

  if (!hasEnoughCarrierCredit(gateBase.carrier_credit)) {
    return {
      allowed: false,
      reason: "insufficient_credit",
      message: `Add at least $${CARRIER_PROVISIONING_FEE_USD.toFixed(2)} carrier credit on the Pay tab before purchasing a line.`,
      upgrade_message: null,
      ...gateBase,
    }
  }

  return { allowed: true, ...gateBase }
}

export type PurchasePhoneNumberResult =
  | { ok: true; phone_number: string; order_id: string }
  | { ok: false; error: string; reason?: NumberPurchaseBlockReason | "number_unavailable" | "area_empty" | "carrier_error" }

/** Purchase a line on the carrier, deduct $2 carrier credit, save to phone_numbers. */
export async function purchasePhoneNumberForUser(
  userId: string,
  phoneNumberE164: string,
  label: string,
  friendlyName?: string,
  organizationId?: string | null
): Promise<PurchasePhoneNumberResult> {
  const gate = await evaluateNumberPurchaseGate(userId)
  if (!gate.allowed) {
    return { ok: false, error: gate.message, reason: gate.reason }
  }

  const purchase = await purchaseAndConfigureTelnyxLine(phoneNumberE164)
  if (!purchase.ok) {
    return { ok: false, error: purchase.error, reason: purchase.reason }
  }

  await adjustUserCarrierCredit({
    userId,
    deltaUsd: -CARRIER_PROVISIONING_FEE_USD,
    reason: "carrier_number_purchase",
    reference: purchase.order_id,
    meta: { phone_number: purchase.phone_number },
  })

  const saved = await insertPhoneNumber({
    user_id: userId,
    number: purchase.phone_number,
    friendly_name: friendlyName?.trim() || purchase.phone_number,
    label: label.trim() || "Business Line",
    type: "local",
    status: "active",
    provider_number_sid: purchase.order_id,
    organization_id: organizationId ?? null,
  })

  void saved
  return { ok: true, phone_number: purchase.phone_number, order_id: purchase.order_id }
}
