/** Shared Quick SMS / late-ETA preset helpers for owner → customer texts. */

export const CUSTOMER_SMS_QUICK_TEMPLATES = [
  "Stuck on a job, text you right back!",
  "On my way — give me 10 minutes.",
  "Got your call. What's the address?",
  "Tech is en route — please stay near the vehicle.",
] as const

/** Build a running-late SMS body from an ETA in minutes. */
export function buildRunningLateSms(etaMinutes: number): string {
  const mins = Math.max(1, Math.min(180, Math.round(etaMinutes) || 15))
  return `Running about ${mins} minutes late — on my way. Sorry for the wait!`
}

/** Default ETA when the operator taps Running late without editing minutes. */
export const DEFAULT_LATE_ETA_MINUTES = 15
