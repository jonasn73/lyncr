import { describe, expect, it } from "vitest"
import { looksLikePhoneQuery, pickCrmCustomerIdForPhone } from "@/lib/crm-phone-match"

describe("pickCrmCustomerIdForPhone", () => {
  it("opens the matching customer, not a hunt through the list", () => {
    expect(
      pickCrmCustomerIdForPhone(
        [
          { id: "a", phone_e164: "+15025550112" },
          { id: "isaac", phone_e164: "+15028762058" },
        ],
        "(502) 876-2058"
      )
    ).toBe("isaac")
  })

  it("returns null when nobody matches", () => {
    expect(
      pickCrmCustomerIdForPhone([{ id: "a", phone_e164: "+15025550112" }], "+15028762058")
    ).toBeNull()
  })
})

describe("looksLikePhoneQuery", () => {
  it("treats a Messages deep-link phone as a phone search", () => {
    expect(looksLikePhoneQuery("+15026018134")).toBe(true)
    expect(looksLikePhoneQuery("Isaac")).toBe(false)
  })
})
