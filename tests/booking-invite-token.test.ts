import { describe, expect, it } from "vitest"
import { normalizeBookingInviteToken } from "@/lib/booking-invite"

describe("normalizeBookingInviteToken", () => {
  it("strips trailing punctuation phones append when auto-linking", () => {
    expect(normalizeBookingInviteToken("QKZLHEAA.")).toBe("QKZLHEAA")
    expect(normalizeBookingInviteToken("QKZLHEAA,")).toBe("QKZLHEAA")
    expect(normalizeBookingInviteToken("QKZLHEAA!")).toBe("QKZLHEAA")
    expect(normalizeBookingInviteToken("QKZLHEAA/")).toBe("QKZLHEAA")
  })

  it("uppercases short codes and ignores surrounding noise", () => {
    expect(normalizeBookingInviteToken("qkzlheaa")).toBe("QKZLHEAA")
    expect(normalizeBookingInviteToken("QKZLHEAA We've got")).toBe("QKZLHEAA")
  })

  it("keeps UUID invites intact", () => {
    const id = "700c7ad3-c79f-4c57-8d18-2a8b98165b2b"
    expect(normalizeBookingInviteToken(id)).toBe(id)
    expect(normalizeBookingInviteToken(`${id}.`)).toBe(id)
  })
})
