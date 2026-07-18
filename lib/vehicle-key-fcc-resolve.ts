// Resolve multiple FCC IDs for one Year/Make/Model by cross-checking
// reference profiles, TI catalog FCC/button data, and key style signals.
// When still ambiguous, build an Ask-the-customer clarification prompt.

import { sanitizeFccIdInput } from "@/lib/fcc-id-input"
import { isTiAftermarketSku } from "@/lib/ti-supplier-catalog-shared"
import type { VehicleClarificationPrompt } from "@/lib/vehicle-intake-clarifications"

/** One FCC row from the locksmith CSV / key-info profiles. */
export type FccResolveProfile = {
  fccId: string
  frequency?: string | null
  modulation?: string | null
  /** Number of remote photo variants we have for this FCC. */
  variantCount?: number
  /** Button counts parsed from variant titles (when available). */
  buttonCountsFromVariants?: number[]
}

/** One TI catalog hit that may name an FCC ID. */
export type FccResolveTiHit = {
  fccId: string
  tiSku: string
  title: string
  buttonCount: number
  frequency: string
  score: number
}

export type FccRankedCandidate = {
  fccId: string
  score: number
  reasons: string[]
}

export type VehicleKeyFccResolveResult = {
  /** Confident single FCC to prefer (null when the dispatcher must ask). */
  resolvedFccId: string | null
  confidence: "single" | "high" | "low"
  ranked: FccRankedCandidate[]
  /** Present when confidence is low — reuse Ask-the-customer UI. */
  clarification: VehicleClarificationPrompt | null
  /** Best aftermarket TI SKU for the resolved FCC (when known). */
  preferredTiSku: string | null
  /** True when more than one FCC remains and we could not auto-pick. */
  needsClarification: boolean
}

function ensureCandidate(
  map: Map<string, FccRankedCandidate>,
  fccId: string
): FccRankedCandidate {
  let row = map.get(fccId)
  if (!row) {
    row = { fccId, score: 0, reasons: [] }
    map.set(fccId, row)
  }
  return row
}

function addScore(row: FccRankedCandidate, points: number, reason: string): void {
  if (points === 0) return
  row.score += points
  if (!row.reasons.includes(reason)) row.reasons.push(reason)
}

function isSmartModulation(modulation: string | null | undefined): boolean {
  const m = modulation ?? ""
  return /fsk/i.test(m) && !/\bask\b/i.test(m)
}

function isAskModulation(modulation: string | null | undefined): boolean {
  return /\bask\b/i.test(modulation ?? "")
}

/** Pull a button count from TI / variant titles ("3B", "5-Button"). */
export function extractButtonCountFromTitle(title: string): number | null {
  const buttonWord = title.match(/(\d)\s*-?\s*Button/i)
  if (buttonWord) return Number(buttonWord[1])
  const short = title.match(/\b(\d)\s*B\b/i)
  if (short) return Number(short[1])
  return null
}

function bestTiForFcc(tiHits: FccResolveTiHit[], fccId: string): FccResolveTiHit | null {
  const want = sanitizeFccIdInput(fccId)
  const matches = tiHits.filter((hit) => sanitizeFccIdInput(hit.fccId) === want)
  if (matches.length === 0) return null
  matches.sort((a, b) => {
    const aAfter = isTiAftermarketSku(a.tiSku, a.title) ? 1 : 0
    const bAfter = isTiAftermarketSku(b.tiSku, b.title) ? 1 : 0
    if (bAfter !== aAfter) return bAfter - aAfter
    return b.score - a.score
  })
  return matches[0] ?? null
}

function labelForFcc(
  fccId: string,
  profiles: FccResolveProfile[],
  tiHits: FccResolveTiHit[]
): string {
  const ti = bestTiForFcc(tiHits, fccId)
  if (ti) {
    const buttons =
      ti.buttonCount > 0
        ? `${ti.buttonCount}-btn `
        : extractButtonCountFromTitle(ti.title)
          ? `${extractButtonCountFromTitle(ti.title)}-btn `
          : ""
    const style = /smart|prox/i.test(ti.title)
      ? "smart"
      : /flip/i.test(ti.title)
        ? "flip"
        : /remote/i.test(ti.title)
          ? "remote"
          : "key"
    return `${buttons}${style} · FCC ${fccId}`
  }
  const profile = profiles.find((p) => sanitizeFccIdInput(p.fccId) === sanitizeFccIdInput(fccId))
  if (profile && isSmartModulation(profile.modulation)) return `Smart / push-start · FCC ${fccId}`
  if (profile && isAskModulation(profile.modulation)) return `Turn-key / remote head · FCC ${fccId}`
  return `FCC ${fccId}`
}

