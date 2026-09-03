// Download fccid.io key photos into public/key-images/ so we own the assets.
// Used by scripts/mirror-fcc-key-images.ts and scripts/build-fcc-remote-cache.ts.

import { createHash } from "node:crypto"
import { access, mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { FccRemoteVariant } from "@/lib/fccid-remote-variants"

export type MirroredVariantCache = Record<string, FccRemoteVariant[]>

/** Folder-safe FCC id for public/key-images/{id}/… */
export function normalizeFccIdForFilename(fccId: string): string {
  return fccId.trim().replace(/[^a-zA-Z0-9_-]+/g, "").toUpperCase()
}

/** True when the image already lives on our app (not a remote hotlink). */
export function isLocalKeyImageUrl(imageUrl: string | null | undefined): boolean {
  return Boolean(imageUrl?.startsWith("/key-images/"))
}

/** Turn a cache image_url into a full https URL we can download. */
export function toAbsoluteDownloadUrl(imageUrl: string): string {
  const clean = imageUrl.split("?")[0]!
  if (clean.startsWith("http")) return clean
  if (clean.startsWith("/key-images/")) return clean
  return `https://fccid.io${clean.startsWith("/") ? clean : `/${clean}`}`
}

/** Stable public URL path served from Next.js public/. */
export function localKeyImagePublicPath(fccId: string, sourceUrl: string): string {
  const fcc = normalizeFccIdForFilename(fccId)
  const file = safeImageFilename(sourceUrl)
  return `/key-images/${fcc}/${file}`
}

/** Disk path under the repo public/ folder. */
function localKeyImageDiskPath(publicDir: string, publicPath: string): string {
  return join(publicDir, publicPath.replace(/^\//, ""))
}

function extensionFromUrl(url: string): string {
  const match = url.split("?")[0]!.match(/\.(jpe?g|png|gif|webp)$/i)
  return match ? match[0]!.toLowerCase() : ".jpg"
}

/** Filename with a short hash so two different URLs never collide. */
export function safeImageFilename(sourceUrl: string): string {
  const clean = sourceUrl.split("?")[0]!
  const rawBase = clean.split("/").pop() || "image"
  const base = rawBase.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "image"
  const hash = createHash("sha1").update(clean).digest("hex").slice(0, 8)
  const ext = extensionFromUrl(clean)
  const stem = base.replace(/\.(jpe?g|png|gif|webp)$/i, "") || "image"
  return `${stem.slice(0, 80)}-${hash}${ext}`
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

type MirrorImageResult = {
  publicPath: string | null
  downloaded: boolean
  skipped: boolean
  failed: boolean
}

/** Download one remote image into public/key-images/ (skip if already on disk). */
async function mirrorImageUrl(
  fccId: string,
  imageUrl: string | null | undefined,
  publicDir: string,
  urlMap?: Map<string, string>
): Promise<MirrorImageResult> {
  if (!imageUrl) {
    return { publicPath: null, downloaded: false, skipped: false, failed: false }
  }
  if (isLocalKeyImageUrl(imageUrl)) {
    return { publicPath: imageUrl, downloaded: false, skipped: true, failed: false }
  }

  const downloadUrl = toAbsoluteDownloadUrl(imageUrl)
  const cachedPath = urlMap?.get(downloadUrl)
  if (cachedPath) {
    return { publicPath: cachedPath, downloaded: false, skipped: true, failed: false }
  }

  const publicPath = localKeyImagePublicPath(fccId, downloadUrl)
  const diskPath = localKeyImageDiskPath(publicDir, publicPath)

  if (await fileExists(diskPath)) {
    urlMap?.set(downloadUrl, publicPath)
    return { publicPath, downloaded: false, skipped: true, failed: false }
  }

  try {
    const res = await fetch(downloadUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; lyncr-key-mirror/1.0; +https://lyncr.app)",
        Accept: "image/*,*/*",
      },
      signal: AbortSignal.timeout(25_000),
    })
    if (!res.ok) {
      return { publicPath: imageUrl, downloaded: false, skipped: false, failed: true }
    }
    const type = res.headers.get("content-type") ?? ""
    if (!type.startsWith("image/") && !downloadUrl.match(/\.(jpe?g|png|gif|webp)(\?|$)/i)) {
      return { publicPath: imageUrl, downloaded: false, skipped: false, failed: true }
    }
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.length < 200) {
      return { publicPath: imageUrl, downloaded: false, skipped: false, failed: true }
    }
    await mkdir(dirname(diskPath), { recursive: true })
    await writeFile(diskPath, bytes)
    urlMap?.set(downloadUrl, publicPath)
    return { publicPath, downloaded: true, skipped: false, failed: false }
  } catch {
    return { publicPath: imageUrl, downloaded: false, skipped: false, failed: true }
  }
}

export type MirrorStats = { downloaded: number; skipped: number; failed: number; rewritten: number }

/** Rewrite variant image_url fields to local /key-images/ paths. */
export async function mirrorVariantsForFcc(
  fccId: string,
  variants: FccRemoteVariant[],
  publicDir: string,
  urlMap?: Map<string, string>
): Promise<{ variants: FccRemoteVariant[]; stats: MirrorStats }> {
  const stats: MirrorStats = { downloaded: 0, skipped: 0, failed: 0, rewritten: 0 }
  const out: FccRemoteVariant[] = []

  for (const variant of variants) {
    const result = await mirrorImageUrl(fccId, variant.image_url, publicDir, urlMap)
    if (result.downloaded) stats.downloaded++
    if (result.skipped) stats.skipped++
    if (result.failed) stats.failed++
    if (result.publicPath && result.publicPath !== variant.image_url) {
      stats.rewritten++
      out.push({ ...variant, image_url: result.publicPath })
    } else {
      out.push(variant)
    }
  }

  return { variants: out, stats }
}

/** Mirror every image referenced in the FCC variants JSON cache. */
export async function mirrorFccVariantCache(
  cache: MirroredVariantCache,
  publicDir: string,
  onProgress?: (fccId: string, index: number, total: number) => void
): Promise<{ cache: MirroredVariantCache; stats: MirrorStats }> {
  const fccIds = Object.keys(cache).sort()
  const totalStats: MirrorStats = { downloaded: 0, skipped: 0, failed: 0, rewritten: 0 }
  const out: MirroredVariantCache = {}
  const urlMap = new Map<string, string>()

  for (let i = 0; i < fccIds.length; i++) {
    const fccId = fccIds[i]!
    onProgress?.(fccId, i + 1, fccIds.length)
    const { variants, stats } = await mirrorVariantsForFcc(fccId, cache[fccId] ?? [], publicDir, urlMap)
    out[fccId] = variants
    totalStats.downloaded += stats.downloaded
    totalStats.skipped += stats.skipped
    totalStats.failed += stats.failed
    totalStats.rewritten += stats.rewritten
  }

  return { cache: out, stats: totalStats }
}
