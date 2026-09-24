// ============================================
// Hold-queue intake prompts — questions while a caller waits
// ============================================
// Reuses the SAME taxonomy as lib/ai-intake-field-registry.ts / lib/job-intake-registry.ts:
// each option's intentSlug is meant to line up with that registry's intent_slug so an
// answer captured on hold is the same field a human operator would have picked from
// the manual-intake dropdown, not a fourth parallel taxonomy.
//
// Kept deliberately small and hand-phrased (not derived from the registry's branch
// bullets) — those are written as prose hints for an AI voice agent, not short,
// TTS-friendly multiple-choice copy for a DTMF menu.
//
// Phase 1 = `options` (one multiple-choice question). Phase 2 = each option may also
// carry `followUp` — a second, numeric-only question. Every supported service asks
// for service ZIP; vehicle jobs can first capture year/make/model by voice.

export type HoldQueueIntakeFollowUp = {
  /** Spoken via gather_using_speak on the reprompt cycle after the option is picked. */
  text: string
  /** Digits only (gather_using_speak already defaults validDigits to 0-9). */
  maxDigits: number
  /** Key written into call_queue.collected, e.g. "vehicle_year". */
  fieldKey: string
  /** Label prefix for the waiting-caller card, e.g. "Year". */
  fieldLabel: string
}

export type HoldQueueIntakeOption = {
  /** Digit the caller presses. */
  digit: string
  /** Short human-readable label — what the operator sees on the waiting-caller card. */
  label: string
  /** Lines up with ai-intake-field-registry.ts intent_slug where one exists. */
  intentSlug: string
  /** Optional Phase-2 numeric follow-up, asked only when this option is picked. */
  followUp?: HoldQueueIntakeFollowUp
  /** Capture year/make/model by voice when transcription is available. */
  vehicleVoice?: boolean
  /**
   * "Right now" situations (stranded, locked out, active leak) — read by
   * lib/abandoned-hold-rescue.ts to skip the after-hours 15-minute wait so an
   * abandoned-hold caller in genuine trouble gets the booking-link text
   * immediately instead of waiting alongside routine/scheduled requests.
   */
  urgent?: boolean
}

export type HoldQueueIntakePrompt = {
  /** Spoken via gather_using_speak — keep it short, it interrupts hold music. */
  text: string
  options: HoldQueueIntakeOption[]
}

const VEHICLE_ZIP_FOLLOW_UP: HoldQueueIntakeFollowUp = {
  text: "Please type the five-digit ZIP code where you need service, then press pound.",
  maxDigits: 5,
  fieldKey: "job_address_postal_code",
  fieldLabel: "ZIP code",
}

