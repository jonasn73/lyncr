// Locksmith SMS templates for missed-lead recovery intercept.

export type MissedLeadSmsTemplateId = "standard_stall" | "repeat_rescue"

export type MissedLeadSmsTemplate = {
  id: MissedLeadSmsTemplateId
  /** Title badge shown in the interceptor sheet. */
  badge: string
  /** Exact outbound SMS body. */
  body: string
}

/** One-tap recovery texts — no fake ETAs or discount prices. */
export const MISSED_LEAD_SMS_TEMPLATES: readonly MissedLeadSmsTemplate[] = [
  {
    id: "standard_stall",
    badge: "Sorry we missed you",
    body: "Hey — sorry we missed your call. Text us here if you still need help or anything changed.",
  },
  {
    id: "repeat_rescue",
    badge: "Still need help?",
    body: "Hey — just checking in, do you still need help? Text us here for any update or change.",
  },
] as const

/** Default hold-message copy — kept for callers that still import the old constant. */
export const MISSED_LEAD_INTERCEPT_SMS = MISSED_LEAD_SMS_TEMPLATES[0]!.body
