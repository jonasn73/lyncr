// Fetch and parse replacement-key listings from fccid.io for a given FCC ID + vehicle.
// Server-only — used by /api/vehicle/fcc-detail (not bundled to the client).

import { sanitizeFccIdInput } from "@/lib/fcc-id-input"
import { attachLocalBundledPhotos } from "@/lib/local-key-images"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { classifyKeyStyleBucket, extractButtonCount, inferProgrammingMethod, variantButtonSignature, type KeyStyleBucket } from "@/lib/vehicle-key-variant-labels"

export type FccRemoteVariant = {
  /** Stable id for UI selection (hash of title + image). */
  id: string
  title: string
  image_url: string | null
  key_type: string | null
  buttons: string | null
  battery: string | null
  part_numbers: string | null
  fits_text: string | null
  source_url: string | null
  /** Human hint for the intake sheet key-style dropdown. */
  suggested_key_style: string | null
  /** Programming workflow badge for Smart Pro–style intake cards. */
  programming_method: string | null
  /** Photo borrowed from another listing with the same FCC ID. */
  reference_image?: boolean
  /** Shown when the borrowed photo may be a different trim but same button count. */
  reference_note?: string
}

type CacheEntry = { expires: number; variants: FccRemoteVariant[] }
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 1000 * 60 * 60 * 12 // 12 hours — reference pages change slowly

let staticParsedByFcc: Record<string, FccRemoteVariant[]> | null = null

function loadStaticParsedByFcc(): Record<string, FccRemoteVariant[]> {
  if (staticParsedByFcc) return staticParsedByFcc
  try {
    const filePath = join(process.cwd(), "data", "fcc-remote-variants-cache.json")
    staticParsedByFcc = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, FccRemoteVariant[]>
  } catch {
    staticParsedByFcc = {}
  }
  return staticParsedByFcc
}

function normalizeFccId(raw: string): string {
  return sanitizeFccIdInput(raw)
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
}

function cellValue(rowHtml: string, label: string): string {
  const re = new RegExp(`data-label="${label}"[^>]*>([\\s\\S]*?)(?=<td|$)`, "i")
  const m = rowHtml.match(re)
  return m ? stripHtml(m[1]) : ""
}

function absoluteImageUrl(src: string): string {
  const clean = src.split("?")[0]!
  if (clean.startsWith("/key-images/")) return clean
  if (clean.startsWith("http")) return clean
  return `https://fccid.io${clean.startsWith("/") ? clean : `/${clean}`}`
}

function suggestKeyStyle(keyType: string | null, title: string): string | null {
  const blob = `${keyType ?? ""} ${title}`.toLowerCase()
  if (/push\s*start|smart\s*key|proximity|keyless\s*go/.test(blob) && !/combo|remote head/.test(blob)) {
    return "Push start (smart key)"
  }
  if (/flip/.test(blob)) return "Flip key"
  if (/remote\s*head|key combo|combo\s*key|transponder\s*key/.test(blob)) return "Remote head key"
  if (/remote\s*only|keyless\s*entry\s*remote|fob\s*only/.test(blob) && !/combo|head/.test(blob)) {
    return "Keyless remote only"
  }
  if (/blade|turn\s*key|mechanical/.test(blob)) return "Turn key (blade)"
  return null
}

function variantId(title: string, imageUrl: string | null): string {
  const base = `${title}|${imageUrl ?? ""}`
  let hash = 0
  for (let i = 0; i < base.length; i++) hash = (hash * 31 + base.charCodeAt(i)) >>> 0
  return `v-${hash.toString(16)}`
}

