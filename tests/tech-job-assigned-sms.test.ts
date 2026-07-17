import { describe, expect, it } from "vitest"
import { buildTechJobAssignedSms } from "@/lib/tech-job-assigned-sms"

describe("buildTechJobAssignedSms", () => {
  it("includes vehicle, AKL, address, and TI SKU", () => {
    const text = buildTechJobAssignedSms({
      vehicleYear: "2022",
      vehicleMake: "Subaru",
      vehicleModel: "Forester",
      isAkl: true,
      location: "123 Main St, Louisville, KY",
      tiSku: "TIK-SUB-37A",
    })
    expect(text).toBe(
      [
        "🛠️ JOB ASSIGNED: 2022 Subaru Forester (AKL)",
        "📍 Location: 123 Main St, Louisville, KY",
        "🔑 REQUIRED PART: TIK-SUB-37A",
      ].join("\n")
    )
  })

  it("omits AKL when not all-keys-lost", () => {
    const text = buildTechJobAssignedSms({
      vehicleYear: "2020",
      vehicleMake: "Honda",
      vehicleModel: "Civic",
      isAkl: false,
      location: "456 Oak Ave",
      tiSku: "TIK-HON-04",
    })
    expect(text).toContain("🛠️ JOB ASSIGNED: 2020 Honda Civic")
    expect(text).not.toContain("(AKL)")
    expect(text).toContain("🔑 REQUIRED PART: TIK-HON-04")
  })
})
