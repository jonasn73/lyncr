import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { mergeVariantLists, pickVariantsForVehicle } from "@/lib/fccid-remote-variants"

describe("pickVariantsForVehicle photos", () => {
  it("attaches same-FCC reference photo when vehicle listing has no image", () => {
    const cache = JSON.parse(
      readFileSync(join(process.cwd(), "data", "fcc-remote-variants-cache.json"), "utf8")
    ) as Record<string, Parameters<typeof pickVariantsForVehicle>[0]>
    const picked = pickVariantsForVehicle(cache["KR5TXN1"] ?? [], {
      year: 2020,
      make: "NISSAN",
      model: "Altima",
    })
    expect(picked.length).toBeGreaterThan(0)
    expect(picked.some((v) => Boolean(v.image_url))).toBe(true)
  })

  it("mergeVariantLists prefers variants with photos from alternate FCC profiles", () => {
    const cache = JSON.parse(
      readFileSync(join(process.cwd(), "data", "fcc-remote-variants-cache.json"), "utf8")
    ) as Record<string, Parameters<typeof pickVariantsForVehicle>[0]>
    const input = { year: 2020, make: "NISSAN", model: "Altima" }
    const merged = mergeVariantLists([
      pickVariantsForVehicle(cache["KR5TXN1"] ?? [], input),
      pickVariantsForVehicle(cache["KR5TXN4"] ?? [], input),
    ])
    expect(merged.some((v) => Boolean(v.image_url))).toBe(true)
  })
})
