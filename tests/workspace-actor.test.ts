import { describe, expect, it, vi, beforeEach } from "vitest"
import { resolveWorkspaceActor } from "@/lib/workspace-actor"
import { DEFAULT_RECEPTIONIST_CAPABILITIES } from "@/lib/receptionist-capabilities"

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

/** Sign in as a receptionist linked to owner-1 with the given flags on. */
function signedInReceptionist(capabilities: Record<string, boolean>) {
  getUserIdFromRequest.mockReturnValue("recep-1")
  getUser.mockResolvedValue({ id: "recep-1", account_role: "receptionist", email: "r@x.com" })
  getReceptionistPortalContext.mockResolvedValue({
    owner_user_id: "owner-1",
    receptionist: { id: "recep-row-1", name: "  Dana  ", capabilities },
  })
}

beforeEach(() => {
  getUserIdFromRequest.mockReset()
  getUser.mockReset()
  getReceptionistPortalContext.mockReset()
})

describe("resolveWorkspaceActor", () => {
  it("refuses a request with no session", async () => {
    getUserIdFromRequest.mockReturnValue(null)
    expect(await resolveWorkspaceActor(COOKIE)).toBeNull()
  })

  it("refuses a session whose user row is gone", async () => {
    getUserIdFromRequest.mockReturnValue("ghost-1")
    getUser.mockResolvedValue(null)
    expect(await resolveWorkspaceActor(COOKIE)).toBeNull()
  })

  it("resolves an owner to their own account, with every capability granted", async () => {
    getUserIdFromRequest.mockReturnValue("owner-1")
    getUser.mockResolvedValue({ id: "owner-1", account_role: "owner", email: "o@x.com" })

    const actor = await resolveWorkspaceActor(COOKIE)
    expect(actor).toMatchObject({
      ownerUserId: "owner-1",
      actingUserId: "owner-1",
      actorRole: "owner",
      receptionistId: null,
      receptionistName: null,
    })
    for (const key of Object.keys(DEFAULT_RECEPTIONIST_CAPABILITIES)) {
      expect(actor?.capabilities[key as keyof typeof actor.capabilities]).toBe(true)
    }
  })

  it("lets an owner through a capability gate they never opted into", async () => {
    getUserIdFromRequest.mockReturnValue("owner-1")
    getUser.mockResolvedValue({ id: "owner-1", account_role: "owner", email: "o@x.com" })

    const actor = await resolveWorkspaceActor(COOKIE, { capability: "invoicing_send" })
    expect(actor?.ownerUserId).toBe("owner-1")
  })

  it("points a receptionist at the owner's account, not her own", async () => {
    signedInReceptionist({ crm_access: true })

    const actor = await resolveWorkspaceActor(COOKIE, { capability: "crm_access" })
    expect(actor).toMatchObject({
      ownerUserId: "owner-1",
      actingUserId: "recep-1",
      actorRole: "receptionist",
      receptionistId: "recep-row-1",
      receptionistName: "Dana",
    })
  })

  it("admits a receptionist with no capability required — that is intake", async () => {
    signedInReceptionist({})

    const actor = await resolveWorkspaceActor(COOKIE)
    expect(actor?.ownerUserId).toBe("owner-1")
    expect(actor?.capabilities.crm_access).toBe(false)
  })

  it("refuses a receptionist whose capability is off", async () => {
    signedInReceptionist({ crm_access: true })
    expect(await resolveWorkspaceActor(COOKIE, { capability: "crm_edit" })).toBeNull()
  })

  it("reads a capability missing from the stored row as off, not on", async () => {
    // Rows written before a flag existed have no such key — they must not inherit access.
    signedInReceptionist({ dispatching: true })
    expect(await resolveWorkspaceActor(COOKIE, { capability: "invoicing" })).toBeNull()
  })

  it("refuses a receptionist account not linked to any business", async () => {
    getUserIdFromRequest.mockReturnValue("recep-1")
    getUser.mockResolvedValue({ id: "recep-1", account_role: "receptionist", email: "r@x.com" })
    getReceptionistPortalContext.mockResolvedValue(null)
    expect(await resolveWorkspaceActor(COOKIE)).toBeNull()
  })

  it("refuses a field tech rather than defaulting them to owner", async () => {
    getUserIdFromRequest.mockReturnValue("tech-1")
    getUser.mockResolvedValue({ id: "tech-1", account_role: "field_tech", email: "t@x.com" })
    expect(await resolveWorkspaceActor(COOKIE)).toBeNull()
  })
})
