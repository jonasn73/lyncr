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

/** Default ETA when the operator taps Running late without editing minutes. */
export const DEFAULT_LATE_ETA_MINUTES = 15
