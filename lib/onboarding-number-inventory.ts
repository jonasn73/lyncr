/** Onboarding number search — prefers real Telnyx inventory; demo rows only as fallback. */

import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { displayToE164 } from "@/lib/onboarding-reservation"

export type OnboardingNumberOption = {
  id: string
  /** Display format, e.g. (502) 234-5678 */
  number: string
  /** E.164 from Telnyx when available */
  e164: string
  type: "Local" | "Toll-Free"
  price: string
  trialNote: string
  afterTrialPrice: string
  /** True when row came from Telnyx search (real purchasable DID). */
  fromTelnyx?: boolean
}

export const ONBOARDING_INVENTORY_SIZE = 4

export type OnboardingInventoryResult = {
  numbers: OnboardingNumberOption[]
  source: "telnyx" | "demo"
}

function normalizeAreaCode(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 3)
  return digits.length === 3 ? digits : digits.padStart(3, "5")
}

function isTollFreeE164(e164: string): boolean {
  const digits = e164.replace(/\D/g, "")
  const area = digits.length >= 10 ? digits.slice(-10, -7) : ""
  return /^8[08]/.test(area)
}

function mapTelnyxRow(item: { number: string; type?: string }, index: number): OnboardingNumberOption {
  const e164 = String(item.number).trim()
  const tollFree = item.type === "toll_free" || isTollFreeE164(e164)
  const afterTrialPrice = tollFree ? "$4.99/mo after trial" : "$2.99/mo after trial"
  return {
    id: e164 || `telnyx-${index}`,
    number: formatPhoneDisplay(e164),
    e164,
    type: tollFree ? "Toll-Free" : "Local",
    price: tollFree ? "$4.99/mo" : "$2.99/mo",
    trialNote: "Included in trial",
    afterTrialPrice,
    fromTelnyx: true,
  }
}

/** Search Telnyx for real available numbers in an area code (client-side fetch). */
export async function fetchOnboardingNumberInventory(areaCode: string): Promise<OnboardingInventoryResult> {
  const ac = normalizeAreaCode(areaCode)
  try {
    const res = await fetch(
      `/api/numbers/telnyx?area_code=${encodeURIComponent(ac)}&type=local`,
      { credentials: "include" }
    )
    const data = (await res.json().catch(() => ({}))) as {
      numbers?: { number: string; type?: string }[]
      error?: string
    }
    if (!res.ok || !Array.isArray(data.numbers) || data.numbers.length === 0) {
      return { numbers: buildOnboardingNumberInventory(ac), source: "demo" }
    }
    return {
      numbers: data.numbers.slice(0, ONBOARDING_INVENTORY_SIZE).map(mapTelnyxRow),
      source: "telnyx",
    }
  } catch {
    return { numbers: buildOnboardingNumberInventory(ac), source: "demo" }
  }
}

/** Demo-only fallback when Telnyx search is unavailable. */
export function buildOnboardingNumberInventory(areaCode: string, count = ONBOARDING_INVENTORY_SIZE): OnboardingNumberOption[] {
  const ac = normalizeAreaCode(areaCode)
  const used = new Set<string>()
  const out: OnboardingNumberOption[] = []

  for (let i = 0; i < count; i++) {
    let display = ""
    for (let attempt = 0; attempt < 64; attempt++) {
      const exchange = String(Math.floor(200 + Math.random() * 800))
      const last4 = String(Math.floor(1000 + Math.random() * 9000))
      display = `(${ac}) ${exchange}-${last4}`
      if (!used.has(display)) break
    }
    used.add(display)
    const tollFree =
      i === count - 1 || exchangeStartsTollFree(display) || Math.random() < 0.12
    const afterTrialPrice = tollFree ? "$4.99/mo after trial" : "$2.99/mo after trial"
    const e164 = displayToE164(display)
    out.push({
      id: `${ac}-${e164}-${i}`,
      number: display,
      e164,
      type: tollFree ? "Toll-Free" : "Local",
      price: tollFree ? "$4.99/mo" : "$2.99/mo",
      trialNote: "Included in trial",
      afterTrialPrice,
      fromTelnyx: false,
    })
  }

  return out
}

function exchangeStartsTollFree(display: string): boolean {
  const match = display.match(/\(\d{3}\)\s(\d{3})-/)
  if (!match) return false
  const ex = match[1]
  return ex.startsWith("8") && (ex[1] === "0" || ex[1] === "8")
}
