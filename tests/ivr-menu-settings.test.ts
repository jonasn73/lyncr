import { describe, expect, it } from "vitest"
import {
  DEFAULT_IVR_GREETING_TEXT,
  normalizeIvrMenuAction,
  normalizeIvrMenuSettings,
} from "@/lib/ivr-menu-settings"
import { buildTelnyxMenuGatherXml } from "@/lib/telnyx-menu"

describe("ivr menu settings", () => {
  it("normalizes action aliases", () => {
    expect(normalizeIvrMenuAction("sms_link", "voicemail")).toBe("sms_link")
    expect(normalizeIvrMenuAction("auto_book_next_day", "sms_link")).toBe("live_booking")
    expect(normalizeIvrMenuAction("voicemail", "sms_link")).toBe("voicemail")
    expect(normalizeIvrMenuAction("nope", "live_booking")).toBe("live_booking")
  })

  it("normalizes settings with Key Squad default greeting", () => {
    const settings = normalizeIvrMenuSettings({})
    expect(settings.ivrGreetingText).toContain("Key Squad 5-0-2")
    expect(settings.ivrOption1Action).toBe("sms_link")
    expect(settings.ivrOption2Action).toBe("live_booking")
  })

  it("injects custom greeting into Gather TeXML", () => {
    const custom = "Thanks for calling Key Squad 5-0-2. Press 1 now."
    const xml = buildTelnyxMenuGatherXml("https://lyncr.app/api/telnyx-menu", custom)
    expect(xml).toContain(custom)
    expect(xml).toContain("<Gather")
    expect(xml).toContain('voice="alice"')
  })
})
