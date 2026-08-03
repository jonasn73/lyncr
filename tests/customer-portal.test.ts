import { describe, expect, it } from "vitest"
import {
  customerPortalBookSuccessCopy,
  customerPortalStepLabel,
  customerPortalStepsForMode,
} from "@/lib/customer-portal"

describe("customer portal journey helpers", () => {
  it("orders book → pay → done for slot booking", () => {
    expect(customerPortalStepsForMode("book")).toEqual(["book", "pay", "done"])
  })

  it("skips pay for missed-call callback mode", () => {
    expect(customerPortalStepsForMode("callback")).toEqual(["book", "done"])
  })

  it("keeps short rails for pay and review surfaces", () => {
    expect(customerPortalStepsForMode("pay")).toEqual(["pay", "done"])
    expect(customerPortalStepsForMode("review")).toEqual(["review", "done"])
  })

  it("labels steps for the step rail", () => {
    expect(customerPortalStepLabel("book")).toBe("Book")
    expect(customerPortalStepLabel("book", "callback")).toBe("Request")
    expect(customerPortalStepLabel("pay")).toBe("Pay")
    expect(customerPortalStepLabel("review")).toBe("Review")
  })

  it("returns ASAP emergency copy when flagged", () => {
    const copy = customerPortalBookSuccessCopy({ mode: "callback", asap: true })
    expect(copy.title.toLowerCase()).toContain("emergency")
    expect(copy.body.toLowerCase()).toContain("asap")
  })

  it("returns callback follow-up copy (we'll call you)", () => {
    const copy = customerPortalBookSuccessCopy({ mode: "callback" })
    expect(copy.title).toMatch(/request/i)
    expect(copy.nextHint.toLowerCase()).toContain("call")
  })

  it("hints deposit pay next when booking without deposit success", () => {
    const copy = customerPortalBookSuccessCopy({ mode: "book" })
    expect(copy.nextHint.toLowerCase()).toContain("deposit")
  })

  it("confirms deposit success and mentions later review", () => {
    const copy = customerPortalBookSuccessCopy({ mode: "book", depositSuccess: true })
    expect(copy.title).toMatch(/deposit/i)
    expect(copy.nextHint.toLowerCase()).toContain("review")
  })
})
