import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

const limitMock = vi.fn()

vi.mock("@upstash/redis", () => ({
  Redis: vi.fn().mockImplementation(() => ({})),
}))

vi.mock("@upstash/ratelimit", () => {
  class Ratelimit {
    static slidingWindow = vi.fn((limit: number, window: string) => ({ limit, window }))
    limit = limitMock
  }
  return { Ratelimit }
})

describe("rate-limit", () => {
  const previousUrl = process.env.KV_REST_API_URL
  const previousToken = process.env.KV_REST_API_TOKEN

  beforeEach(() => {
    vi.resetModules()
    limitMock.mockReset()
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
  })

  afterEach(() => {
    if (previousUrl == null) delete process.env.KV_REST_API_URL
    else process.env.KV_REST_API_URL = previousUrl
    if (previousToken == null) delete process.env.KV_REST_API_TOKEN
    else process.env.KV_REST_API_TOKEN = previousToken
  })

  it("allows a request under the limit", async () => {
    limitMock.mockResolvedValue({ success: true, reset: Date.now() + 60_000 })
    const { checkRateLimit } = await import("@/lib/rate-limit")
    const result = await checkRateLimit("auth-login", "1.2.3.4")
    expect(result).toEqual({ limited: false })
  })

  it("blocks a request over the limit and reports retry-after", async () => {
    const reset = Date.now() + 4_500
    limitMock.mockResolvedValue({ success: false, reset })
    const { checkRateLimit } = await import("@/lib/rate-limit")
    const result = await checkRateLimit("auth-login", "1.2.3.4")
    expect(result.limited).toBe(true)
    if (result.limited) {
      expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(4)
      expect(result.retryAfterSeconds).toBeLessThanOrEqual(5)
    }
  })

  it("fails open when KV env vars are not configured", async () => {
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    const { checkRateLimit } = await import("@/lib/rate-limit")
    const result = await checkRateLimit("auth-login", "1.2.3.4")
    expect(result).toEqual({ limited: false })
    expect(limitMock).not.toHaveBeenCalled()
  })

  it("fails open when Redis throws", async () => {
    limitMock.mockRejectedValue(new Error("network error"))
    const { checkRateLimit } = await import("@/lib/rate-limit")
    const result = await checkRateLimit("auth-login", "1.2.3.4")
    expect(result).toEqual({ limited: false })
  })

  it("clientIpFromHeaders prefers x-forwarded-for, falls back to x-real-ip, then unknown", async () => {
    const { clientIpFromHeaders } = await import("@/lib/rate-limit")
    const headers = (map: Record<string, string>) => ({ get: (name: string) => map[name] ?? null })
    expect(clientIpFromHeaders(headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("1.1.1.1")
    expect(clientIpFromHeaders(headers({ "x-real-ip": "3.3.3.3" }))).toBe("3.3.3.3")
    expect(clientIpFromHeaders(headers({}))).toBe("unknown")
  })

  it("rateLimitedResponse returns a 429 with Retry-After", async () => {
    const { rateLimitedResponse } = await import("@/lib/rate-limit")
    const res = rateLimitedResponse(7)
    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("7")
  })
})
