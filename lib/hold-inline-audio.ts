// Inline hold-music bytes for Telnyx `playback_content` (base64).
// Used for near-immediate Busy soft-hold: Telnyx never needs to fetch lyncr.app.
// Reads the short 8 kHz mono WAV from public/ so we never ship a giant string literal.
// Prefetch at module load so the first hold after cold start skips disk I/O.

import { readFileSync } from "fs"
import { join } from "path"

let cachedBase64: string | null = null
let prefetchAttempted = false

/** Absolute path to the short Classic-hold WAV bundled with the app. */
function shortHoldWavPath(): string {
  return join(process.cwd(), "public", "audio", "hold-calm-short.wav")
}

/**
 * Load + cache base64 of Classic hold clip for Call Control `playback_start.playback_content`.
 * Returns null if the file is missing (local/test without assets).
 */
export function loadHoldMusicPlaybackContentBase64(): string | null {
  if (cachedBase64) return cachedBase64
  try {
    const buf = readFileSync(shortHoldWavPath())
    if (!buf.length) return null
    cachedBase64 = buf.toString("base64")
    return cachedBase64
  } catch {
    return null
  }
}

/**
 * Warm the in-memory base64 cache (call on webhook cold start).
 * Safe to call repeatedly — only hits disk once.
 */
export function prefetchHoldMusicPlaybackContent(): void {
  if (prefetchAttempted && cachedBase64) return
  prefetchAttempted = true
  loadHoldMusicPlaybackContentBase64()
}

// Prefetch as soon as this module is imported (Call Control hold path / voice webhook).
prefetchHoldMusicPlaybackContent()
