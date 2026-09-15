import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const getDevicePushTokensForUserMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db", () => ({
  getDevicePushTokensForUser: getDevicePushTokensForUserMock,
}))

describe("notifyOwnerOfIncomingCall", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock)
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true, text: async () => "" })
    getDevicePushTokensForUserMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("sends a push to every token on file for the owner", async () => {
    getDevicePushTokensForUserMock.mockResolvedValue(["ExponentPushToken[a]", "ExponentPushToken[b]"])
    const { notifyOwnerOfIncomingCall } = await import("@/lib/push-notifications")
    await notifyOwnerOfIncomingCall({ ownerUserId: "u1", fromNumber: "+15025551234" })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe("https://exp.host/--/api/v2/push/send")
    const body = JSON.parse(String(opts.body)) as { to: string; title: string; body: string }[]
    expect(body).toHaveLength(2)
    expect(body.map((m) => m.to)).toEqual(["ExponentPushToken[a]", "ExponentPushToken[b]"])
    expect(body[0].title).toBe("Incoming call")
    expect(body[0].body).toContain("+15025551234")
  })

  it("skips push entirely when Busy/Hold answers first (owner's phone never rings)", async () => {
    getDevicePushTokensForUserMock.mockResolvedValue(["ExponentPushToken[a]"])
    const { notifyOwnerOfIncomingCall } = await import("@/lib/push-notifications")
    await notifyOwnerOfIncomingCall({
      ownerUserId: "u1",
      fromNumber: "+15025551234",
      dialReason: "busy_automation",
    })

    expect(getDevicePushTokensForUserMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("no-ops quietly when the owner has no registered devices", async () => {
    getDevicePushTokensForUserMock.mockResolvedValue([])
    const { notifyOwnerOfIncomingCall } = await import("@/lib/push-notifications")
    await notifyOwnerOfIncomingCall({ ownerUserId: "u1", fromNumber: "+15025551234" })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("never throws when the Expo push API itself fails", async () => {
    getDevicePushTokensForUserMock.mockResolvedValue(["ExponentPushToken[a]"])
    fetchMock.mockRejectedValue(new Error("network down"))
    const { notifyOwnerOfIncomingCall } = await import("@/lib/push-notifications")
    await expect(
      notifyOwnerOfIncomingCall({ ownerUserId: "u1", fromNumber: "+15025551234" })
    ).resolves.toBeUndefined()
  })
})

describe("notifyOwnerOfCompletedCall", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock)
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true, text: async () => "" })
    getDevicePushTokensForUserMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("pushes a missed-call alert when the caller already determined isMissed", async () => {
    getDevicePushTokensForUserMock.mockResolvedValue(["ExponentPushToken[a]"])
    const { notifyOwnerOfCompletedCall } = await import("@/lib/push-notifications")
    await notifyOwnerOfCompletedCall({
      ownerUserId: "u1",
      isMissed: true,
      fromNumber: "+15025551234",
      callLogId: "log-1",
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as { title: string; body: string }[]
    expect(body[0].title).toBe("Missed call")
    expect(body[0].body).toContain("+15025551234")
  })

  it("does not push for a call that was actually answered", async () => {
    getDevicePushTokensForUserMock.mockResolvedValue(["ExponentPushToken[a]"])
    const { notifyOwnerOfCompletedCall } = await import("@/lib/push-notifications")
    await notifyOwnerOfCompletedCall({ ownerUserId: "u1", isMissed: false, fromNumber: "+15025551234" })

    expect(getDevicePushTokensForUserMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
