import { describe, expect, it } from "vitest"
import { walletStatusFromInvoice } from "@/lib/tech-wallet"

describe("walletStatusFromInvoice", () => {
  it("maps cash paid → COMPLETED + CASH", () => {
    expect(walletStatusFromInvoice({ paymentStatus: "paid", paymentMethod: "cash" })).toEqual({
      status: "COMPLETED",
      paymentMethod: "CASH",
    })
  })

  it("maps card pending → PENDING + MANUAL_CARD", () => {
    expect(walletStatusFromInvoice({ paymentStatus: "pending", paymentMethod: "card" })).toEqual({
      status: "PENDING",
      paymentMethod: "MANUAL_CARD",
    })
  })

  it("maps recorded card → PENDING", () => {
    expect(walletStatusFromInvoice({ paymentStatus: "recorded", paymentMethod: "card" })).toEqual({
      status: "PENDING",
      paymentMethod: "MANUAL_CARD",
    })
  })
})
