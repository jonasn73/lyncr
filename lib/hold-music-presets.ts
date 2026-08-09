// ============================================
// Hold music presets — Busy soft-hold playback
// ============================================
// Bundled tracks are Lyncr-authored synthetic ambient loops (royalty-free).
// Custom URL remains available under Advanced for operators who host their own MP3/WAV.

import { getAppUrl } from "@/lib/telnyx"

/** Built-in preset ids (not including custom). */
export type HoldMusicPresetId = "calm" | "upbeat" | "minimal"

export type HoldMusicPreset = {
  id: HoldMusicPresetId
  label: string
  /** Short UI blurb — keep mobile blurbs `hidden md:block` in the form. */
  description: string
  /** App-relative path under public/ (portable across lyncr.app / previews). */
  path: string
}

/** Calm is the product default so Busy is never silent when assets ship. */
export const HOLD_MUSIC_DEFAULT_PRESET: HoldMusicPresetId = "calm"

export const HOLD_MUSIC_PRESETS: HoldMusicPreset[] = [
  {
    id: "calm",
    label: "Calm",
    description: "Soft ambient pad — easy to talk over.",
    path: "/audio/hold-calm.wav",
  },
  {
    id: "upbeat",
    label: "Upbeat",
    description: "Brighter pulse so callers know the line is live.",
    path: "/audio/hold-upbeat.wav",
  },
  {
    id: "minimal",
    label: "Minimal",
    description: "Sparse soft tones with quiet gaps.",
    path: "/audio/hold-minimal.wav",
  },
]

/** Absolute HTTPS URL for a preset path (or null if app URL unknown). */
export function holdMusicPresetAbsoluteUrl(presetId: HoldMusicPresetId): string | null {
  const preset = HOLD_MUSIC_PRESETS.find((p) => p.id === presetId)
  if (!preset) return null
  try {
    const base = getAppUrl().replace(/\/$/, "")
    if (!base) return null
    return `${base}${preset.path}`
  } catch {
    return null
  }
}

/** Resolve a stored account value → which preset (or custom / empty). */
export function matchHoldMusicPreset(
  storedUrl: string | null | undefined
): HoldMusicPresetId | "custom" | "default" {
  const raw = String(storedUrl || "").trim()
  if (!raw) return "default"
  const lower = raw.toLowerCase()
  for (const p of HOLD_MUSIC_PRESETS) {
    if (lower.includes(p.path.toLowerCase()) || lower.endsWith(p.path.split("/").pop()!)) {
      return p.id
    }
  }
  // Legacy default file names still map to Calm.
  if (lower.includes("/audio/hold-music.wav") || lower.includes("/audio/hold-music.mp3")) {
    return "calm"
  }
  if (raw.startsWith("http") || raw.startsWith("/audio/")) return "custom"
  return "custom"
}

/**
 * Value to persist when the operator picks a preset.
 * Prefer relative `/audio/…` so Neon rows survive domain changes; playback resolves to absolute.
 */
export function holdMusicValueForPreset(presetId: HoldMusicPresetId): string {
  const preset = HOLD_MUSIC_PRESETS.find((p) => p.id === presetId)
  return preset?.path ?? HOLD_MUSIC_PRESETS[0]!.path
}
