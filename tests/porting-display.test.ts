import { describe, it, expect } from "vitest"
import { displayPortingMessageBody, displayUserFacingMessage } from "@/lib/porting-display"

describe("displayPortingMessageBody", () => {
  it("replaces vendor team labels with neutral porting-team wording", () => {
    expect(displayPortingMessageBody("Hello from Telnyx Porting Team")).toContain("Porting team")
    expect(displayPortingMessageBody("Telnyx Admin said fix PIN")).toContain("Porting team")
  })

  it("does not break telnyx.com URLs", () => {
    const u = "See https://portal.telnyx.com/foo for details"
    expect(displayPortingMessageBody(u)).toContain("portal.telnyx.com")
  })

  it("neutralizes voice-assistant phrasing", () => {
    expect(displayUserFacingMessage("Link your Telnyx assistant")).toContain("voice assistant")
  })
})
