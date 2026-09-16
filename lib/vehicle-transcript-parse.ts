// Parse a short spoken "make and model" clip transcript into structured fields.
//
// The hold queue records ~10 seconds of the caller answering "say the make and
// model of your vehicle" (keypads can't type "Toyota Camry"). Whisper's output is
// conversational ("uh it's a 2015 toyota camry"), so this normalizes it against a
// known-makes list rather than trusting raw text: a matched make is the anchor,
// the words after it become the model, and anything unmatched stays transcript-only
// so a garbage transcription never pre-fills a booking form with nonsense.

const FILLER_LEAD_IN =
  /^(?:uh+|um+|so|well|yeah|yes|okay|ok|it's|its|it is|i have|i've got|i got|i drive|a|an|my|the|this is)\s+/i

/** Canonical make → spoken aliases (lowercased, matched on word boundaries). */
const MAKE_ALIASES: Record<string, string[]> = {
  Toyota: ["toyota"],
  Honda: ["honda"],
  Ford: ["ford"],
  Chevrolet: ["chevrolet", "chevy"],
  Nissan: ["nissan"],
  Hyundai: ["hyundai"],
  Kia: ["kia"],
  Jeep: ["jeep"],
  Dodge: ["dodge"],
  Ram: ["ram"],
  GMC: ["gmc"],
  Subaru: ["subaru"],
  Volkswagen: ["volkswagen", "vw"],
  BMW: ["bmw"],
  "Mercedes-Benz": ["mercedes-benz", "mercedes", "benz"],
  Audi: ["audi"],
  Lexus: ["lexus"],
  Mazda: ["mazda"],
  Buick: ["buick"],
  Cadillac: ["cadillac"],
  Chrysler: ["chrysler"],
  Lincoln: ["lincoln"],
  Acura: ["acura"],
  Infiniti: ["infiniti", "infinity"],
  Tesla: ["tesla"],
  Volvo: ["volvo"],
  Mitsubishi: ["mitsubishi"],
  Porsche: ["porsche"],
  "Land Rover": ["land rover", "range rover", "landrover"],
  Jaguar: ["jaguar"],
  Mini: ["mini cooper", "mini"],
  Fiat: ["fiat"],
  Genesis: ["genesis"],
  Rivian: ["rivian"],
  Pontiac: ["pontiac"],
  Saturn: ["saturn"],
  Mercury: ["mercury"],
  Oldsmobile: ["oldsmobile"],
  Hummer: ["hummer"],
  Scion: ["scion"],
  Suzuki: ["suzuki"],
  Isuzu: ["isuzu"],
}

/** Longest aliases first so "land rover" wins over any shorter overlap. */
const ALIAS_ENTRIES: { alias: string; make: string }[] = Object.entries(MAKE_ALIASES)
  .flatMap(([make, aliases]) => aliases.map((alias) => ({ alias, make })))
  .sort((a, b) => b.alias.length - a.alias.length)

function titleCaseModel(raw: string): string {
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (/^\d/.test(w) || w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ")
}

const ONES: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
}
const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
}
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
}
const ONES_ALT = Object.keys(ONES).join("|")
const TEENS_ALT = Object.keys(TEENS).join("|")
const TENS_ALT = Object.keys(TENS).join("|")

/**
 * Rewrite spoken years as digits so the digit extractor sees them: "twenty fifteen"
 * → 2015, "two thousand and eight" → 2008, "nineteen ninety-nine" → 1999,
 * "twenty oh five" → 2005. Whisper usually emits digits already — this is the
 * belt-and-braces for when it doesn't.
 */
function normalizeSpokenYears(text: string): string {
  let out = text
  // two thousand [and] [eight | fifteen | twenty(-three)]
  out = out.replace(
    new RegExp(
      `\\btwo thousand(?:\\s+and)?(?:\\s+(?:(${TEENS_ALT})|(twenty)(?:[\\s-](${ONES_ALT}))?|(${ONES_ALT})))?\\b`,
      "gi"
    ),
    (_m, teen, twenty, twentyOne, one) => {
      let v = 2000
      if (teen) v += TEENS[teen.toLowerCase()]
      else if (twenty) v += 20 + (twentyOne ? ONES[twentyOne.toLowerCase()] : 0)
      else if (one) v += ONES[one.toLowerCase()]
      return String(v)
    }
  )
  // nineteen|twenty + (teens | tens[-ones] | oh/o + one)
  out = out.replace(
    new RegExp(
      `\\b(nineteen|twenty)\\s+(?:(${TEENS_ALT})|(${TENS_ALT})(?:[\\s-](${ONES_ALT}))?|(?:oh|o)[\\s-](${ONES_ALT}))\\b`,
      "gi"
    ),
    (_m, century, teen, tens, tensOne, ohOne) => {
      const base = century.toLowerCase() === "nineteen" ? 1900 : 2000
      let v: number
      if (teen) v = TEENS[teen.toLowerCase()]
      else if (tens) v = TENS[tens.toLowerCase()] + (tensOne ? ONES[tensOne.toLowerCase()] : 0)
      else v = ONES[ohOne.toLowerCase()]
      return String(base + v)
    }
  )
  return out
}

export type ParsedVehicleTranscript = {
  /** Canonical make when one was confidently matched, else null. */
  make: string | null
  /** Words spoken after the make (max 3), title-cased — null when nothing usable. */
  model: string | null
  /** Four-digit model year when one was spoken (digits or words), else null. */
  year: string | null
  /** The cleaned transcript (fillers/years stripped) — kept even when unmatched. */
  cleaned: string
}

/** Null when the transcript is empty/unusable — callers then store nothing at all. */
export function parseVehicleFromTranscript(
  raw: string | null | undefined
): ParsedVehicleTranscript | null {
  let text = String(raw || "")
    .replace(/[.,!?;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!text) return null

  // Strip conversational lead-ins ("uh it's a …") — repeatedly, they stack.
  for (let i = 0; i < 6; i += 1) {
    const next = text.replace(FILLER_LEAD_IN, "")
    if (next === text) break
    text = next.trim()
  }

  // The year now comes FROM the clip ("2015 Toyota Camry") — spoken-word years are
  // normalized to digits first, then the first plausible year is captured and every
  // year token is stripped so it never bleeds into the model.
  text = normalizeSpokenYears(text)
  const yearMatch = text.match(/\b(19[5-9]\d|20[0-4]\d)\b/)
  const year = yearMatch ? yearMatch[1] : null
  text = text.replace(/\b(19|20)\d{2}\b/g, " ").replace(/\s+/g, " ").trim()
  // A remainder that is nothing but filler ("um", "uh yeah") carries no signal.
  if (/^(?:(?:uh+|um+|so|well|yeah|yes|okay|ok|no|nope|hmm+)\s*)*$/i.test(text)) {
    return year ? { make: null, model: null, year, cleaned: "" } : null
  }

  const lower = text.toLowerCase()
  for (const { alias, make } of ALIAS_ENTRIES) {
    const re = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")
    const m = re.exec(lower)
    if (!m) continue
    const after = text
      .slice(m.index + alias.length)
      .replace(/[^a-zA-Z0-9\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
    const model = after ? titleCaseModel(after.split(/\s+/).slice(0, 3).join(" ")).slice(0, 32) : null
    return { make, model: model || null, year, cleaned: text }
  }

  // No known make — never invent structure; keep the transcript for the human.
  return { make: null, model: null, year, cleaned: text.slice(0, 120) }
}
