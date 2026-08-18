// Defaults + helpers for owner-editable field status SMS (late, arrived, paused, check-in).

import { stockOrSaved } from "@/lib/sms-template-defaults"
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
  check_in:
    "Hey {{customer_name}} — just checking in, do you still need help with {{vehicle}}? Text us here for any update or change. — {{business_name}}",
  late: "Hey {{customer_name}} — running about {{eta_minutes}} minutes late. Sorry about that. — {{business_name}}",
  arrived: "Hey {{customer_name}} — I’m here. — {{business_name}}",
  paused_wait:
    "Hey {{customer_name}} — stepped away for a few minutes. I’ll be back to finish. — {{business_name}}",
  paused_parts:
    "Hey {{customer_name}} — need a part to finish. I’ll text you here when I have an update. — {{business_name}}",
}

export const LEGACY_SMS_STATUS_TEMPLATES: Record<keyof OwnerSmsStatusTemplates, readonly string[]> = {
  check_in: [],
  late: [
    "Hi {{customer_name}}, running about {{eta_minutes}} minutes late — on my way. Sorry for the wait! — {{business_name}}",
  ],
  arrived: ["Hi {{customer_name}}, {{business_name}} is on site and starting work now."],
  paused_wait: [
    "Hi {{customer_name}}, we've stepped away briefly and will be back shortly to finish your job. — {{business_name}}",
  ],
  paused_parts: [
    "Hi {{customer_name}}, we need a part to finish and will follow up as soon as it's ready. Thanks for your patience. — {{business_name}}",
  ],
}

/** Chips you tap in Messages. */
export const PRIMARY_SMS_STATUS_KEYS: (keyof OwnerSmsStatusTemplates)[] = [
  "check_in",
  "late",
  "arrived",
]

/** Job-board pause texts — keep editable, hide unless they open More. */
export const EXTRA_SMS_STATUS_KEYS: (keyof OwnerSmsStatusTemplates)[] = [
  "paused_wait",
  "paused_parts",
]

export const SMS_STATUS_TEMPLATE_META: {
  key: keyof OwnerSmsStatusTemplates
  title: string
  description: string
}[] = [
  {
    key: "check_in",
    title: "Status chip",
    description: "Fills Status in Messages (still need help?).",
  },
  {
    key: "late",
    title: "Running late",
    description: "Fills Running late in Messages. Use {{eta_minutes}}.",
  },
  {
    key: "arrived",
    title: "I'm here",
    description: "Fills I’m here in Messages, and when you mark Arrived.",
  },
  {
    key: "paused_wait",
    title: "Paused — back soon",
    description: "Only if you pause a job on the board.",
  },
  {
    key: "paused_parts",
    title: "Need a part",
    description: "Only if you pause a job because you’re waiting on a part.",
  },
]

/** Merge saved JSON with defaults (empty / old built-ins fall back to current stock). */
export function normalizeSmsStatusTemplates(raw: unknown): OwnerSmsStatusTemplates {
  const obj =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const pick = (key: keyof OwnerSmsStatusTemplates): string => {
    const v = obj[key]
    const saved = typeof v === "string" ? v.trim().slice(0, 480) : ""
    return stockOrSaved(saved, DEFAULT_SMS_STATUS_TEMPLATES[key], LEGACY_SMS_STATUS_TEMPLATES[key])
  }
  return {
    check_in: pick("check_in"),
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
    vehicle?: string | null
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
    vehicle: vars.vehicle?.trim() || "that",
  })
}
