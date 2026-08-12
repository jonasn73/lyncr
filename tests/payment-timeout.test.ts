import { describe, expect, it, vi } from "vitest"
import {
  CARD_CHARGE_TIMEOUT_MESSAGE,
  PAYMENT_CONFIRM_TIMEOUT_MS,
  withTimeout,
} from "@/lib/payment-timeout"

describe("withTimeout", () => {
  it("resolves when the promise wins", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1000, "late")).resolves.toBe("ok")
  })

  it("rejects when the timeout wins", async () => {
    vi.useFakeTimers()
    const hanging = new Promise<string>(() => {
      /* never settles */
    })
    const raced = withTimeout(hanging, 50, CARD_CHARGE_TIMEOUT_MESSAGE)
    const assertion = expect(raced).rejects.toThrow(CARD_CHARGE_TIMEOUT_MESSAGE)
    await vi.advanceTimersByTimeAsync(50)
    await assertion
    vi.useRealTimers()
  })

  it("confirm ceiling is aggressive (≤30s)", () => {
    expect(PAYMENT_CONFIRM_TIMEOUT_MS).toBeLessThanOrEqual(30_000)
    expect(PAYMENT_CONFIRM_TIMEOUT_MS).toBeGreaterThanOrEqual(15_000)
  })
})
