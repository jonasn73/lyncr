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
        intentSlug: "auto_repair_urgent",
        followUp: VEHICLE_YEAR_FOLLOW_UP,
      },
      {
        digit: "2",
        label: "Scheduled repair",
        intentSlug: "auto_repair_scheduled",
        followUp: VEHICLE_YEAR_FOLLOW_UP,
      },
    ],
  },
  towing: {
    text:
      "Quick question while you wait. If you're stuck on the road right now, press 1. " +
      "For a scheduled tow, press 2.",
    options: [
      { digit: "1", label: "Stuck now / roadside", intentSlug: "towing_roadside" },
      { digit: "2", label: "Scheduled tow", intentSlug: "towing_scheduled" },
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
      { digit: "1", label: "Leak / flooding", intentSlug: "plumbing_leak" },
      { digit: "2", label: "Clogged drain", intentSlug: "plumbing_clog" },
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
