import { describe, expect, it, afterEach } from "vitest"
import { isAuthorizedCronRequest } from "@/lib/cron-auth"

function fakeReq(authorization?: string) {
  return {
    headers: {
      get(name: string) {
        return name.toLowerCase() === "authorization" ? authorization ?? null : null
      },
    },
  }
}

describe("isAuthorizedCronRequest", () => {
  const previous = process.env.CRON_SECRET

  afterEach(() => {
    if (previous == null) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = previous
  })

  it("allows all requests when CRON_SECRET is unset", () => {
    delete process.env.CRON_SECRET
    expect(isAuthorizedCronRequest(fakeReq())).toBe(true)
  })

  it("requires Bearer token when CRON_SECRET is set", () => {
    process.env.CRON_SECRET = "test-secret"
    expect(isAuthorizedCronRequest(fakeReq())).toBe(false)
    expect(isAuthorizedCronRequest(fakeReq("Bearer wrong"))).toBe(false)
    expect(isAuthorizedCronRequest(fakeReq("Bearer test-secret"))).toBe(true)
  })
})
