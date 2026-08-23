import { describe, expect, it } from "vitest"
import {
  hashSentryEmail,
  isNoisyHydrationWarning,
  resolveSentryDsn,
  shouldEnableSentry,
} from "@/lib/sentry-config"

describe("resolveSentryDsn", () => {
  it("prefers the public browser DSN", () => {
    expect(
      resolveSentryDsn({
        NEXT_PUBLIC_SENTRY_DSN: " https://public@o1.ingest.sentry.io/1 ",
        SENTRY_DSN: "https://server@o1.ingest.sentry.io/1",
      })
    ).toBe("https://public@o1.ingest.sentry.io/1")
  })

  it("falls back to SENTRY_DSN", () => {
    expect(
      resolveSentryDsn({
        SENTRY_DSN: "https://server@o1.ingest.sentry.io/1",
      })
    ).toBe("https://server@o1.ingest.sentry.io/1")
  })

  it("returns empty when unset", () => {
    expect(resolveSentryDsn({} as NodeJS.ProcessEnv)).toBe("")
  })
})

describe("shouldEnableSentry", () => {
  it("is off in development even with a DSN", () => {
    expect(shouldEnableSentry({ nodeEnv: "development", dsn: "https://x@o1.ingest/1" })).toBe(false)
  })

  it("is off in production without a DSN", () => {
    expect(shouldEnableSentry({ nodeEnv: "production", dsn: "" })).toBe(false)
  })

  it("is on in production with a DSN", () => {
    expect(shouldEnableSentry({ nodeEnv: "production", dsn: "https://x@o1.ingest/1" })).toBe(true)
  })
})

describe("isNoisyHydrationWarning", () => {
  it("filters hydration mismatch copy", () => {
    expect(isNoisyHydrationWarning("Hydration failed because the initial UI does not match")).toBe(true)
    expect(isNoisyHydrationWarning("There was an error while hydrating")).toBe(true)
    expect(isNoisyHydrationWarning("Minified React error #418")).toBe(true)
  })

  it("does not swallow real render-loop crashes", () => {
    expect(isNoisyHydrationWarning("Minified React error #185")).toBe(false)
    expect(isNoisyHydrationWarning("Cannot read properties of null")).toBe(false)
  })
})

describe("hashSentryEmail", () => {
  it("is stable and case-insensitive", () => {
    expect(hashSentryEmail("Admin@Lyncr.app")).toBe(hashSentryEmail("admin@lyncr.app"))
    expect(hashSentryEmail("admin@lyncr.app")).toMatch(/^[0-9a-f]{8}$/)
  })

  it("returns empty for blank email", () => {
    expect(hashSentryEmail("  ")).toBe("")
  })
})
