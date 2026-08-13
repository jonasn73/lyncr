import { describe, expect, it } from "vitest"
import { appendHelpContextToFeedbackBody, describeBrowserDevice } from "@/lib/help-feedback-context"

describe("appendHelpContextToFeedbackBody", () => {
  it("returns the note unchanged without context", () => {
    expect(appendHelpContextToFeedbackBody("  Screen flashed  ")).toBe("Screen flashed")
  })

  it("appends page path, screen name, and device", () => {
    const text = appendHelpContextToFeedbackBody("Screen flashed", {
      pagePath: "/dashboard/activity",
      pageName: "activity",
      device: "iPhone / iPad",
    })
    expect(text).toContain("Screen flashed")
    expect(text).toContain("Page: /dashboard/activity")
    expect(text).toContain("Screen: activity")
    expect(text).toContain("Device: iPhone / iPad")
  })
})

describe("describeBrowserDevice", () => {
  it("labels common user agents", () => {
    expect(describeBrowserDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)")).toBe("iPhone / iPad")
    expect(describeBrowserDevice("Mozilla/5.0 (Linux; Android 14)")).toBe("Android")
    expect(describeBrowserDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)")).toBe("Mac")
    expect(describeBrowserDevice("")).toBe("unknown device")
  })
})
