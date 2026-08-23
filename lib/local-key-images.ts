// Match bundled photos in public/key-images/{FCC}/ to vehicle + variant rows.

import { readdirSync } from "node:fs"
import { join } from "node:path"
import type { FccRemoteVariant } from "@/lib/fccid-remote-variants"
import { extractButtonCount, variantButtonSignature } from "@/lib/vehicle-key-variant-labels"
import { normalizeFccIdForFilename } from "@/lib/key-reference-image-mirror"

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "")
}

export function listLocalKeyImageFiles(fccId: string, publicDir: string): string[] {
  const dir = join(publicDir, "key-images", normalizeFccIdForFilename(fccId))
  try {
    return readdirSync(dir).filter((name) => /\.(jpe?g|png|gif|webp)$/i.test(name))
  } catch {
    return []
  }
}

function publicPathForFile(fccId: string, filename: string): string {
  return `/key-images/${normalizeFccIdForFilename(fccId)}/${filename}`
}

function buttonCountFromFilename(filename: string): number | null {
  const lower = filename.toLowerCase()
  const m = lower.match(/(?:^|[-_])(\d)\s*[-_]?b(?:uttons?)?(?:[-_.]|$)/) ?? lower.match(/(\d)-button/)
  if (m) return Number(m[1])
  if (/\b4b\b/.test(lower) || lower.includes("4-button")) return 4
  if (/\b3b\b/.test(lower) || lower.includes("3-button")) return 3
  return null
}

function scoreLocalFile(
  filename: string,
  input: { year: number; make: string; model: string },
  buttonHint: number | null
): number {
  const hay = filename.toLowerCase().replace(/[^a-z0-9]+/g, "")
  const year = String(input.year)
  const make = normalizeToken(input.make)
  const model = normalizeToken(input.model)
  let score = 0
  if (hay.includes(year)) score += 20
  if (make && hay.includes(make)) score += 12
  if (model && hay.includes(model)) score += 15
  if (model.includes("yaris") && hay.includes("yarisia") && model.includes("ia")) score += 10
  if (buttonHint != null) {
    const fileButtons = buttonCountFromFilename(filename)
    if (fileButtons === buttonHint) score += 25
  }
  if (filename.toLowerCase().includes("refurb")) score -= 2
  return score
}

function pickBestLocalFile(
  files: string[],
  input: { year: number; make: string; model: string },
  buttonHint: number | null,
  used: Set<string>
): string | null {
  let best: string | null = null
  let bestScore = 0
  for (const file of files) {
    if (used.has(file)) continue
    const score = scoreLocalFile(file, input, buttonHint)
    if (score > bestScore) {
      bestScore = score
      best = file
    }
  }
  if (bestScore < 15) return null
  return best
}

/** Attach /key-images/ URLs when the JSON cache has titles but no image_url. */
export function attachLocalBundledPhotos(
  fccId: string,
  variants: FccRemoteVariant[],
  input: { year: number; make: string; model: string },
  publicDir: string
): FccRemoteVariant[] {
  const files = listLocalKeyImageFiles(fccId, publicDir)
  if (files.length === 0) return variants

  const used = new Set<string>()
  const updated = variants.map((variant) => {
    if (variant.image_url?.startsWith("/key-images/")) return variant
    // extractButtonCount returns the digit as a STRING ("4"), while scoreLocalFile compares
    // it with `===` against buttonCountFromFilename's number — so 4 === "4" was always false
    // and the +25 button-match bonus never fired. Parse it so button count actually counts.
    const buttonHintRaw = extractButtonCount(variant.title, variant.buttons, variant.fits_text)
    const buttonHintParsed = buttonHintRaw != null ? Number.parseInt(buttonHintRaw, 10) : Number.NaN
    const buttonHint = Number.isFinite(buttonHintParsed) ? buttonHintParsed : null
    const file = pickBestLocalFile(files, input, buttonHint, used)
    if (!file) return variant
    used.add(file)
    const score = scoreLocalFile(file, input, buttonHint)
    return {
      ...variant,
      image_url: publicPathForFile(fccId, file),
      reference_image: score < 25,
      reference_note: score >= 25 ? undefined : "Bundled reference photo — confirm on key",
    }
  })

  if (updated.some((v) => Boolean(v.image_url))) {
    return updated
  }

  // Build photo rows from disk when cache listings have no URLs at all.
  const signatures = new Map<string, FccRemoteVariant>()
  for (const file of files) {
    const buttons = buttonCountFromFilename(file)
    const sig = buttons ? `${buttons}b` : "smart"
    if (signatures.has(sig)) continue
    const score = scoreLocalFile(file, input, buttons)
    if (score < 15) continue
    signatures.set(sig, {
      id: `local-${normalizeFccIdForFilename(fccId)}-${sig}`,
      title: buttons ? `${buttons}-button smart key` : "Smart key",
      image_url: publicPathForFile(fccId, file),
      key_type: "Smart Key",
      buttons: buttons ? String(buttons) : null,
      battery: null,
      part_numbers: null,
      fits_text: `${input.year} ${input.make} ${input.model}`,
      source_url: null,
      suggested_key_style: "Push start (smart key)",
      // Required on FccRemoteVariant — disk-built rows carry no programming hint.
      programming_method: null,
    })
  }

  const fromDisk = [...signatures.values()].slice(0, 4)
  return fromDisk.length > 0 ? fromDisk : updated
}

export function countLocalKeyImages(fccId: string, publicDir: string): number {
  return listLocalKeyImageFiles(fccId, publicDir).length
}
