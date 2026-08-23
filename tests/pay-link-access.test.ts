import { describe, expect, it } from "vitest"
import { canAccessCollectPayLink } from "@/lib/job-pay-link"

const OWNER = "owner-1"
const ACTOR = "actor-1"
const TECH = "tech-1"
const STRANGER = "stranger-1"

/** Link with no job and no Stripe session — the shape that used to bypass every check. */
const orphanLink = {
  owner_user_id: OWNER,
  acting_user_id: ACTOR,
  tech_user_id: null,
}

describe("canAccessCollectPayLink", () => {
  it("lets the owning business through", () => {
    expect(canAccessCollectPayLink({ userId: OWNER, link: orphanLink, job: null })).toBe(true)
  })

  it("lets whoever created the link through", () => {
    expect(canAccessCollectPayLink({ userId: ACTOR, link: orphanLink, job: null })).toBe(true)
  })

  it("lets the tech the link was raised for through", () => {
    const link = { ...orphanLink, tech_user_id: TECH }
    expect(canAccessCollectPayLink({ userId: TECH, link, job: null })).toBe(true)
  })

  it("falls back to job assignment for links attached to a job", () => {
    const job = { ownerUserId: "other-owner", assignedTechId: TECH }
    expect(canAccessCollectPayLink({ userId: TECH, link: orphanLink, job })).toBe(true)
    expect(
      canAccessCollectPayLink({
        userId: "other-owner",
        link: orphanLink,
        job,
      })
    ).toBe(true)
  })

  // The regression this function exists for: a link with no stripe_session_id and no job_id
  // resolved to `stored === null`, so neither ownership branch ran and the handler returned
  // the link to any authenticated caller holding the token.
  it("refuses an unrelated authenticated user on a link with no job", () => {
    expect(canAccessCollectPayLink({ userId: STRANGER, link: orphanLink, job: null })).toBe(false)
  })

  it("refuses an unrelated user even when the link has a job they are not on", () => {
    const job = { ownerUserId: OWNER, assignedTechId: TECH }
    expect(canAccessCollectPayLink({ userId: STRANGER, link: orphanLink, job })).toBe(false)
  })

  it("fails closed when the link row cannot be resolved", () => {
    expect(canAccessCollectPayLink({ userId: OWNER, link: null, job: null })).toBe(false)
  })

  it("does not match on null ids — a null owner must not admit a null-ish caller", () => {
    const link = { owner_user_id: null, acting_user_id: null, tech_user_id: null }
    expect(canAccessCollectPayLink({ userId: STRANGER, link, job: null })).toBe(false)
    expect(canAccessCollectPayLink({ userId: "", link, job: null })).toBe(false)
  })
})
