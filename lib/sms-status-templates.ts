// Defaults + helpers for owner-editable field status SMS (late, arrived, paused).

import type { OwnerSmsStatusTemplates } from "@/lib/types"

/** Replace {{tag}} tokens (same rules as the SMS automation engine). */
function renderTemplate(template: string, vars: Record<string, string>): string {
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(vars)) lower[k.toLowerCase()] = v
  return template
    .replace(/\{\{\s*([\w]+)\s*\}\}/g, (_m, key: string) => lower[key.toLowerCase()] ?? "")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}

export const DEFAULT_SMS_STATUS_TEMPLATES: Required<OwnerSmsStatusTemplates> = {
  late: "Hi {{customer_name}}, running about {{eta_minutes}} minutes late — on my way. Sorry for the wait! — {{business_name}}",
  arrived: "Hi {{customer_name}}, {{business_name}} is on site and starting work now.",
  paused_wait:
    "Hi {{customer_name}}, we've stepped away briefly and will be back shortly to finish your job. — {{business_name}}",
  paused_parts:
    "Hi {{customer_name}}, we need a part to finish and will follow up as soon as it's ready. Thanks for your patience. — {{business_name}}",
}

export const SMS_STATUS_TEMPLATE_META: {
  key: keyof OwnerSmsStatusTemplates
  title: string
  description: string
}[] = [
  {
    key: "late",
    title: "Running late",
    description: "Sent when you tap Running late in the text composer (uses {{eta_minutes}}).",
  },
  {
    key: "arrived",
    title: "I'm here / on site",
    description: "Sent when job status moves to Arrived / I'm here.",
  },
  {
    key: "paused_wait",
    title: "Paused — will return",
    description: "Sent when you mark Paused / wait (stepped away, coming back).",
  },
  {
    key: "paused_parts",
    title: "Leaving — back later / parts",
    description: "Sent when you can't finish today (parts or come back later).",
  },
]

/** Merge saved JSON with defaults (empty strings fall back to default). */
export function normalizeSmsStatusTemplates(raw: unknown): OwnerSmsStatusTemplates {
  const obj =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const pick = (key: keyof OwnerSmsStatusTemplates): string => {
    const v = obj[key]
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 480)
    return DEFAULT_SMS_STATUS_TEMPLATES[key]
  }
  return {
    late: pick("late"),
    arrived: pick("arrived"),
    paused_wait: pick("paused_wait"),
    paused_parts: pick("paused_parts"),
  }
}

/** Fill tags for a status template (eta optional). */
export function renderStatusSms(
  template: string,
  vars: {
    customer_name?: string | null
    business_name?: string | null
    tech_name?: string | null
    eta_minutes?: number | string | null
    review_url?: string | null
    time_slot?: string | null
  }
): string {
  const etaRaw = vars.eta_minutes
  const eta =
    etaRaw == null || etaRaw === ""
      ? "15"
      : String(Math.max(1, Math.min(180, Math.round(Number(etaRaw)) || 15)))
  return renderTemplate(template || DEFAULT_SMS_STATUS_TEMPLATES.late, {
    customer_name: vars.customer_name?.trim() || "there",
    business_name: vars.business_name?.trim() || "us",
    tech_name: vars.tech_name?.trim() || "your technician",
    eta_minutes: eta,
    review_url: vars.review_url?.trim() || "",
    time_slot: vars.time_slot?.trim() || "",
  })
}
