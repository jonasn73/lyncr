// Shared FCC ID sanitization + manual key-type bypass options (client + server safe).

/** Trim, strip hyphens/symbols, uppercase — used before any FCC database query. */
export function sanitizeFccIdInput(raw: string): string {
  return raw.trim().replace(/[^a-zA-Z0-9]+/g, "").toUpperCase()
}

/**
 * Strip trailing "00" pairs so TI `M3NA2C931423` matches CSV `M3NA2C93142300`.
 * Ford Conti remotes often publish the same FCC with or without trailing zeros.
 */
export function canonicalFccMatchKey(raw: string): string {
  const clean = sanitizeFccIdInput(raw)
  if (!clean) return ""
  let key = clean
  // Keep a meaningful stem (at least 6 chars) while peeling trailing 00 pairs.
  while (key.length > 6 && /00$/.test(key)) {
    key = key.slice(0, -2)
  }
  return key
}

/** True when two FCC strings refer to the same remote (ignoring hyphens / trailing 00). */
export function fccIdsMatch(a: string, b: string): boolean {
  const left = canonicalFccMatchKey(a)
  const right = canonicalFccMatchKey(b)
  return Boolean(left && right && left === right)
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
  /** Catalog SKU shown on the intake card (e.g. KEY-VOL-05-PROX). */
  catalogSku?: string | null
  /** Supplier / ordering SKU (e.g. TIK-VOL-13N). */
  supplierSku?: string | null
  /** Vehicle brand for TI catalog cards (e.g. Nissan). */
  brand?: string | null
}

/**
 * Volvo KEY-VOL-05 split into true chip variants (was a single generic KEY-VOL-05).
 * Shown in manual bypass for classic Volvo models — not in the generic regional list.
 */
export const VOLVO_KEY_VOL_05_PROX: ManualKeyFrequencyOption = {
  id: "KEY-VOL-05-PROX",
  label: "Volvo 5-Button Smart Proximity Key",
  keyStyle: "Push start (smart key)",
  frequency: "315",
  description: "Smart proximity / push-start 5-button fob",
  programmingMethod: "OBD2 PROGRAMMING REQUIRED",
  imageUrl: null,
  fccId: "KR55WK49250",
  catalogSku: "KEY-VOL-05-PROX",
  supplierSku: "TIK-VOL-13N",
}

export const VOLVO_KEY_VOL_05_NONPROX: ManualKeyFrequencyOption = {
  id: "KEY-VOL-05-NONPROX",
  label: "Volvo 5-Button Insert-to-Start Key",
  keyStyle: "Remote head key",
  frequency: "315",
  description: "Insert-to-start dashboard fobik key",
  programmingMethod: "OBD2 PROGRAMMING REQUIRED",
  imageUrl: null,
  fccId: "KR55WK49259",
  catalogSku: "KEY-VOL-05-NONPROX",
  supplierSku: "TIK-VOL-19N",
}

/** Both KEY-VOL-05 child options (prox first, then insert-to-start). */
export const VOLVO_KEY_VOL_05_OPTIONS: readonly ManualKeyFrequencyOption[] = [
  VOLVO_KEY_VOL_05_PROX,
  VOLVO_KEY_VOL_05_NONPROX,
]

/** @deprecated Use VOLVO_KEY_VOL_05_NONPROX — kept for any leftover id checks. */
export const VOLVO_FOBIK_5B_OPTION = VOLVO_KEY_VOL_05_NONPROX

const VOLVO_KEY_VOL_05_IDS = new Set(
  VOLVO_KEY_VOL_05_OPTIONS.map((option) => option.id)
)

/** True when this option id is one of the KEY-VOL-05 child SKUs. */
export function isVolvoKeyVol05OptionId(id: string | null | undefined): boolean {
  if (!id) return false
  return VOLVO_KEY_VOL_05_IDS.has(id) || id === "volvo-fobik-5b"
}

/** Models that commonly use the KEY-VOL-05 5-button family (manual bypass + SVG sample). */
const VOLVO_INSERT_FOBIK_MODELS = new Set(["c30", "s40", "v50", "c70"])

/** True when this YMM should offer the KEY-VOL-05 prox / non-prox pair. */
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

/**
 * Drop mock KEY-/PROX- cards that contradict Ask-the-customer (push vs turn).
 * Never show a proximity fob after the caller said turn-key.
 */
export function filterManualOptionsByKeyStyle(
  options: readonly ManualKeyFrequencyOption[],
  keyStyle: string | null | undefined
): ManualKeyFrequencyOption[] {
  const style = (keyStyle ?? "").toLowerCase()
  if (!style.trim()) return [...options]
  const wantsSmart = /push|smart|prox/.test(style)
  const wantsTurn = /turn|remote\s*head|blade|flip/.test(style)
  if (wantsSmart && !wantsTurn) {
    return options.filter((option) => /push|smart|prox/i.test(option.keyStyle))
  }
  if (wantsTurn && !wantsSmart) {
    return options.filter(
      (option) =>
        /turn|remote|blade|flip/i.test(option.keyStyle) && !/push|smart|prox/i.test(option.keyStyle)
    )
  }
  return [...options]
}
