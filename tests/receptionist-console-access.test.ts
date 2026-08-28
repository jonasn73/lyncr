import { describe, expect, it, vi, beforeEach } from "vitest"
import { requireReceptionistCapability } from "@/lib/receptionist-route-guard"
import { RECEPTIONIST_NAV_ITEMS } from "@/components/receptionist-portal-chrome"
import { DEFAULT_RECEPTIONIST_CAPABILITIES } from "@/lib/receptionist-capabilities"
import type { ReceptionistCapabilities } from "@/lib/types"

const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`)
})
const getSessionUser = vi.fn()
const getReceptionistPortalContext = vi.fn()

vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }))
vi.mock("@/lib/server-session-user", () => ({ getSessionUser: () => getSessionUser() }))
vi.mock("@/lib/receptionist-portal-auth", () => ({
  getReceptionistPortalContext: (...a: unknown[]) => getReceptionistPortalContext(...a),
}))


function capabilities(on: Partial<ReceptionistCapabilities>): ReceptionistCapabilities {
  return { ...DEFAULT_RECEPTIONIST_CAPABILITIES, ...on }
}

/** Same filter the chrome applies to decide which tabs a receptionist sees. */
function visibleTabs(caps: ReceptionistCapabilities): string[] {
  return RECEPTIONIST_NAV_ITEMS.filter((i) => !i.requires || caps[i.requires] === true).map(
    (i) => i.label
  )
}

beforeEach(() => {
  redirect.mockClear()
  getSessionUser.mockReset()
  getReceptionistPortalContext.mockReset()
})

describe("receptionist console navigation", () => {
  it("shows only the front desk before the owner opens anything up", () => {
    expect(visibleTabs(capabilities({}))).toEqual(["Home", "Calls", "Earnings"])
  })

  it("adds each mirrored surface as its capability is turned on", () => {
    expect(visibleTabs(capabilities({ crm_access: true }))).toContain("Customers")
    expect(visibleTabs(capabilities({ scheduler: true }))).toContain("Scheduler")
    expect(visibleTabs(capabilities({ dispatching: true }))).toContain("Dispatch")
  })

  it("keeps the owner's tab order so the two consoles read as one product", () => {
    const all = Object.keys(DEFAULT_RECEPTIONIST_CAPABILITIES).reduce(
      (acc, k) => ({ ...acc, [k]: true }),
      {} as ReceptionistCapabilities
    )
    expect(visibleTabs(all)).toEqual([
      "Home",
      "Calls",
      "Customers",
      "Scheduler",
      "Dispatch",
      "Earnings",
    ])
  })
})

describe("requireReceptionistCapability", () => {
  it("sends a signed-out visitor to login, remembering where they were going", async () => {
    getSessionUser.mockResolvedValue(null)
    await expect(
      requireReceptionistCapability("crm_access", "/receptionist/customers")
    ).rejects.toThrow("REDIRECT:/login?next=%2Freceptionist%2Fcustomers")
  })

  it("bounces a receptionist who types the URL without the capability", async () => {
    getSessionUser.mockResolvedValue({ id: "recep-1" })
    getReceptionistPortalContext.mockResolvedValue({
      owner_user_id: "owner-1",
      receptionist: { id: "row-1", capabilities: capabilities({ dispatching: true }) },
    })
    await expect(
      requireReceptionistCapability("crm_access", "/receptionist/customers")
    ).rejects.toThrow("REDIRECT:/receptionist")
  })

  it("bounces an account with no receptionist record at all", async () => {
    getSessionUser.mockResolvedValue({ id: "nobody-1" })
    getReceptionistPortalContext.mockResolvedValue(null)
    await expect(
      requireReceptionistCapability("scheduler", "/receptionist/scheduler")
    ).rejects.toThrow("REDIRECT:/receptionist")
  })

  it("returns her portal context when the capability is on", async () => {
    getSessionUser.mockResolvedValue({ id: "recep-1" })
    getReceptionistPortalContext.mockResolvedValue({
      owner_user_id: "owner-1",
      receptionist: { id: "row-1", capabilities: capabilities({ crm_access: true }) },
    })
    const ctx = await requireReceptionistCapability("crm_access", "/receptionist/customers")
    expect(ctx.owner_user_id).toBe("owner-1")
    expect(redirect).not.toHaveBeenCalled()
  })
})
