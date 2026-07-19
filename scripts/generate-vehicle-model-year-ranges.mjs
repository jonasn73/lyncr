#!/usr/bin/env node
/**
 * Builds data/vehicle-model-year-ranges.json from the FCC key CSV + curated
 * US hard discontinuations.
 *
 * IMPORTANT: FCC last-seen year is NOT the same as “model discontinued”.
 * Our FCC CSV is incomplete for recent years (e.g. Silverado may stop at 2021
 * even though it still sells). Only curated rows set hardStart/hardEnd used to
 * hide NHTSA ghosts (e.g. 2022 Chevrolet Cruze).
 *
 * Run: node scripts/generate-vehicle-model-year-ranges.mjs
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const csvPath = path.join(root, "data/vehicle-key-fcc-reference.csv")
const outPath = path.join(root, "data/vehicle-model-year-ranges.json")

/**
 * Hard US-market production windows. These override NHTSA ghost listings.
 * Prefer official discontinuation years, not “last year we have an FCC row”.
 */
const CURATED_HARD = [
  { make: "CHEVROLET", model: "CRUZE", start: 2010, end: 2019 },
  { make: "CHEVROLET", model: "CRUZE LIMITED", start: 2016, end: 2016 },
  { make: "CHEVROLET", model: "IMPALA", start: 2000, end: 2020 },
  { make: "CHEVROLET", model: "SONIC", start: 2012, end: 2020 },
  { make: "CHEVROLET", model: "SPARK", start: 2013, end: 2022 },
  { make: "CHEVROLET", model: "VOLT", start: 2011, end: 2019 },
  { make: "CHEVROLET", model: "SS", start: 2014, end: 2017 },
  { make: "FORD", model: "FUSION", start: 2006, end: 2020 },
  { make: "FORD", model: "FIESTA", start: 2011, end: 2019 },
  { make: "FORD", model: "FOCUS", start: 2000, end: 2018 },
  { make: "FORD", model: "TAURUS", start: 2008, end: 2019 },
  { make: "FORD", model: "ECOSPORT", start: 2018, end: 2022 },
  { make: "DODGE", model: "DART", start: 2013, end: 2016 },
  { make: "DODGE", model: "JOURNEY", start: 2009, end: 2020 },
  { make: "DODGE", model: "GRAND CARAVAN", start: 2008, end: 2020 },
  { make: "CHRYSLER", model: "200", start: 2011, end: 2017 },
  { make: "CHRYSLER", model: "300", start: 2005, end: 2023 },
  { make: "TOYOTA", model: "YARIS", start: 2007, end: 2020 },
  { make: "TOYOTA", model: "YARIS IA", start: 2016, end: 2018 },
  { make: "TOYOTA", model: "SCION TC", start: 2005, end: 2016 },
  { make: "HONDA", model: "FIT", start: 2007, end: 2020 },
  { make: "HONDA", model: "INSIGHT", start: 2019, end: 2022 },
  { make: "NISSAN", model: "VERSA NOTE", start: 2014, end: 2019 },
  { make: "NISSAN", model: "JUKE", start: 2011, end: 2017 },
  { make: "HYUNDAI", model: "ACCENT", start: 2000, end: 2022 },
  { make: "HYUNDAI", model: "VELOSTER", start: 2012, end: 2022 },
  { make: "KIA", model: "OPTIMA", start: 2001, end: 2020 },
  { make: "KIA", model: "FORTE5", start: 2011, end: 2018 },
  { make: "BUICK", model: "LACROSSE", start: 2005, end: 2019 },
  { make: "BUICK", model: "REGAL", start: 2011, end: 2020 },
  { make: "CADILLAC", model: "ATS", start: 2013, end: 2019 },
  { make: "CADILLAC", model: "XTS", start: 2013, end: 2019 },
  { make: "CADILLAC", model: "CT6", start: 2016, end: 2020 },
  { make: "MAZDA", model: "CX-3", start: 2016, end: 2021 },
  { make: "VOLKSWAGEN", model: "BEETLE", start: 2012, end: 2019 },
  { make: "VOLKSWAGEN", model: "CC", start: 2009, end: 2017 },
  { make: "VOLKSWAGEN", model: "GOLF", start: 2010, end: 2021 },
  { make: "JEEP", model: "PATRIOT", start: 2007, end: 2017 },
  { make: "MITSUBISHI", model: "LANCER", start: 2002, end: 2017 },
  { make: "MITSUBISHI", model: "MIRAGE", start: 2014, end: 2024 },
  { make: "FIAT", model: "500", start: 2012, end: 2019 },
  { make: "SMART", model: "FORTWO", start: 2008, end: 2019 },
]

const csv = fs.readFileSync(csvPath, "utf8")
/** FCC soft spans — informational only (last year we have a key row). */
const fccSpans = new Map()

for (const line of csv.split(/\r?\n/).slice(1)) {
  if (!line.trim()) continue
  const match = line.match(/^(\d{4}),([^,]+),([^,]+),/)
  if (!match) continue
  const year = Number(match[1])
  const make = match[2].trim().toUpperCase()
  const model = match[3].trim().toUpperCase()
  if (!year || !make || !model) continue
  const key = `${make}|${model}`
  const prev = fccSpans.get(key)
  if (!prev) fccSpans.set(key, { make, model, fccStart: year, fccEnd: year })
  else {
    prev.fccStart = Math.min(prev.fccStart, year)
    prev.fccEnd = Math.max(prev.fccEnd, year)
  }
}

const hardByKey = new Map()
for (const row of CURATED_HARD) {
  hardByKey.set(`${row.make}|${row.model}`, row)
}

const keys = new Set([...fccSpans.keys(), ...hardByKey.keys()])
const ranges = []

for (const key of keys) {
  const [make, model] = key.split("|")
  const fcc = fccSpans.get(key)
  const hard = hardByKey.get(key)
  // open-ended curated (2099) means “still sold” — do not hard-filter by end
  const hardEnd = hard && hard.end < 2090 ? hard.end : null
  const hardStart = hard ? hard.start : null
  ranges.push({
    make,
    model,
    // Compat fields used by the app filter (hard window only when curated).
    start: hardStart ?? fcc?.fccStart ?? 1980,
    end: hardEnd ?? 2099,
    hard: Boolean(hard && hardEnd != null),
    fccStart: fcc?.fccStart ?? null,
    fccEnd: fcc?.fccEnd ?? null,
  })
}

ranges.sort((a, b) => a.make.localeCompare(b.make) || a.model.localeCompare(b.model))

const out = {
  generatedAt: new Date().toISOString(),
  source: "data/vehicle-key-fcc-reference.csv + curated US hard discontinuations",
  note: "Only rows with hard:true are used to hide Year→Make→Model options. fccStart/fccEnd are last-seen key data years and must not be treated as discontinuation.",
  ranges,
}

fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`)
const hardCount = ranges.filter((r) => r.hard).length
console.log(`Wrote ${ranges.length} ranges (${hardCount} hard) → ${path.relative(root, outPath)}`)
const cruze = ranges.find((r) => r.make === "CHEVROLET" && r.model === "CRUZE")
const silverado = ranges.find((r) => r.make === "CHEVROLET" && r.model === "SILVERADO")
console.log("CHEVROLET CRUZE", cruze)
console.log("CHEVROLET SILVERADO", silverado)
