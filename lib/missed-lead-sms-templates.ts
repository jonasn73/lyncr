// Locksmith SMS templates for missed-lead recovery intercept.

export type MissedLeadSmsTemplateId = "standard_stall" | "repeat_rescue" | "price_discount"

export type MissedLeadSmsTemplate = {
  id: MissedLeadSmsTemplateId
  /** Title badge shown in the interceptor sheet. */
  badge: string
  /** Exact outbound SMS body. */
  body: string
}

/** Three one-tap locksmith recovery templates. */
export const MISSED_LEAD_SMS_TEMPLATES: readonly MissedLeadSmsTemplate[] = [
  {
    id: "standard_stall",
    badge: "⚡ Standard Stall",
    body: "Hey, sorry we missed your call! We have an active technician near your area right now — reply with your address and we'll lock in an ETA.",
  },
  {
    id: "repeat_rescue",
    badge: "🚨 Repeat Rescue",
    body: "We see you've called a few times — you're our top priority. Text this number back or reply YES and a locksmith will call you within 5 minutes.",
  },
  {
    id: "price_discount",
    badge: "💰 Price Discount",
    body: "Still locked out? We can knock $20 off a standard service call if you book in the next hour — reply BOOK and we'll get rolling.",
  },
] as const

/** Default hold-message copy (Standard Stall) — kept for callers that still import the old constant. */
export const MISSED_LEAD_INTERCEPT_SMS = MISSED_LEAD_SMS_TEMPLATES[0]!.body
