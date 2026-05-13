import { describe, expect, it } from "vitest"
import { buildInboundLineWhisperPhrase, sanitizeWhisperPhrase } from "@/lib/inbound-line-whisper"

describe("buildInboundLineWhisperPhrase", () => {
  it("prefixes account business name before custom line label", () => {
    const s = buildInboundLineWhisperPhrase("Acme Plumbing", "Dispatch", "", "+15025199741")
    expect(s.startsWith("Acme Plumbing")).toBe(true)
    expect(s).toContain("Dispatch")
  })

  it("uses custom label only when business name is empty", () => {
    const s = buildInboundLineWhisperPhrase("   ", "Key Squad 502", "", "+15025199741")
    expect(s).toBe("Key Squad 502")
  })

  it("does not duplicate when line label matches business name", () => {
    expect(buildInboundLineWhisperPhrase("Acme", "Acme", "", "+15025199741")).toBe("Acme")
  })

  it("falls back to friendly name when label is Main Line", () => {
    const s = buildInboundLineWhisperPhrase("Big Co", "Main Line", "(502) 519-9741", "+15025199741")
    expect(s.startsWith("Big Co")).toBe(true)
    expect(s).toContain("502")
  })

  it("uses last four digits when no label or friendly name", () => {
    const s = buildInboundLineWhisperPhrase("Solo LLC", "Main Line", "", "+15025199741")
    expect(s.startsWith("Solo LLC")).toBe(true)
    expect(s).toMatch(/9\s+7\s+4\s+1/)
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
