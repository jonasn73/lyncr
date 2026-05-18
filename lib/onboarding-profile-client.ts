import type { OnboardingProfile, UpdateOnboardingProfileRequest } from "@/lib/types"

export async function fetchOnboardingProfile(): Promise<OnboardingProfile | null> {
  const res = await fetch("/api/onboarding/profile", { credentials: "include" })
  if (res.status === 401) return null
  const json = (await res.json().catch(() => ({}))) as { data?: OnboardingProfile; error?: string }
  if (!res.ok) {
    if (json.error?.includes("024-onboarding-profiles")) return null
    throw new Error(json.error || "Could not load onboarding profile")
  }
  return json.data ?? null
}

export async function patchOnboardingProfile(
  updates: UpdateOnboardingProfileRequest
): Promise<OnboardingProfile> {
  const res = await fetch("/api/onboarding/profile", {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  })
  const json = (await res.json().catch(() => ({}))) as { data?: OnboardingProfile; error?: string }
  if (!res.ok) throw new Error(json.error || "Could not save onboarding progress")
  if (!json.data) throw new Error("No profile returned")
  return json.data
}

export async function completeOnboardingCheckoutClient(
  opts?: UpdateOnboardingProfileRequest
): Promise<OnboardingProfile> {
  const res = await fetch("/api/onboarding/profile/complete", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts ?? {}),
  })
  const json = (await res.json().catch(() => ({}))) as { data?: OnboardingProfile; error?: string }
  if (!res.ok) throw new Error(json.error || "Could not complete checkout")
  if (!json.data) throw new Error("No profile returned")
  return json.data
}