function keyStyleForFcc(
  fccId: string,
  profiles: FccResolveProfile[],
  tiHits: FccResolveTiHit[]
): string | undefined {
  const ti = bestTiForFcc(tiHits, fccId)
  if (ti && /smart|prox/i.test(ti.title)) return "Push start (smart key)"
  if (ti && /flip/i.test(ti.title)) return "Flip key"
  if (ti && /remote\s*head/i.test(ti.title)) return "Remote head key"
  const profile = profiles.find((p) => sanitizeFccIdInput(p.fccId) === sanitizeFccIdInput(fccId))
  if (profile && isSmartModulation(profile.modulation)) return "Push start (smart key)"
  if (profile && isAskModulation(profile.modulation)) return "Remote head key"
  return undefined
}

/** Build the best clarifying question from what still differs across top FCC candidates. */
function buildFccClarification(
  ranked: FccRankedCandidate[],
  profiles: FccResolveProfile[],
  tiHits: FccResolveTiHit[]
): VehicleClarificationPrompt {
  const top = ranked.slice(0, 4)

  // --- Discriminator 1: button counts ---
  const buttonsToFcc = new Map<number, string>()
  for (const candidate of top) {
    const ti = bestTiForFcc(tiHits, candidate.fccId)
    const fromTi =
      ti && ti.buttonCount > 0 ? ti.buttonCount : ti ? extractButtonCountFromTitle(ti.title) : null
    const profile = profiles.find(
      (p) => sanitizeFccIdInput(p.fccId) === sanitizeFccIdInput(candidate.fccId)
    )
    const fromVariants = profile?.buttonCountsFromVariants?.find((n) => n > 0) ?? null
    const buttons = fromTi ?? fromVariants
    if (buttons != null && buttons > 0 && !buttonsToFcc.has(buttons)) {
      buttonsToFcc.set(buttons, candidate.fccId)
    }
  }
  if (buttonsToFcc.size >= 2) {
    const options = [...buttonsToFcc.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([buttons, fccId]) => {
        const ti = bestTiForFcc(tiHits, fccId)
        return {
          id: `fcc-buttons-${buttons}`,
          label: `${buttons} buttons`,
          askLine: `It has ${buttons} buttons.`,
          fccId,
          tiSku: ti?.tiSku,
          keyStyle: keyStyleForFcc(fccId, profiles, tiHits),
          frequency: ti?.frequency?.replace(/[^\d]/g, "") || undefined,
          note: `Customer confirmed ${buttons}-button key (FCC ${fccId})`,
        }
      })
    return {
      id: "fcc-button-count",
      question: "How many buttons on the key?",
      askScript: "Looking at the customer's remote — how many buttons does it have?",
      options,
    }
  }

  // --- Discriminator 2: push-start vs turn-key (modulation) ---
  const smart = top.filter((c) => {
    const p = profiles.find((row) => sanitizeFccIdInput(row.fccId) === c.fccId)
    return p && isSmartModulation(p.modulation)
  })
  const turnKey = top.filter((c) => {
    const p = profiles.find((row) => sanitizeFccIdInput(row.fccId) === c.fccId)
    return p && isAskModulation(p.modulation)
  })
  if (smart.length > 0 && turnKey.length > 0) {
    const smartFcc = smart[0]!.fccId
    const turnFcc = turnKey[0]!.fccId
    const smartTi = bestTiForFcc(tiHits, smartFcc)
    const turnTi = bestTiForFcc(tiHits, turnFcc)
    return {
      id: "multiple-fcc-ignition",
      question: "Push-button or turn-key?",
      askScript:
        "This year can use different keys — does it have push-button start or a regular turn-key?",
      options: [
        {
          id: "multi-fcc-push",
          label: "Push-button / smart key",
          fccId: smartFcc,
          tiSku: smartTi?.tiSku,
          keyStyle: "Push start (smart key)",
          note: `Customer confirmed push-button smart key (FCC ${smartFcc})`,
        },
        {
          id: "multi-fcc-turn-key",
          label: "Turn-key / remote head key",
          fccId: turnFcc,
          tiSku: turnTi?.tiSku,
          keyStyle: "Remote head key",
          note: `Customer confirmed turn-key remote head (FCC ${turnFcc})`,
        },
      ],
    }
  }

  // --- Discriminator 3: trunk vs hatch on TI titles ---
  const trunkFccs = new Set<string>()
  const hatchFccs = new Set<string>()
  for (const hit of tiHits) {
    const id = sanitizeFccIdInput(hit.fccId)
    if (!id) continue
    if (!top.some((c) => c.fccId === id)) continue
    if (/trunk/i.test(hit.title)) trunkFccs.add(id)
    if (/hatch/i.test(hit.title)) hatchFccs.add(id)
  }
  if (trunkFccs.size > 0 && hatchFccs.size > 0) {
    const trunkFcc = [...trunkFccs][0]!
    const hatchFcc = [...hatchFccs][0]!
    return {
      id: "fcc-trunk-or-hatch",
      question: "Trunk or hatch button?",
      askScript: "On the remote — is there a trunk-release button, or a hatch / liftgate button?",
      options: [
        {
          id: "fcc-trunk",
          label: "Trunk button",
          fccId: trunkFcc,
          tiSku: bestTiForFcc(tiHits, trunkFcc)?.tiSku,
          note: `Customer confirmed trunk-button remote (FCC ${trunkFcc})`,
        },
        {
          id: "fcc-hatch",
          label: "Hatch / liftgate button",
          fccId: hatchFcc,
          tiSku: bestTiForFcc(tiHits, hatchFcc)?.tiSku,
          note: `Customer confirmed hatch-button remote (FCC ${hatchFcc})`,
        },
      ],
    }
  }

  // --- Fallback: let the dispatcher pick among labeled FCC options ---
  return {
    id: "fcc-pick-remote",
    question: "Which remote matches?",
    askScript: "Which of these best matches the customer's key?",
    options: top.map((candidate) => {
      const ti = bestTiForFcc(tiHits, candidate.fccId)
      return {
        id: `fcc-pick-${candidate.fccId}`,
        label: labelForFcc(candidate.fccId, profiles, tiHits),
        fccId: candidate.fccId,
        tiSku: ti?.tiSku,
        keyStyle: keyStyleForFcc(candidate.fccId, profiles, tiHits),
        note: `Customer matched FCC ${candidate.fccId}`,
      }
    }),
  }
}

