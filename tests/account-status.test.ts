import { describe, expect, it } from "vitest"
import {
  accountWaitPath,
  isAccountRoutingBlocked,
  isShopAccountUsable,
  parseAccountStatus,
  signupAccountStatusForBusinessName,
} from "@/lib/account-status"
import { resolvePostAuthPath } from "@/lib/post-auth-redirect"

describe("signup approval status", () => {
  it("puts real shop names in the pending queue", () => {
    expect(signupAccountStatusForBusinessName("Key Squad 502")).toBe("pending")
    expect(signupAccountStatusForBusinessName("Latest Lock")).toBe("pending")
  })

  it("auto-approves TEST-labeled shops", () => {
    expect(signupAccountStatusForBusinessName("TEST Pat's Lock & Key")).toBe("active")
    expect(signupAccountStatusForBusinessName("test shop")).toBe("active")
  })

  it("blocks pending and denied shops from routing and from using the app", () => {
    expect(isAccountRoutingBlocked("pending")).toBe(true)
    expect(isAccountRoutingBlocked("denied")).toBe(true)
    expect(isShopAccountUsable("pending")).toBe(false)
    expect(isShopAccountUsable("denied")).toBe(false)
    expect(isShopAccountUsable("flagged")).toBe(true)
    expect(isShopAccountUsable("active")).toBe(true)
  })

  it("sends pending and denied logins to the wait pages", () => {
    expect(accountWaitPath("pending")).toBe("/waiting-approval")
    expect(accountWaitPath("denied")).toBe("/account-denied")
    expect(
      resolvePostAuthPath({
        user: { email: "a@b.com", account_role: "owner" },
        account_status: "pending",
      })
    ).toBe("/waiting-approval")
  })

  it("parses the new statuses", () => {
    expect(parseAccountStatus("Pending")).toBe("pending")
    expect(parseAccountStatus("DENIED")).toBe("denied")
  })
})
