import { describe, expect, it } from "vitest"
import {
  formatIntakeJobTypeForDispatch,
  isIntakeJobTypeComplete,
  KEY_REPLACEMENT_MODES,
} from "@/lib/intake-job-types"

describe("intake job types", () => {
  it("requires origination or duplication for key replacement", () => {
    expect(isIntakeJobTypeComplete("Key replacement", "")).toBe(false)
    expect(isIntakeJobTypeComplete("Key replacement", "Origination")).toBe(true)
    expect(isIntakeJobTypeComplete("Key replacement", "Duplication")).toBe(true)
    expect(isIntakeJobTypeComplete("Lockout", "")).toBe(true)
  })

  it("formats dispatch job type with replacement mode", () => {
    expect(formatIntakeJobTypeForDispatch("Key replacement", "Origination")).toBe(
      "Key replacement — Origination"
    )
    expect(formatIntakeJobTypeForDispatch("Lockout", "")).toBe("Lockout")
  })

  it("lists origination and duplication modes", () => {
    expect(KEY_REPLACEMENT_MODES).toEqual(["Origination", "Duplication"])
  })
})
