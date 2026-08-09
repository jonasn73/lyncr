// ============================================
// Hold music presets — classic call-center soft hold
// ============================================
// Bundled tracks are Lyncr-authored royalty-free elevator / light-instrumental loops
// (smooth major arpeggios + warm pad — not beeps or experimental noise).
// Custom URL remains available under Advanced.
// Keep this module browser-safe — do not import lib/telnyx or other Node telephony clients.

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

/**
 * Presets use 8 kHz mono WAV — Telnyx PSTN-friendly.
 * Classic “on hold” style: soft jazz / elevator voicings (not beeps).
 */
export const HOLD_MUSIC_PRESETS: HoldMusicPreset[] = [
  {
    id: "calm",
    label: "Classic hold",
    description: "Soft jazz / elevator voicings — standard contact-center feel.",
    path: "/audio/hold-calm.wav",
  },
  {
    id: "upbeat",
    label: "Bright hold",
    description: "Slightly brighter light jazz, still soft on the ear.",
    path: "/audio/hold-upbeat.wav",
  },
  {
    id: "minimal",
    label: "Soft hold",
    description: "Quieter sparse pad for a gentler wait.",
    path: "/audio/hold-minimal.wav",
  },
]

/** Resolve a stored account value → which preset (or custom / empty). */
export function matchHoldMusicPreset(
  storedUrl: string | null | undefined
): HoldMusicPresetId | "custom" | "default" {
  const raw = String(storedUrl || "").trim()
  if (!raw) return "default"
  const lower = raw.toLowerCase()
  for (const p of HOLD_MUSIC_PRESETS) {
    const file = p.path.split("/").pop()
    const stem = file?.replace(/\.(mp3|wav)$/i, "")
    if (
      lower.includes(p.path.toLowerCase()) ||
      (file && lower.endsWith(file)) ||
      (stem && (lower.includes(`/audio/${stem}.mp3`) || lower.includes(`/audio/${stem}.wav`)))
    ) {
      return p.id
    }
  }
  // Legacy default file names still map to Classic hold (calm).
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
