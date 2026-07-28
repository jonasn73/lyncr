// Confirm-only AI intake suggestions from open quote / CRM / notes (never auto-book).

import {
  normalizeServiceQuoteTypeId,
  type ServiceQuoteTypeId,
} from "@/lib/service-rate-card"

export type IntakeAiSuggestInput = {
  /** Caller E.164 when known. */
  phone?: string | null
  /** Existing intake notes. */
  notes?: string | null
  /** Matched CRM customer display name. */
  customerName?: string | null
  /** Matched CRM notes. */
  customerNotes?: string | null
  /** Open quote lead service type id. */
  openServiceTypeId?: string | null
  /** Open quote amount in cents. */
  openQuoteCents?: number | null
  /** Vehicle YMM already on the form. */
  vehicleYear?: string | null
  vehicleMake?: string | null
  vehicleModel?: string | null
  /** Optional call / wrap-up text (transcript stub or operator notes). */
  callContext?: string | null
}

export type IntakeAiSuggestion = {
  /** Suggested service quote type — owner must confirm. */
  serviceTypeId: ServiceQuoteTypeId
  /** Rough price in cents, or null when unknown. */
  suggestedPriceCents: number | null
  /** Notes draft to merge into intake (owner confirms before book). */
  notesDraft: string
  /** Short UI blurb for the Suggest button result. */
  summary: string
  /** How the suggestion was built. */
  source: "heuristic" | "openai"
}

function dollarsLabel(cents: number | null): string {
  if (cents == null || cents <= 0) return ""
  return `$${Math.round(cents / 100)}`
}

function vehicleLabel(input: IntakeAiSuggestInput): string {
  const parts = [input.vehicleYear, input.vehicleMake, input.vehicleModel]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter(Boolean)
  return parts.join(" ")
}

/** Guess service type from free text (notes / CRM / call context). */
export function inferServiceTypeFromText(text: string): ServiceQuoteTypeId | null {
  const t = text.toLowerCase()
  if (!t.trim()) return null
  if (/\b(lock\s*out|locked\s*out|keys?\s+locked|keys?\s*in\s*(car|vehicle|trunk)|can.?t get in)\b/.test(t)) {
    return "lockout"
  }
  if (/\b(duplicate|spare\s*key|copy\s*(of\s*)?(key|fob))\b/.test(t)) {
    return "key_duplication"
  }
  if (/\b(all\s*keys?\s*lost|no\s*keys?|key\s*(gen|generation|origination)|new\s*key)\b/.test(t)) {
    return "key_generation"
  }
  if (/\b(ignition|won.?t\s*turn|starter)\b/.test(t)) return "ignition_repair"
  if (/\b(extract|broken\s*key|key\s*stuck)\b/.test(t)) return "key_extraction"
  if (/\b(program|transponder|fob\s*not\s*working|chip\s*key)\b/.test(t)) {
    return "programming_diagnostics"
  }
  if (/\b(rekey|re-key|changed\s*locks?)\b/.test(t)) return "rekey"
  if (/\b(install|new\s*lock|deadbolt)\b/.test(t)) return "lock_installation"
  if (/\b(safe)\b/.test(t)) return "safe_lockout"
  if (/\b(keypad|smart\s*lock|august|schlage\s*encode)\b/.test(t)) return "keypad_smart_lock"
  return null
}

const SERVICE_LABELS: Partial<Record<ServiceQuoteTypeId, string>> = {
  lockout: "Vehicle lockout",
  key_generation: "Key generation",
  key_duplication: "Key duplication",
  programming_diagnostics: "Programming / diagnostics",
  ignition_repair: "Ignition repair",
  key_extraction: "Key extraction",
  rekey: "Rekey",
  lock_installation: "Lock installation",
  safe_lockout: "Safe lockout",
  keypad_smart_lock: "Keypad / smart lock",
  other: "Service call",
}

/**
 * Deterministic suggest from open quote + CRM + notes.
 * Safe without OPENAI_API_KEY; never creates a job.
 */
