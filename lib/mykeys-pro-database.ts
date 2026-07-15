// MYKEYS Pro mock matrix — vehicle-specific key profiles for manual intake fallback.

import {
  isVolvoInsertFobikVehicle,
  MANUAL_KEY_FREQUENCY_OPTIONS,
  VOLVO_FOBIK_5B_OPTION,
  type ManualKeyFrequencyOption,
} from "@/lib/fcc-id-input"

/** One key row inside a MYKEYS Pro vehicle profile. */
export type MykeysProKeyRow = {
  type: string
  method: string
  img: string
}

/** Vehicle profile returned by the mock MYKEYS Pro lookup. */
export type MykeysProVehicleProfile = {
  fccId: string
  keys: MykeysProKeyRow[]
}

/** Mock MKP database keyed by "Make Model" (year omitted). */
export const MYKEYS_PRO_DATABASE: Record<string, MykeysProVehicleProfile> = {
  "Mazda CX-90": {
    fccId: "WAX12DH45",
    keys: [
      {
        type: "Proximity Smart Key",
        method: "OBD2 Bypass (3-Min Delay)",
        img: "/key-images/mykeys/mazda-cx90-prox.svg",
      },
      {
        type: "High-Security Edge Cut",
        method: "Mechanical Cut (Laser)",
        img: "/key-images/mykeys/mazda-blade.svg",
      },
    ],
  },
  "Subaru Outback": {
    fccId: "HYQ14AHK",
    keys: [
      {
        type: "Proximity Smart Key",
        method: "Active Dashboard Turn Sequence",
        img: "/key-images/mykeys/subaru-prox.svg",
      },
    ],
  },
}

/** Build the lookup key used by MYKEYS Pro: `${make} ${model}`. */
export function mykeysProVehicleKey(make: string, model: string): string {
  return `${make.trim()} ${model.trim()}`.replace(/\s+/g, " ")
}

/** Case-insensitive MYKEYS Pro profile lookup for the current YMM selection. */
export function lookupMykeysProProfile(
  make: string,
  model: string
): MykeysProVehicleProfile | null {
  const key = mykeysProVehicleKey(make, model)
  if (MYKEYS_PRO_DATABASE[key]) return MYKEYS_PRO_DATABASE[key]

  const normalized = key.toLowerCase()
  const entry = Object.entries(MYKEYS_PRO_DATABASE).find(([label]) => label.toLowerCase() === normalized)
  return entry ? entry[1] : null
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

/** Map MKP key type labels to intake key-style dropdown values. */
function keyStyleForMykeysType(type: string): string {
  const blob = type.toLowerCase()
  if (/proximity|smart/.test(blob)) return "Push start (smart key)"
  if (/edge|blade|mechanical|high.?security/.test(blob)) return "Turn key (blade)"
  if (/transponder|remote head/.test(blob)) return "Remote head key"
  if (/flip/.test(blob)) return "Flip key"
  if (/remote|fob/.test(blob)) return "Keyless remote only"
  return "Not sure yet"
}

/** Convert one MKP row into a manual intake card option. */
function mykeysRowToOption(
  row: MykeysProKeyRow,
  profile: MykeysProVehicleProfile,
  index: number
): ManualKeyFrequencyOption {
  const vehicleKey = slugify(`${profile.fccId}-${row.type}`)
  return {
    id: `mykeys-${vehicleKey}-${index}`,
    label: row.type,
    keyStyle: keyStyleForMykeysType(row.type),
    frequency: /315/.test(row.type) ? "315" : /proximity|smart/i.test(row.type) ? "315" : null,
    description: `MYKEYS Pro · FCC ${profile.fccId}`,
    programmingMethod: row.method,
    imageUrl: row.img,
    fccId: profile.fccId,
  }
}

/**
 * Key cards for manual / MKP fallback — vehicle-specific when the mock DB has a match,
 * otherwise the generic three-option regional list.
 * Classic Volvo insert-start models also get the 5-button Fobik card first.
 */
export function mykeysProKeyOptions(make: string, model: string): ManualKeyFrequencyOption[] {
  const profile = lookupMykeysProProfile(make, model)
  const base = profile
    ? profile.keys.map((row, index) => mykeysRowToOption(row, profile, index))
    : [...MANUAL_KEY_FREQUENCY_OPTIONS]

  if (!isVolvoInsertFobikVehicle(make, model)) return base

  // Put the Volvo Fobik first; drop a duplicate if MKP somehow reused the same id.
  return [
    VOLVO_FOBIK_5B_OPTION,
    ...base.filter((option) => option.id !== VOLVO_FOBIK_5B_OPTION.id),
  ]
}
