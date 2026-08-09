// Inline hold-music bytes for Telnyx `playback_content` (base64).
// Used when URL fetch from Telnyx fails or returns a format Telnyx rejects mid-gather.
// Reads the short 8 kHz mono WAV from public/ so we never ship a giant string literal.

import { readFileSync } from "fs"
import { join } from "path"

let cachedBase64: string | null = null

/** Absolute path to the short Calm WAV bundled with the app. */
function shortHoldWavPath(): string {
  return join(process.cwd(), "public", "audio", "hold-calm-short.wav")
}

/**
 * Base64 of Calm hold clip for Call Control `playback_start.playback_content`.
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
