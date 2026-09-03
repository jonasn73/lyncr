// Tier gate for Telnyx AI Voice Assistant usage — shared by the full-receptionist
// fallback (legacy TeXML) and the Call Control hold-queue AI bridge (`087`).
// Professional + Business only; the master QA account always passes (see service-context.ts).

import { getUser, getOnboardingProfile } from "@/lib/db"
import { buildServiceContext } from "@/lib/service-context"
import type { SubscriptionTier } from "@/lib/subscription-tier"

export type AiVoiceAssistantEntitlement = {
  tier: SubscriptionTier
  allowed: boolean
}

export async function resolveAiVoiceAssistantEntitlement(
  userId: string
): Promise<AiVoiceAssistantEntitlement> {
  if (!userId) return { tier: "free_trial", allowed: false }
  // Sequential, not Promise.all: if one call throws synchronously (a mocked-but-unexported
  // dependency in tests; never happens in production) with the other still pending, the
  // pending one's promise never gets attached to anything and Node flags it as unhandled.
  const user = await getUser(userId)
  const profile = await getOnboardingProfile(userId)
  const service = buildServiceContext(user ?? { email: "" }, profile)
  return { tier: service.subscription_tier, allowed: service.capabilities.ai_voice_assistant }
}

export const AI_VOICE_ASSISTANT_UPGRADE_MESSAGE =
  "AI Assistant call handling is available on Professional and Business plans. Upgrade to activate it."