const HOLD_QUEUE_INTAKE_PROMPTS: Partial<Record<string, HoldQueueIntakePrompt>> = {
  locksmith: {
    text:
      "Quick question while you wait. If you're locked out of your car, press 1. " +
      "If you lost your key or need a new one made, press 2. " +
      "For a home or business lockout, press 3. For anything else, press 4.",
    // Locksmith's REAL job types are SERVICE_QUOTE_TYPES (lockout, key_generation,
    // key_duplication, ignition_repair, programming_diagnostics, key_extraction,
    // rekey, …) — six-plus granular options, none of which a coarse Phase-1 question
    // maps onto 1:1. These intentSlugs are informational only (shown as the label on
    // the waiting card) and deliberately don't match any real option id, so
    // resolveHoldQueueCollectedPreFill's job-type auto-select correctly no-ops for
    // locksmith — the operator still picks the specific job type, same as always.
    // The ZIP follow-up applies to every service; only vehicle jobs use voice capture.
    //
    // Split "vehicle key / lockout" (the original 3-option version) into its two most
    // common, operationally-different cases: a plain lockout (fast, no key needed —
    // just entry tools, and the model year doesn't change what the tech brings) versus
    // all-keys-lost / a new key needed (key_generation — slower, needs a key blank +
    // cutting/programming gear, where the vehicle year/make/model genuinely matters).
    // Reported live: a plain lockout was still being asked for the year — only the
    // key_generation option should carry that follow-up.
    options: [
      {
        digit: "1",
        label: "Locked out of car",
        intentSlug: "locksmith_lockout",
        followUp: VEHICLE_ZIP_FOLLOW_UP,
        urgent: true,
      },
      {
        digit: "2",
        label: "Lost key / needs new key made",
        intentSlug: "locksmith_key_generation",
        followUp: VEHICLE_ZIP_FOLLOW_UP,
        vehicleVoice: true,
      },
      {
        digit: "3",
        label: "Home or business lockout",
        intentSlug: "locksmith_property",
        followUp: VEHICLE_ZIP_FOLLOW_UP,
        urgent: true,
      },
      { digit: "4", label: "Something else", intentSlug: "locksmith_other", followUp: VEHICLE_ZIP_FOLLOW_UP },
    ],
  },
  auto_repair: {
    text:
      "Quick question while you wait. If your vehicle won't start or you're stranded, " +
      "press 1. For a scheduled repair, press 2.",
    options: [
      {
        digit: "1",
        label: "Won't start / stranded",
        // Matches ai-intake-field-registry.ts auto_repair branch "Vehicle not
        // drivable / warning lights / noise".
        intentSlug: "auto_repair_diagnostic",
        followUp: VEHICLE_ZIP_FOLLOW_UP,
        vehicleVoice: true,
        urgent: true,
      },
      {
        digit: "2",
        label: "Scheduled repair",
        // Matches branch "Scheduled maintenance / oil / brakes".
        intentSlug: "auto_repair_maintenance",
        followUp: VEHICLE_ZIP_FOLLOW_UP,
        vehicleVoice: true,
      },
    ],
  },
  towing: {
    // Rephrased to match the registry's real 2 usable branches — towing/roadside
    // has no "scheduled" branch at all, every real option is some flavor of "now".
    text:
      "Quick question while you wait. If you need a tow right now, press 1. " +
      "For roadside help like a jump start or flat tire, press 2.",
    options: [
      { digit: "1", label: "Tow needed", intentSlug: "towing_tow", followUp: VEHICLE_ZIP_FOLLOW_UP, urgent: true },
      {
        digit: "2",
        label: "Roadside help (jump / flat tire)",
        intentSlug: "towing_roadside",
        followUp: VEHICLE_ZIP_FOLLOW_UP,
        urgent: true,
      },
    ],
  },
  roofing: {
    text:
      "Quick question while you wait. If you have an active leak right now, press 1. " +
      "For an estimate, press 2.",
    options: [
      { digit: "1", label: "Active leak", intentSlug: "roofing_emergency", followUp: VEHICLE_ZIP_FOLLOW_UP, urgent: true },
      { digit: "2", label: "Estimate", intentSlug: "roofing_estimate", followUp: VEHICLE_ZIP_FOLLOW_UP },
    ],
  },
  plumbing: {
    text:
      "Quick question while you wait. For a leak or flooding, press 1. " +
      "For a clogged drain, press 2. For anything else, press 3.",
    options: [
      // Bespoke industry — ids are flat (BESPOKE_OPTIONS in job-intake-registry.ts),
      // not registry-branch-derived, so these must match those exact ids.
      { digit: "1", label: "Leak / flooding", intentSlug: "plumbing_emergency_leak", followUp: VEHICLE_ZIP_FOLLOW_UP, urgent: true },
      { digit: "2", label: "Clogged drain", intentSlug: "plumbing_drain_clog", followUp: VEHICLE_ZIP_FOLLOW_UP },
      { digit: "3", label: "Something else", intentSlug: "plumbing_other", followUp: VEHICLE_ZIP_FOLLOW_UP },
    ],
  },
  hvac: {
    text:
      "Quick question while you wait. If you have no heat, press 1. " +
      "If you have no cooling, press 2. For anything else, press 3.",
    options: [
      // Bespoke industry — ids are flat (BESPOKE_OPTIONS in job-intake-registry.ts),
      // not registry-branch-derived, so these must match those exact ids.
      { digit: "1", label: "No heat", intentSlug: "hvac_no_heat", followUp: VEHICLE_ZIP_FOLLOW_UP, urgent: true },
      { digit: "2", label: "No cooling", intentSlug: "hvac_no_cooling", followUp: VEHICLE_ZIP_FOLLOW_UP, urgent: true },
      { digit: "3", label: "Something else", intentSlug: "hvac_other", followUp: VEHICLE_ZIP_FOLLOW_UP },
    ],
  },
  electrical: {
    text:
      "Quick question while you wait. If you smell smoke or see sparks, press 1. " +
      "For partial or no power, press 2. For anything else, press 3.",
    options: [
      // Bespoke industry — ids are flat (BESPOKE_OPTIONS in job-intake-registry.ts),
      // not registry-branch-derived, so these must match those exact ids.
      { digit: "1", label: "Sparks / smoke / safety concern", intentSlug: "electrical_safety", followUp: VEHICLE_ZIP_FOLLOW_UP, urgent: true },
      { digit: "2", label: "Partial or no power", intentSlug: "electrical_partial_power", followUp: VEHICLE_ZIP_FOLLOW_UP },
      { digit: "3", label: "Something else", intentSlug: "electrical_other", followUp: VEHICLE_ZIP_FOLLOW_UP },
    ],
  },
}

/** Valid DTMF digits for gather_using_speak's validDigits, e.g. "123". */
export function holdQueueIntakeValidDigits(prompt: HoldQueueIntakePrompt): string {
  return prompt.options.map((o) => o.digit).join("")
}

export function resolveHoldQueueIntakePrompt(
  industry: string | null | undefined
): HoldQueueIntakePrompt | null {
  const key = String(industry || "").trim().toLowerCase()
  if (!key) return null
  return HOLD_QUEUE_INTAKE_PROMPTS[key] ?? null
}

export function resolveHoldQueueIntakeOption(
  prompt: HoldQueueIntakePrompt,
  digit: string
): HoldQueueIntakeOption | null {
  return prompt.options.find((o) => o.digit === digit) ?? null
}

