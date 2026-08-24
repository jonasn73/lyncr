import { describe, expect, it } from "vitest"
import { addUtcMonths, rollBillingCycleWindowForward } from "@/lib/billing-cycle-window"

describe("billing cycle roll-forward", () => {
  it("repairs the window that was reporting $0.00 on the live console", () => {
    // Exact values read from the production dashboard on 2026-08-24: a Stripe period that
    // closed 2026-06-18 and was still being returned verbatim two months later.
    const rolled = rollBillingCycleWindowForward(
      "2026-05-18T23:55:13.000Z",
      "2026-06-18T23:55:13.000Z",
      new Date("2026-08-24T16:00:00.000Z")
    )
    expect(rolled).toEqual({
      start: "2026-08-18T23:55:13.000Z",
      end: "2026-09-18T23:55:13.000Z",
    })
  })

  it("keeps the anchor day rather than restarting from today", () => {
    // Pay periods must stay aligned to the subscription date, not drift to whenever the
    // page happened to be loaded.
    const rolled = rollBillingCycleWindowForward(
      "2026-01-03T00:00:00.000Z",
      "2026-02-03T00:00:00.000Z",
      new Date("2026-08-24T16:00:00.000Z")
    )
    expect(rolled?.start).toBe("2026-08-03T00:00:00.000Z")
    expect(rolled?.end).toBe("2026-09-03T00:00:00.000Z")
  })

  it("leaves an open window untouched", () => {
    const window = {
      start: "2026-08-18T00:00:00.000Z",
      end: "2026-09-18T00:00:00.000Z",
    }
    expect(
      rollBillingCycleWindowForward(window.start, window.end, new Date("2026-08-24T16:00:00.000Z"))
    ).toEqual(window)
  })

  it("lands on a window that actually contains now", () => {
    const now = new Date("2026-08-24T16:00:00.000Z")
    const rolled = rollBillingCycleWindowForward(
      "2024-03-31T12:00:00.000Z",
      "2024-04-30T12:00:00.000Z",
      now
    )
    expect(rolled).not.toBeNull()
    expect(new Date(rolled!.start).getTime()).toBeLessThanOrEqual(now.getTime())
    expect(new Date(rolled!.end).getTime()).toBeGreaterThan(now.getTime())
  })

  it("advances sub-month cycles by their exact duration", () => {
    // Weekly cycle — month arithmetic would not move it at all.
    const rolled = rollBillingCycleWindowForward(
      "2026-08-03T00:00:00.000Z",
      "2026-08-10T00:00:00.000Z",
      new Date("2026-08-24T16:00:00.000Z")
    )
    expect(rolled).toEqual({
      start: "2026-08-24T00:00:00.000Z",
      end: "2026-08-31T00:00:00.000Z",
    })
  })

  it("returns null for an unusable window so callers fall back to a calendar month", () => {
    expect(rollBillingCycleWindowForward("nonsense", "2026-06-18T00:00:00.000Z", new Date())).toBeNull()
    // end before start
    expect(
      rollBillingCycleWindowForward("2026-06-18T00:00:00.000Z", "2026-05-18T00:00:00.000Z", new Date())
    ).toBeNull()
  })
})

describe("addUtcMonths", () => {
  it("clamps a month-end anchor instead of overflowing", () => {
    // Jan 31 + 1 month must be Feb 28, not Mar 2/3.
    expect(addUtcMonths(new Date("2026-01-31T00:00:00.000Z"), 1).toISOString()).toBe(
      "2026-02-28T00:00:00.000Z"
    )
  })

  it("handles leap years", () => {
    expect(addUtcMonths(new Date("2024-01-31T00:00:00.000Z"), 1).toISOString()).toBe(
      "2024-02-29T00:00:00.000Z"
    )
  })

  it("crosses year boundaries in both directions", () => {
    expect(addUtcMonths(new Date("2026-11-15T00:00:00.000Z"), 3).toISOString()).toBe(
      "2027-02-15T00:00:00.000Z"
    )
    expect(addUtcMonths(new Date("2026-02-15T00:00:00.000Z"), -3).toISOString()).toBe(
      "2025-11-15T00:00:00.000Z"
    )
  })
})
