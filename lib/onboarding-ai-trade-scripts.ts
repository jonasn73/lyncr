/** Onboarding fallback step — trade scripts, voicemail default, strategy keys. */

export type OnboardingFallbackStrategy = "ai" | "voicemail"

export const ONBOARDING_FALLBACK_DEFAULT: OnboardingFallbackStrategy = "ai"

export const ONBOARDING_DEFAULT_VOICEMAIL_GREETING =
  "Thanks for calling. We are currently assisting other clients or out in the field. Please leave your name, phone number, and a detailed message after the tone, and we will get right back to you."

export type OnboardingTradeCategory = "automotive" | "trades_mep" | "general"

export type OnboardingTradeOption = {
  id: OnboardingTradeCategory
  label: string
  openingLine: string
}

export const ONBOARDING_TRADE_DEFAULT: OnboardingTradeCategory = "general"

export const ONBOARDING_TRADE_OPTIONS: readonly OnboardingTradeOption[] = [
  {
    id: "automotive",
    label: "Automotive Locksmith / Towing",
    openingLine:
      "Thanks for calling. To dispatch a technician to you immediately, please tell me your name, the location you're at, and a quick breakdown of your issue. If this involves a vehicle, please include the year, make, and model.",
  },
  {
    id: "trades_mep",
    label: "Plumbing / HVAC / Electrical",
    openingLine:
      "Thanks for calling. To route an emergency technician to your property right now, please tell me your name, your address, and exactly what kind of system issue you're experiencing.",
  },
  {
    id: "general",
    label: "General / Other Trades",
    openingLine:
      "Thanks for calling. To get a technician out to assist you immediately, please tell me your name, the address or location you're at, and a quick breakdown of what we can help you with today.",
  },
] as const

export function getOnboardingOpeningLine(category: OnboardingTradeCategory): string {
  const row = ONBOARDING_TRADE_OPTIONS.find((o) => o.id === category)
  return row?.openingLine ?? ONBOARDING_TRADE_OPTIONS.find((o) => o.id === "general")!.openingLine
}

export function onboardingTradeLabel(category: OnboardingTradeCategory): string {
  return ONBOARDING_TRADE_OPTIONS.find((o) => o.id === category)?.label ?? "General / Other Trades"
}

export function isOnboardingTradeCategory(value: string | null | undefined): value is OnboardingTradeCategory {
  return value === "automotive" || value === "trades_mep" || value === "general"
}
