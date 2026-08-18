/** Shared Quick SMS / late-ETA preset helpers for owner → customer texts. */

/** Answered / active-job follow-ups. */
export const CUSTOMER_SMS_QUICK_TEMPLATES = [
  "Hey — stuck on a job, I’ll text you back here.",
  "Hey — I’m on my way. Text us here for any update or change.",
  "Hey — got your call. What’s the address?",
] as const

/** Missed / unanswered recovery texts — callback, not “on my way.” */
export const MISSED_CALL_SMS_QUICK_TEMPLATES = [
  "Hey — sorry we missed your call. Text us here if you still need help.",
  "Hey — sorry we missed you. Want a callback?",
  "Hey — got your missed call. Reply with the address and we’ll take it from there.",
] as const

/** One-tap ETA minutes on the Today board / composer. */
export const ETA_MINUTE_PRESETS = [5, 15, 23, 30] as const

/** Build a running-late SMS body from an ETA in minutes. */
export function buildRunningLateSms(etaMinutes: number): string {
  const mins = Math.max(1, Math.min(180, Math.round(etaMinutes) || 15))
  return `Running about ${mins} minutes late. Sorry about that.`
}

/** Build a plain “on my way” SMS with an ETA in minutes. */
export function buildOnMyWayEtaSms(etaMinutes: number): string {
  const mins = Math.max(1, Math.min(180, Math.round(etaMinutes) || 15))
  return `On my way — about ${mins} minutes out.`
}

/** Default ETA when the operator taps Running late without editing minutes. */
export const DEFAULT_LATE_ETA_MINUTES = 15
