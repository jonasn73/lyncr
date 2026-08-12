import { describe, expect, it } from "vitest"
import {
  phoneMatchKey,
  resolveMessagesDeepLinkPhone,
  shouldApplyMessagesDeepLink,
} from "@/lib/messages-deep-link"

describe("messages deep-link selection", () => {
  it("matches last-10 digits across formats", () => {
    expect(phoneMatchKey("+14046325695")).toBe("4046325695")
    expect(phoneMatchKey("(404) 632-5695")).toBe("4046325695")
  })

  it("prefers the inbox thread phone when resolving a deep link", () => {
    const threads = [{ customerPhone: "+14046325695" }, { customerPhone: "+13125974738" }]
    expect(resolveMessagesDeepLinkPhone("(404) 632-5695", threads)).toBe("+14046325695")
    expect(resolveMessagesDeepLinkPhone("+13125974738", threads)).toBe("+13125974738")
  })

  it("keeps the raw query when no thread exists yet (empty CRM follow-up)", () => {
    expect(resolveMessagesDeepLinkPhone("+13125974738", [])).toBe("+13125974738")
  })

  it("does not re-apply a deep link after it was already consumed", () => {
    // Regression: poll rebuilt `threads` while `?phone=` was still in the URL —
    // re-applying yanked the user off a manually selected conversation.
    const first = shouldApplyMessagesDeepLink({
      phoneQuery: "+13125974738",
      lastAppliedKey: null,
    })
    expect(first).toEqual({ apply: true, key: "3125974738" })

    const afterConsume = shouldApplyMessagesDeepLink({
      phoneQuery: "+13125974738",
      lastAppliedKey: "3125974738",
    })
    expect(afterConsume).toEqual({ apply: false })
  })

  it("allows a new deep link after the previous key was cleared", () => {
    expect(
      shouldApplyMessagesDeepLink({
        phoneQuery: "+14046325695",
        lastAppliedKey: null,
      })
    ).toEqual({ apply: true, key: "4046325695" })
  })
})
