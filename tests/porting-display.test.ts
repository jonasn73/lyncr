import { describe, it, expect } from "vitest"
import { displayPortingMessageBody, displayUserFacingMessage } from "@/lib/porting-display"

describe("displayPortingMessageBody", () => {
  it("replaces vendor team labels with the neutral carrier-desk label", () => {
    const greeting = displayPortingMessageBody("Hello from Telnyx Porting Team")
    const admin = displayPortingMessageBody("Telnyx Admin said fix PIN")
    // The invariant that actually matters: no vendor name reaches the UI.
    expect(greeting).not.toMatch(/telnyx/i)
    expect(admin).not.toMatch(/telnyx/i)
    // Current white-label wording (see lib/porting-display.ts).
    expect(greeting).toContain("Carrier Core Desk")
    expect(admin).toContain("Carrier Core Desk")
  })

  it("does not break telnyx.com URLs", () => {
    const u = "See https://portal.telnyx.com/foo for details"
    expect(displayPortingMessageBody(u)).toContain("portal.telnyx.com")
  })

  it("neutralizes voice-assistant phrasing", () => {
    expect(displayUserFacingMessage("Link your Telnyx assistant")).toContain("voice assistant")
  })
})
