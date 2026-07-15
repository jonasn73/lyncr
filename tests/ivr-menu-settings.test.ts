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
    expect(normalizeIvrMenuAction("ring_owner", "sms_link")).toBe("ring_phone")
    expect(normalizeIvrMenuAction("voicemail", "sms_link")).toBe("voicemail")
    expect(normalizeIvrMenuAction("nope", "live_booking")).toBe("live_booking")
  })

  it("normalizes settings with Key Squad default greeting", () => {
    const settings = normalizeIvrMenuSettings({})
    expect(settings.ivrGreetingText).toContain("Key Squad 502")
    expect(settings.ivrGreetingText).toContain("ring our phone")
    expect(settings.ivrOption1Action).toBe("sms_link")
    expect(settings.ivrOption2Action).toBe("ring_phone")
    expect(DEFAULT_IVR_GREETING_TEXT).toContain("Press 1")
  })

  it("injects custom greeting into Gather TeXML with phonetic TTS", () => {
    const custom = "Thanks for calling Key Squad 502. Press 1 now."
    const xml = buildTelnyxMenuGatherXml("https://lyncr.app/api/telnyx-menu", custom)
    // Spoken XML uses five oh two; stored script stays 502.
    expect(xml).toContain("Key Squad five oh two")
    expect(xml).toContain("<Gather")
    expect(xml).toContain('voice="alice"')
  })
})
