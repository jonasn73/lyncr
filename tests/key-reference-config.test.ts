import { afterEach, describe, expect, it } from "vitest"
import { isKeyReferenceCacheOnly } from "@/lib/key-reference-config"

describe("isKeyReferenceCacheOnly", () => {
  const prev = process.env.KEY_REFERENCE_CACHE_ONLY

  afterEach(() => {
    if (prev === undefined) delete process.env.KEY_REFERENCE_CACHE_ONLY
    else process.env.KEY_REFERENCE_CACHE_ONLY = prev
  })

  it("defaults to true when env is unset (safe cache-only)", () => {
    delete process.env.KEY_REFERENCE_CACHE_ONLY
    expect(isKeyReferenceCacheOnly()).toBe(true)
  })

  it("is true when env is true or 1", () => {
    process.env.KEY_REFERENCE_CACHE_ONLY = "true"
    expect(isKeyReferenceCacheOnly()).toBe(true)
    process.env.KEY_REFERENCE_CACHE_ONLY = "1"
    expect(isKeyReferenceCacheOnly()).toBe(true)
  })

  it("is false only when explicitly opted out", () => {
    process.env.KEY_REFERENCE_CACHE_ONLY = "false"
    expect(isKeyReferenceCacheOnly()).toBe(false)
    process.env.KEY_REFERENCE_CACHE_ONLY = "0"
    expect(isKeyReferenceCacheOnly()).toBe(false)
    process.env.KEY_REFERENCE_CACHE_ONLY = "off"
    expect(isKeyReferenceCacheOnly()).toBe(false)
  })
})
