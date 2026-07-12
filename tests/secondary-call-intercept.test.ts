import { describe, expect, it } from "vitest"
import {
  SECONDARY_DECLINE_SMS_TEMPLATE,
  SECONDARY_HOLD_SMS_TEMPLATE,
} from "@/lib/secondary-call-intercept"

describe("secondary call intercept SMS templates", () => {
  it("provides hold delay and decline stall copy", () => {
    expect(SECONDARY_HOLD_SMS_TEMPLATE.length).toBeGreaterThan(20)
    expect(SECONDARY_DECLINE_SMS_TEMPLATE.length).toBeGreaterThan(20)
    expect(SECONDARY_HOLD_SMS_TEMPLATE.toLowerCase()).toMatch(/text|minutes|call/)
    expect(SECONDARY_DECLINE_SMS_TEMPLATE.toLowerCase()).toMatch(/missed|back/)
  })
})
