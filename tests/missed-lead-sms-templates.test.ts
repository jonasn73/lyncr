import { describe, expect, it } from "vitest"
import {
  MISSED_LEAD_INTERCEPT_SMS,
  MISSED_LEAD_SMS_TEMPLATES,
} from "@/lib/missed-lead-sms-templates"

describe("MISSED_LEAD_SMS_TEMPLATES", () => {
  it("exposes two human intercept templates without fake prices or ETAs", () => {
    expect(MISSED_LEAD_SMS_TEMPLATES).toHaveLength(2)
    expect(MISSED_LEAD_SMS_TEMPLATES.map((t) => t.badge)).toEqual([
      "Sorry we missed you",
      "Still need help?",
    ])
    for (const template of MISSED_LEAD_SMS_TEMPLATES) {
      expect(template.body.length).toBeGreaterThan(20)
      expect(template.body.toLowerCase()).not.toContain("$20")
      expect(template.body.toLowerCase()).not.toContain("5 minutes")
    }
    expect(MISSED_LEAD_INTERCEPT_SMS).toBe(MISSED_LEAD_SMS_TEMPLATES[0]!.body)
  })
})
