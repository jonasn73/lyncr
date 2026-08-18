/**
 * Amber leftover intent — rules first, tiny AI only when the reply is unclear.
 * Never sends a customer SMS by itself. Unsure → ask, don’t draft junk.
 */

import { isAmberSendKeyword, isAmberSkipKeyword } from "@/lib/amber-coworker-commands"
import { isAmberStatusPhrase, normalizeAmberSmsBody } from "@/lib/amber-commands"

/** What we do with an owner leftover reply after rules + optional AI. */
export type AmberLeftoverIntent = "skip" | "send" | "status" | "ask" | "draft"

/** True when the owner is asking about the leftover, not dictating a customer text. */
export function isAmberOwnerClarifyQuestion(raw: string): boolean {
  const upper = normalizeAmberSmsBody(raw).toUpperCase().replace(/'/g, "")
  return (
    /^(WHEN WAS THIS|WHEN WAS THAT|WHO IS THIS|WHO IS THAT|WHAT IS THIS|WHAT IS THAT)\b/.test(
      upper
    ) ||
    /^(WHICH (ONE|JOB|LEAD)|HOW LONG AGO|HOW OLD IS THIS)\b/.test(upper) ||
    upper === "WHEN?" ||
    upper === "WHO?"
  )
}

/** Fast rules — no network. */
export function classifyAmberLeftoverIntentLocal(raw: string): AmberLeftoverIntent {
  if (isAmberSendKeyword(raw)) return "send"
  if (isAmberSkipKeyword(raw)) return "skip"
  if (isAmberStatusPhrase(raw)) return "status"
  const upper = normalizeAmberSmsBody(raw).toUpperCase().replace(/'/g, "")
  if (
    upper === "PASS" ||
    upper === "PASS ON THIS" ||
    upper === "PASS ON IT" ||
    upper === "SKIP THAT" ||
    upper === "SKIP HIM" ||
    upper === "SKIP HER" ||
    /^PASS ON\s+[A-Z][A-Z'-]{1,24}\b/.test(upper)
  ) {
    return "skip"
  }
  if (isAmberOwnerClarifyQuestion(raw)) return "ask"
  return "draft"
}

/** Short question when we must not guess. */
export function buildAmberClarifySms(params: {
  customerFirstName: string
  hasQuotedDraft: boolean
}): string {
  const who = params.customerFirstName || "them"
  if (params.hasQuotedDraft) {
    return `Not sure what you meant about ${who}. Reply ok to send the draft, skip ${who} to skip, or tell me the exact text for them.`
  }
  return `Not sure what you meant about ${who}. Reply skip ${who} to skip, or tell me the exact text to send them.`
}

type AiIntentJson = { intent?: unknown; confidence?: unknown }

function parseAiIntent(raw: string): AmberLeftoverIntent | null {
  let parsed: AiIntentJson
  try {
    parsed = JSON.parse(raw) as AiIntentJson
  } catch {
    return null
  }
  const intent = String(parsed.intent || "").trim().toLowerCase()
  const confidence = Number(parsed.confidence)
  if (!Number.isFinite(confidence) || confidence < 0.7) return "ask"
  if (intent === "skip" || intent === "send" || intent === "status" || intent === "ask" || intent === "draft") {
    return intent
  }
  return "ask"
}

/**
 * Tiny AI classifier for leftover replies rules did not settle.
 * send is only kept when the owner already used an approve phrase (caller enforces).
 */
export async function classifyAmberLeftoverIntentAi(params: {
  text: string
  customerFirstName: string
  hasQuotedDraft: boolean
}): Promise<AmberLeftoverIntent | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4000)
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 60,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              'Classify an owner SMS about one leftover book job. Return JSON {"intent":"skip|send|status|ask|draft","confidence":0-1}. skip = do not text the customer (skip, dismiss that one, dismiss, clear, drop, I am done with them). send = approve an already-quoted draft only. status = owner asking if they are Busy/Available. draft = they are dictating a customer text. ask = unclear. Never invent times or prices. If unsure, intent ask and confidence below 0.7.',
          },
          {
            role: "user",
            content: JSON.stringify({
              owner_text: params.text,
              leftover_first_name: params.customerFirstName,
              has_quoted_draft: params.hasQuotedDraft,
            }),
          },
        ],
      }),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const content = json.choices?.[0]?.message?.content?.trim()
    if (!content) return null
    return parseAiIntent(content)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Drop model guesses that would skip or send without the owner using those words. */
export function applyAmberAiIntentGuard(params: {
  text: string
  ai: AmberLeftoverIntent
}): AmberLeftoverIntent {
  if (params.ai === "send" && !isAmberSendKeyword(params.text)) return "ask"
  if (params.ai === "skip" && !isAmberSkipKeyword(params.text)) return "ask"
  return params.ai
}

/** Rules first; AI only for leftover “draft” guesses. send/skip from AI need the owner’s words. */
export async function resolveAmberLeftoverIntent(params: {
  text: string
  customerFirstName: string
  hasQuotedDraft: boolean
}): Promise<AmberLeftoverIntent> {
  const local = classifyAmberLeftoverIntentLocal(params.text)
  if (local !== "draft") return local
  const ai = await classifyAmberLeftoverIntentAi(params)
  if (!ai || ai === "draft") return "draft"
  return applyAmberAiIntentGuard({ text: params.text, ai })
}
