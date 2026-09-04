// Reports AI Assistant conversation minutes to Stripe's Billing Meter (`087`) so usage past
// the tier's included minutes bills automatically as overage. Purely additive/best-effort —
// never blocks or fails the call it's reporting for.

import { getOnboardingProfile } from "@/lib/db"
import { getStripeClient, isStripeConfigured } from "@/lib/stripe-config"

const AI_ASSISTANT_MINUTES_METER_EVENT = "ai_assistant_minutes"

export async function reportAiAssistantMinutesUsage(
  userId: string,
  seconds: number,
  /** e.g. the call_control_id — dedupes if this call is ever reported twice (Stripe keys on this for ~24h). */
  identifier?: string
): Promise<void> {
  if (!userId || !Number.isFinite(seconds) || seconds <= 0) return
  if (!isStripeConfigured()) return

  try {
    const profile = await getOnboardingProfile(userId)
    const customerId = profile?.stripe_customer_id?.trim()
    if (!customerId) {
      // No Stripe customer (e.g. master-test-bypass account, or a call before checkout ever
      // completed) — nothing to meter against. Not an error.
      return
    }

    const minutes = Math.ceil(seconds / 60)
    const stripe = getStripeClient()
    await stripe.billing.meterEvents.create({
      event_name: AI_ASSISTANT_MINUTES_METER_EVENT,
      payload: {
        stripe_customer_id: customerId,
        value: String(minutes),
      },
      ...(identifier ? { identifier } : {}),
    })
    console.log(
      JSON.stringify({
        zing: "ai-assistant-minutes-reported",
        userId,
        minutes,
        seconds,
      })
    )
  } catch (e) {
    // Billing Meter may not exist yet (Jonas hasn't created it in Stripe Dashboard) — log and
    // move on. This must never take down a real call's cleanup path.
    console.warn("[ai-usage-billing] reportAiAssistantMinutesUsage failed:", e)
  }
}
