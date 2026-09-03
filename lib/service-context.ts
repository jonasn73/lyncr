// Subscription tier capabilities + master test-account bypass (Jonas QA).

import type { User } from "@/lib/types"
import {
  canAddNumberForTier,
  normalizeSubscriptionTier,
  tierActiveNumberLimit,
  type SubscriptionTier,
} from "@/lib/subscription-tier"

/** Hardcoded master QA account — bypasses all subscription / tier gates. */
export const MASTER_TEST_ACCOUNT_EMAIL = "jonasn73@gmail.com"

export type PremiumCapability =
  | "multi_tenant_workspaces"
  | "unlimited_text_dispatches"
  | "operator_pooling"
  /** Telnyx AI Voice Assistant — full-receptionist fallback + hold-queue AI bridge (`087`). */
  | "ai_voice_assistant"

const SCALE_TIER_CAPABILITIES: PremiumCapability[] = [
  "multi_tenant_workspaces",
  "unlimited_text_dispatches",
  "operator_pooling",
  "ai_voice_assistant",
]

function normalizeAccountEmail(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? ""
}

export function isMasterTestAccount(email: string | null | undefined): boolean {
  return normalizeAccountEmail(email) === MASTER_TEST_ACCOUNT_EMAIL
}

/** Professional and Business (Scale) unlock multi-tenant premium features. */
function tierHasScaleCapabilities(tier: SubscriptionTier): boolean {
  return tier === "professional" || tier === "business"
}

export function hasPremiumCapability(
  email: string | null | undefined,
  tier: SubscriptionTier,
  capability: PremiumCapability
): boolean {
  if (isMasterTestAccount(email)) return true
  if (!tierHasScaleCapabilities(tier)) return false
  return SCALE_TIER_CAPABILITIES.includes(capability)
}

export type ServiceContext = {
  email: string
  master_test_bypass: boolean
  subscription_tier: SubscriptionTier
  /** Effective line cap (business-tier unlimited for master bypass). */
  active_number_limit: number
  capabilities: Record<PremiumCapability, boolean>
}

type ProfileLike = { subscription_tier?: string | null } | null | undefined

export function buildServiceContext(user: Pick<User, "email">, profile?: ProfileLike): ServiceContext {
  const email = normalizeAccountEmail(user.email)
  const master_test_bypass = isMasterTestAccount(email)
  const subscription_tier = normalizeSubscriptionTier(profile?.subscription_tier)
  const capabilities: Record<PremiumCapability, boolean> = {
    multi_tenant_workspaces: hasPremiumCapability(email, subscription_tier, "multi_tenant_workspaces"),
    unlimited_text_dispatches: hasPremiumCapability(email, subscription_tier, "unlimited_text_dispatches"),
    operator_pooling: hasPremiumCapability(email, subscription_tier, "operator_pooling"),
    ai_voice_assistant: hasPremiumCapability(email, subscription_tier, "ai_voice_assistant"),
  }
  const active_number_limit = master_test_bypass ? tierActiveNumberLimit("business") : tierActiveNumberLimit(subscription_tier)

  return {
    email,
    master_test_bypass,
    subscription_tier,
    active_number_limit,
    capabilities,
  }
}

export function canAddNumberWithServiceContext(service: ServiceContext, activeCount: number): boolean {
  if (service.master_test_bypass) return true
  return canAddNumberForTier(service.subscription_tier, activeCount)
}

export const MULTI_TENANT_UPGRADE_TITLE = "Unlock Multi-Tenant Operations"

export const MULTI_TENANT_UPGRADE_MESSAGE =
  "Manage multiple business entities with distinct automated configurations under one centralized login. Upgrade to Scale Tier."
