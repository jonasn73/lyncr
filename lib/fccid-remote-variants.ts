// Fetch and parse replacement-key listings from fccid.io for a given FCC ID + vehicle.
// Server-only — used by /api/vehicle/fcc-detail (not bundled to the client).

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
}

type CacheEntry = { expires: number; variants: FccRemoteVariant[] }
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 1000 * 60 * 60 * 12 // 12 hours — reference pages change slowly

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
  if (clean.startsWith("http")) return clean
  return `https://fccid.io${clean.startsWith("/") ? clean : `/${clean}`}`
}

function suggestKeyStyle(keyType: string | null, title: string): string | null {
  const blob = `${keyType ?? ""} ${title}`.toLowerCase()
  if (/push\s*start|smart\s*key|proximity|keyless\s*go/.test(blob)) return "Push start (smart key)"
  if (/flip/.test(blob)) return "Flip key"
  if (/remote\s*head|combo\s*key|transponder\s*key/.test(blob)) return "Remote head key"
  if (/remote\s*only|keyless\s*entry\s*remote|fob\s*only/.test(blob)) return "Keyless remote only"
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

function dedupeVariants(list: FccRemoteVariant[]): FccRemoteVariant[] {
  const seen = new Set<string>()
  return list.filter((v) => {
    if (seen.has(v.id)) return false
    seen.add(v.id)
    return true
  })
}

/** Rank and filter parsed listings for a vehicle, with broader fallbacks when exact matches are thin. */
export function pickVariantsForVehicle(
  parsed: FccRemoteVariant[],
  input: { year: number; make: string; model: string },
  limit = 8
): FccRemoteVariant[] {
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
  if (exact.length >= 3) return dedupeVariants(exact).slice(0, limit)

  const modelOnly = sort(
    parsed.filter((v) =>
      rowMatchesModel(
        { title: v.title, fits: v.fits_text ?? "", alt: v.title },
        input.make,
        input.model
      )
    )
  )
  const merged = dedupeVariants([...exact, ...modelOnly])
  if (merged.length >= 2) return merged.slice(0, limit)

  const broad = sort(parsed.filter((v) => !isJunkListing(v.title)))
  return dedupeVariants([...merged, ...broad]).slice(0, limit)
}

function scoreVariant(v: FccRemoteVariant, year: number): number {
  let score = 0
  if (v.image_url) score += 40
  const blob = `${v.title} ${v.fits_text ?? ""}`.toLowerCase()
  if (blob.includes(String(year))) score += 25
  if (v.key_type) score += 10
  if (v.buttons) score += 5
  if (/aftermarket|oem|refurb/i.test(v.title)) score += 2
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
  source: "fccid.io"
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
  const fccClean = input.fcc_id.trim().replace(/\s+/g, "").toUpperCase()
  const pageUrl = `https://fccid.io/${encodeURIComponent(fccClean)}/Remote-Keyfob-Replacement`
  const cacheKey = `${fccClean}|${input.year}|${normalizeToken(input.make)}|${normalizeToken(input.model)}`
  const hit = cache.get(cacheKey)
  if (hit && hit.expires > Date.now()) {
    return {
      fcc_id: fccClean,
      year: input.year,
      make: input.make,
      model: input.model,
      variants: hit.variants,
      fccid_page_url: pageUrl,
      source: "fccid.io",
      disclaimer:
        "Photos and titles come from public FCC ID replacement listings. Always confirm the physical key on the vehicle before ordering.",
    }
  }

  const html = await fetchFccidReplacementHtml(fccClean)
  if (!html) {
    return {
      fcc_id: fccClean,
      year: input.year,
      make: input.make,
      model: input.model,
      variants: [],
      fccid_page_url: pageUrl,
      source: "fccid.io",
      disclaimer:
        "Could not load key photos from FCC listings. Use the links below or check the key on the vehicle.",
    }
  }

  const parsed = parseFccidReplacementHtml(html)
  const filtered = pickVariantsForVehicle(parsed, input, 8)

  if (filtered.length > 0) {
    cache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, variants: filtered })
  }

  return {
    fcc_id: fccClean,
    year: input.year,
    make: input.make,
    model: input.model,
    variants: filtered,
    fccid_page_url: pageUrl,
    source: "fccid.io",
    disclaimer:
      filtered.length > 0
        ? "Photos and titles come from public FCC ID replacement listings. Always confirm the physical key on the vehicle before ordering."
        : "No matching photos for this vehicle on FCC listings. Use the key style dropdown and supplier links below.",
  }
}
