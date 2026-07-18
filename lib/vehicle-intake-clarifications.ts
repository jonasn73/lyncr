// Call-script questions when year/make/model alone is not enough to pick the right key reference.
// Safe for client + server (no filesystem).

export type VehicleClarificationOption = {
  id: string
  /** Button label in the intake sheet */
  label: string
  /** Optional line the receptionist can read verbatim */
  askLine?: string
  /** Replace the model field when the customer confirms this variant */
  model?: string
  make?: string
  /** Stored on the job when this option is chosen */
  note?: string
  /** Pin Key Details to this FCC after the customer answers */
  fccId?: string
  /** Preferred TI order blank (usually …A aftermarket) for this answer */
  tiSku?: string
  /** Key style hint for the form (smart / remote head / …) */
  keyStyle?: string
  /** Digits-only frequency when known from catalog */
  frequency?: string
}

export type VehicleClarificationPrompt = {
  id: string
  /** Short label above the buttons */
  question: string
  /** Full question to ask the customer on the phone */
  askScript: string
  options: VehicleClarificationOption[]
}

export type VehicleKeyLookupHint = {
  match_type: "exact" | "family"
  matched_model: string
  model: string
  profiles: Array<{
    fcc_id?: string
    modulation: string | null
    frequency?: string | null
  }>
  /**
   * Pre-built multi-FCC resolution prompt from server-side TI + FCC compare.
   * When set, replaces the generic ignition-only multi-FCC prompt.
   */
  fccResolveClarification?: VehicleClarificationPrompt | null
}

