import { getOnboardingProfile, getCallLogUserIdByProviderSid, updateOnboardingProfile } from "@/lib/db"
import { LOW_CARRIER_CREDIT_THRESHOLD_USD } from "@/lib/carrier-credit-threshold"

export { LOW_CARRIER_CREDIT_THRESHOLD_USD } from "@/lib/carrier-credit-threshold"

function isMissingLowBalanceNotifiedColumnError(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase()
  return msg.includes("low_balance_notified")
}

/**
 * Background check after a call status event — flags `low_balance_notified` when wallet is low.
 * Safe to fire-and-forget from Telnyx webhooks (never throws on missing migration).
 */
export async function evaluateLowCarrierCreditFromCallUsage(providerCallSid: string): Promise<void> {
  const sid = providerCallSid.trim()
  if (!sid) return

  let userId: string | null = null
  try {
    userId = await getCallLogUserIdByProviderSid(sid)
  } catch {
    return
  }
  if (!userId) return

  await evaluateAndFlagLowCarrierCredit(userId)
}

/** Read wallet, set or clear `low_balance_notified` on the onboarding profile. */
export async function evaluateAndFlagLowCarrierCredit(
  userId: string,
  thresholdUsd = LOW_CARRIER_CREDIT_THRESHOLD_USD
): Promise<{ flagged: boolean; balanceUsd: number }> {
  const profile = await getOnboardingProfile(userId)
  if (!profile) return { flagged: false, balanceUsd: 0 }

  const balanceUsd = Number(profile.carrier_credit ?? 0)
  if (balanceUsd >= thresholdUsd) {
    if (profile.low_balance_notified) {
      try {
        await updateOnboardingProfile(userId, { low_balance_notified: false })
      } catch (e) {
        if (!isMissingLowBalanceNotifiedColumnError(e)) throw e
      }
    }
    return { flagged: false, balanceUsd }
  }

  if (!profile.low_balance_notified) {
    try {
      await updateOnboardingProfile(userId, { low_balance_notified: true })
      return { flagged: true, balanceUsd }
    } catch (e) {
      if (isMissingLowBalanceNotifiedColumnError(e)) return { flagged: false, balanceUsd }
      throw e
    }
  }

  return { flagged: true, balanceUsd }
}

/** After a credit top-up, clear the Pay-tab warning when balance is healthy again. */
export async function clearLowBalanceFlagIfToppedUp(
  userId: string,
  balanceUsd: number,
  thresholdUsd = LOW_CARRIER_CREDIT_THRESHOLD_USD
): Promise<void> {
  if (balanceUsd < thresholdUsd) return
  try {
    await updateOnboardingProfile(userId, { low_balance_notified: false })
  } catch (e) {
    if (!isMissingLowBalanceNotifiedColumnError(e)) throw e
  }
}