/**
 * Compare FCC candidates against TI catalog + profile metadata.
 * Returns one FCC when evidence is strong; otherwise an Ask-the-customer prompt.
 */
export function resolveVehicleKeyFcc(input: {
  profiles: FccResolveProfile[]
  tiHits: FccResolveTiHit[]
}): VehicleKeyFccResolveResult {
  const byFcc = new Map<string, FccRankedCandidate>()

  for (const profile of input.profiles) {
    const fccId = sanitizeFccIdInput(profile.fccId)
    if (!fccId) continue
    const row = ensureCandidate(byFcc, fccId)
    addScore(row, 10, "in reference database")
    const variants = profile.variantCount ?? 0
    if (variants > 0) {
      addScore(row, Math.min(30, variants * 6), "has key photos in system")
    }
  }

  for (const hit of input.tiHits) {
    const fccId = sanitizeFccIdInput(hit.fccId)
    if (!fccId) continue
    const row = ensureCandidate(byFcc, fccId)
    addScore(row, 45, "listed on Transponder Island for this vehicle")
    if (isTiAftermarketSku(hit.tiSku, hit.title)) {
      addScore(row, 55, "aftermarket TI order blank")
    }
    // Higher TI match score → stronger FCC evidence.
    addScore(row, Math.min(25, Math.round(hit.score / 8)), "strong TI title match")
  }

  // Frequency consensus across CSV profiles.
  const freqCounts = new Map<string, number>()
  for (const profile of input.profiles) {
    const freq = (profile.frequency ?? "").replace(/[^\d]/g, "")
    if (!freq) continue
    freqCounts.set(freq, (freqCounts.get(freq) ?? 0) + 1)
  }
  let majorityFreq: string | null = null
  let majorityCount = 0
  for (const [freq, count] of freqCounts) {
    if (count > majorityCount) {
      majorityFreq = freq
      majorityCount = count
    }
  }
  if (majorityFreq && majorityCount >= 2) {
    for (const profile of input.profiles) {
      const fccId = sanitizeFccIdInput(profile.fccId)
      const freq = (profile.frequency ?? "").replace(/[^\d]/g, "")
      if (fccId && freq === majorityFreq) {
        addScore(ensureCandidate(byFcc, fccId), 12, "matches majority frequency")
      }
    }
  }

  // Button-count agreement between TI rows and variant titles.
  for (const profile of input.profiles) {
    const fccId = sanitizeFccIdInput(profile.fccId)
    if (!fccId) continue
    const ti = bestTiForFcc(input.tiHits, fccId)
    if (!ti) continue
    const tiButtons =
      ti.buttonCount > 0 ? ti.buttonCount : extractButtonCountFromTitle(ti.title)
    const variantButtons = profile.buttonCountsFromVariants ?? []
    if (tiButtons && variantButtons.includes(tiButtons)) {
      addScore(ensureCandidate(byFcc, fccId), 20, "button count matches catalog photos")
    }
  }

  const ranked = [...byFcc.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.fccId.localeCompare(b.fccId)
  })

  if (ranked.length === 0) {
    return {
      resolvedFccId: null,
      confidence: "low",
      ranked,
      clarification: null,
      preferredTiSku: null,
      needsClarification: false,
    }
  }

  if (ranked.length === 1) {
    const only = ranked[0]!
    return {
      resolvedFccId: only.fccId,
      confidence: "single",
      ranked,
      clarification: null,
      preferredTiSku: bestTiForFcc(input.tiHits, only.fccId)?.tiSku ?? null,
      needsClarification: false,
    }
  }

  // All aftermarket TI hits agree on one FCC → trust that blank.
  const aftermarketFccs = [
    ...new Set(
      input.tiHits
        .filter((hit) => isTiAftermarketSku(hit.tiSku, hit.title))
        .map((hit) => sanitizeFccIdInput(hit.fccId))
        .filter(Boolean)
    ),
  ]
  if (aftermarketFccs.length === 1) {
    const fccId = aftermarketFccs[0]!
    return {
      resolvedFccId: fccId,
      confidence: "high",
      ranked,
      clarification: null,
      preferredTiSku: bestTiForFcc(input.tiHits, fccId)?.tiSku ?? null,
      needsClarification: false,
    }
  }

  // Clear score gap between #1 and #2.
  const top = ranked[0]!
  const second = ranked[1]!
  if (top.score >= second.score + 35) {
    return {
      resolvedFccId: top.fccId,
      confidence: "high",
      ranked,
      clarification: null,
      preferredTiSku: bestTiForFcc(input.tiHits, top.fccId)?.tiSku ?? null,
      needsClarification: false,
    }
  }

  return {
    resolvedFccId: null,
    confidence: "low",
    ranked,
    clarification: buildFccClarification(ranked, input.profiles, input.tiHits),
    preferredTiSku: null,
    needsClarification: true,
  }
}

/**
 * Put TI rows for the preferred FCC first (keeps A-suffix ordering inside that group).
 * When `strict` is true, drop other FCC rows if at least one preferred row exists.
 */
export function orderTiCatalogByPreferredFcc<
  T extends { fccId: string; tiSku: string; title: string; score: number },
>(hits: T[], preferredFccId: string | null | undefined, strict = false): T[] {
  const want = preferredFccId ? sanitizeFccIdInput(preferredFccId) : ""
  if (!want || hits.length === 0) return hits

  const matching = hits.filter((hit) => sanitizeFccIdInput(hit.fccId) === want)
  if (matching.length === 0) return hits
  if (strict) return matching

  const rest = hits.filter((hit) => sanitizeFccIdInput(hit.fccId) !== want)
  return [...matching, ...rest]
}
