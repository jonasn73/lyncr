import { describe, expect, it } from "vitest"
import { buildJobTechnicalSpecBlocks } from "@/lib/scheduler-job-spec-blocks"

describe("buildJobTechnicalSpecBlocks", () => {
  it("builds vehicle, key, and chip lines from saved job fields", () => {
    const blocks = buildJobTechnicalSpecBlocks({
      vehicle_year: "2020",
      vehicle_make: "GMC",
      vehicle_model: "Terrain",
      key_frequency: "314.9",
      key_style: "Proximity Smart Key",
      key_chipset: "HU100 Blade profile",
      service_quote_type_id: "key_generation",
    })
    expect(blocks.map((block) => block.value)).toEqual([
      "2020 GMC Terrain",
      "Key Generation (AKL)",
      "314.9 MHz Proximity Smart Key",
      "HU100 Blade profile",
    ])
  })
})
