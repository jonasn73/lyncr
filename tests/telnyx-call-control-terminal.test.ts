import { describe, expect, it } from "vitest"
import {
  isTelnyxCallControlKnownTerminal,
  isTelnyxCallNoLongerActiveError,
  markTelnyxCallControlTerminal,
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

describe("known terminal call control ids", () => {
  it("remembers marked legs for skip/idempotent hangup", () => {
    const id = `test-cc-${Date.now()}`
    expect(isTelnyxCallControlKnownTerminal(id)).toBe(false)
    markTelnyxCallControlTerminal(id)
    expect(isTelnyxCallControlKnownTerminal(id)).toBe(true)
  })
})
