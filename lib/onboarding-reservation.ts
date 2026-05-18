/** Session-scoped checkout reservation — number is held until billing completes. */

import type { OnboardingNumberOption } from "@/lib/onboarding-number-inventory"

export type OnboardingLineMethod = "buy" | "port"

export type OnboardingLineReservation = {
  method: OnboardingLineMethod
  /** Display format, e.g. (502) 234-5678 */
  display: string
  /** E.164 for carrier purchase webhook, e.g. +15022345678 */
  e164: string
  lineType?: OnboardingNumberOption["type"]
  /** Shown on billing review — no charge until Stripe succeeds */
  trialNote: string
  afterTrialPrice?: string
  portCarrier?: string
}

const STORAGE_KEY = "lyncr:onboarding-line-reservation"

export function displayToE164(display: string): string {
  const digits = display.replace(/\D/g, "")
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  return digits.startsWith("+") ? digits : `+${digits}`
}

export function e164ToQueryDigits(e164: string): string {
  return e164.replace(/\D/g, "")
}

export function buildBuyReservation(row: OnboardingNumberOption): OnboardingLineReservation {
  return {
    method: "buy",
    display: row.number,
    e164: row.e164?.trim() || displayToE164(row.number),
    lineType: row.type,
    trialNote: row.trialNote,
    afterTrialPrice: row.afterTrialPrice,
  }
}

export function buildPortReservation(display: string, portCarrier: string): OnboardingLineReservation {
  return {
    method: "port",
    display,
    e164: displayToE164(display),
    trialNote: "Included in trial",
    afterTrialPrice: "Porting fee may apply after trial",
    portCarrier,
  }
}

export function readOnboardingReservation(): OnboardingLineReservation | null {
  if (typeof window === "undefined") return null
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as OnboardingLineReservation
  } catch {
    return null
  }
}

export function writeOnboardingReservation(reservation: OnboardingLineReservation): void {
  if (typeof window === "undefined") return
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(reservation))
}

export function clearOnboardingReservation(): void {
  if (typeof window === "undefined") return
  sessionStorage.removeItem(STORAGE_KEY)
}

/** Sync reservation to URL for deep-linking the billing segment (e.g. ?number=1502…). */
export function reservationToSearchParams(reservation: OnboardingLineReservation): URLSearchParams {
  const params = new URLSearchParams()
  params.set("number", e164ToQueryDigits(reservation.e164))
  params.set("method", reservation.method)
  if (reservation.portCarrier) params.set("carrier", reservation.portCarrier)
  return params
}

export function parseReservationFromSearchParams(params: URLSearchParams): OnboardingLineReservation | null {
  const digits = params.get("number")?.replace(/\D/g, "")
  if (!digits || digits.length < 10) return null
  const e164 = digits.length === 10 ? `+1${digits}` : `+${digits}`
  const method = params.get("method") === "port" ? "port" : "buy"
  const display =
    digits.length >= 10
      ? `(${digits.slice(-10, -7)}) ${digits.slice(-7, -4)}-${digits.slice(-4)}`
      : e164
  return {
    method,
    display,
    e164,
    trialNote: "Included in trial",
    portCarrier: params.get("carrier") ?? undefined,
  }
}
