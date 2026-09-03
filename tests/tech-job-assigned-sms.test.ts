import { describe, expect, it } from "vitest"
import { buildTechJobAssignedSms } from "@/lib/tech-job-assigned-sms"

describe("buildTechJobAssignedSms", () => {
  it("includes customer, vehicle, AKL, address, problem, and TI SKU", () => {
    const text = buildTechJobAssignedSms({
      customerName: "Jane Doe",
      customerPhone: "(502) 555-0134",
      vehicleYear: "2022",
      vehicleMake: "Subaru",
      vehicleModel: "Forester",
      isAkl: true,
      location: "123 Main St, Louisville, KY",
      jobType: "Lost all keys, need a replacement",
      tiSku: "TIK-SUB-37A",
    })
    expect(text).toBe(
      [
        "🛠️ JOB ASSIGNED: 2022 Subaru Forester (AKL)",
        "👤 Jane Doe · (502) 555-0134",
        "📍 Location: 123 Main St, Louisville, KY",
        "🔧 Lost all keys, need a replacement",
        "🔑 REQUIRED PART: TIK-SUB-37A",
      ].join("\n")
    )
  })

  it("omits AKL when not all-keys-lost", () => {
    const text = buildTechJobAssignedSms({
      customerName: "John Smith",
      customerPhone: null,
      vehicleYear: "2020",
      vehicleMake: "Honda",
      vehicleModel: "Civic",
      isAkl: false,
      location: "456 Oak Ave",
      jobType: "Key fob programming",
      tiSku: "TIK-HON-04",
    })
    expect(text).toContain("🛠️ JOB ASSIGNED: 2020 Honda Civic")
    expect(text).not.toContain("(AKL)")
    expect(text).toContain("👤 John Smith")
    expect(text).toContain("🔧 Key fob programming")
    expect(text).toContain("🔑 REQUIRED PART: TIK-HON-04")
  })

  it("falls back to TBD placeholders when customer/vehicle/problem details are missing", () => {
    const text = buildTechJobAssignedSms({
      customerName: null,
      customerPhone: null,
      vehicleYear: null,
      vehicleMake: null,
      vehicleModel: null,
      isAkl: false,
      location: null,
      jobType: null,
      tiSku: null,
    })
    expect(text).toBe(
      [
        "🛠️ JOB ASSIGNED: Vehicle",
        "👤 Customer TBD",
        "📍 Location: Address TBD",
        "🔧 Service call",
        "🔑 REQUIRED PART: TBD",
      ].join("\n")
    )
  })
})
