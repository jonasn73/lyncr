// Unified Lines "Who Answers" mode — single active_routing_mode string.

export type ActiveRoutingMode =
  | "your_phone"
  | "smart_ivr"
  | "lyncr_pool"
  | "custom_routing"

export const ACTIVE_ROUTING_MODE_OPTIONS: {
  value: ActiveRoutingMode
  label: string
  description: string
}[] = [
  {
    value: "your_phone",
    label: "Your Phone",
    description: "Ring your cell first. Configure backup ring delay below.",
  },
  {
    value: "smart_ivr",
    label: "Smart IVR Menu",
    description: "Off-duty keypad menu answers with greeting + press 1 / 2.",
  },
  {
    value: "lyncr_pool",
    label: "Lyncr Pool",
    description: "Shared certified operators answer in-browser.",
  },
  {
    value: "custom_routing",
    label: "Custom Routing",
    description: "Forward every inbound call to a specific 10-digit number.",
  },
]

export function normalizeActiveRoutingMode(raw: unknown): ActiveRoutingMode {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : ""
  if (v === "your_phone" || v === "owner" || v === "phone") return "your_phone"
  if (v === "smart_ivr" || v === "ivr" || v === "smart_overflow") return "smart_ivr"
  if (v === "lyncr_pool" || v === "pool" || v === "lyncr_only") return "lyncr_pool"
  if (v === "custom_routing" || v === "custom") return "custom_routing"
  return "your_phone"
}

/** Infer mode from legacy columns when active_routing_mode is unset. */
export function inferActiveRoutingMode(row: {
  active_routing_mode?: string | null
  ivr_menu_enabled?: boolean | null
  routing_strategy?: string | null
  custom_routing_phone?: string | null
  selected_receptionist_id?: string | null
}): ActiveRoutingMode {
  if (row.active_routing_mode) return normalizeActiveRoutingMode(row.active_routing_mode)
  if (row.ivr_menu_enabled === true) return "smart_ivr"
  if (row.routing_strategy === "lyncr_only") return "lyncr_pool"
  if (row.custom_routing_phone?.trim()) return "custom_routing"
  return "your_phone"
}

/** Digits-only US phone → E.164, or null if invalid. */
export function normalizeCustomRoutingPhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, "")
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  if (raw.trim().startsWith("+") && digits.length >= 10) return `+${digits}`
  return null
}
