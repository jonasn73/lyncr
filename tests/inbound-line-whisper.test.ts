import { describe, expect, it } from "vitest"
import { buildInboundLineWhisperPhrase, sanitizeWhisperPhrase } from "@/lib/inbound-line-whisper"

describe("buildInboundLineWhisperPhrase", () => {
  it("uses custom line label when not Main Line", () => {
    expect(buildInboundLineWhisperPhrase("Dispatch", "", "+15025199741")).toBe("Dispatch")
  })

  it("uses friendly name when label is Main Line", () => {
    expect(buildInboundLineWhisperPhrase("Main Line", "(502) 519-9741", "+15025199741")).toContain("502")
  })

  it("uses last four digits when no label or friendly name", () => {
    const s = buildInboundLineWhisperPhrase("Main Line", "", "+15025199741")
    expect(s).toMatch(/9\s+7\s+4\s+1/)
  })

  it("does not include account business name", () => {
    const s = buildInboundLineWhisperPhrase("Sales Line", "", "+15551234567")
    expect(s).toBe("Sales Line")
    expect(s.toLowerCase()).not.toContain("acme")
  })
})

describe("sanitizeWhisperPhrase", () => {
  it("strips script-like characters", () => {
    expect(sanitizeWhisperPhrase("A<script>x</script>")).not.toMatch(/</)
  })

  it("respects max length", () => {
    const long = "a".repeat(200)
    expect(sanitizeWhisperPhrase(long, 20).length).toBeLessThanOrEqual(20)
  })
})
