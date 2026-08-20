import { describe, expect, it } from "vitest"
import { parseViewportIsMobile, viewportCookieValue } from "@/lib/viewport-hint"

describe("viewport hint", () => {
  it("prefers the refresh cookie over client hints", () => {
    expect(parseViewportIsMobile("1", "?0", "1200")).toBe(true)
    expect(parseViewportIsMobile("0", "?1", "375")).toBe(false)
  })

  it("uses client hints when the cookie is missing", () => {
    expect(parseViewportIsMobile(undefined, "?1", null)).toBe(true)
    expect(parseViewportIsMobile(null, "?0", null)).toBe(false)
    expect(parseViewportIsMobile(undefined, null, "390")).toBe(true)
    expect(parseViewportIsMobile(undefined, null, "1024")).toBe(false)
  })

  it("returns unknown when nothing is available", () => {
    expect(parseViewportIsMobile(undefined, null, null)).toBeNull()
  })

  it("stores 1 for phone and 0 for computer", () => {
    expect(viewportCookieValue(true)).toBe("1")
    expect(viewportCookieValue(false)).toBe("0")
  })
})
