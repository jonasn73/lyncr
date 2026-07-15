import { describe, expect, it } from "vitest"
import { normalizeWorkspaceDisplayName } from "@/lib/workspace-organizations"

describe("normalizeWorkspaceDisplayName", () => {
  it("fixes Key Squad 5o2 letter-o typo to digit zero", () => {
    expect(normalizeWorkspaceDisplayName("Key Squad 5o2")).toBe("Key Squad 502")
    expect(normalizeWorkspaceDisplayName("Key Squad 5O2")).toBe("Key Squad 502")
    expect(normalizeWorkspaceDisplayName("  Key Squad 502  ")).toBe("Key Squad 502")
  })
})
