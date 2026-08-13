import { describe, expect, it } from "vitest"
import {
  collectedChargeWalletLabel,
  collectedChargeWalletStatus,
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
