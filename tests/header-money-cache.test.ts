import { describe, expect, it } from "vitest"
import { resolveHeaderWalletChipDisplay } from "@/lib/header-money-cache"

describe("resolveHeaderWalletChipDisplay", () => {
  it("shows Available balance even when customers paid today (wallet ≠ sales)", () => {
    // Bug report: $1 today made the chip drop from ~$196 Available → $1.
    const chip = resolveHeaderWalletChipDisplay(19_600, 0, 100)
    expect(chip.mode).toBe("in_account")
    expect(chip.amountCents).toBe(19_600)
    expect(chip.chipLabel).toBe("Available")
  })

  it("falls back to Pending when nothing is Available yet", () => {
    const chip = resolveHeaderWalletChipDisplay(0, 5_000, 200)
    expect(chip.mode).toBe("pending")
    expect(chip.amountCents).toBe(5_000)
    expect(chip.chipLabel).toBe("Pending")
  })

  it("shows empty wallet when Available and Pending are both zero", () => {
    const chip = resolveHeaderWalletChipDisplay(0, 0, 9_900)
    expect(chip.mode).toBe("zero")
    expect(chip.amountCents).toBe(0)
    expect(chip.chipLabel).toBe("In Stripe")
  })
})
