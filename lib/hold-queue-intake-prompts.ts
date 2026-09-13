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
// carry `followUp` — a second, numeric-only question asked on the NEXT reprompt cycle,
// only when that specific option was the one picked (e.g. only "vehicle" answers get
// asked for a model year — a property lockout never does).

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
}

export type HoldQueueIntakePrompt = {
  /** Spoken via gather_using_speak — keep it short, it interrupts hold music. */
  text: string
  options: HoldQueueIntakeOption[]
}

const VEHICLE_YEAR_FOLLOW_UP: HoldQueueIntakeFollowUp = {
  text: "If you know it, type the four-digit model year now, then press pound. Otherwise just stay on the line.",
  maxDigits: 4,
  fieldKey: "vehicle_year",
  fieldLabel: "Year",
}

const HOLD_QUEUE_INTAKE_PROMPTS: Partial<Record<string, HoldQueueIntakePrompt>> = {
  locksmith: {
    text:
      "Quick question while you wait. For a car key or lockout, press 1. " +
      "For a home or business lockout, press 2. For anything else, press 3.",
    // Locksmith's REAL job types are SERVICE_QUOTE_TYPES (lockout, key_generation,
    // key_duplication, ignition_repair, programming_diagnostics, key_extraction,
    // rekey, …) — six-plus granular options, none of which "vehicle key/lockout"
    // maps onto 1:1. These intentSlugs are informational only (shown as the label
    // on the waiting card) and deliberately don't match any real option id, so
    // resolveHoldQueueCollectedPreFill's job-type auto-select correctly no-ops for
    // locksmith — the operator still picks the specific job type, same as always.
    // Phase 2's model-year follow-up still pre-fills, independent of that.
    options: [
      {
        digit: "1",
        label: "Vehicle key / lockout",
        intentSlug: "locksmith_vehicle",
        followUp: VEHICLE_YEAR_FOLLOW_UP,
      },
      { digit: "2", label: "Home or business lockout", intentSlug: "locksmith_property" },
      { digit: "3", label: "Something else", intentSlug: "locksmith_other" },
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
        followUp: VEHICLE_YEAR_FOLLOW_UP,
      },
      {
        digit: "2",
        label: "Scheduled repair",
        // Matches branch "Scheduled maintenance / oil / brakes".
        intentSlug: "auto_repair_maintenance",
        followUp: VEHICLE_YEAR_FOLLOW_UP,
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
      { digit: "1", label: "Tow needed", intentSlug: "towing_tow" },
      { digit: "2", label: "Roadside help (jump / flat tire)", intentSlug: "towing_roadside" },
    ],
  },
  roofing: {
    text:
      "Quick question while you wait. If you have an active leak right now, press 1. " +
      "For an estimate, press 2.",
    options: [
      { digit: "1", label: "Active leak", intentSlug: "roofing_emergency" },
      { digit: "2", label: "Estimate", intentSlug: "roofing_estimate" },
    ],
  },
  plumbing: {
    text:
      "Quick question while you wait. For a leak or flooding, press 1. " +
      "For a clogged drain, press 2. For anything else, press 3.",
    options: [
      // Bespoke industry — ids are flat (BESPOKE_OPTIONS in job-intake-registry.ts),
      // not registry-branch-derived, so these must match those exact ids.
      { digit: "1", label: "Leak / flooding", intentSlug: "plumbing_emergency_leak" },
      { digit: "2", label: "Clogged drain", intentSlug: "plumbing_drain_clog" },
      { digit: "3", label: "Something else", intentSlug: "plumbing_other" },
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
