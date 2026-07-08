import { describe, expect, it } from "vitest"
import {
  extractVariantFactoryFeatures,
  shouldShowAklTrimVerificationBanner,
  variantDisabledByTrim,
} from "@/lib/vehicle-trim-features"

describe("vehicle-trim-features", () => {
  it("detects remote start on variant titles", () => {
    expect(
      extractVariantFactoryFeatures({
        title: "Ford Escape OEM 4 Button Remote Head Key Fob w/ remote start",
        buttons: null,
        fits_text: null,
        key_type: "Remote",
      })
    ).toContain("remote_start")
  })

  it("disables remote-start variants on confirmed base trim", () => {
    const result = variantDisabledByTrim(
      {
        title: "4-button remote start fob",
        buttons: "4",
        fits_text: null,
        key_type: "Remote",
      },
      { trim: "Base", factoryOptions: [], excludedOptions: [] }
    )
    expect(result.disabled).toBe(true)
    expect(result.missingFeature).toBe("remote_start")
  })

  it("shows AKL banner when remote start variant picked without trim proof", () => {
    const show = shouldShowAklTrimVerificationBanner(
      {
        title: "5-button remote start smart key",
        buttons: "5",
        fits_text: null,
        key_type: "Smart",
      },
      { trim: "SLT", factoryOptions: [] },
      true
    )
    expect(show).toBe(true)
  })
})
