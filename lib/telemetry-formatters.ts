// Shared duration formatters for HUD pills, call history, and live talk-time counters.

/** Turn raw seconds into m:ss or h:mm:ss (returns "0:00" for empty/invalid input). */
export function formatSecondsToClock(sec: number | null | undefined): string {
  // Treat missing or non-numeric values as zero talk time.
  if (sec == null || Number.isNaN(Number(sec))) return "0:00"
  // Round to whole seconds so UI counters never show fractional values.
  const total = Math.max(0, Math.round(Number(sec)))
  // Split total seconds into hours, minutes, and the remainder.
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  // Use h:mm:ss when the call ran longer than an hour; otherwise m:ss.
  return h > 0
    ? `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
    : `${m}:${s.toString().padStart(2, "0")}`
}

/** Parse cached HUD strings like "12:05" or "1:02:03" back into seconds. */
export function parseTalkSecondsFromDisplay(display?: string): number {
  // Empty display strings mean zero seconds.
  if (!display?.trim()) return 0
  // Split on colon and convert each segment to a number.
  const parts = display.split(":").map((p) => Number(p))
  // Reject malformed strings that are not all numeric parts.
  if (parts.some((n) => Number.isNaN(n))) return 0
  // h:mm:ss → hours + minutes + seconds.
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  // m:ss → minutes + seconds.
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  // Any other shape is treated as zero.
  return 0
}
