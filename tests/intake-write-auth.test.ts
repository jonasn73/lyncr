import { describe, expect, it, vi, beforeEach } from "vitest"
import { resolveIntakeWriteActor } from "@/lib/intake-write-auth"

const getUserIdFromRequest = vi.fn()
const getUser = vi.fn()
const getPlatformAccountGrantsRaw = vi.fn((..._a: unknown[]) => ({}) as unknown)
const getReceptionistPortalContext = vi.fn()

vi.mock("@/lib/auth", () => ({
  getUserIdFromRequest: (...a: unknown[]) => getUserIdFromRequest(...a),
}))
vi.mock("@/lib/db", () => ({
  getUser: (...a: unknown[]) => getUser(...a),
  getPlatformAccountGrantsRaw: (...a: unknown[]) =>
    getPlatformAccountGrantsRaw(...a),
}))
vi.mock("@/lib/receptionist-portal-auth", () => ({
  getReceptionistPortalContext: (...a: unknown[]) => getReceptionistPortalContext(...a),
  isReceptionistPortalUser: (user: { account_role?: string }) =>
    user?.account_role === "receptionist",
}))

const COOKIE = "lyncr_session=abc"

beforeEach(() => {
  getUserIdFromRequest.mockReset()
  getUser.mockReset()
  getReceptionistPortalContext.mockReset()
})

describe("intake write actor", () => {
  it("writes under the owner's own id when the owner takes the call", async () => {
    getUserIdFromRequest.mockReturnValue("owner-1")
    getUser.mockResolvedValue({ id: "owner-1", account_role: "owner", email: "o@x.com" })

    const actor = await resolveIntakeWriteActor(COOKIE)
    expect(actor).toEqual({
      ownerUserId: "owner-1",
      actingUserId: "owner-1",
      actorRole: "owner",
      receptionistId: null,
      receptionistName: null,
    })
    // The owner path must not depend on receptionist resolution at all.
    expect(getReceptionistPortalContext).not.toHaveBeenCalled()
  })

  it("writes under the OWNER when a receptionist takes the call, never her own account", async () => {
    // This is the whole point: a receptionist has no business, customers, or jobs of her
    // own, so a write under her id would vanish from the owner's dashboard.
    getUserIdFromRequest.mockReturnValue("recep-9")
    getUser.mockResolvedValue({ id: "recep-9", account_role: "receptionist", email: "a@x.com" })
    getReceptionistPortalContext.mockResolvedValue({
      owner_user_id: "owner-1",
      receptionist: { id: "r-77", name: "Alex Jonas" },
      business_name: "Key Squad 502",
    })

    const actor = await resolveIntakeWriteActor(COOKIE)
    expect(actor?.ownerUserId).toBe("owner-1")
    expect(actor?.actingUserId).toBe("recep-9")
    expect(actor?.actorRole).toBe("receptionist")
    expect(actor?.receptionistId).toBe("r-77")
    expect(actor?.receptionistName).toBe("Alex Jonas")
  })

  it("refuses a field tech rather than defaulting them to owner", async () => {
    // Techs work jobs; they do not take intake. Falling through to "owner" would let a
    // tech create customers and jobs under their own id.
    getUserIdFromRequest.mockReturnValue("tech-3")
    getUser.mockResolvedValue({ id: "tech-3", account_role: "field_tech", email: "t@x.com" })
    expect(await resolveIntakeWriteActor(COOKIE)).toBeNull()
  })

  it("refuses an unrecognised role", async () => {
    getUserIdFromRequest.mockReturnValue("who-1")
    getUser.mockResolvedValue({ id: "who-1", account_role: "something_new", email: "w@x.com" })
    expect(await resolveIntakeWriteActor(COOKIE)).toBeNull()
  })

  it("refuses a receptionist who is not linked to any business", async () => {
    // An unlinked portal user has no owner to write under — writing anywhere would be wrong.
    getUserIdFromRequest.mockReturnValue("recep-9")
    getUser.mockResolvedValue({ id: "recep-9", account_role: "receptionist", email: "a@x.com" })
    getReceptionistPortalContext.mockResolvedValue(null)
    expect(await resolveIntakeWriteActor(COOKIE)).toBeNull()
  })

  it("refuses with no session", async () => {
    getUserIdFromRequest.mockReturnValue(null)
    expect(await resolveIntakeWriteActor(null)).toBeNull()
    expect(getUser).not.toHaveBeenCalled()
  })

  it("refuses when the session points at a deleted user", async () => {
    getUserIdFromRequest.mockReturnValue("ghost-1")
    getUser.mockResolvedValue(null)
    expect(await resolveIntakeWriteActor(COOKIE)).toBeNull()
  })
})
