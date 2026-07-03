import { describe, expect, it } from "vitest"
import {
  DEFAULT_TELEMETRY_TIMEZONE,
  routingTelemetryQueryString,
  sanitizeIanaTimezone,
} from "@/lib/telemetry-timezone"

describe("sanitizeIanaTimezone", () => {
  it("accepts valid IANA zones", () => {
    expect(sanitizeIanaTimezone("America/New_York")).toBe("America/New_York")
    expect(sanitizeIanaTimezone("America/Kentucky/Louisville")).toBe("America/Kentucky/Louisville")
  })

  it("rejects unsafe strings", () => {
    expect(sanitizeIanaTimezone("'; DROP TABLE call_logs; --")).toBe(DEFAULT_TELEMETRY_TIMEZONE)
    expect(sanitizeIanaTimezone("")).toBe(DEFAULT_TELEMETRY_TIMEZONE)
  })
})

describe("routingTelemetryQueryString", () => {
  it("always includes timezone", () => {
    const qs = routingTelemetryQueryString("org-123", "America/Chicago")
    expect(qs).toContain("timezone=America%2FChicago")
    expect(qs).toContain("organization_id=org-123")
  })
})
