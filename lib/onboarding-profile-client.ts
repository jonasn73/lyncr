import type { OnboardingProfile, UpdateOnboardingProfileRequest } from "@/lib/types"

export async function fetchOnboardingProfile(): Promise<OnboardingProfile | null> {
  const res = await fetch("/api/onboarding/profile", { credentials: "include" })
  if (res.status === 401) return null
  const json = (await res.json().catch(() => ({}))) as { data?: OnboardingProfile; error?: string }
  if (!res.ok) {
    if (json.error?.includes("025-onboarding-profiles")) return null
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
  const json = (await res.json().catch(() => ({}))) as {
    data?: OnboardingProfile
    error?: string
    simulation_mode?: boolean
  }
  if (!res.ok) throw new Error(json.error || "Could not complete checkout")
  if (!json.data) throw new Error("No profile returned")
  return json.data
}

export type OnboardingProvisionMode = {
  simulation_mode: boolean
  notice: string | null
}

export async function fetchOnboardingProvisionMode(): Promise<OnboardingProvisionMode> {
  const res = await fetch("/api/onboarding/provision-mode", { credentials: "include" })
  const json = (await res.json().catch(() => ({}))) as {
    data?: OnboardingProvisionMode
  }
  return (
    json.data ?? {
      simulation_mode: true,
      notice:
        "Development Mode: Number reserved in Neon DB. Live Telnyx webhooks require production API key mapping.",
    }
  )
}

/** Step 1 — reserve chosen DID in Neon (simulation skips live Telnyx). */
export async function reserveOnboardingNumberClient(payload: {
  reserved_number: string
  reserved_number_display: string | null
  reserved_number_method: "buy" | "port"
  port_carrier?: string | null
}): Promise<{ profile: OnboardingProfile; simulation_mode: boolean }> {
  const res = await fetch("/api/onboarding/profile/reserve-number", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  const json = (await res.json().catch(() => ({}))) as {
    data?: OnboardingProfile
    simulation_mode?: boolean
    error?: string
  }
  if (!res.ok) throw new Error(json.error || "Could not reserve number")
  if (!json.data) throw new Error("No profile returned")
  return { profile: json.data, simulation_mode: json.simulation_mode !== false }
}

export async function activateSubscriptionClient(): Promise<{ message: string; profile: OnboardingProfile }> {
  const res = await fetch("/api/onboarding/profile/activate", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  })
  const json = (await res.json().catch(() => ({}))) as {
    data?: OnboardingProfile
    message?: string
    error?: string
  }
  if (!res.ok) throw new Error(json.error || "Could not activate subscription")
  if (!json.data) throw new Error("No profile returned")
  return {
    profile: json.data,
    message:
      json.message ||
      `Subscription activated! Telnyx carrier routing provisioning successfully initiated for ${json.data.reserved_number_display ?? json.data.reserved_number ?? "your line"}.`,
  }
}
