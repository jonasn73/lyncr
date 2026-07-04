// AI-assisted recovery SMS copy for lost leads (falls back to a template when OpenAI is unavailable).

import type { LostLeadRow } from "@/lib/lost-leads"

function formatPrice(cents: number | null): string {
  if (cents == null || cents <= 0) return "a competitive rate"
  return `$${Math.round(cents / 100)}`
}

function vehicleLabel(row: LostLeadRow): string {
  const parts = [row.vehicle_year, row.vehicle_make, row.vehicle_model].filter(Boolean)
  return parts.length ? parts.join(" ") : "your vehicle"
}

/** Deterministic fallback when OPENAI_API_KEY is not configured. */
export function buildLostLeadRecoverySmsTemplate(row: LostLeadRow): string {
  const price = formatPrice(row.last_quoted_price_cents)
  const vehicle = vehicleLabel(row)
  const service = row.service_type?.trim() || "locksmith service"
  return (
    `Hi — sorry we missed you on ${service} for ${vehicle}. ` +
    `We can still help today starting around ${price}. Reply YES for a quick callback or call us back anytime.`
  ).slice(0, 320)
}

/** Optional OpenAI personalization; returns template on any failure. */
export async function generateLostLeadRecoverySms(row: LostLeadRow): Promise<string> {
  const template = buildLostLeadRecoverySmsTemplate(row)
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) return template

  const prompt = [
    "Write one short SMS (max 300 chars) to win back a locksmith customer who declined price or hung up.",
    "Tone: friendly, local business, no emojis, include a soft discount or callback offer.",
    `Quoted price: ${formatPrice(row.last_quoted_price_cents)}`,
    `Service: ${row.service_type ?? "locksmith"}`,
    `Vehicle: ${vehicleLabel(row)}`,
    `Failure reason: ${row.failure_reason}`,
  ].join("\n")

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        max_tokens: 120,
        messages: [
          { role: "system", content: "You write concise US SMS for a mobile locksmith." },
          { role: "user", content: prompt },
        ],
      }),
    })
    if (!res.ok) return template
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    const text = json.choices?.[0]?.message?.content?.trim()
    if (!text) return template
    return text.slice(0, 320)
  } catch {
    return template
  }
}
