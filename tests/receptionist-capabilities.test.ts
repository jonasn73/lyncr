import { describe, expect, it } from "vitest"
import {
  DEFAULT_RECEPTIONIST_CAPABILITIES,
  parseReceptionistCapabilities,
} from "@/lib/receptionist-capabilities"

describe("parseReceptionistCapabilities", () => {
  it("defaults to off when the column is missing (pre-migration)", () => {
    expect(parseReceptionistCapabilities(undefined)).toEqual(DEFAULT_RECEPTIONIST_CAPABILITIES)
    expect(parseReceptionistCapabilities(null)).toEqual(DEFAULT_RECEPTIONIST_CAPABILITIES)
  })

  it("reads a known flag", () => {
    const result = parseReceptionistCapabilities({ full_vehicle_key_catalog: true })
    expect(result.full_vehicle_key_catalog).toBe(true)
  })

  it("ignores unknown keys and non-boolean values", () => {
    const result = parseReceptionistCapabilities({
      full_vehicle_key_catalog: "yes",
      some_future_flag: true,
    })
    expect(result.full_vehicle_key_catalog).toBe(false)
    expect(result).toEqual(DEFAULT_RECEPTIONIST_CAPABILITIES)
  })
})
