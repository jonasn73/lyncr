// Shared FCC ID sanitization + manual key-type bypass options (client + server safe).

/** Trim, strip hyphens/symbols, uppercase — used before any FCC database query. */
export function sanitizeFccIdInput(raw: string): string {
  return raw.trim().replace(/[^a-zA-Z0-9]+/g, "").toUpperCase()
}

export type ManualKeyFrequencyOption = {
  id: string
  label: string
  keyStyle: string
  frequency: string | null
  description: string
  /** How this key is programmed on the vehicle (shown on intake cards). */
  programmingMethod: string
  /** Optional fob thumbnail — null shows the No Pic placeholder. */
  imageUrl: string | null
  /** FCC id from a MYKEYS Pro vehicle profile (manual MKP picks only). */
  fccId?: string | null
}

/** Dispatcher fallback when FCC / YMM lookup cannot resolve a specific remote. */
export const MANUAL_KEY_FREQUENCY_OPTIONS: readonly ManualKeyFrequencyOption[] = [
  {
    id: "manual-315-transponder",
    label: "Standard 315 MHz Transponder",
    keyStyle: "Remote head key",
    frequency: "315",
    description: "Common US remote-head / transponder key",
    programmingMethod: "OBD2 Programming Required",
    imageUrl: null,
  },
  {
    id: "manual-proximity-smart",
    label: "Proximity Smart Key",
    keyStyle: "Push start (smart key)",
    frequency: "315",
    description: "Push-to-start proximity fob",
    programmingMethod: "OBD2 Programming Required",
    imageUrl: null,
  },
  {
    id: "manual-high-security-edge",
    label: "High-Security Edge Cut",
    keyStyle: "Turn key (blade)",
    frequency: null,
    description: "Laser-cut / high-security mechanical blade",
    programmingMethod: "On-Board Sequence",
    imageUrl: null,
  },
] as const
