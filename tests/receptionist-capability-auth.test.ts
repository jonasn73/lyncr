import { describe, expect, it, vi, beforeEach } from "vitest"
import { resolveCapabilityActor } from "@/lib/receptionist-capability-auth"

const getUserIdFromRequest = vi.fn()
const getUser = vi.fn()
const getPlatformAccountGrantsRaw = vi.fn((..._a: unknown[]) => ({}) as unknown)
const getReceptionistPortalContext = vi.fn()
const isReceptionistPortalUser = vi.fn()

vi.mock("@/lib/auth", () => ({
  getUserIdFromRequest: (...args: unknown[]) => getUserIdFromRequest(...args),
}))
vi.mock("@/lib/db", () => ({
  getUser: (...args: unknown[]) => getUser(...args),
  getPlatformAccountGrantsRaw: (...args: unknown[]) =>
    getPlatformAccountGrantsRaw(...args),
}))
vi.mock("@/lib/receptionist-portal-auth", () => ({
  getReceptionistPortalContext: (...args: unknown[]) => getReceptionistPortalContext(...args),
  isReceptionistPortalUser: (...args: unknown[]) => isReceptionistPortalUser(...args),
}))

beforeEach(() => {
  getUserIdFromRequest.mockReset()
  getUser.mockReset()
  getReceptionistPortalContext.mockReset()
  isReceptionistPortalUser.mockReset()
})

describe("resolveCapabilityActor", () => {
  it("returns null with no session", async () => {
    getUserIdFromRequest.mockReturnValue(null)
    const actor = await resolveCapabilityActor("cookie", "dispatching")
    expect(actor).toBeNull()
  })

  it("an owner always passes, regardless of the capability", async () => {
    getUserIdFromRequest.mockReturnValue("owner-1")
    getUser.mockResolvedValue({ account_role: "owner", email: "owner@example.com" })
    isReceptionistPortalUser.mockReturnValue(false)
    const actor = await resolveCapabilityActor("cookie", "dispatching")
    expect(actor).toEqual({
      ownerUserId: "owner-1",
      actingUserId: "owner-1",
      actorRole: "owner",
      receptionistId: null,
    })
  })

  it("a receptionist with the capability on passes, acting under the owner's account", async () => {
    getUserIdFromRequest.mockReturnValue("recep-1")
    getUser.mockResolvedValue({ account_role: "receptionist", email: "recep@example.com" })
    isReceptionistPortalUser.mockReturnValue(true)
    getReceptionistPortalContext.mockResolvedValue({
      owner_user_id: "owner-1",
      receptionist: { id: "recep-row-1", capabilities: { dispatching: true, full_vehicle_key_catalog: false } },
    })
    const actor = await resolveCapabilityActor("cookie", "dispatching")
    expect(actor).toEqual({
      ownerUserId: "owner-1",
      actingUserId: "recep-1",
      actorRole: "receptionist",
      receptionistId: "recep-row-1",
    })
  })

  it("a receptionist without the capability is refused", async () => {
    getUserIdFromRequest.mockReturnValue("recep-1")
    getUser.mockResolvedValue({ account_role: "receptionist", email: "recep@example.com" })
    isReceptionistPortalUser.mockReturnValue(true)
    getReceptionistPortalContext.mockResolvedValue({
      owner_user_id: "owner-1",
      receptionist: { id: "recep-row-1", capabilities: { dispatching: false, full_vehicle_key_catalog: false } },
    })
    const actor = await resolveCapabilityActor("cookie", "dispatching")
    expect(actor).toBeNull()
  })

  it("a field tech (or any other role) is refused rather than defaulted to owner", async () => {
    getUserIdFromRequest.mockReturnValue("tech-1")
    getUser.mockResolvedValue({ account_role: "field_tech", email: "tech@example.com" })
    isReceptionistPortalUser.mockReturnValue(false)
    const actor = await resolveCapabilityActor("cookie", "dispatching")
    expect(actor).toBeNull()
  })
})
