import type { OnboardingProfile, UpdateOnboardingProfileRequest } from "@/lib/types"

export type OnboardingProfileSnapshot = {
  profile: OnboardingProfile | null
  /** True when the reserved DID has a carrier SID and is active — calls can route. */
  carrierLive: boolean
}

export async function fetchOnboardingProfile(): Promise<OnboardingProfileSnapshot> {
  const res = await fetch("/api/onboarding/profile", { credentials: "include" })
  if (res.status === 401) return { profile: null, carrierLive: false }
  const json = (await res.json().catch(() => ({}))) as {
    data?: OnboardingProfile
    carrier_live?: boolean
    error?: string
  }
  if (!res.ok) {
    if (json.error?.includes("025-onboarding-profiles")) return { profile: null, carrierLive: false }
    throw new Error(json.error || "Could not load onboarding profile")
  }
  return {
    profile: json.data ?? null,
    carrierLive: json.carrier_live === true,
  }
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

export async function activateSubscriptionClient(opts?: {
  saveBillingMethod?: boolean
}): Promise<{
  message: string
  profile: OnboardingProfile
  carrierLive: boolean
}> {
  const res = await fetch("/api/onboarding/profile/activate", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ save_billing_method: opts?.saveBillingMethod === true }),
  })
  const json = (await res.json().catch(() => ({}))) as {
    data?: OnboardingProfile
    carrier_live?: boolean
    message?: string
    error?: string
  }
  if (!res.ok) throw new Error(json.error || "Could not activate subscription")
  if (!json.data) throw new Error("No profile returned")
  const display = json.data.reserved_number_display ?? json.data.reserved_number ?? "your line"
  return {
    profile: json.data,
    carrierLive: json.carrier_live === true,
    message:
      json.message ||
      (json.carrier_live
        ? `Live production enabled for ${display}.`
        : `Payment saved for ${display}. Line remains in sandbox until Telnyx provisioning completes.`),
  }
}
