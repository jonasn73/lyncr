// Inline US ringback bytes for Telnyx Call Control `playback_start.playback_content`.
// Call Control Dial (POST /v2/calls + bridge_on_answer) has no TeXML `ringTone` —
// after Answer the A-leg is already up, so we must play ringback ourselves or the
// caller hears dead air while the cell rings.

import { readFileSync } from "fs"
import { join } from "path"

// Cached base64 of the 8 kHz mono WAV (null until first successful read).
let cachedBase64: string | null = null
// True after we tried disk once (avoids hammering missing files in tests).
let prefetchAttempted = false

/** Absolute path to the bundled North American ringback WAV (2s on / 4s off). */
function usRingbackWavPath(): string {
  // public/ is served by Next and also readable from the Node webhook process.
  return join(process.cwd(), "public", "audio", "us-ringback.wav")
}

/**
 * Load + cache base64 of US ringback for Call Control `playback_content`.
 * Returns null if the file is missing (local/test without assets).
 */
export function loadUsRingbackPlaybackContentBase64(): string | null {
  // Reuse memory cache on hot paths (every inbound Dial).
  if (cachedBase64) return cachedBase64
  try {
    // Read the short 8 kHz WAV from disk once per cold start.
    const buf = readFileSync(usRingbackWavPath())
    // Empty file would be useless — treat as missing.
    if (!buf.length) return null
    // Telnyx wants base64 of the raw file bytes (including RIFF header).
    cachedBase64 = buf.toString("base64")
    return cachedBase64
  } catch {
    // Missing asset in CI / odd cwd — caller can fall back to audio_url.
    return null
  }
}

/**
 * Warm the in-memory base64 cache (call on webhook cold start).
 * Safe to call repeatedly — only hits disk once.
 */
export function prefetchUsRingbackPlaybackContent(): void {
  // Skip if we already warmed successfully.
  if (prefetchAttempted && cachedBase64) return
  // Remember we tried so missing-file cases do not re-stat forever.
  prefetchAttempted = true
  // Populate cache (or leave null if the WAV is absent).
  loadUsRingbackPlaybackContentBase64()
}

// Prefetch as soon as this module is imported (Call Control inbound Dial path).
prefetchUsRingbackPlaybackContent()
