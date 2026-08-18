import { describe, expect, it } from "vitest"
import {
  amberHelpText,
  parseAmberCommand,
  resolveAmberUntilInstant,
} from "@/lib/amber-commands"

describe("parseAmberCommand", () => {
  it("parses HELP STATUS AVAILABLE BUSY", () => {
    expect(parseAmberCommand("HELP").kind).toBe("help")
    expect(parseAmberCommand("STATUS").kind).toBe("status")
    expect(parseAmberCommand("AVAILABLE").kind).toBe("available")
    expect(parseAmberCommand("BUSY").kind).toBe("busy")
  })

  it("parses busy until time", () => {
    const cmd = parseAmberCommand("Make me busy until 4:30. I'm on a job.")
    expect(cmd.kind).toBe("busy")
    if (cmd.kind === "busy") {
      expect(cmd.untilLocalTime).toMatch(/4:30/i)
    }
  })

  it("returns unknown for gibberish", () => {
    expect(parseAmberCommand("pizza please").kind).toBe("unknown")
  })
})

describe("resolveAmberUntilInstant", () => {
  it("resolves a future wall time in a timezone", () => {
    // Fixed "now" morning Eastern so 4:30pm is later today.
    const nowMs = Date.parse("2026-08-16T14:00:00.000Z") // 10:00 AM EDT
    const when = resolveAmberUntilInstant({
      untilLocalTime: "4:30pm",
      timezone: "America/New_York",
      nowMs,
    })
    expect(when).not.toBeNull()
    expect(when!.getTime()).toBeGreaterThan(nowMs)
  })
})

describe("amberHelpText", () => {
  it("mentions Amber and BUSY", () => {
    expect(amberHelpText()).toContain("Amber")
    expect(amberHelpText()).toContain("BUSY")
    expect(amberHelpText()).toContain("45 min")
  })
})
