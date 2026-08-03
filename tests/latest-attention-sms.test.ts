import { describe, expect, it } from "vitest"
import {
  buildLatestAttentionSmsText,
  latestAttentionPhoneKey,
} from "@/lib/latest-attention-sms"

describe("latestAttentionPhoneKey", () => {
  it("normalizes to last 10 digits", () => {
    expect(latestAttentionPhoneKey("+1 (502) 555-1212")).toBe("5025551212")
    expect(latestAttentionPhoneKey("5025551212")).toBe("5025551212")
  })
})

describe("buildLatestAttentionSmsText", () => {
  it("builds a replied reminder with preview", () => {
    const text = buildLatestAttentionSmsText({
      event: "replied",
      customerName: "David",
      customerPhone: "+15025551212",
      preview: "Can you come sooner?",
    })
    expect(text).toContain("David replied")
    expect(text).toContain("Can you come sooner?")
    expect(text).toContain("/dashboard")
  })

  it("builds a book_form reminder", () => {
    const text = buildLatestAttentionSmsText({
      event: "book_form",
      customerName: "Jonas",
      customerPhone: "+15025369252",
      preview: "Customer submitted book form · ASAP",
    })
    expect(text).toContain("Customer submitted book form · ASAP")
    expect(text).toContain("Jonas")
    expect(text).toContain("/dashboard")
  })
})
