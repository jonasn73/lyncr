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

  it("picks distinct button layouts for 2012 Ford Escape CWTWB1U793", () => {
    const cache = JSON.parse(
      readFileSync(join(process.cwd(), "data", "fcc-remote-variants-cache.json"), "utf8")
    ) as Record<string, Parameters<typeof pickVariantsForVehicle>[0]>
    const picked = pickVariantsForVehicle(cache["CWTWB1U793"] ?? [], {
      year: 2012,
      make: "Ford",
      model: "Escape",
    })
    expect(picked.length).toBeGreaterThanOrEqual(2)
    const images = picked.map((v) => v.image_url).filter(Boolean)
    expect(new Set(images).size).toBe(images.length)
    const buttonTitles = picked.map((v) => v.title.toLowerCase()).join(" ")
    expect(buttonTitles).toMatch(/3\s*[- ]?button/)
    expect(buttonTitles).toMatch(/4\s*[- ]?button/)
  })

  it("uses 3-button F-series photo for 2020 F-150 M3N-A2C93142300", () => {
    const cache = JSON.parse(
      readFileSync(join(process.cwd(), "data", "fcc-remote-variants-cache.json"), "utf8")
    ) as Record<string, Parameters<typeof pickVariantsForVehicle>[0]>
    const picked = pickVariantsForVehicle(cache["M3N-A2C93142300"] ?? [], {
      year: 2020,
      make: "Ford",
      model: "F-150",
    })
    expect(picked.length).toBe(1)
    expect(picked[0]?.title.toLowerCase()).toContain("f-150")
    expect(picked[0]?.title.toLowerCase()).toMatch(/3b|3.button/)
    expect(picked[0]?.image_url).toMatch(/3b|hc3t/i)
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
