// Build data/fcc-remote-variants-cache.json from fccid.io replacement pages.
// Downloads key photos into public/key-images/ so we are not dependent on fccid.io hosting.
// Run: npm run build:fcc-cache

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parseFccidReplacementHtml } from "../lib/fccid-remote-variants"
import { mirrorVariantsForFcc, type MirroredVariantCache } from "../lib/key-reference-image-mirror"

function csvFccIds(): string[] {
  const filePath = join(process.cwd(), "data", "vehicle-key-fcc-reference.csv")
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/)
  const ids = new Set<string>()
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line?.trim()) continue
    const cols = line.split(",")
    const raw = cols[3]?.trim()
    if (!raw || raw === "noRecord") continue
    for (const part of raw.split("/")) {
      const clean = part.trim().replace(/\s+/g, "").toUpperCase()
      if (clean) ids.add(clean)
    }
  }
  return [...ids].sort()
}

function loadExistingCache(path: string): MirroredVariantCache {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, "utf8")) as MirroredVariantCache
  } catch {
    return {}
  }
}

async function fetchHtml(fccId: string): Promise<string | null> {
  const url = `https://fccid.io/${encodeURIComponent(fccId)}/Remote-Keyfob-Replacement`
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; lyncr-key-cache/1.0; +https://lyncr.app)",
        Accept: "text/html,application/xhtml+xml",
      },
    })
    if (!res.ok) return null
    const html = await res.text()
    return html.includes("remote-key-thumb") ||
      html.includes("remote-key-card") ||
      html.includes("remote-key-table") ||
      html.includes("remote-key-hero")
      ? html
      : null
  } catch {
    return null
  }
}

async function main() {
  const fccIds = csvFccIds()
  const outPath = join(process.cwd(), "data", "fcc-remote-variants-cache.json")
  const publicDir = join(process.cwd(), "public")
  const out: MirroredVariantCache = loadExistingCache(outPath)

  if (existsSync(outPath)) {
    copyFileSync(outPath, `${outPath}.${Date.now()}.bak`)
  }

  let ok = 0
  let fail = 0
  let downloaded = 0
  let mirrorFailed = 0

  for (let i = 0; i < fccIds.length; i++) {
    const fccId = fccIds[i]!
    process.stdout.write(`[${i + 1}/${fccIds.length}] ${fccId} … `)
    const html = await fetchHtml(fccId)
    if (!html) {
      fail++
      console.log(out[fccId]?.length ? "keep existing" : "skip")
      await new Promise((r) => setTimeout(r, 150))
      continue
    }
    const parsed = parseFccidReplacementHtml(html)
    const { variants, stats } = await mirrorVariantsForFcc(fccId, parsed, publicDir)
    out[fccId] = variants
    ok++
    downloaded += stats.downloaded
    mirrorFailed += stats.failed
    console.log(`${variants.length} variants, +${stats.downloaded} imgs`)
    await new Promise((r) => setTimeout(r, 150))
  }

  writeFileSync(outPath, JSON.stringify(out))
  console.log(
    `\nWrote ${outPath} — refreshed ${ok} FCC IDs, kept/skipped ${fail}, downloaded ${downloaded} images, mirror failures ${mirrorFailed}`
  )
}

void main()
