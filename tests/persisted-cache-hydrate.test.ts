import { describe, expect, it, beforeEach, afterEach, vi } from "vitest"
import {
  allowBrowserSessionCacheReads,
  persistedCacheKey,
  readPersistedCache,
  writePersistedCache,
} from "@/lib/swr/persisted-cache"

describe("persisted session cache", () => {
  const store: Record<string, string> = {}

  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k])
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value
      },
      removeItem: (key: string) => {
        delete store[key]
      },
    })
    allowBrowserSessionCacheReads()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("round-trips a payload", () => {
    const key = persistedCacheKey("test-hydrate", "1")
    writePersistedCache(key, { n: 7 })
    expect(readPersistedCache<{ n: number }>(key)).toEqual({ n: 7 })
  })
})
