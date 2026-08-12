// Rule-based SMS reply chips + drafts for the Latest “Needs reply” sheet.
// Used by the UI immediately; the suggest-reply API can polish with OpenAI.

/** What the customer’s last inbound message seems to be about. */
export type SmsReplyIntent =
  | "cancel"
  | "schedule"
  | "thanks"
  | "question"
  | "generic"

/** One tap-chip shown above the composer (fills the draft — never auto-sends). */
export type SmsReplyChip = {
  /** Stable id for React keys. */
  id: string
  /** Short label on the chip button. */
  label: string
  /** Full SMS body to put in the composer. */
  body: string
}

/** Context we know when suggesting a reply. */
export type SmsReplySuggestInput = {
  /** Last inbound customer text (required for intent). */
  customerMessage: string
  /** Display name, e.g. “Ken Cook”. */
  customerName?: string | null
  /** Business name for sign-off, e.g. “Key Squad 502”. */
  businessName?: string | null
  /** Vehicle string when known, e.g. “2023 Ford Expedition”. */
  vehicle?: string | null
  /** Prior outbound SMS body (quote / follow-up) for extra context. */
  priorOutbound?: string | null
}

/** Result of local (non-AI) suggestion building. */
export type SmsReplyHeuristicResult = {
  intent: SmsReplyIntent
  chips: SmsReplyChip[]
  /** 1–2 full draft replies ready to paste into the composer. */
  drafts: string[]
  source: "heuristic"
}

/** Prefer first name for SMS tone; fall back to “there”. */
function firstName(name: string | null | undefined): string {
  // Take the first word of the customer name when present.
  const first = String(name ?? "")
    .trim()
    .split(/\s+/)[0]
  // Use “there” when we have no usable name.
  return first || "there"
}

/** Business sign-off used in chip bodies. */
function biz(name: string | null | undefined): string {
  // Trim the business name from session / outbound context.
  const n = String(name ?? "").trim()
  // Fall back to a neutral “us” so copy still reads well.
  return n || "us"
}

/**
 * Guess cancel / schedule / thanks / question / generic from free text.
 * Cancel wins when phrases like “no longer needed” or “found a different…” appear.
 */