function isJunkListing(title: string): boolean {
  const t = title.toLowerCase()
  if (/\b(bundle|pack of|x \d+|\d+ x )\b/.test(t)) return true
  if (/\bshell only\b|\bkey shell\b|\bshell \//.test(t)) return true
  if (/\bprogrammer\b|\btool\b|\bobd\b/.test(t)) return true
  if (/\bdiy kit\b|\bvoice fob\b|\bvoice diy\b/.test(t)) return true
  return false
}

function rowMatchesMake(row: { title: string; fits: string; alt: string }, make: string): boolean {
  const makeTok = normalizeToken(make)
  if (!makeTok) return true
  const hay = normalizeToken(`${row.title} ${row.fits} ${row.alt}`)
  if (hay.includes(makeTok)) return true
  if (makeTok === "ram" || makeTok === "dodge") {
    return hay.includes("ram") || hay.includes("dodge")
  }
  return false
}

function rowMatchesModel(
  row: { title: string; fits: string; alt: string },
  make: string,
  model: string
): boolean {
  const modelTok = normalizeToken(model)
  if (!modelTok) return false
  const hay = normalizeToken(`${row.title} ${row.fits} ${row.alt}`)
  if (!hay.includes(modelTok)) return false
  return rowMatchesMake(row, make)
}

function yearMatchesText(year: number, title: string, fits: string): boolean {
  const yearStr = String(year)
  const hay = normalizeToken(`${title} ${fits}`)
  if (hay.includes(yearStr)) return true
  const rangeRe = /(19|20)(\d{2})\s*[-–]\s*(19|20)(\d{2})/g
  let m: RegExpExecArray | null
  const blob = `${title} ${fits}`
  while ((m = rangeRe.exec(blob))) {
    const y1 = Number(`${m[1]}${m[2]}`)
    const y2 = Number(`${m[3]}${m[4]}`)
    if (year >= Math.min(y1, y2) && year <= Math.max(y1, y2)) return true
  }
  return false
}

function rowMatchesVehicle(
  row: { title: string; fits: string; alt: string },
  year: number,
  make: string,
  model: string
): boolean {
  if (!rowMatchesModel(row, make, model)) return false
  return yearMatchesText(year, row.title, row.fits)
}

/** Max key photos shown on the answered-call intake sheet. */
export const INTAKE_KEY_VARIANT_LIMIT = 3

function trimForIntakeSheet(variants: FccRemoteVariant[], max: number): FccRemoteVariant[] {
  if (variants.length <= max) return variants
  const smart = variants.filter((v) => classifyKeyStyleBucket(v.title, v.key_type) === "smart")
  const rest = variants.filter((v) => classifyKeyStyleBucket(v.title, v.key_type) !== "smart")
  if (smart.length >= max) return smart.slice(0, max)
  return [...smart, ...rest].slice(0, max)
}

function dedupeVariants(list: FccRemoteVariant[]): FccRemoteVariant[] {
  const seen = new Set<string>()
  return list.filter((v) => {
    if (seen.has(v.id)) return false
    seen.add(v.id)
    return true
  })
}

function dedupeByImage(list: FccRemoteVariant[]): FccRemoteVariant[] {
  const seen = new Set<string>()
  return list.filter((v) => {
    if (!v.image_url) return true
    if (seen.has(v.image_url)) return false
    seen.add(v.image_url)
    return true
  })
}

function buttonSignature(v: FccRemoteVariant): string {
  return variantButtonSignature(v.title, v.buttons, v.fits_text, v.key_type)
}

function hasKnownButtonCount(signature: string): boolean {
  const count = signature.split("|")[0] ?? "?"
  return /^\d$/.test(count)
}

/** Rank and filter parsed listings — distinct button layouts with unique photos. */
export function pickVariantsForVehicle(
  parsed: FccRemoteVariant[],
  input: { year: number; make: string; model: string },
  limit = INTAKE_KEY_VARIANT_LIMIT
): FccRemoteVariant[] {
  const intakeCap = Math.min(limit, INTAKE_KEY_VARIANT_LIMIT)
  const sort = (list: FccRemoteVariant[]) =>
    [...list].sort((a, b) => scoreVariant(b, input.year) - scoreVariant(a, input.year))

  const exact = sort(
    parsed.filter((v) =>
      rowMatchesVehicle(
        { title: v.title, fits: v.fits_text ?? "", alt: v.title },
        input.year,
        input.make,
        input.model
      )
    )
  )

  const modelOnly = sort(
    parsed.filter((v) =>
      rowMatchesModel(
        { title: v.title, fits: v.fits_text ?? "", alt: v.title },
        input.make,
        input.model
      )
    )
  )

  const modelPhotos = modelOnly.filter((v) => Boolean(v.image_url))
  const candidates = dedupeVariants(
    sort(
      [...modelPhotos, ...exact, ...modelOnly].filter(
        (v) => !isJunkListing(v.title) && (v.image_url || classifyKeyStyleBucket(v.title, v.key_type) !== "other")
      )
    )
  )

  const rankedExact = sort(
    exact.filter(
      (v) => !isJunkListing(v.title) && (v.image_url || classifyKeyStyleBucket(v.title, v.key_type) !== "other")
    )
  )
  const ranked = sort(candidates)
  const picked: FccRemoteVariant[] = []
  const seenSignatures = new Set<string>()
  const seenImages = new Set<string>()

  const tryPick = (v: FccRemoteVariant, requireKnownButtons: boolean) => {
    if (picked.length >= intakeCap) return false
    const sig = buttonSignature(v)
    if (requireKnownButtons && !hasKnownButtonCount(sig)) return false
    if (seenSignatures.has(sig)) return false
    if (v.image_url && seenImages.has(v.image_url)) return false
    seenSignatures.add(sig)
    if (v.image_url) seenImages.add(v.image_url)
    picked.push(v)
    return true
  }

  // Phase 1: exact year+make+model listings with known button counts.
  for (const v of rankedExact) tryPick(v, true)
  for (const v of ranked) tryPick(v, true)

  // Phase 2: at most one fallback when the supplier title omits button count.
  let unknownPicked = false
  if (picked.filter((row) => hasKnownButtonCount(buttonSignature(row))).length === 0) {
    for (const v of rankedExact) {
      if (unknownPicked) break
      const sig = buttonSignature(v)
      if (hasKnownButtonCount(sig)) continue
      if (tryPick(v, false)) unknownPicked = true
    }
    if (!unknownPicked) {
      for (const v of ranked) {
        if (unknownPicked) break
        const sig = buttonSignature(v)
        if (hasKnownButtonCount(sig)) continue
        if (tryPick(v, false)) unknownPicked = true
      }
    }
  }

  let result = dedupeByImage(attachReferencePhotos(picked, parsed))
  if (result.some((row) => row.image_url && hasKnownButtonCount(buttonSignature(row)))) {
    result = result.filter((row) => Boolean(row.image_url))
  }
  const knownLayouts = result.filter((row) => hasKnownButtonCount(buttonSignature(row))).length
  if (knownLayouts >= 2) {
    return trimForIntakeSheet(
      result.filter((row) => hasKnownButtonCount(buttonSignature(row))),
      intakeCap
    )
  }
  if (knownLayouts >= 1 && result.some((row) => row.image_url)) {
    return trimForIntakeSheet(result.filter((row) => row.image_url), intakeCap)
  }

  const resultSignatures = new Set(result.map((row) => buttonSignature(row)))

  for (const v of [...rankedExact, ...ranked]) {
    if (result.length >= intakeCap) break
    if (result.some((row) => row.id === v.id)) continue
    if (v.image_url && result.some((row) => row.image_url === v.image_url)) continue
    const sig = buttonSignature(v)
    if (resultSignatures.has(sig)) continue
    result.push(v)
    resultSignatures.add(sig)
  }

  result = trimForIntakeSheet(dedupeByImage(result), intakeCap)

  // Last resort: same FCC page photos for this make when YMM filter found nothing.
  if (result.length === 0) {
    const makePhotos = sort(
      parsed.filter(
        (v) =>
          v.image_url &&
          !isJunkListing(v.title) &&
          rowMatchesMake({ title: v.title, fits: v.fits_text ?? "", alt: v.title }, input.make)
      )
    )
    if (makePhotos.length > 0) {
      return makePhotos.slice(0, intakeCap).map((v) => ({
        ...v,
        reference_image: true,
        reference_note: "Reference photo (same FCC ID — confirm on vehicle)",
      }))
    }
  }

  return result
}

/** Fill in missing photos from other listings on the same FCC page (same key family). */
function attachReferencePhotos(
  picked: FccRemoteVariant[],
  pool: FccRemoteVariant[]
): FccRemoteVariant[] {
  const photoPool = pool.filter((v) => v.image_url && !isJunkListing(v.title))
  if (photoPool.length === 0) return picked

  const usedImages = new Set(picked.map((v) => v.image_url).filter(Boolean) as string[])

  return picked.map((v) => {
    if (v.image_url) return v
    const sig = buttonSignature(v)
    const bucket = classifyKeyStyleBucket(v.title, v.key_type)
    const targetCount = extractButtonCount(v.title, v.buttons, v.fits_text)
    const fallback =
      photoPool.find(
        (p) =>
          !usedImages.has(p.image_url!) &&
          hasKnownButtonCount(sig) &&
          buttonSignature(p) === sig
      ) ??
      (targetCount
        ? photoPool.find(
            (p) =>
              !usedImages.has(p.image_url!) &&
              extractButtonCount(p.title, p.buttons, p.fits_text) === targetCount
          )
        : undefined) ??
      (!hasKnownButtonCount(sig)
        ? photoPool.find(
            (p) =>
              !usedImages.has(p.image_url!) &&
              classifyKeyStyleBucket(p.title, p.key_type) === bucket
          )
        : undefined)
    if (!fallback?.image_url) return v
    usedImages.add(fallback.image_url)
    const sameLayout = buttonSignature(fallback) === sig
    return {
      ...v,
      image_url: fallback.image_url,
      reference_image: true,
      reference_note: sameLayout
        ? undefined
        : targetCount
          ? `${targetCount}-button reference (same FCC, confirm on key)`
          : "Reference photo (same FCC, confirm on key)",
    }
  })
}

/** Merge variant lists from multiple FCC profiles — prefer entries that have photos. */
export function mergeVariantLists(lists: FccRemoteVariant[], limit = 6): FccRemoteVariant[] {
  const merged = dedupeByImage(dedupeVariants(lists.flat()))
  return [...merged].sort((a, b) => Number(Boolean(b.image_url)) - Number(Boolean(a.image_url))).slice(0, limit)
}

function scoreVariant(v: FccRemoteVariant, year: number): number {
  let score = 0
  if (v.image_url) score += 55
  const blob = `${v.title} ${v.fits_text ?? ""}`.toLowerCase()
  if (yearMatchesText(year, v.title, v.fits_text ?? "")) score += 25
  if (v.key_type) score += 10
  if (v.buttons) score += 5
  if (/\d\s*[- ]?button/.test(v.title.toLowerCase())) score += 12
  if (/\b\d\s*b\b/i.test(v.title)) score += 12
  if (/\boem\b|new oem|factory oem/.test(blob)) score += 15
  if (/aftermarket/.test(blob)) score += 4
  if (/refurb|used|reconditioned/.test(blob)) score -= 12
  if (isJunkListing(v.title)) score -= 100
  return score
}

/** Parse fccid.io replacement table rows from cached HTML. Exported for tests. */
export function parseFccidReplacementHtml(html: string): FccRemoteVariant[] {
  const variants: FccRemoteVariant[] = []
  const rowRe = /<tr>([\s\S]*?)<\/tr>/gi
  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowRe.exec(html))) {
    const row = rowMatch[1]!
    if (!row.includes("remote-key-thumb")) continue

    const imgMatch = row.match(/<img[^>]+src="([^"]+)"[^>]*(?:alt="([^"]*)")?/i)
    const title = cellValue(row, "Remote")
    if (!title) continue

    const details = cellValue(row, "Details")
    const keyType =
      details.match(/Type:\s*([^]+?)(?=Buttons:|Frequency:|Condition:|IC:|$)/i)?.[1]?.trim() ?? null
    const buttons = details.match(/Buttons:\s*([^]+?)(?=Type:|Frequency:|Condition:|IC:|$)/i)?.[1]?.trim() ?? null
    const batteryRaw = cellValue(row, "Battery")
    const battery =
      batteryRaw &&
      /^[A-Z]{1,3}\d{3,4}[A-Z]?$/i.test(batteryRaw.trim()) &&
      batteryRaw.length <= 12
        ? batteryRaw.trim()
        : null
    const partNumbers = title.match(/Part number:\s*(.+)$/i)?.[1]?.trim() ?? null
    const cleanTitle = title.replace(/\s*Part number:\s*.+$/i, "").trim()
    const sourceMatch = row.match(/data-label="Source"[^>]*>[\s\S]*?href="([^"]+)"/i)

    variants.push({
      id: variantId(cleanTitle, imgMatch ? absoluteImageUrl(imgMatch[1]!) : null),
      title: cleanTitle,
      image_url: imgMatch ? absoluteImageUrl(imgMatch[1]!) : null,
      key_type: keyType,
      buttons,
      battery,
      part_numbers: partNumbers,
      fits_text: cellValue(row, "Fits") || null,
      source_url: sourceMatch?.[1] ?? null,
      suggested_key_style: suggestKeyStyle(keyType, cleanTitle),
      programming_method: inferProgrammingMethod(cleanTitle, keyType, null),
    })
  }

  // De-dupe by title + image
  const seen = new Set<string>()
  return variants.filter((v) => {
    const key = `${v.title}|${v.image_url ?? ""}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export type FccRemoteLookupInput = {
  fcc_id: string
  year: number
  make: string
  model: string
}

export type FccRemoteLookupResult = {
  fcc_id: string
  year: number
  make: string
  model: string
  variants: FccRemoteVariant[]
  fccid_page_url: string
  source: "fccid.io" | "fccid.io-cache" | "lyncr-cache"
  disclaimer: string
}

async function fetchFccidReplacementHtml(fccClean: string): Promise<string | null> {
  const pageUrl = `https://fccid.io/${encodeURIComponent(fccClean)}/Remote-Keyfob-Replacement`
  const userAgents = [
    "Mozilla/5.0 (compatible; lyncr-key-reference/1.1; +https://lyncr.app)",
    "lyncr-key-reference/1.0 (+https://lyncr.app)",
  ]

  for (const userAgent of userAgents) {
    try {
      const res = await fetch(pageUrl, {
        headers: {
          "User-Agent": userAgent,
          Accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(20_000),
        next: { revalidate: 60 * 60 * 12 },
      })
      if (!res.ok) continue
      const html = await res.text()
      if (html.includes("remote-key-thumb")) return html
    } catch (e) {
      console.warn("[fccid-remote-variants] fetch failed", fccClean, e)
    }
  }

  return null
}

export async function lookupFccRemoteVariants(
  input: FccRemoteLookupInput
): Promise<FccRemoteLookupResult> {
  const fccClean = normalizeFccId(input.fcc_id)
  const pageUrl = `https://fccid.io/${encodeURIComponent(fccClean)}/Remote-Keyfob-Replacement`
  const cacheKey = `${fccClean}|${input.year}|${normalizeToken(input.make)}|${normalizeToken(input.model)}`
  const hit = cache.get(cacheKey)
  if (hit && hit.expires > Date.now()) {
    return buildLookupResult(input, fccClean, pageUrl, hit.variants)
  }

  const staticParsed = loadStaticParsedByFcc()[fccClean]
  if (staticParsed?.length) {
    let filtered = pickVariantsForVehicle(staticParsed, input)
    filtered = attachLocalBundledPhotos(fccClean, filtered, input, join(process.cwd(), "public"))
    if (filtered.length > 0) {
      cache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, variants: filtered })
    }
    return buildLookupResult(input, fccClean, pageUrl, filtered, "lyncr-cache")
  }

  if (isKeyReferenceCacheOnly()) {
    return buildLookupResult(input, fccClean, pageUrl, [], "lyncr-cache")
  }

  const html = await fetchFccidReplacementHtml(fccClean)
  if (!html) {
    return buildLookupResult(input, fccClean, pageUrl, [], "fccid.io")
  }

  const parsed = parseFccidReplacementHtml(html)
  let filtered = pickVariantsForVehicle(parsed, input)
  filtered = attachLocalBundledPhotos(fccClean, filtered, input, join(process.cwd(), "public"))

  if (filtered.length > 0) {
    cache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, variants: filtered })
  }

  return buildLookupResult(input, fccClean, pageUrl, filtered, "fccid.io")
}

function buildLookupResult(
  input: FccRemoteLookupInput,
  fccClean: string,
  pageUrl: string,
  variants: FccRemoteVariant[],
  source: FccRemoteLookupResult["source"] = "fccid.io"
): FccRemoteLookupResult {
  return {
    fcc_id: fccClean,
    year: input.year,
    make: input.make,
    model: input.model,
    variants,
    fccid_page_url: pageUrl,
    source,
    disclaimer:
      variants.length > 0
        ? "Photos and titles come from our bundled key reference library. Always confirm the physical key on the vehicle before ordering."
        : "No matching photos for this vehicle on FCC listings. Use the key style dropdown and supplier links below.",
  }
}
