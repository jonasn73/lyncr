import { describe, expect, it } from "vitest"
import { buildLiveGpsRequestSmsText, buildTrackLocationUrl } from "@/lib/live-gps-locate"

describe("live GPS SMS helpers", () => {
  it("builds a clean Lyncr GPS request message", () => {
    const text = buildLiveGpsRequestSmsText(
      "https://lyncr.app/track-location?jobId=abc&c=tok123"
    )
    expect(text).toContain("Lyncr: Your locksmith is requesting your live location")
    expect(text).toContain("https://lyncr.app/track-location?jobId=abc&c=tok123")
  })

  it("includes jobId and secure token on the track-location URL", () => {
    const url = buildTrackLocationUrl("tok123", "job-99")
    expect(url).toContain("/track-location?")
    expect(url).toContain("jobId=job-99")
    expect(url).toContain("c=tok123")
  })
})
