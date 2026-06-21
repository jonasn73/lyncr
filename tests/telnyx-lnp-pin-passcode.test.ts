import { describe, it, expect } from "vitest"

/** Mirror Telnyx admin field names — regression for PASSCODE_PIN_INVALID fixes. */
function buildPinPatchBody(pin: string): Record<string, unknown> {
  return { end_user: { admin: { pin_passcode: pin.trim() } } }
}

describe("telnyx lnp pin passcode", () => {
  it("PATCH body uses pin_passcode not pin", () => {
    const body = buildPinPatchBody("1230")
    const admin = (body.end_user as { admin: Record<string, string> }).admin
    expect(admin.pin_passcode).toBe("1230")
    expect(admin.pin).toBeUndefined()
  })
})
