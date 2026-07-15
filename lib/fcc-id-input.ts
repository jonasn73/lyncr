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

/**
 * Classic Volvo insert-and-start dashboard Fobik (C30 / S40 / V50 / C70 era).
 * Shown in manual bypass for those models — not in the generic regional list.
 */
export const VOLVO_FOBIK_5B_OPTION: ManualKeyFrequencyOption = {
  id: "volvo-fobik-5b",
  label: "Volvo 5-Button Fobik Key",
  keyStyle: "Remote head key",
  frequency: "315",
  description: "Insert-and-start dashboard fobik key",
  programmingMethod: "OBD2 PROGRAMMING REQUIRED",
  imageUrl: null,
}

/** Models that commonly use the 5-button insert Fobik (manual bypass + SVG sample). */
const VOLVO_INSERT_FOBIK_MODELS = new Set(["c30", "s40", "v50", "c70"])

/** True when this YMM should offer / illustrate the Volvo 5-button Fobik. */
export function isVolvoInsertFobikVehicle(make: string, model: string): boolean {
  if (make.trim().toLowerCase() !== "volvo") return false
  const normalizedModel = model.trim().toLowerCase().replace(/\s+/g, "")
  return VOLVO_INSERT_FOBIK_MODELS.has(normalizedModel)
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
