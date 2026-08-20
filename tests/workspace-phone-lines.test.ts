import { describe, expect, it } from "vitest"
import { operationsPaintMatchesOrg } from "@/lib/operations-paint-cache"
import {
  preferPhoneLinesForWorkspace,
  scopeCallsToShopLines,
} from "@/lib/workspace-phone-lines"

describe("preferPhoneLinesForWorkspace", () => {
  it("uses bootstrap when it has more DIDs than the painted chrome subset", () => {
    const live = [{ number: "+15023471148", status: "active" }]
    const boot = [
      { number: "+15023471148", status: "active" },
      { number: "+15025571219", status: "active" },
    ]
    expect(preferPhoneLinesForWorkspace(live, boot)).toEqual(boot)
  })
})

describe("scopeCallsToShopLines", () => {
  const amber = { number: "+15023471148" }
  const main = { number: "+15025571219" }
  const calls = [
    { id: "1", targetLineE164: "+15025571219" },
    { id: "2", targetLineE164: "+15025758166" },
  ]

  it("keeps sister-line history when every shop DID is known", () => {
    const scoped = scopeCallsToShopLines(calls, [amber, main])
    expect(scoped.map((c) => c.id)).toEqual(["1"])
  })

  it("does not hide history when only the painted Main Line is known and it matches nothing", () => {
    const scoped = scopeCallsToShopLines(calls, [amber])
    expect(scoped).toEqual(calls)
  })

  it("keeps painted rows while shop lines are still loading", () => {
    const scoped = scopeCallsToShopLines(calls, [], { linesLoading: true })
    expect(scoped).toEqual(calls)
  })

  it("filters to active line while lines load when only one DID is painted", () => {
    const scoped = scopeCallsToShopLines(calls, [], {
      linesLoading: true,
      activeLine: "+15025571219",
    })
    expect(scoped.map((c) => c.id)).toEqual(["1"])
  })
})

describe("operationsPaintMatchesOrg", () => {
  const seed = { organizationId: "__paint-seed__", calls: [], fetchedAt: 1 }

  it("does not treat a paint-seed stub vs a real shop id as a different shop", () => {
    expect(operationsPaintMatchesOrg(seed, "a3841ad1-2fb8-4482-a8d7-db7094cd95ee")).toBe(true)
  })

  it("accepts legacy cookies without an org tag", () => {
    const legacy = { organizationId: null, calls: [], fetchedAt: 1 }
    expect(operationsPaintMatchesOrg(legacy, "a3841ad1-2fb8-4482-a8d7-db7094cd95ee")).toBe(true)
  })

  it("rejects a different real shop id", () => {
    const tagged = {
      organizationId: "a3841ad1-2fb8-4482-a8d7-db7094cd95ee",
      calls: [],
      fetchedAt: 1,
    }
    expect(operationsPaintMatchesOrg(tagged, "f8c2a1b0-4e3d-4a9b-8c7f-1d2e3f4a5b6c")).toBe(false)
  })
})
