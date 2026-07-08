import { describe, expect, it } from "vitest"
import { classifyKeyStyleBucket, inferProgrammingMethod, variantButtonLabel, variantDisplayLabel } from "@/lib/vehicle-key-variant-labels"

describe("vehicle-key-variant-labels", () => {
  it("labels key combo as remote head key, not generic remote", () => {
    expect(
      variantDisplayLabel("2017 Nissan Altima Keyless Entry Remote / key combo", null)
    ).toBe("Remote head key")
    expect(classifyKeyStyleBucket("2017 Nissan Altima Keyless Entry Remote / key combo", null)).toBe(
      "remote_head"
    )
  })

  it("labels smart remote key fob as smart even when type says Remote", () => {
    expect(variantDisplayLabel("2016 Dodge Dart Smart Remote Key Fob - Refurbished", "Remote")).toBe(
      "Smart key"
    )
  })

  it("labels standalone keyless remote as keyless fob", () => {
    expect(variantDisplayLabel("2016 Dodge Dart Keyless Remote Key - Refurbished", null)).toBe(
      "Keyless fob"
    )
  })

  it("extracts button layout label from listing title", () => {
    expect(
      variantButtonLabel("Ford Escape OEM 4 Button Remote Head Key Fob", null, null)
    ).toBe("4-button")
    expect(
      variantButtonLabel(
        "2011 Ford Expedition 4 Button Keyless Remote Key w/ Engine Start",
        null,
        null
      )
    ).toBe("4-button + remote start")
  })

  it("labels smart key with trunk when button count is omitted", () => {
    expect(
      variantButtonLabel("2020 Ford Explorer ST Smart Remote w/ Trunk", "Remote", null)
    ).toBe("Smart key + trunk")
  })

  it("reads Ford OEM 3B / 4B shorthand in titles", () => {
    expect(
      variantButtonLabel(
        "Ford New OEM 2017-2024 F-150 Smart Key 3B FCCID: M3N-A2C93142300",
        null,
        null
      )
    ).toBe("3-button")
  })

  it("infers OBD2 programming for smart and transponder keys", () => {
    expect(inferProgrammingMethod("2018 Toyota RAV4 Smart Remote Key Fob", "Remote")).toBe(
      "OBD2 Programming Required"
    )
    expect(inferProgrammingMethod("Nissan Altima Keyless Entry Remote / key combo", null)).toBe(
      "OBD2 Programming Required"
    )
  })

  it("infers on-board sequence for mechanical blades", () => {
    expect(inferProgrammingMethod("High-Security laser cut blade", "Mechanical")).toBe("On-Board Sequence")
  })
})
