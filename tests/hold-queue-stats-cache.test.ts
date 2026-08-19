import { describe, expect, it, beforeEach, afterEach, vi } from "vitest"
import {
  holdQueueStatsHaveTodayActivity,
  normalizeHoldQueueStatsPaintSeed,
  readHoldQueueStatsFromCookieRaw,
  writeHoldQueueStatsCache,
  HOLD_QUEUE_STATS_COOKIE,
} from "@/lib/hold-queue-stats-cache"
import { writePaintSeedCookie } from "@/lib/paint-seed-cookie"
import { localDateTimePartsInZone } from "@/lib/schedule-blockouts"

describe("hold-queue-stats-cache", () => {
  const store: Record<string, string> = {}
  const session: Record<string, string> = {}

  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k])
    Object.keys(session).forEach((k) => delete session[k])
    vi.stubGlobal("document", {
      get cookie() {
        return Object.entries(store)
          .map(([k, v]) => `${k}=${v}`)
          .join("; ")
      },
      set cookie(value: string) {
        const [pair] = value.split(";")
        const eq = pair.indexOf("=")
        const key = pair.slice(0, eq)
        const val = pair.slice(eq + 1)
        if (value.includes("Max-Age=0")) delete store[key]
        else store[key] = val
      },
    })
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => session[k] ?? null,
      setItem: (k: string, v: string) => {
        session[k] = v
      },
      removeItem: (k: string) => {
        delete session[k]
      },
    })
    vi.stubGlobal("window", {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("shows the Today bar when Left / Answer / Press 1 is above zero", () => {
    expect(
      holdQueueStatsHaveTodayActivity({
        waiting: 0,
        answered: 0,
        press1: 0,
        abandoned: 3,
        avgWaitSecs: 301,
      })
    ).toBe(true)
    expect(
      holdQueueStatsHaveTodayActivity({
        waiting: 0,
        answered: 0,
        press1: 0,
        abandoned: 0,
        avgWaitSecs: null,
      })
    ).toBe(false)
    expect(holdQueueStatsHaveTodayActivity(null)).toBe(false)
  })

  it("zeros counts when the day key is stale", () => {
    const seed = normalizeHoldQueueStatsPaintSeed({
      waiting: 0,
      answered: 1,
      press1: 2,
      abandoned: 3,
      avgWaitSecs: 10,
      localDayPeriodKey: "2000-01-01",
    })
    expect(seed).toEqual(
      expect.objectContaining({
        answered: 0,
        press1: 0,
        abandoned: 0,
        avgWaitSecs: null,
      })
    )
  })

  it("keeps counts when the day key matches today", () => {
    const tz = "America/New_York"
    const seed = normalizeHoldQueueStatsPaintSeed({
      waiting: 0,
      answered: 0,
      press1: 0,
      abandoned: 3,
      avgWaitSecs: 301,
      localDayPeriodKey: localDateTimePartsInZone(new Date(), tz).dateKey,
      timeZone: tz,
    })
    expect(seed).toEqual(
      expect.objectContaining({ answered: 0, press1: 0, abandoned: 3, avgWaitSecs: 301 })
    )
  })

  it("keeps Eastern today after UTC midnight (8pm Louisville)", () => {
    // 10pm Eastern Aug 19 2026 = 02:00 UTC Aug 20 — Vercel’s date is “tomorrow”.
    const utcTomorrow = new Date("2026-08-20T02:00:00.000Z")
    const seed = normalizeHoldQueueStatsPaintSeed(
      {
        waiting: 0,
        answered: 0,
        press1: 0,
        abandoned: 3,
        avgWaitSecs: 301,
        localDayPeriodKey: "2026-08-19",
        timeZone: "America/New_York",
      },
      utcTomorrow
    )
    expect(seed).toEqual(
      expect.objectContaining({ abandoned: 3, avgWaitSecs: 301, localDayPeriodKey: "2026-08-19" })
    )
    expect(holdQueueStatsHaveTodayActivity(seed)).toBe(true)
  })

  it("writes a cookie the SSR layout can parse", () => {
    writeHoldQueueStatsCache({
      waiting: 0,
      answered: 0,
      press1: 0,
      abandoned: 3,
      avgWaitSecs: 301,
    })
    expect(store[HOLD_QUEUE_STATS_COOKIE] || store[Object.keys(store)[0]]).toBeTruthy()
    writePaintSeedCookie("hold-queue-day-stats", {
      waiting: 0,
      answered: 0,
      press1: 0,
      abandoned: 3,
      avgWaitSecs: 301,
      localDayPeriodKey: localDateTimePartsInZone(new Date(), "America/New_York").dateKey,
      timeZone: "America/New_York",
    })
    const raw = Object.values(store)[0]
    const parsed = readHoldQueueStatsFromCookieRaw(raw)
    expect(parsed?.abandoned).toBe(3)
    expect(holdQueueStatsHaveTodayActivity(parsed)).toBe(true)
  })
})
