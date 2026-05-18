import { getOnboardingProfile } from "@/lib/db"
import type { User } from "@/lib/types"

/** True when the account finished onboarding checkout (Neon `profiles` row). */
export async function userMayAccessDashboard(user: User): Promise<boolean> {
  if (process.env.NODE_ENV === "development" && user.id === "dev-user") {
    return true
  }
  try {
    const profile = await getOnboardingProfile(user.id)
    if (!profile) return false
    return profile.has_active_subscription === true && Boolean(profile.reserved_number?.trim())
  } catch (e) {
    console.error("[userMayAccessDashboard]", e)
    return false
  }
}
