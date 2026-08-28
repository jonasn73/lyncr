import { describe, expect, it } from "vitest"
import {
  customerFacingPhoneLines,
  isAmberControlLine,
} from "@/lib/control-line"
import { pickPreferredCustomerLine } from "@/lib/preferred-business-line"

describe("amber control line", () => {
  it("detects Amber by flag or label", () => {
    expect(isAmberControlLine({ is_amber_control: true })).toBe(true)
    expect(isAmberControlLine({ label: "Amber · Lyncr" })).toBe(true)
    expect(isAmberControlLine({ label: "Business Line" })).toBe(false)
  })

  it("drops Amber from shop line lists", () => {
    const lines = [
      { number: "+15025571219", label: "Business Line" },
      { number: "+15023471148", label: "Amber · Lyncr", is_amber_control: true },
    ]
    expect(customerFacingPhoneLines(lines).map((l) => l.number)).toEqual(["+15025571219"])
  })

  it("never picks Amber as the preferred shop line even if it was last selected", () => {
    const pick = pickPreferredCustomerLine({
      lines: [
        {
          number: "+15025571219",
          status: "active",
          label: "Business Line",
          provider_number_sid: "pn_biz",
        },
        {
          number: "+15023471148",
          status: "active",
          label: "Amber · Lyncr",
          is_amber_control: true,
          provider_number_sid: "pn_amber",
        },
      ],
      previousSelection: "+15023471148",
    })
    expect(pick).toBe("+15025571219")
  })
})