export function detectSmsReplyIntent(inboundBody: string): SmsReplyIntent {
  // Normalize for case-insensitive matching.
  const t = String(inboundBody ?? "").toLowerCase()
  // Empty inbound → generic chips only.
  if (!t.trim()) return "generic"

  // Cancel / declined / found another provider.
  if (
    /\b(no longer needed|not needed anymore|don'?t need|dont need|no need)\b/.test(t) ||
    /\b(found (a )?different|went (with|elsewhere)|found someone else)\b/.test(t) ||
    /\b(cancel|cancelled|canceled|call(ing)? off|never ?mind|changed my mind|all set)\b/.test(t)
  ) {
    return "cancel"
  }

  // Asking to book or pick a time.
  if (
    /\b(schedule|reschedule|book(ing)?|appointment|available|availability)\b/.test(t) ||
    /\b(when can|what time|this (morning|afternoon|evening)|tomorrow|today|this week)\b/.test(t) ||
    /\b(can you come|come out|get (me )?on the (schedule|calendar))\b/.test(t)
  ) {
    return "schedule"
  }

  // Pure thanks (short).
  if (
    /^(thanks|thank you|thx|ty)[\s!.]*$/i.test(t.trim()) ||
    (/\b(thanks|thank you)\b/.test(t) && t.length < 40)
  ) {
    return "thanks"
  }

  // Price / how / what questions.
  if (/\?/.test(t) || /\b(how much|price|cost|quote|do you|can you|is it possible)\b/.test(t)) {
    return "question"
  }

  // Default catch-all.
  return "generic"
}

/**
 * Pull a rough vehicle label out of prior outbound copy
 * (e.g. “quote for the 2023 Ford Expedition”).
 */
export function extractVehicleFromSmsBody(body: string | null | undefined): string | null {
  // Work on the raw outbound string.
  const text = String(body ?? "")
  // Match “quote for the 2023 Ford Expedition” style phrases.
  const quoteMatch = text.match(
    /(?:quote for(?: the)?|regarding your quote for(?: the)?)\s+(\d{4}\s+[A-Za-z][\w-]*(?:\s+[A-Za-z][\w-]*){0,3})/i
  )
  if (quoteMatch?.[1]) return quoteMatch[1].trim()
  // Fallback: bare year + make + model anywhere in the text.
  const ymm = text.match(/\b(20\d{2}|19\d{2})\s+([A-Za-z][\w-]*)\s+([A-Za-z][\w-]*)\b/)
  if (ymm) return `${ymm[1]} ${ymm[2]} ${ymm[3]}`.trim()
  // Nothing found.
  return null
}

/**
 * Prefer an explicit business name; else try “Name — …” prefix on outbound.
 */
export function extractBusinessNameFromSmsBody(body: string | null | undefined): string | null {
  // Outbound often starts with “Key Squad 502 — pick a time: …”
  const text = String(body ?? "").trim()
  const m = text.match(/^([A-Za-z0-9][A-Za-z0-9 &'./-]{1,40})\s+[—–-]\s+/)
  if (m?.[1] && !/^(hi|hey|hello|thanks)\b/i.test(m[1])) return m[1].trim()
  return null
}

/** Build 2–4 one-tap chips + 1–2 drafts from last inbound intent. */
export function buildHeuristicSmsReplySuggestions(
  input: SmsReplySuggestInput
): SmsReplyHeuristicResult {
  // Detect intent from the customer’s last message.
  const intent = detectSmsReplyIntent(input.customerMessage)
  // Friendly first name for drafts.
  const who = firstName(input.customerName)
  // Business name for sign-off (session or outbound prefix).
  const business =
    String(input.businessName ?? "").trim() ||
    extractBusinessNameFromSmsBody(input.priorOutbound) ||
    "us"
  const businessLabel = biz(business)
  // Vehicle hint from props or outbound body.
  const vehicle =
    String(input.vehicle ?? "").trim() ||
    extractVehicleFromSmsBody(input.priorOutbound) ||
    ""

  // Always start with an empty chip list we fill by intent.
  const chips: SmsReplyChip[] = []
  // Drafts the “Suggest reply” button can fall back to without OpenAI.
  const drafts: string[] = []

  if (intent === "cancel") {
    // Closing thank-you when they found another solution / no longer need service.
    chips.push({
      id: "cancel-thanks",
      label: "Thanks — closed",
      body: `Thanks for letting us know, ${who}. Wishing you the best — reach out anytime if you need ${businessLabel} again.`,
    })
    chips.push({
      id: "cancel-understood",
      label: "Understood",
      body: `Understood, ${who}. We've closed out your request. Thank you for considering ${businessLabel}.`,
    })
    drafts.push(
      `Hi ${who}, thanks for the update — glad you found a solution. We've marked your request closed. If you ever need ${businessLabel}, we're here.`
    )
    drafts.push(
      `Thanks for letting us know, ${who}. No problem at all — take care, and feel free to text ${businessLabel} anytime.`
    )
  } else if (intent === "schedule") {
    // Scheduling follow-up chips.
    chips.push({
      id: "schedule-windows",
      label: "Send windows",
      body: `Hi ${who}, happy to get you on the schedule${vehicle ? ` for the ${vehicle}` : ""}. What days/times work best? — ${businessLabel}`,
    })
    chips.push({
      id: "schedule-today",
      label: "Today ok?",
      body: `Hi ${who}, we still have availability today — want us to pencil you in? Reply with a time window. — ${businessLabel}`,
    })
    drafts.push(
      `Hi ${who}, thanks for getting back to us. Reply with a couple of time windows that work and we'll lock one in${vehicle ? ` for the ${vehicle}` : ""}. — ${businessLabel}`
    )
  } else if (intent === "thanks") {
    chips.push({
      id: "thanks-ack",
      label: "You're welcome",
      body: `You're welcome, ${who}! Happy to help. — ${businessLabel}`,
    })
    drafts.push(`You're welcome, ${who}! Text us anytime. — ${businessLabel}`)
  } else if (intent === "question") {
    chips.push({
      id: "question-soon",
      label: "We'll reply soon",
      body: `Thanks ${who} — got your question. We'll get back to you shortly. — ${businessLabel}`,
    })
    chips.push({
      id: "question-call",
      label: "Can we call?",
      body: `Hi ${who}, happy to help with that. Is it ok if we give you a quick call? — ${businessLabel}`,
    })
    drafts.push(
      `Hi ${who}, thanks for your message — we'll follow up shortly with details${vehicle ? ` on the ${vehicle}` : ""}. — ${businessLabel}`
    )
  } else {
    // Generic catch-all.
    chips.push({
      id: "generic-soon",
      label: "We'll get back",
      body: `Thanks ${who} — we'll get back to you shortly. — ${businessLabel}`,
    })
    drafts.push(
      `Hi ${who}, thanks for your message. We'll follow up shortly. — ${businessLabel}`
    )
  }

  // Always offer a safe generic chip when not already the primary.
  if (!chips.some((c) => c.id === "generic-soon")) {
    chips.push({
      id: "generic-soon",
      label: "We'll get back",
      body: `Thanks — we'll get back to you shortly. — ${businessLabel}`,
    })
  }

  // Cap at 4 chips for a mobile-friendly row.
  return {
    intent,
    chips: chips.slice(0, 4),
    drafts: drafts.slice(0, 2),
    source: "heuristic",
  }
}

/**
 * Compact chips for the “job finished → send thanks + review” sheet when there is
 * no inbound yet. Tap fills Messages (?draft=) — never auto-sends; review SMS stays primary.
 */
export function buildJobFinishedFollowUpChips(input: {
  customerName?: string | null
  businessName?: string | null
}): SmsReplyChip[] {
  const who = firstName(input.customerName)
  const businessLabel = biz(input.businessName)
  return [
    {
      id: "job-thanks",
      label: "Thanks again",
      body: `Thanks again, ${who}! Appreciate you choosing ${businessLabel}.`,
    },
    {
      id: "job-glad",
      label: "Glad we helped",
      body: `Hi ${who}, glad we could help today. Text ${businessLabel} anytime you need us.`,
    },
    {
      id: "job-checkin",
      label: "All good?",
      body: `Hi ${who}, just checking in — everything still working well? — ${businessLabel}`,
    },
  ]
}

/**
 * Optional OpenAI polish of 1–2 reply drafts.
 * Falls back to heuristic drafts when OPENAI_API_KEY is missing or the call fails.
 */
export async function generateSmsReplySuggestions(
  input: SmsReplySuggestInput
): Promise<{
  intent: SmsReplyIntent
  chips: SmsReplyChip[]
  drafts: string[]
  source: "heuristic" | "openai"
}> {
  // Always compute rule-based chips/drafts first (safe offline fallback).
  const base = buildHeuristicSmsReplySuggestions(input)
  // Read the API key from the environment (same pattern as intake suggest).
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  // No key → return chips + drafts without calling OpenAI.
  if (!apiKey) return base

  try {
    // Call OpenAI chat completions for 1–2 short owner SMS drafts.
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        max_tokens: 280,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You help a small-business owner reply to a customer SMS. " +
              "Return JSON only: {\"drafts\":[\"string\",\"string\"]}. " +
              "Write 1 or 2 short SMS replies (under 280 chars each) the owner can send. " +
              "Match the customer's intent (cancel → polite close; schedule → ask for times; thanks → brief ack). " +
              "Use the business name when provided. Never invent prices or appointments. Do not auto-send — drafts only.",
          },
          {
            role: "user",
            content: JSON.stringify({
              customerMessage: input.customerMessage,
              customerName: input.customerName ?? null,
              businessName: input.businessName ?? null,
              vehicle: input.vehicle ?? null,
              priorOutbound: input.priorOutbound
                ? String(input.priorOutbound).slice(0, 400)
                : null,
              intent: base.intent,
              heuristicDrafts: base.drafts,
            }),
          },
        ],
      }),
    })
    // Non-OK response → keep heuristic drafts.
    if (!res.ok) return base
    // Parse the OpenAI envelope.
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    // Raw JSON string from the model.
    const raw = json.choices?.[0]?.message?.content?.trim()
    if (!raw) return base
    // Parse the model JSON into drafts[].
    const parsed = JSON.parse(raw) as { drafts?: unknown }
    // Keep only non-empty string drafts, cap at 2, max length 320.
    const drafts = (Array.isArray(parsed.drafts) ? parsed.drafts : [])
      .filter((d): d is string => typeof d === "string" && d.trim().length > 0)
      .map((d) => d.trim().slice(0, 320))
      .slice(0, 2)
    // If the model returned nothing useful, keep heuristic drafts.
    if (drafts.length === 0) return base
    // Keep rule-based chips; swap in AI drafts for the Suggest button.
    return {
      intent: base.intent,
      chips: base.chips,
      drafts,
      source: "openai",
    }
  } catch {
    // Network / parse errors → safe heuristic fallback.
    return base
  }
}
