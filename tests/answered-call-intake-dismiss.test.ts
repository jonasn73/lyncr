import { describe, expect, it, beforeEach, vi } from "vitest"
import {
  isAnsweredIntakeDismissed,
  loadAnsweredIntakeDismissed,
  markAnsweredIntakeDismissed,
} from "@/lib/answered-call-intake-dismiss"

const OWNER = "owner-uuid-1"
const CALL = "11111111-1111-4111-8111-111111111111"

function mockWebStorage() {
  const makeStore = () => {
    const store = new Map<string, string>()
    return {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v)
      },
      removeItem: (k: string) => {
        store.delete(k)
      },
      clear: () => store.clear(),
    }
  }
  vi.stubGlobal("localStorage", makeStore())
  vi.stubGlobal("sessionStorage", makeStore())
  vi.stubGlobal("window", globalThis)
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage() {}
      close() {}
    }
  )
}

describe("answered-call-intake-dismiss", () => {
  beforeEach(() => {
    mockWebStorage()
  })

  it("persists dismissed ids in localStorage per owner", () => {
    markAnsweredIntakeDismissed(OWNER, CALL, { syncServer: false })
    expect(isAnsweredIntakeDismissed(OWNER, CALL)).toBe(true)
    expect(loadAnsweredIntakeDismissed(OWNER).has(CALL)).toBe(true)
  })

  it("migrates legacy sessionStorage seen ids", () => {
    sessionStorage.setItem("zing_answered_customer_popup_seen_v1", JSON.stringify([CALL]))
    const loaded = loadAnsweredIntakeDismissed(OWNER)
    expect(loaded.has(CALL)).toBe(true)
  })

  it("POSTs intake-dismissed for real call log ids", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"))
    markAnsweredIntakeDismissed(OWNER, [CALL, "ring-temp"])
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/calls/${encodeURIComponent(CALL)}/intake-dismissed`,
      expect.objectContaining({ method: "POST" })
    )
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("ring-temp"),
      expect.anything()
    )
  })
})
