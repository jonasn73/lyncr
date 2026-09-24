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

  it("includes submitted details when Latest is the booking lead alert", () => {
    const text = buildLatestAttentionSmsText({
      event: "book_form",
      businessName: "Key Squad 502",
      customerPhone: "+15025369252",
      bookFormLead: {
        intentSlug: null,
        summary: "All keys lost — Alex Customer",
        collected: {
          customer_name: "Alex Customer",
          service_type: "All keys lost",
          vehicle_year: "2015",
          vehicle_make: "Toyota",
          vehicle_model: "Camry",
          job_address: "123 Main St",
          customer_notes: "Please call before arriving",
          availability: "Thursday 1–3 PM",
        },
      },
    })
    for (const detail of ["Key Squad 502", "Alex Customer", "2015 Toyota Camry", "123 Main St", "Please call before arriving", "Thursday 1–3 PM", "/dashboard"]) {
      expect(text).toContain(detail)
    }
  })
})
