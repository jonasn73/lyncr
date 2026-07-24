/** Shared Quick SMS / late-ETA preset helpers for owner → customer texts. */

/** Answered / active-job follow-ups (ETA, en route). */
export const CUSTOMER_SMS_QUICK_TEMPLATES = [
  "Stuck on a job, text you right back!",
  "On my way — give me 10 minutes.",
  "Got your call. What's the address?",
  "Tech is en route — please stay near the vehicle.",
] as const

/** Missed / unanswered recovery texts — callback + book, not “on my way”. */
export const MISSED_CALL_SMS_QUICK_TEMPLATES = [
  "Sorry we missed your call — can I call you back?",
  "Got your missed call. Reply with your address and we'll get you booked.",
  "Sorry we missed you. Tap our booking link or text what you need.",
] as const

/** Build a running-late SMS body from an ETA in minutes. */
export function buildRunningLateSms(etaMinutes: number): string {
  const mins = Math.max(1, Math.min(180, Math.round(etaMinutes) || 15))
  return `Running about ${mins} minutes late — on my way. Sorry for the wait!`
}

/** Default ETA when the operator taps Running late without editing minutes. */
export const DEFAULT_LATE_ETA_MINUTES = 15
