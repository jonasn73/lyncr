import { describe, expect, it } from "vitest"
import {
  buildHoldNoResponseSmsBody,
  isLocalNight,
  parseOwnerHandledCommand,
} from "@/lib/hold-no-response-followup"
import { nextScheduledOpeningLabel, type AccountWeeklyHours } from "@/lib/account-weekly-hours"

function weekdayHours(overrides?: Partial<AccountWeeklyHours>): AccountWeeklyHours {
  return {
    scheduleEnabled: true,
    timezone: "America/New_York",
    days: Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      enabled: dayOfWeek >= 1 && dayOfWeek <= 5,
      startTime: "09:00",
      endTime: "17:00",
    })),
    ...overrides,
  }
}

describe("nextScheduledOpeningLabel", () => {
  it("says tomorrow for a late-night weekday call", () => {
    // Tue 2026-09-15 23:48 ET = Wed 03:48 UTC.
    const label = nextScheduledOpeningLabel(weekdayHours(), new Date("2026-09-16T03:48:00Z"))
    expect(label).toBe("tomorrow at 9:00 AM")
  })

  it("says today when the opening is still ahead (just past midnight)", () => {
    // Wed 2026-09-16 00:20 ET — Wednesday opens at 9 AM later that morning.
    const label = nextScheduledOpeningLabel(weekdayHours(), new Date("2026-09-16T04:20:00Z"))
    expect(label).toBe("today at 9:00 AM")
  })

  it("skips disabled weekend days and names the weekday", () => {
    // Fri 2026-09-18 20:00 ET — Sat/Sun off, so next opening is Monday.
    const label = nextScheduledOpeningLabel(weekdayHours(), new Date("2026-09-19T00:00:00Z"))
    expect(label).toBe("Monday at 9:00 AM")
  })

  it("returns null when the schedule is disabled or empty", () => {
    expect(nextScheduledOpeningLabel(weekdayHours({ scheduleEnabled: false }))).toBeNull()
    const allOff = weekdayHours()
    allOff.days = allOff.days.map((d) => ({ ...d, enabled: false }))
    expect(nextScheduledOpeningLabel(allOff)).toBeNull()
  })
})

describe("isLocalNight", () => {
  it("treats late evening and pre-dawn as night, midday as day", () => {
    expect(isLocalNight("America/New_York", new Date("2026-09-16T03:48:00Z"))).toBe(true) // 11:48 PM ET
    expect(isLocalNight("America/New_York", new Date("2026-09-16T08:00:00Z"))).toBe(true) // 4:00 AM ET
    expect(isLocalNight("America/New_York", new Date("2026-09-16T16:00:00Z"))).toBe(false) // noon ET
  })
})

describe("buildHoldNoResponseSmsBody", () => {
  it("uses the honest + door-open copy with the next opening, link last", () => {
    const body = buildHoldNoResponseSmsBody({
      shopLabel: "Key Squad",
      night: true,
      nextOpenLabel: "tomorrow at 9:00 AM",
      link: "https://lyncr.app/b/4KGFXNSF",
    })
    expect(body).toBe(
      "Key Squad — sorry, our whole team is still unavailable tonight. We're back tomorrow at 9:00 AM and you're at the top of our list. If anything frees up sooner, we'll call you right away. Book anytime: https://lyncr.app/b/4KGFXNSF"
    )
    expect(body.endsWith("https://lyncr.app/b/4KGFXNSF")).toBe(true)
  })

  it("drops the opening time when the schedule can't provide one", () => {
    const body = buildHoldNoResponseSmsBody({
      shopLabel: "Key Squad",
      night: false,
      nextOpenLabel: null,
      link: "https://lyncr.app/b/AB12CD34",
    })
    expect(body).toContain("still unavailable right now")
    expect(body).not.toContain("We're back")
    expect(body.endsWith("https://lyncr.app/b/AB12CD34")).toBe(true)
  })
})

describe("parseOwnerHandledCommand", () => {
  it("accepts the keyword variants, case-insensitive", () => {
    expect(parseOwnerHandledCommand("HANDLED")).toEqual({ targetDigits: null })
    expect(parseOwnerHandledCommand("handled")).toEqual({ targetDigits: null })
    expect(parseOwnerHandledCommand("Got it")).toEqual({ targetDigits: null })
    expect(parseOwnerHandledCommand("on it!")).toEqual({ targetDigits: null })
    expect(parseOwnerHandledCommand("mine")).toEqual({ targetDigits: null })
  })

  it("captures trailing digits to target one customer", () => {
    expect(parseOwnerHandledCommand("HANDLED 0137")).toEqual({ targetDigits: "0137" })
    expect(parseOwnerHandledCommand("got it 5023220137")).toEqual({ targetDigits: "5023220137" })
  })

  it("rejects ordinary replies so customer texts are never eaten", () => {
    expect(parseOwnerHandledCommand("I handled the key yesterday")).toBeNull()
    expect(parseOwnerHandledCommand("yes")).toBeNull()
    expect(parseOwnerHandledCommand("3")).toBeNull()
    expect(parseOwnerHandledCommand("handled it perfectly, thanks")).toBeNull()
    expect(parseOwnerHandledCommand("")).toBeNull()
  })
})
