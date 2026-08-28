import { describe, expect, it } from "vitest"
import {
  fieldsForJobType,
  intakeFieldsForProfile,
  jobTypeRequiresVehicle,
} from "@/lib/field-service-intake"

describe("jobTypeRequiresVehicle", () => {
  it("defaults to true before a job type is chosen", () => {
    expect(jobTypeRequiresVehicle("locksmith", "")).toBe(true)
  })

  it("is false for a house rekey on the locksmith profile", () => {
    expect(jobTypeRequiresVehicle("locksmith", "Rekey")).toBe(false)
  })

  it("stays true for automotive locksmith job types", () => {
    expect(jobTypeRequiresVehicle("locksmith", "Lockout")).toBe(true)
    expect(jobTypeRequiresVehicle("locksmith", "Ignition")).toBe(true)
    expect(jobTypeRequiresVehicle("locksmith", "Key replacement")).toBe(true)
  })

  it("detailing and auto_repair always need a vehicle", () => {
    expect(jobTypeRequiresVehicle("detailing", "Interior only")).toBe(true)
    expect(jobTypeRequiresVehicle("auto_repair", "Oil change")).toBe(true)
  })
})

describe("fieldsForJobType", () => {
  const locksmithFields = intakeFieldsForProfile("locksmith")

  it("keeps every field when the job type needs a vehicle", () => {
    const result = fieldsForJobType(locksmithFields, "locksmith", "Lockout")
    expect(result).toEqual(locksmithFields)
  })

  it("drops vehicle and car-key-specific fields for a house rekey", () => {
    const result = fieldsForJobType(locksmithFields, "locksmith", "Rekey")
    expect(result.some((f) => f.type === "vehicle_cascade")).toBe(false)
    expect(result.some((f) => f.type === "vin_lookup")).toBe(false)
    expect(result.some((f) => f.name === "all_keys_lost")).toBe(false)
    // job/address/notes fields still apply to a house rekey.
    expect(result.some((f) => f.name === "job_type")).toBe(true)
    expect(result.some((f) => f.name === "job_address")).toBe(true)
  })
})