export type VehicleIntakeContext = {
  year: number
  make: string
  model: string
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function normalizeMake(make: string): string {
  return normalizeToken(make)
}

function normalizeModel(model: string): string {
  return normalizeToken(model)
}

function ctxMatch(
  ctx: VehicleIntakeContext,
  opts: {
    makes?: string[]
    modelEquals?: string
    modelIncludes?: RegExp
    yearMin?: number
    yearMax?: number
  }
): boolean {
  const make = normalizeMake(ctx.make)
  const model = ctx.model.trim()
  const modelKey = normalizeModel(model)
  if (opts.makes && !opts.makes.map(normalizeMake).includes(make)) return false
  if (opts.yearMin != null && ctx.year < opts.yearMin) return false
  if (opts.yearMax != null && ctx.year > opts.yearMax) return false
  if (opts.modelEquals && modelKey !== normalizeModel(opts.modelEquals)) return false
  if (opts.modelIncludes && !opts.modelIncludes.test(model)) return false
  return true
}

/** Plain "Yaris" without the iA suffix — hatchback / sedan split matters for keys. */
function isGenericToyotaYaris(ctx: VehicleIntakeContext): boolean {
  if (!ctxMatch(ctx, { makes: ["Toyota"], yearMin: 2015, yearMax: 2020 })) return false
  const model = ctx.model.trim()
  if (/iA/i.test(model)) return false
  return /^yaris$/i.test(model.trim())
}

/** Curated rules for common locksmith intake ambiguities. */
const STATIC_CLARIFICATION_RULES: Array<{
  id: string
  when: (ctx: VehicleIntakeContext) => boolean
  prompts: VehicleClarificationPrompt[]
}> = [
  {
    id: "toyota-yaris-body",
    when: isGenericToyotaYaris,
    prompts: [
      {
        id: "yaris-body-style",
        question: "Hatchback or sedan?",
        askScript:
          "Is it the hatchback Yaris, or the sedan? In 2017 the sedan is often called Yaris iA.",
        options: [
          {
            id: "yaris-hatchback",
            label: "Hatchback",
            askLine: "It's the hatchback.",
            model: "Yaris",
            note: "Confirmed hatchback Yaris",
          },
          {
            id: "yaris-sedan-ia",
            label: "Sedan (Yaris iA)",
            askLine: "It's the sedan — Yaris iA.",
            model: "Yaris iA",
            note: "Confirmed Yaris iA sedan",
          },
        ],
      },
      {
        id: "yaris-ignition-type",
        question: "Push-button or turn-key?",
        askScript: "Does it have push-button start, or a regular turn-key ignition?",
        options: [
          {
            id: "yaris-push-start",
            label: "Push-button start",
            keyStyle: "Push start (smart key)",
            note: "Customer confirmed push-button start",
          },
          {
            id: "yaris-turn-key",
            label: "Turn-key ignition",
            keyStyle: "Remote head key",
            note: "Customer confirmed turn-key ignition",
          },
        ],
      },
    ],
  },
  {
    id: "toyota-chr-vs-corolla",
    when: (ctx) => ctxMatch(ctx, { makes: ["Toyota"], modelIncludes: /^c-?hr$/i, yearMin: 2018 }),
    prompts: [
      {
        id: "chr-not-corolla",
        question: "Confirm C-HR (small SUV)?",
        askScript:
          "Just to confirm — it's the C-HR, the small crossover? Not the Corolla sedan or Corolla Cross?",
        options: [
          {
            id: "chr-confirmed",
            label: "Yes — C-HR crossover",
            note: "Confirmed Toyota C-HR",
          },
          {
            id: "chr-is-corolla-cross",
            label: "No — Corolla Cross",
            model: "Corolla Cross",
            note: "Customer said Corolla Cross, not C-HR",
          },
          {
            id: "chr-is-corolla-sedan",
            label: "No — Corolla sedan",
            model: "Corolla",
            note: "Customer said Corolla sedan, not C-HR",
          },
        ],
      },
    ],
  },
  {
    id: "toyota-corolla-cross",
    when: (ctx) =>
      ctxMatch(ctx, { makes: ["Toyota"], modelIncludes: /corolla\s*cross/i, yearMin: 2022 }),
    prompts: [
      {
        id: "corolla-cross-not-sedan",
        question: "Corolla Cross SUV?",
        askScript: "Is it the Corolla Cross SUV, not the regular Corolla sedan?",
        options: [
          {
            id: "corolla-cross-yes",
            label: "Yes — Corolla Cross SUV",
            note: "Confirmed Corolla Cross",
          },
          {
            id: "corolla-cross-is-sedan",
            label: "No — Corolla sedan",
            model: "Corolla",
            note: "Customer said Corolla sedan",
          },
        ],
      },
    ],
  },
  {
    id: "ram-tonnage",
    when: (ctx) => {
      const make = normalizeMake(ctx.make)
      if (make !== "ram" && make !== "dodge") return false
      return /^(1500|2500|3500|4500|5500|6500|7500)$/i.test(ctx.model.trim())
    },
    prompts: [
      {
        id: "ram-confirm-tonnage",
        question: "Confirm truck size",
        askScript: "Which Ram is it — 1500, 2500, 3500, or heavier?",
        options: [
          { id: "ram-1500", label: "Ram 1500", model: "Ram 1500", note: "Confirmed Ram 1500" },
          { id: "ram-2500", label: "Ram 2500", model: "Ram 2500", note: "Confirmed Ram 2500" },
          { id: "ram-3500", label: "Ram 3500", model: "Ram 3500", note: "Confirmed Ram 3500" },
          { id: "ram-4500-plus", label: "4500 / 5500 / heavier", model: "Ram 4500", note: "Confirmed Ram 4500+" },
        ],
      },
    ],
  },
  {
    id: "ford-super-duty",
    when: (ctx) => {
      if (!ctxMatch(ctx, { makes: ["Ford"], yearMin: 2011 })) return false
      return /^f[-\s]?(250|350|450|550|650|750)$/i.test(ctx.model.trim().replace(/\s+/g, ""))
    },
    prompts: [
      {
        id: "ford-hd-confirm",
        question: "Super Duty (F-250+)?",
        askScript:
          "Is it the Super Duty — F-250 or larger? Or did you mean the F-150 half-ton?",
        options: [
          {
            id: "ford-hd-yes",
            label: "Super Duty (F-250+)",
            note: "Confirmed Ford Super Duty",
          },
          {
            id: "ford-f150",
            label: "F-150 half-ton",
            model: "F-150",
            note: "Customer confirmed F-150, not Super Duty",
          },
        ],
      },
    ],
  },
  {
    id: "jeep-wrangler-jk-jl",
    when: (ctx) => ctxMatch(ctx, { makes: ["Jeep"], modelIncludes: /^wrangler$/i, yearMin: 2015, yearMax: 2020 }),
    prompts: [
      {
        id: "wrangler-jk-jl",
        question: "JK or JL Wrangler?",
        askScript:
          "Is it the newer JL body style from 2018 and up, or the older JK Wrangler?",
        options: [
          {
            id: "wrangler-jl",
            label: "JL (2018+)",
            note: "Customer confirmed JL Wrangler (2018+)",
          },
          {
            id: "wrangler-jk",
            label: "JK (2015–2017)",
            note: "Customer confirmed JK Wrangler",
          },
        ],
      },
    ],
  },
  {
    id: "honda-civic-ignition",
    when: (ctx) => ctxMatch(ctx, { makes: ["Honda"], modelIncludes: /^civic$/i, yearMin: 2016, yearMax: 2022 }),
    prompts: [
      {
        id: "civic-push-vs-key",
        question: "Push-button or turn-key?",
        askScript: "Does the Civic have push-button start, or a regular key you turn in the ignition?",
        options: [
          {
            id: "civic-push",
            label: "Push-button start",
            keyStyle: "Push start (smart key)",
            note: "Civic with push-button start",
          },
          {
            id: "civic-turn-key",
            label: "Turn-key ignition",
            keyStyle: "Remote head key",
            note: "Civic with turn-key ignition",
          },
        ],
      },
    ],
  },
  {
    id: "nissan-altima-generation",
    when: (ctx) => ctxMatch(ctx, { makes: ["Nissan"], modelIncludes: /^altima$/i, yearMin: 2013, yearMax: 2020 }),
    prompts: [
      {
        id: "altima-push-vs-key",
        question: "Push-button or turn-key?",
        askScript: "Does the Altima have push-button start, or a turn-key ignition?",
        options: [
          {
            id: "altima-push",
            label: "Push-button start",
            keyStyle: "Push start (smart key)",
            note: "Altima with push-button start",
          },
          {
            id: "altima-turn-key",
            label: "Turn-key ignition",
            keyStyle: "Remote head key",
            note: "Altima with turn-key ignition",
          },
        ],
      },
    ],
  },
  {
    id: "chevy-hd-silverado",
    when: (ctx) => {
      if (!ctxMatch(ctx, { makes: ["Chevrolet", "GMC"], yearMin: 2011 })) return false
      const m = ctx.model.trim()
      return /^(1500|2500|3500|4500|5500|6500)$/i.test(m) || /\b(2500|3500|4500|5500)hd\b/i.test(m)
    },
    prompts: [], // filled dynamically in getVehicleIntakeClarifications
  },
]

function lookupFamilyPrompt(
  ctx: VehicleIntakeContext,
  lookup: VehicleKeyLookupHint
): VehicleClarificationPrompt | null {
  if (lookup.match_type !== "family") return null
  if (normalizeModel(lookup.matched_model) === normalizeModel(lookup.model)) return null
  return {
    id: "reference-family-match",
    question: "Confirm exact model",
    askScript: `Our reference lists this as a ${lookup.matched_model}. Does that match what the customer has?`,
    options: [
      {
        id: "family-match-yes",
        label: `Yes — ${lookup.matched_model}`,
        model: lookup.matched_model,
        note: `Confirmed reference model ${lookup.matched_model}`,
      },
      {
        id: "family-match-no",
        label: `No — stays ${ctx.model}`,
        note: `Customer says not ${lookup.matched_model}; verify FCC on key`,
      },
    ],
  }
}

function multipleFccIgnitionPrompt(lookup: VehicleKeyLookupHint): VehicleClarificationPrompt | null {
  if (lookup.profiles.length < 2) return null
  const smartProfiles = lookup.profiles.filter(
    (p) => /fsk/i.test(p.modulation ?? "") && !/\bask\b/i.test(p.modulation ?? "")
  )
  const askProfiles = lookup.profiles.filter((p) => /\bask\b/i.test(p.modulation ?? ""))
  if (smartProfiles.length === 0 || askProfiles.length === 0) return null
  const smartFcc = smartProfiles[0]?.fcc_id?.trim() || undefined
  const askFcc = askProfiles[0]?.fcc_id?.trim() || undefined
  return {
    id: "multiple-fcc-ignition",
    question: "Push-button or turn-key?",
    askScript:
      "This year can have different keys — does it have push-button start or a regular turn-key?",
    options: [
      {
        id: "multi-fcc-push",
        label: "Push-button / smart key",
        fccId: smartFcc,
        keyStyle: "Push start (smart key)",
        note: smartFcc
          ? `Customer confirmed push-button smart key (FCC ${smartFcc})`
          : "Customer confirmed push-button smart key",
      },
      {
        id: "multi-fcc-turn-key",
        label: "Turn-key / remote head key",
        fccId: askFcc,
        keyStyle: "Remote head key",
        note: askFcc
          ? `Customer confirmed turn-key remote head (FCC ${askFcc})`
          : "Customer confirmed turn-key remote head",
      },
    ],
  }
}

function gmTruckSizePrompt(ctx: VehicleIntakeContext): VehicleClarificationPrompt {
  const isGmc = normalizeMake(ctx.make) === "gmc"
  return {
    id: "gm-truck-size",
    question: "Confirm truck size",
    askScript: "Which truck is it — 1500 half-ton, 2500/3500 heavy duty, or larger?",
    options: [
      {
        id: "gm-1500",
        label: "1500 half-ton",
        model: isGmc ? "Sierra 1500" : "Silverado 1500",
        note: "Confirmed 1500 half-ton",
      },
      {
        id: "gm-2500",
        label: "2500 HD",
        model: isGmc ? "Sierra 2500" : "Silverado 2500",
        note: "Confirmed 2500 HD",
      },
      {
        id: "gm-3500",
        label: "3500 HD",
        model: isGmc ? "Sierra 3500" : "Silverado 3500",
        note: "Confirmed 3500 HD",
      },
    ],
  }
}

/** Prompts to show after year + make + model are entered. */
export function getVehicleIntakeClarifications(
  yearRaw: string | number,
  makeRaw: string,
  modelRaw: string,
  lookup?: VehicleKeyLookupHint | null,
  answeredIds: ReadonlySet<string> = new Set()
): VehicleClarificationPrompt[] {
  const year = typeof yearRaw === "number" ? yearRaw : Number(String(yearRaw).trim())
  const make = makeRaw.trim()
  const model = modelRaw.trim()
  if (!Number.isFinite(year) || year < 1980 || !make || !model) return []

  const ctx: VehicleIntakeContext = { year, make, model }
  const out: VehicleClarificationPrompt[] = []
  const seen = new Set<string>()

  for (const rule of STATIC_CLARIFICATION_RULES) {
    if (!rule.when(ctx)) continue
    if (rule.id === "chevy-hd-silverado") {
      const prompt = gmTruckSizePrompt(ctx)
      if (!answeredIds.has(prompt.id) && !seen.has(prompt.id)) {
        seen.add(prompt.id)
        out.push(prompt)
      }
      continue
    }
    for (const prompt of rule.prompts) {
      if (answeredIds.has(prompt.id) || seen.has(prompt.id)) continue
      seen.add(prompt.id)
      out.push(prompt)
    }
  }

  if (lookup) {
    const family = lookupFamilyPrompt(ctx, lookup)
    if (family && !answeredIds.has(family.id) && !seen.has(family.id)) {
      seen.add(family.id)
      out.push(family)
    }
    // Prefer the TI+FCC compare prompt when the server already built one.
    const resolvedPrompt = lookup.fccResolveClarification ?? null
    if (resolvedPrompt && !answeredIds.has(resolvedPrompt.id) && !seen.has(resolvedPrompt.id)) {
      seen.add(resolvedPrompt.id)
      out.push(resolvedPrompt)
    } else {
      const multi = multipleFccIgnitionPrompt(lookup)
      if (multi && !answeredIds.has(multi.id) && !seen.has(multi.id)) {
        seen.add(multi.id)
        out.push(multi)
      }
    }
  }

  return out
}

/**
 * True when this prompt must be answered before Key Details shows a blank.
 * (Ignition type / multi-FCC / button count — not model family renames alone.)
 */
export function clarificationGatesKeySelection(prompt: VehicleClarificationPrompt): boolean {
  if (/^(multiple-fcc|fcc-|.*push-vs|.*ignition)/i.test(prompt.id)) return true
  return prompt.options.some((option) => Boolean(option.fccId?.trim() || option.keyStyle?.trim()))
}

/** YMM combos that must always offer at least one clarification prompt (regression). */
export const MUST_HAVE_CLARIFICATION_PROMPTS: VehicleIntakeContext[] = [
  { year: 2017, make: "Toyota", model: "Yaris" },
  { year: 2021, make: "Toyota", model: "C-HR" },
  { year: 2022, make: "Toyota", model: "Corolla Cross" },
  { year: 2014, make: "RAM", model: "1500" },
  { year: 2018, make: "Jeep", model: "Wrangler" },
  { year: 2018, make: "Honda", model: "Civic" },
]

export function assertMustHaveClarificationPrompts(): string[] {
  const failures: string[] = []
  for (const ctx of MUST_HAVE_CLARIFICATION_PROMPTS) {
    const prompts = getVehicleIntakeClarifications(ctx.year, ctx.make, ctx.model)
    if (prompts.length === 0) {
      failures.push(`${ctx.year} ${ctx.make} ${ctx.model}`)
    }
  }
  return failures
}
