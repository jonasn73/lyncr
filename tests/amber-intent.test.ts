import { describe, expect, it } from "vitest"
import { parseAmberCommand } from "@/lib/amber-commands"
import { isBareAmberPresenceCommand, parseAmberCoworkerCommand } from "@/lib/amber-coworker-commands"
import {
  applyAmberAiIntentGuard,
  buildAmberClarifySms,
  classifyAmberLeftoverIntentLocal,
  isAmberOwnerClarifyQuestion,
} from "@/lib/amber-intent"

describe("status in plain English", () => {
  it("treats what's my status and am I busy as status, not a draft", () => {
    expect(parseAmberCommand("What's my status").kind).toBe("status")
    expect(parseAmberCommand("whats my status").kind).toBe("status")
    expect(parseAmberCommand("am I busy").kind).toBe("status")
    expect(parseAmberCommand("STATUS").kind).toBe("status")
    expect(isBareAmberPresenceCommand("What's my status")).toBe(true)
  })
})

describe("classifyAmberLeftoverIntentLocal", () => {
  it("skips named leftovers and pass", () => {
    expect(classifyAmberLeftoverIntentLocal("dismiss Flavio")).toBe("skip")
    expect(classifyAmberLeftoverIntentLocal("Dismiss that one")).toBe("skip")
    expect(classifyAmberLeftoverIntentLocal("I'm done with Flavio")).toBe("skip")
  })

  it("asks when the owner is asking about the leftover", () => {
    expect(isAmberOwnerClarifyQuestion("When was this?")).toBe(true)
    expect(classifyAmberLeftoverIntentLocal("When was this")).toBe("ask")
    expect(classifyAmberLeftoverIntentLocal("tell him we can come tomorrow")).toBe("draft")
  })

  it("builds a clarify SMS without sending", () => {
    const text = buildAmberClarifySms({ customerFirstName: "Noah", hasQuotedDraft: true })
    expect(text.toLowerCase()).toContain("noah")
    expect(text.toLowerCase()).toContain("ok")
    expect(text.toLowerCase()).toContain("skip")
  })

  it("blocks AI send or skip unless the owner used those words", () => {
    expect(applyAmberAiIntentGuard({ text: "tell him tomorrow", ai: "send" })).toBe("ask")
    expect(applyAmberAiIntentGuard({ text: "tell him tomorrow", ai: "skip" })).toBe("ask")
    expect(applyAmberAiIntentGuard({ text: "ok", ai: "send" })).toBe("send")
    expect(applyAmberAiIntentGuard({ text: "skip noah", ai: "skip" })).toBe("skip")
  })
})
