import { describe, expect, it, beforeEach, afterEach, vi } from "vitest"
import {
  readPaintSeedCookie,
  readPaintSeedCookieValue,
  writePaintSeedCookie,
} from "@/lib/paint-seed-cookie"

describe("paint-seed-cookie", () => {
  const store: Record<string, string> = {}

  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k])
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
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("round-trips a compact money snapshot", () => {
    writePaintSeedCookie("header-money", { availableCents: 12500, connectReady: true })
    const read = readPaintSeedCookie<{ availableCents: number; connectReady: boolean }>("header-money")
    expect(read?.availableCents).toBe(12500)
    expect(read?.connectReady).toBe(true)
  })

  it("parses a server cookie value", () => {
    writePaintSeedCookie("header-money", { availableCents: 500 })
    const raw = decodeURIComponent(store["lyncr_paint_header-money"])
    const parsed = readPaintSeedCookieValue<{ availableCents: number }>(
      store["lyncr_paint_header-money"]
    )
    expect(parsed?.availableCents).toBe(500)
    expect(raw).toContain("availableCents")
  })
})
