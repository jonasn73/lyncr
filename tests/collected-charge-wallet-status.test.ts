import { describe, expect, it } from "vitest"
import {
  collectedChargeWalletLabel,
  collectedChargeWalletStatus,
  formatCollectedDollars,
  isStalePendingCollectedCharge,
} from "@/lib/owner-collected"

const now = Date.parse("2026-08-12T20:00:00.000Z")

describe("collectedChargeWalletStatus", () => {
  it("marks a card charge from today as Clearing (not Paid)", () => {
    const status = collectedChargeWalletStatus(
      {
        status: "COMPLETED",
        paymentMethod: "MANUAL_CARD",
        createdAt: "2026-08-12T20:12:00.000Z",
      },
      now
    )
    expect(status).toBe("clearing")
    expect(collectedChargeWalletLabel(status)).toBe("Clearing")
  })

  it("marks a card charge older than 2 days as Paid", () => {
    const status = collectedChargeWalletStatus(
      {
        status: "COMPLETED",
        paymentMethod: "TAP_TO_PAY",
        createdAt: "2026-08-09T12:00:00.000Z",
      },
      now
    )
    expect(status).toBe("paid")
    expect(collectedChargeWalletLabel(status)).toBe("Paid")
  })

  it("keeps cash as Paid immediately", () => {
    expect(
      collectedChargeWalletStatus(
        {
          status: "COMPLETED",
          paymentMethod: "CASH",
          createdAt: "2026-08-12T19:00:00.000Z",
        },
        now
      )
    ).toBe("paid")
  })

  it("hides abandoned PENDING walk-ups after 20 minutes", () => {
    expect(
      isStalePendingCollectedCharge(
        { status: "PENDING", createdAt: "2026-08-12T00:37:52.415Z" },
        now
      )
    ).toBe(true)
    expect(
      isStalePendingCollectedCharge(
        { status: "PENDING", createdAt: "2026-08-12T19:50:00.000Z" },
        now
      )
    ).toBe(false)
    expect(
      isStalePendingCollectedCharge(
        { status: "COMPLETED", createdAt: "2026-08-12T00:38:07.193Z" },
        now
      )
    ).toBe(false)
  })

  it("keeps failed / unsettled statuses", () => {
    expect(
      collectedChargeWalletStatus(
        { status: "FAILED", paymentMethod: "MANUAL_CARD", createdAt: "2026-08-12T19:00:00.000Z" },
        now
      )
    ).toBe("failed")
    expect(
      collectedChargeWalletStatus(
        { status: "PENDING", paymentMethod: "MANUAL_CARD", createdAt: "2026-08-12T19:00:00.000Z" },
        now
      )
    ).toBe("pending")
  })
})

describe("formatCollectedDollars with reversals", () => {
  it("renders money going back out as negative, not clamped to $0", () => {
    // Reversal rows (migration 154) are negative. Clamping made a refund read as "$0",
    // which looks like a bug rather than money returned.
    expect(formatCollectedDollars(-12000)).toBe("-$120")
    expect(formatCollectedDollars(-4550)).toBe("-$45.50")
  })

  it("still formats collected amounts unchanged", () => {
    expect(formatCollectedDollars(12000)).toBe("$120")
    expect(formatCollectedDollars(4550)).toBe("$45.50")
    expect(formatCollectedDollars(null)).toBe("—")
  })
})
