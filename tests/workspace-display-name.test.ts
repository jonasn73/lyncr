import { describe, expect, it } from "vitest"
import {
  isWorkspaceOrgStubId,
  normalizeWorkspaceDisplayName,
  organizationQueryString,
  resolveActiveOrganizationId,
} from "@/lib/workspace-organizations"
import { filterPhoneLinesForOrganization } from "@/lib/workspace-phone-lines"

describe("normalizeWorkspaceDisplayName", () => {
  it("fixes Key Squad 5o2 letter-o typo to digit zero", () => {
    expect(normalizeWorkspaceDisplayName("Key Squad 5o2")).toBe("Key Squad 502")
    expect(normalizeWorkspaceDisplayName("Key Squad 5O2")).toBe("Key Squad 502")
    expect(normalizeWorkspaceDisplayName("  Key Squad 502  ")).toBe("Key Squad 502")
  })
})

describe("resolveActiveOrganizationId", () => {
  const keySquad = { id: "ks", name: "Key Squad 502", is_default: true }
  const freshAuto = { id: "fa", name: "Fresh Auto Detail", is_default: false }
  const rows = [keySquad, freshAuto]

  it("keeps the shop already on screen even when the cookie is the default shop", () => {
    expect(
      resolveActiveOrganizationId({
        rows,
        currentId: "fa",
        currentName: "Fresh Auto Detail",
        storedId: "ks",
      })
    ).toBe("fa")
  })

  it("matches a paint-seed fake id by shop name instead of jumping to default", () => {
    expect(
      resolveActiveOrganizationId({
        rows,
        currentId: "__paint-seed__",
        currentName: "Fresh Auto Detail",
        storedId: "ks",
      })
    ).toBe("fa")
  })

  it("keeps the chip shop when the cookie id is a different shop", () => {
    expect(
      resolveActiveOrganizationId({
        rows,
        currentId: "ks",
        currentName: "Fresh Auto Detail",
        storedId: "ks",
      })
    ).toBe("fa")
  })

  it("uses the stored cookie when nothing is on screen yet", () => {
    expect(
      resolveActiveOrganizationId({
        rows,
        currentId: null,
        currentName: null,
        storedId: "fa",
      })
    ).toBe("fa")
  })
})

describe("isWorkspaceOrgStubId", () => {
  it("treats paint-seed and legacy ids as stubs, not empty or real uuids", () => {
    expect(isWorkspaceOrgStubId("__paint-seed__")).toBe(true)
    expect(isWorkspaceOrgStubId("legacy-user-1")).toBe(true)
    expect(isWorkspaceOrgStubId(null)).toBe(false)
    expect(isWorkspaceOrgStubId("a3841ad1-2fb8-4482-a8d7-db7094cd95ee")).toBe(false)
  })
})

describe("organizationQueryString", () => {
  it("omits paint-seed and legacy stubs so /api/numbers/mine is not asked for a fake id", () => {
    expect(organizationQueryString("__paint-seed__")).toBe("")
    expect(organizationQueryString("legacy-user-1")).toBe("")
    expect(organizationQueryString("a3841ad1-2fb8-4482-a8d7-db7094cd95ee")).toBe(
      "?organization_id=a3841ad1-2fb8-4482-a8d7-db7094cd95ee"
    )
  })
})

describe("filterPhoneLinesForOrganization", () => {
  const keySquadLine = {
    number: "+15023471148",
    status: "active",
    organization_id: "ks",
  }

  it("keeps painted lines when the active org id is still a paint-seed stub", () => {
    expect(filterPhoneLinesForOrganization([keySquadLine], "__paint-seed__")).toEqual([
      keySquadLine,
    ])
  })
})
