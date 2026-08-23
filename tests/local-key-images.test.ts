import { describe, expect, it } from "vitest"
import { lookupFccRemoteVariants } from "@/lib/fccid-remote-variants"
import { attachLocalBundledPhotos, countLocalKeyImages } from "@/lib/local-key-images"
import { join } from "node:path"

describe("local bundled key photos", () => {
  const publicDir = join(process.cwd(), "public")

  it("has mirrored files for WAZSKE13D02", () => {
    expect(countLocalKeyImages("WAZSKE13D02", publicDir)).toBeGreaterThan(0)
  })

  it("attaches Yaris iA photos for 2017 Toyota Yaris iA", async () => {
    const prev = process.env.KEY_REFERENCE_CACHE_ONLY
    process.env.KEY_REFERENCE_CACHE_ONLY = "true"
    try {
      const result = await lookupFccRemoteVariants({
        fcc_id: "WAZSKE13D02",
        year: 2017,
        make: "Toyota",
        model: "Yaris iA",
      })
      expect(result.variants.length).toBeGreaterThan(0)
      expect(result.variants.some((v) => v.image_url?.startsWith("/key-images/"))).toBe(true)
    } finally {
      if (prev === undefined) delete process.env.KEY_REFERENCE_CACHE_ONLY
      else process.env.KEY_REFERENCE_CACHE_ONLY = prev
    }
  })

  it("maps disk files onto variants missing image_url", () => {
    const attached = attachLocalBundledPhotos(
      "WAZSKE13D02",
      [
        {
          id: "v-test-3",
          title: "3-Button Smart Key",
          image_url: null,
          key_type: "Smart Key",
          programming_method: null,
          buttons: "3",
          battery: null,
          part_numbers: null,
          fits_text: "2017 Toyota Yaris iA",
          source_url: null,
          suggested_key_style: "Push start (smart key)",
        },
      ],
      { year: 2017, make: "Toyota", model: "Yaris iA" },
      publicDir
    )
    expect(attached[0]?.image_url).toMatch(/^\/key-images\/WAZSKE13D02\//)
  })
})
