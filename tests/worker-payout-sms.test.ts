import { describe, expect, it } from "vitest"
import { buildWorkerPayoutSms } from "@/lib/worker-payout-sms"

describe("buildWorkerPayoutSms", () => {
  it("formats the amount and method, no note line when none was given", () => {
    const text = buildWorkerPayoutSms(34000, "CASH", null)
    expect(text).toBe(["💵 PAYOUT RECORDED: $340.00", "Method: Cash"].join("\n"))
  })

  it("includes the note line when one is present", () => {
    const text = buildWorkerPayoutSms(12550, "VENMO", "Weeks of Sep 1-7")
    expect(text).toBe(
      ["💵 PAYOUT RECORDED: $125.50", "Method: Venmo", "Note: Weeks of Sep 1-7"].join("\n")
    )
  })

  it("always shows a positive amount even though the ledger row is negative", () => {
    const text = buildWorkerPayoutSms(-5000, "CHECK", null)
    expect(text).toContain("$50.00")
  })

  it("falls back to Other for an unrecognized method", () => {
    const text = buildWorkerPayoutSms(1000, "SOMETHING_NEW" as never, null)
    expect(text).toContain("Method: Other")
  })
})
