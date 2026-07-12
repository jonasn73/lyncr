import { describe, expect, it } from "vitest"
import {
  MISSED_LEAD_INTERCEPT_SMS,
  MISSED_LEAD_SMS_TEMPLATES,
} from "@/lib/missed-lead-sms-templates"

describe("MISSED_LEAD_SMS_TEMPLATES", () => {
  it("exposes three locksmith intercept templates", () => {
    expect(MISSED_LEAD_SMS_TEMPLATES).toHaveLength(3)
    expect(MISSED_LEAD_SMS_TEMPLATES.map((t) => t.badge)).toEqual([
      "⚡ Standard Stall",
      "🚨 Repeat Rescue",
      "💰 Price Discount",
    ])
    for (const template of MISSED_LEAD_SMS_TEMPLATES) {
      expect(template.body.length).toBeGreaterThan(20)
    }
    expect(MISSED_LEAD_INTERCEPT_SMS).toBe(MISSED_LEAD_SMS_TEMPLATES[0]!.body)
  })
})
