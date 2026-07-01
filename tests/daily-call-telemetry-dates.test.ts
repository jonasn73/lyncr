import { describe, expect, it } from "vitest"
import { isUtcToday } from "@/lib/daily-call-telemetry"

describe("isUtcToday", () => {
  it("matches Neon UTC day boundaries used by HUD telemetry", () => {
    const now = new Date("2026-07-01T05:08:27.015Z")
    expect(isUtcToday("2026-07-01T03:33:23.812Z", now)).toBe(true)
    expect(isUtcToday("2026-06-30T23:57:00.310Z", now)).toBe(false)
  })
})
