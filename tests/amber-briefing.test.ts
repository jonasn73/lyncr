import { describe, expect, it } from "vitest"
import { parseAmberCommand } from "@/lib/amber-commands"
import { formatAmberBriefingSms, formatAmberHelloSms, isAmberBriefingPhrase } from "@/lib/amber-briefing"
import { isBareAmberPresenceCommand } from "@/lib/amber-coworker-commands"

describe("isAmberBriefingPhrase", () => {
  it("catches the owner asking what still needs them", () => {
    expect(isAmberBriefingPhrase("Any important events?")).toBe(true)
    expect(isAmberBriefingPhrase("anything I should know")).toBe(true)
    expect(isAmberBriefingPhrase("what's waiting")).toBe(true)
    expect(isAmberBriefingPhrase("what did I miss")).toBe(true)
    expect(isAmberBriefingPhrase("What's going on around my business")).toBe(true)
    expect(isAmberBriefingPhrase("What's going around my dashboard?")).toBe(true)
    expect(parseAmberCommand("Any important events?").kind).toBe("briefing")
    expect(isBareAmberPresenceCommand("Any important events?")).toBe(true)
    expect(isBareAmberPresenceCommand("What's going on around my business")).toBe(true)
    expect(isAmberBriefingPhrase("tell him we can come tomorrow")).toBe(false)
    expect(isAmberBriefingPhrase("tell him what's going on")).toBe(false)
    expect(parseAmberCommand("Hey").kind).toBe("greeting")
  })
})

describe("formatAmberBriefingSms", () => {
  it("says you’re clear when nothing is waiting", () => {
    const text = formatAmberBriefingSms({ busy: false, lines: [] })
    expect(text).toContain("Available")
    expect(text.toLowerCase()).toContain("clear")
  })

  it("puts leftovers on a Hey so the owner does not have to ask twice", () => {
    const empty = formatAmberHelloSms({ busy: false, untilLabel: null, lines: [] })
    expect(empty.startsWith("Hey.")).toBe(true)
    expect(empty.toLowerCase()).toContain("nothing waiting")
    expect(empty.toLowerCase()).not.toContain("what's my status")
    const waiting = formatAmberHelloSms({
      busy: false,
      untilLabel: null,
      lines: [{ name: "Isaac", last4: "2058", urgency: "asap" }],
    })
    expect(waiting).toContain("Isaac")
    expect(waiting).toContain("…2058")
    expect(waiting).toContain("\n")
    expect(waiting.toLowerCase()).toContain("still need you")
  })

  it("lists first names and last four only, no addresses", () => {
    const text = formatAmberBriefingSms({
      busy: true,
      lines: [
        { name: "Noah", last4: "1219", urgency: "asap" },
        { name: "Riley", last4: "0112", urgency: "window" },
      ],
    })
    expect(text).toContain("Busy")
    expect(text).toContain("Noah")
    expect(text).toContain("…1219")
    expect(text).toContain("ASAP")
    expect(text).toContain("\n\nStill need you:")
    expect(text).not.toContain("Main St")
    expect(text).not.toContain("+1")
  })
})
