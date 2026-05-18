import { getOnboardingProfile } from "@/lib/db"
import type { User } from "@/lib/types"

/** Dashboard access once a line is reserved (subscription may still be sandbox until Activate Line). */
export async function userMayAccessDashboard(user: User): Promise<boolean> {
  if (process.env.NODE_ENV === "development" && user.id === "dev-user") {
    return true
  }
  try {
    const profile = await getOnboardingProfile(user.id)
    if (!profile) return false
    return Boolean(profile.reserved_number?.trim())
  } catch (e) {
    console.error("[userMayAccessDashboard]", e)
    return false
  }
}

/** True when live Telnyx routing is unlocked (paid / activated). */
export async function userHasActiveLineSubscription(userId: string): Promise<boolean> {
  try {
    const profile = await getOnboardingProfile(userId)
    return profile?.has_active_subscription === true
  } catch {
    return false
  }
}
