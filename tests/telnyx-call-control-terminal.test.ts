import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  isTelnyxCallControlKnownTerminal,
  isTelnyxCallNoLongerActiveError,
  isTelnyxCallNotInQueueError,
  markTelnyxCallControlTerminal,
  telnyxCallControlLeaveQueue,
} from "@/lib/telnyx-call-control-api"

describe("isTelnyxCallNoLongerActiveError", () => {
  it("detects Telnyx code 90018", () => {
    expect(
      isTelnyxCallNoLongerActiveError(
        422,
        { errors: [{ code: "90018", detail: "This call is no longer active and can't receive commands." }] },
        "This call is no longer active and can't receive commands."
      )
    ).toBe(true)
  })

  it("detects numeric code 90018", () => {
    expect(
      isTelnyxCallNoLongerActiveError(422, { errors: [{ code: 90018, detail: "gone" }] }, "gone")
    ).toBe(true)
  })

  it("does not treat unrelated 422s as terminal", () => {
    expect(
      isTelnyxCallNoLongerActiveError(
        422,
        { errors: [{ code: "10010", detail: "Invalid parameter" }] },
        "Invalid parameter"
      )
    ).toBe(false)
  })
})

describe("isTelnyxCallNotInQueueError", () => {
  it("detects Telnyx code 90035", () => {
    expect(
      isTelnyxCallNotInQueueError(
        422,
        { errors: [{ code: "90035", detail: "Call v3:abc isn't in a queue." }] },
        "Call v3:abc isn't in a queue."
      )
    ).toBe(true)
  })

  it("detects the detail text even without a matching code", () => {
    expect(isTelnyxCallNotInQueueError(422, {}, "Call v3:abc isn't in a queue.")).toBe(true)
  })

  it("does not treat unrelated 422s as an already-left-queue race", () => {
    expect(
      isTelnyxCallNotInQueueError(
        422,
        { errors: [{ code: "10010", detail: "Invalid parameter" }] },
        "Invalid parameter"
      )
    ).toBe(false)
  })

  it("does not overlap with the no-longer-active (90018) check", () => {
    expect(
      isTelnyxCallNotInQueueError(
        422,
        { errors: [{ code: "90018", detail: "This call is no longer active and can't receive commands." }] },
        "This call is no longer active and can't receive commands."
      )
    ).toBe(false)
  })
})

describe("telnyxCallControlLeaveQueue — 90035 race", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock)
    vi.stubEnv("TELNYX_API_KEY", "test-key")
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it("treats 'not in a queue' as success (already left another way), not an error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        errors: [{ code: "90035", detail: "Call v3:abc isn't in a queue." }],
      }),
    })

    const result = await telnyxCallControlLeaveQueue("v3:abc")

    expect(result).toEqual({ ok: true, alreadyTerminal: true })
    // This is the actual regression: it used to log as telnyx-cc-api-failed (console.error),
    // showing up as a Vercel runtime error for a race every call site already ignores.
    expect(errorSpy).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("telnyx-cc-api-already-left-queue"))

    errorSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it("still logs as an error for a genuinely unexpected leave_queue failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ errors: [{ code: "99999", detail: "Internal error" }] }),
    })

    const result = await telnyxCallControlLeaveQueue("v3:abc")

    expect(result.ok).toBe(false)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("telnyx-cc-api-failed"))

    errorSpy.mockRestore()
  })
})

describe("known terminal call control ids", () => {
  it("remembers marked legs for skip/idempotent hangup", () => {
    const id = `test-cc-${Date.now()}`
    expect(isTelnyxCallControlKnownTerminal(id)).toBe(false)
    markTelnyxCallControlTerminal(id)
    expect(isTelnyxCallControlKnownTerminal(id)).toBe(true)
  })
})
