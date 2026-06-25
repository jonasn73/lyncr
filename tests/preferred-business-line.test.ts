import { describe, expect, it } from "vitest"
import { pickPreferredCustomerLine } from "@/lib/preferred-business-line"

describe("pickPreferredCustomerLine", () => {
  const tempLine = {
    number: "+15022602716",
    status: "active",
    provider_number_sid: "pn_temp",
  }
  const portedLine = {
    number: "+15025571219",
    status: "active",
    provider_number_sid: "pn_ported",
  }

  it("prefers completed port target over temp active placeholder", () => {
    const pick = pickPreferredCustomerLine({
      lines: [tempLine, portedLine],
      completedPortTargets: ["+15025571219"],
      reservedNumber: "+15022602716",
      previousSelection: "+15022602716",
    })
    expect(pick).toBe("+15025571219")
  })

  it("prefers reserved_number when it matches an active carrier-live line", () => {
    const pick = pickPreferredCustomerLine({
      lines: [tempLine, portedLine],
      reservedNumber: "+15025571219",
      previousSelection: "+15022602716",
    })
    expect(pick).toBe("+15025571219")
  })
})
