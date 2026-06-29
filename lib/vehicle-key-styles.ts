// Client-safe key style options for the intake sheet (no Node.js imports).

export const KEY_STYLE_OPTIONS = [
  "Push start (smart key)",
  "Turn key (blade)",
  "Remote head key",
  "Flip key",
  "Keyless remote only",
  "Not sure yet",
] as const

export type VehicleKeyStyle = (typeof KEY_STYLE_OPTIONS)[number]
