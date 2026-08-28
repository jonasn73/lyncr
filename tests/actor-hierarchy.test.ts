import { describe, expect, it, vi, beforeEach } from "vitest"
import { resolveActor } from "@/lib/actor"
import { intersectGrants, parsePlatformAccountGrants } from "@/lib/platform-account-grants"
import { DEFAULT_RECEPTIONIST_CAPABILITIES } from "@/lib/receptionist-capabilities"
import type { ReceptionistCapabilities } from "@/lib/types"

const getUserIdFromRequest = vi.fn()
const getUser = vi.fn()
const getPlatformAccountGrantsRaw = vi.fn((..._a: unknown[]) => ({}) as unknown)
const getReceptionistPortalContext = vi.fn()

vi.mock("@/lib/auth", () => ({
  getUserIdFromRequest: (...a: unknown[]) => getUserIdFromRequest(...a),
}))
vi.mock("@/lib/db", () => ({
  getUser: (...a: unknown[]) => getUser(...a),
  getPlatformAccountGrantsRaw: (...a: unknown[]) => getPlatformAccountGrantsRaw(...a),
}))
vi.mock("@/lib/receptionist-portal-auth", () => ({
  getReceptionistPortalContext: (...a: unknown[]) => getReceptionistPortalContext(...a),
  isReceptionistPortalUser: (user: { account_role?: string }) =>
    user?.account_role === "receptionist",
}))

const COOKIE = "lyncr_session=abc"

function caps(on: Partial<ReceptionistCapabilities>): ReceptionistCapabilities {
  return { ...DEFAULT_RECEPTIONIST_CAPABILITIES, ...on }
}

function signInOwner() {
  getUserIdFromRequest.mockReturnValue("owner-1")
  getUser.mockResolvedValue({ id: "owner-1", account_role: "owner", email: "o@x.com" })
}

function signInReceptionist(granted: Partial<ReceptionistCapabilities>) {
  getUserIdFromRequest.mockReturnValue("recep-1")
  getUser.mockResolvedValue({ id: "recep-1", account_role: "receptionist", email: "r@x.com" })
  getReceptionistPortalContext.mockResolvedValue({
    owner_user_id: "owner-1",
    receptionist: { id: "row-1", name: "Dana", capabilities: caps(granted) },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  getPlatformAccountGrantsRaw.mockResolvedValue({})
})

describe("the platform ceiling", () => {
  it("gives an owner everything their account is allowed", async () => {
    signInOwner()
    const actor = await resolveActor(COOKIE, { capability: "crm_access" })
    expect(actor?.actorRole).toBe("owner")
    expect(actor?.capabilities.crm_access).toBe(true)
  })

  it("takes a capability away from the owner when the platform revokes it", async () => {
    signInOwner()
    getPlatformAccountGrantsRaw.mockResolvedValue({ invoicing_send: false })
    expect(await resolveActor(COOKIE, { capability: "invoicing_send" })).toBeNull()
    // Everything else on the account is untouched — a ceiling is per-capability.
    expect((await resolveActor(COOKIE, { capability: "crm_access" }))?.ownerUserId).toBe("owner-1")
  })

  it("caps a receptionist's grant at what the account itself may do", async () => {
    // The owner gave it. The platform did not allow it. She does not inherit it.
    signInReceptionist({ crm_access: true })
    getPlatformAccountGrantsRaw.mockResolvedValue({ crm_access: false })
    expect(await resolveActor(COOKIE, { capability: "crm_access" })).toBeNull()
  })

  it("still requires the owner's grant when the platform allows it", async () => {
    signInReceptionist({})
    expect(await resolveActor(COOKIE, { capability: "crm_access" })).toBeNull()
  })

  it("passes a receptionist only when BOTH levels agree", async () => {
    signInReceptionist({ crm_access: true })
    const actor = await resolveActor(COOKIE, { capability: "crm_access" })
    expect(actor).toMatchObject({
      ownerUserId: "owner-1",
      actingUserId: "recep-1",
      actorRole: "receptionist",
    })
  })

  it("reads an absent grants column as fully granted, never as locked out", async () => {
    // Fails open on purpose: this ceiling only restricts an owner on their own account, so
    // a database blip must not take a business off its own console.
    signInOwner()
    getPlatformAccountGrantsRaw.mockResolvedValue(undefined)
    const actor = await resolveActor(COOKIE, { capability: "invoicing_send" })
    expect(actor?.capabilities.invoicing_send).toBe(true)
  })
})

describe("the platform admin", () => {
  beforeEach(() => {
    getUserIdFromRequest.mockReturnValue("admin-1")
    getUser.mockResolvedValue({ id: "admin-1", account_role: "owner", email: "admin@lyncr.app" })
  })

  it("is not capped by any account ceiling", async () => {
    getPlatformAccountGrantsRaw.mockResolvedValue({ invoicing_send: false, crm_access: false })
    const actor = await resolveActor(COOKIE, { capability: "invoicing_send" })
    expect(actor?.actorRole).toBe("platform_admin")
  })

  it("resolves to their OWN account — the business owns its data", async () => {
    // Being an admin must not silently become a read of someone's customer book. Every
    // workspace route scopes by ownerUserId, so this is what keeps admin out of tenant
    // records; seeing a business's console stays an explicit, auditable impersonation.
    const actor = await resolveActor(COOKIE)
    expect(actor?.ownerUserId).toBe("admin-1")
    expect(actor?.ownerUserId).not.toBe("owner-1")
  })
})

describe("intersectGrants", () => {
  it("denies unless both sides allow", () => {
    const platform = parsePlatformAccountGrants({ crm_access: true, crm_edit: false })
    const staff = caps({ crm_access: true, crm_edit: true })
    const effective = intersectGrants(platform, staff)
    expect(effective.crm_access).toBe(true)
    expect(effective.crm_edit).toBe(false)
  })

  it("covers every capability, so a new key cannot slip past the ceiling", () => {
    const effective = intersectGrants(parsePlatformAccountGrants({}), caps({}))
    expect(Object.keys(effective).sort()).toEqual(
      Object.keys(DEFAULT_RECEPTIONIST_CAPABILITIES).sort()
    )
  })
})
