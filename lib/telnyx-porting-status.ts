// ============================================
// Telnyx port-in status — merge order + per-number fields
// ============================================
// The list endpoint can return `porting_order_status: draft` while nested `phone_numbers[]`
// or a GET /porting_orders/{id} response shows `exception` / `cancelled`. We merge all
// signals and pick the highest-priority status.

export const PORTING_STATUS_LABELS: Record<string, string> = {
  draft: "Processing",
  "in-process": "Transfer in progress",
  submitted: "Transfer in progress",
  exception: "Rejected or action needed",
  ported: "Completed",
  cancelled: "Cancelled",
  canceled: "Cancelled",
  "cancel-pending": "Cancellation pending",
  "port-activating": "Activating",
  "foc-date-confirmed": "Port date confirmed",
  "activation-in-progress": "Activating on network",
  "foc-date-confirmed-pending": "Confirming port date",
  rejected: "Rejected by carrier",
  failed: "Transfer failed",
}

/** Higher = further along / more final (draft must stay lowest among terminal outcomes). */
export const PORTING_STATUS_PRIORITY: Record<string, number> = {
  ported: 100,
  "port-activating": 85,
  "activation-in-progress": 83,
  "foc-date-confirmed": 78,
  "in-process": 70,
  submitted: 65,
  exception: 55,
  rejected: 52,
  cancelled: 50,
  canceled: 50,
  "cancel-pending": 45,
  failed: 48,
  draft: 10,
}

const DEFAULT_PRIORITY_UNKNOWN = 30

/** Normalize Telnyx spelling / casing so we map labels consistently. */
export function normalizeTelnyxPortStatus(raw: string): string {
  const s = raw.toLowerCase().trim().replace(/_/g, "-")
  if (s === "canceled") return "cancelled"
  return s
}

/**
 * Collect every status string Telnyx might send on the order or on nested phone rows.
 */
export function collectPortingStatuses(order: Record<string, unknown>): string[] {
  const out: string[] = []
  const push = (v: unknown) => {
    if (v == null || v === "") return
    if (typeof v === "string") out.push(normalizeTelnyxPortStatus(v))
  }
  const pos = order.porting_order_status
  if (pos && typeof pos === "object" && !Array.isArray(pos)) {
    const row = pos as Record<string, unknown>
    push(row.value)
    push(row.status)
  } else {
    push(pos)
  }
  push(order.status)
  const phones = order.phone_numbers
  if (Array.isArray(phones)) {
    for (const p of phones) {
      if (!p || typeof p !== "object") continue
      const po = p as Record<string, unknown>
      for (const k of [
        "porting_phone_number_status",
        "status",
        "voice_port_status",
        "phone_number_port_status",
        "porting_status",
        "messaging_port_status",
        "port_status",
      ]) {
        push(po[k])
      }
      // Telnyx field names evolve — pick up any *status* string on the nested object.
      for (const [k, v] of Object.entries(po)) {
        if (typeof v === "string" && v.length < 120 && /status/i.test(k) && !k.includes("callback")) {
          push(v)
        }
      }
    }
  }
  return [...new Set(out)]
}

export function pickBestPortingStatus(statuses: string[]): string {
  if (statuses.length === 0) return "draft"
  let best = statuses[0]
  let bestPri = PORTING_STATUS_PRIORITY[best] ?? DEFAULT_PRIORITY_UNKNOWN
  for (const s of statuses.slice(1)) {
    const p = PORTING_STATUS_PRIORITY[s] ?? DEFAULT_PRIORITY_UNKNOWN
    if (p > bestPri) {
      bestPri = p
      best = s
    }
  }
  return best
}

export function labelForPortingStatus(status: string): string {
  return PORTING_STATUS_LABELS[status] || status.replace(/-/g, " ")
}
