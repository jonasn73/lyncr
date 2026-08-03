// CRM / Money helpers — walk-up paid totals and payment status labels stay consistent.
import { describe, expect, it } from "vitest"
import { sumCompletedCollectedCents, type OwnerCollectedTransaction } from "@/lib/owner-collected"

function tx(
  partial: Partial<OwnerCollectedTransaction> & Pick<OwnerCollectedTransaction, "id" | "amount" | "status">
): OwnerCollectedTransaction {
  return {
    paymentMethod: "MANUAL_CARD",
    createdAt: "2026-07-24T22:25:41.721Z",
    jobId: null,
    customerName: "Drius Bell",
    customerPhone: "+18125576793",
    jobLabel: null,
    stripePaymentIntentId: "pi_test",
    tipCents: null,
    hasSignature: false,
    ...partial,
  }
}

describe("sumCompletedCollectedCents", () => {
  it("sums only COMPLETED wallet charges into LTV cents", () => {
    const cents = sumCompletedCollectedCents([
      tx({ id: "1", amount: 371, status: "COMPLETED" }),
      tx({ id: "2", amount: 50, status: "PENDING" }),
      tx({ id: "3", amount: 20, status: "FAILED" }),
      tx({ id: "4", amount: 29.5, status: "COMPLETED" }),
    ])
    // $371 + $29.50 = 40050 cents
    expect(cents).toBe(40050)
  })

  it("returns 0 for an empty list", () => {
    expect(sumCompletedCollectedCents([])).toBe(0)
  })
})
