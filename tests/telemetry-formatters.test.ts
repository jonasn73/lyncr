import { describe, expect, it } from "vitest"
import { formatSecondsToClock, formatTalkHudMinutes, parseTalkSecondsFromDisplay } from "@/lib/telemetry-formatters"

describe("formatSecondsToClock", () => {
  it("formats sub-hour durations as m:ss", () => {
    expect(formatSecondsToClock(0)).toBe("0:00")
    expect(formatSecondsToClock(5)).toBe("0:05")
    expect(formatSecondsToClock(65)).toBe("1:05")
    expect(formatSecondsToClock(725)).toBe("12:05")
  })

  it("formats hour-plus durations as h:mm:ss", () => {
    expect(formatSecondsToClock(3600)).toBe("1:00:00")
    expect(formatSecondsToClock(3661)).toBe("1:01:01")
  })

  it("returns 0:00 for invalid input", () => {
    expect(formatSecondsToClock(undefined)).toBe("0:00")
    expect(formatSecondsToClock(null)).toBe("0:00")
    expect(formatSecondsToClock(Number.NaN)).toBe("0:00")
  })
})

describe("formatTalkHudMinutes", () => {
  it("uses total minutes so HUD pills share one m:ss shape", () => {
    expect(formatTalkHudMinutes(541)).toBe("9:01")
    expect(formatTalkHudMinutes(3058)).toBe("50:58")
    expect(formatTalkHudMinutes(8173)).toBe("136:13")
  })
})

describe("parseTalkSecondsFromDisplay", () => {
  it("round-trips common HUD display strings", () => {
    expect(parseTalkSecondsFromDisplay("12:05")).toBe(725)
    expect(parseTalkSecondsFromDisplay("136:13")).toBe(8173)
    expect(parseTalkSecondsFromDisplay("1:02:03")).toBe(3723)
    expect(parseTalkSecondsFromDisplay("")).toBe(0)
  })
})