/** Precomputed across every industry — intent_slug is already industry-prefixed and unique. */
const URGENT_HOLD_QUEUE_INTENT_SLUGS = new Set(
  Object.values(HOLD_QUEUE_INTAKE_PROMPTS).flatMap((prompt) =>
    (prompt?.options ?? []).filter((o) => o.urgent).map((o) => o.intentSlug)
  )
)

/**
 * True when a captured hold-queue intent is a "right now" situation (locked out,
 * stranded, active leak) — used to skip the after-hours abandoned-hold rescue delay.
 */
export function isUrgentHoldQueueIntentSlug(intentSlug: string | null | undefined): boolean {
  const slug = String(intentSlug || "").trim()
  return Boolean(slug) && URGENT_HOLD_QUEUE_INTENT_SLUGS.has(slug)
}

/** Max times the spoken make/model ask runs (first ask + one retry). */
export const MAX_VEHICLE_VOICE_ATTEMPTS = 2
/** Max read-back confirm asks per capture — silence keeps the data, unconfirmed. */
export const MAX_VEHICLE_VOICE_CONFIRM_ASKS = 1
/** Transcription still pending after this long counts as failed → retry the ask. */
export const VEHICLE_VOICE_PENDING_STALE_MS = 60_000

export type HoldVehicleVoiceStep = "ask" | "retry" | "confirm" | "zip_fallback" | "none"

/**
 * The "do we have every vehicle detail we need?" check, run each reprompt cycle
 * once nothing higher-priority (the Phase-1 question) is being asked. Voice runs
 * FIRST — one spoken "2015 Toyota Camry" captures the vehicle, then ZIP is asked:
 * - a captured make the caller hasn't confirmed yet → read it back ("confirm")
 * - a finished clip that produced no usable make (silence, spoke too late, garbage
 *   transcript, lost webhook past the stale window) → one more ask ("retry")
 * - the clip never ran at all (earlier failure) → "ask"
 * - voice exhausted (or confirm handled) → ask for service ZIP so the call
 *   can still become a useful lead without a transcript
 * - transcription still in flight, caps reached, or everything captured → "none"
 */
export function resolveHoldVehicleVoiceStep(params: {
  isVehicleIntent: boolean
  attempts: number
  confirmed: boolean
  confirmAsks: number
  /** collected.vehicle_voice_pending — transcription not yet merged. */
  transcriptionPending: boolean
  /** True when pending has outlived VEHICLE_VOICE_PENDING_STALE_MS. */
  pendingIsStale: boolean
  capturedMake: string | null
  /** The typed ZIP follow-up already ran and was answered. */
  zipFallbackAnswered: boolean
}): HoldVehicleVoiceStep {
  if (!params.isVehicleIntent) return "none"
  if (params.transcriptionPending && !params.pendingIsStale) return "none"
  const make = params.capturedMake?.trim()

  if (params.confirmed || params.zipFallbackAnswered) return "none"
  if (make) {
    if (params.confirmAsks < MAX_VEHICLE_VOICE_CONFIRM_ASKS) return "confirm"
    return "zip_fallback"
  }
  if (params.attempts === 0) return "ask"
  if (params.attempts < MAX_VEHICLE_VOICE_ATTEMPTS) return "retry"
  return "zip_fallback"
}

export type HoldQueueCollectedPreFill = {
  /** Matches a resolveJobIntakeOptions(industry) option id — feeds OpenManualCallPanelInput. */
  serviceQuoteTypeId?: string
  vehicleYear?: string
}

/**
 * Phase 4: turn a call_queue.collected blob into CallAnsweredModal's pre-fill seed.
 * Job-type auto-select is skipped for locksmith on purpose (see the comment on its
 * prompt above) — every other configured industry's intentSlug is a bare
 * ai-intake-field-registry branch slug, and resolveJobIntakeOptions prefixes those
 * with the industry (e.g. "roofing_emergency" -> "roofing_roofing_emergency"), while
 * bespoke industries (plumbing/hvac/electrical) keep flat ids — so this checks both
 * forms against the real, current option list rather than hardcoding which industry
 * uses which convention.
 */
export function resolveHoldQueueCollectedPreFill(
  industry: string | null | undefined,
  collected: Record<string, unknown> | null | undefined,
  resolveOptions: (industry: string | null | undefined) => { id: string }[]
): HoldQueueCollectedPreFill {
  const out: HoldQueueCollectedPreFill = {}
  if (!collected) return out

  const industryKey = String(industry || "").trim().toLowerCase()
  const intentSlug = collected.intent_slug
  if (industryKey && industryKey !== "locksmith" && typeof intentSlug === "string" && intentSlug.trim()) {
    const slug = intentSlug.trim()
    const options = resolveOptions(industryKey)
    const match = options.find((o) => o.id === slug || o.id === `${industryKey}_${slug}`)
    if (match) out.serviceQuoteTypeId = match.id
  }

  const vehicleYear = collected.vehicle_year
  if (typeof vehicleYear === "string" && /^\d{4}$/.test(vehicleYear.trim())) {
    out.vehicleYear = vehicleYear.trim()
  }

  return out
}