export function buildHeuristicIntakeSuggestion(input: IntakeAiSuggestInput): IntakeAiSuggestion {
  const blob = [
    input.notes,
    input.customerNotes,
    input.callContext,
    input.openServiceTypeId,
  ]
    .filter(Boolean)
    .join("\n")

  const fromText = inferServiceTypeFromText(blob)
  const fromOpen = input.openServiceTypeId
    ? normalizeServiceQuoteTypeId(input.openServiceTypeId)
    : null
  const serviceTypeId = fromText || fromOpen || "lockout"

  const price =
    input.openQuoteCents != null && input.openQuoteCents > 0
      ? Math.round(input.openQuoteCents)
      : null

  const vehicle = vehicleLabel(input)
  const name = input.customerName?.trim() || null
  const priceBit = dollarsLabel(price)
  const serviceLabel = SERVICE_LABELS[serviceTypeId] || "Service call"

  const lines: string[] = ["🤖 [AI intake suggestion — confirm before booking]"]
  if (name) lines.push(`Caller: ${name}`)
  if (vehicle) lines.push(`Vehicle: ${vehicle}`)
  lines.push(`Suggested service: ${serviceLabel}`)
  if (priceBit) lines.push(`Rough price from open quote: ${priceBit}`)
  if (input.customerNotes?.trim()) {
    lines.push(`CRM notes: ${input.customerNotes.trim().slice(0, 240)}`)
  }
  if (input.callContext?.trim()) {
    lines.push(`Call context: ${input.callContext.trim().slice(0, 280)}`)
  }
  lines.push("Owner must confirm — nothing was booked automatically.")

  const notesDraft = lines.join("\n")
  const summary = [
    serviceLabel,
    priceBit ? `~${priceBit}` : null,
    vehicle || null,
  ]
    .filter(Boolean)
    .join(" · ")

  return {
    serviceTypeId,
    suggestedPriceCents: price,
    notesDraft,
    summary: summary || serviceLabel,
    source: "heuristic",
  }
}

/** Optional OpenAI polish; falls back to heuristic on any failure. */
export async function generateIntakeAiSuggestion(
  input: IntakeAiSuggestInput
): Promise<IntakeAiSuggestion> {
  const base = buildHeuristicIntakeSuggestion(input)
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) return base

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        max_tokens: 220,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You help a locksmith dispatcher prefill an intake form. Return JSON only: " +
              '{"serviceTypeId":"lockout|key_generation|key_duplication|programming_diagnostics|ignition_repair|key_extraction|rekey|lock_installation|safe_lockout|keypad_smart_lock|other",' +
              '"suggestedPriceCents":number|null,"notesDraft":"string","summary":"short string"}. ' +
              "Never invent a booking. Prefer the open quote price when present. Keep notesDraft under 400 chars.",
          },
          {
            role: "user",
            content: JSON.stringify({
              phone: input.phone ?? null,
              notes: input.notes ?? null,
              customerName: input.customerName ?? null,
              customerNotes: input.customerNotes ?? null,
              openServiceTypeId: input.openServiceTypeId ?? null,
              openQuoteCents: input.openQuoteCents ?? null,
              vehicle: vehicleLabel(input) || null,
              callContext: input.callContext ?? null,
              heuristic: base,
            }),
          },
        ],
      }),
    })
    if (!res.ok) return base
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    const raw = json.choices?.[0]?.message?.content?.trim()
    if (!raw) return base
    const parsed = JSON.parse(raw) as {
      serviceTypeId?: string
      suggestedPriceCents?: number | null
      notesDraft?: string
      summary?: string
    }
    const serviceTypeId = normalizeServiceQuoteTypeId(parsed.serviceTypeId || base.serviceTypeId)
    const price =
      typeof parsed.suggestedPriceCents === "number" && parsed.suggestedPriceCents > 0
        ? Math.round(parsed.suggestedPriceCents)
        : base.suggestedPriceCents
    const notesDraft =
      typeof parsed.notesDraft === "string" && parsed.notesDraft.trim()
        ? parsed.notesDraft.trim().slice(0, 600)
        : base.notesDraft
    const summary =
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim().slice(0, 120)
        : base.summary
    return {
      serviceTypeId,
      suggestedPriceCents: price,
      notesDraft,
      summary,
      source: "openai",
    }
  } catch {
    return base
  }
}
