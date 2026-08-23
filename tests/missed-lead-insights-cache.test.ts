import { describe, expect, it, beforeEach, afterEach, vi } from "vitest"
import {
  normalizeMissedLeadsPaintSeed,
  readMissedLeadsFromCookieRaw,
  writeMissedLeadsCache,
  MISSED_LEADS_COOKIE,
} from "@/lib/missed-lead-insights-cache"
import { writePaintSeedCookie, paintSeedCookieName } from "@/lib/paint-seed-cookie"
import { telemetryLocalDayPeriodKey } from "@/lib/daily-call-telemetry"

describe("missed-lead-insights-cache", () => {
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

  it("zeros counts when day key is stale", () => {
    const seed = normalizeMissedLeadsPaintSeed({
      uniqueLeadsToday: 1,
      totalMissedToday: 2,
      localDayPeriodKey: "2000-01-01",
    })
    expect(seed).toEqual(
      expect.objectContaining({ uniqueLeadsToday: 0, totalMissedToday: 0 })
    )
  })

  it("keeps counts when day key matches today", () => {
    const seed = normalizeMissedLeadsPaintSeed({
      uniqueLeadsToday: 1,
      totalMissedToday: 2,
      localDayPeriodKey: telemetryLocalDayPeriodKey(),
      fetchedAtMs: Date.now(),
    })
    expect(seed).toEqual(
      expect.objectContaining({ uniqueLeadsToday: 1, totalMissedToday: 2 })
    )
  })

  it("keeps counts when day key is omitted", () => {
    const seed = normalizeMissedLeadsPaintSeed({
      uniqueLeadsToday: 1,
      totalMissedToday: 2,
      fetchedAtMs: Date.now(),
    })
    expect(seed).toEqual(
      expect.objectContaining({ uniqueLeadsToday: 1, totalMissedToday: 2 })
    )
  })

  it("drops counts when the cached seed has no fetchedAtMs (legacy entry) or is stale", () => {
    const legacy = normalizeMissedLeadsPaintSeed({
      uniqueLeadsToday: 1,
      totalMissedToday: 2,
      localDayPeriodKey: telemetryLocalDayPeriodKey(),
    })
    expect(legacy).toBeNull()

    const stale = normalizeMissedLeadsPaintSeed({
      uniqueLeadsToday: 1,
      totalMissedToday: 2,
      localDayPeriodKey: telemetryLocalDayPeriodKey(),
      fetchedAtMs: Date.now() - 3 * 60 * 1000,
    })
    expect(stale).toBeNull()
  })

  it("writes a compact paint cookie for SSR", () => {
    writeMissedLeadsCache({
      rows: [],
      recentUnreturned: [],
      uniqueLeadsToday: 1,
      totalMissedToday: 2,
    })
    const cookieName = paintSeedCookieName("missed-lead-insights")
    expect(store[cookieName]).toBeTruthy()
    expect(MISSED_LEADS_COOKIE).toBe(cookieName)
    const parsed = readMissedLeadsFromCookieRaw(store[cookieName])
    expect(parsed?.uniqueLeadsToday).toBe(1)
    expect(parsed?.totalMissedToday).toBe(2)
  })

  it("round-trips via writePaintSeedCookie helper", () => {
    writePaintSeedCookie("missed-lead-insights", {
      uniqueLeadsToday: 3,
      totalMissedToday: 8,
      fetchedAtMs: Date.now(),
    })
    const parsed = readMissedLeadsFromCookieRaw(store[MISSED_LEADS_COOKIE])
    expect(parsed?.uniqueLeadsToday).toBe(3)
    expect(parsed?.totalMissedToday).toBe(8)
  })
})
