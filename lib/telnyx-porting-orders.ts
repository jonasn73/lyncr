// ============================================
// Telnyx porting orders — ownership + comments API
// ============================================
// Comments live under GET/POST /v2/porting_orders/{id}/comments (Communications tab in portal).

import { telnyxHeaders } from "@/lib/telnyx-config"

const TELNYX_BASE = "https://api.telnyx.com/v2"

export async function fetchTelnyxPortingOrderById(orderId: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(`${TELNYX_BASE}/porting_orders/${orderId}`, { headers: telnyxHeaders() })
    if (!r.ok) return null
    const body = await r.json()
    const d = body?.data ?? body
    return d && typeof d === "object" ? (d as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Returns user id from `customer_reference: zing-<uuid>` when set by HeySigo (legacy prefix). */
export function portOrderZingUserId(order: Record<string, unknown>): string | null {
  const ref = String(order.customer_reference || "").trim()
  if (!ref.startsWith("zing-")) return null
  const id = ref.slice(5).trim()
  return id.length > 0 ? id : null
}

export async function userOwnsTelnyxPortOrder(orderId: string, userId: string): Promise<boolean> {
  const order = await fetchTelnyxPortingOrderById(orderId)
  if (!order) return false
  return portOrderZingUserId(order) === userId
}

export type TelnyxPortingComment = {
  id: string
  body: string
  user_type: string
  created_at: string
}

export async function listTelnyxPortingOrderComments(orderId: string): Promise<TelnyxPortingComment[]> {
  const r = await fetch(`${TELNYX_BASE}/porting_orders/${orderId}/comments?page[size]=100`, {
    headers: telnyxHeaders(),
  })
  const body = await r.json()
  if (!r.ok) {
    const err =
      body?.errors?.[0]?.detail || body?.errors?.[0]?.title || `Telnyx ${r.status}`
    throw new Error(err)
  }
  const rows = body?.data || []
  return rows.map((c: Record<string, unknown>) => ({
    id: String(c.id ?? ""),
    body: String(c.body ?? ""),
    user_type: String(c.user_type ?? "unknown"),
    created_at: String(c.created_at ?? ""),
  }))
}

export async function createTelnyxPortingOrderComment(orderId: string, text: string): Promise<void> {
  const r = await fetch(`${TELNYX_BASE}/porting_orders/${orderId}/comments`, {
    method: "POST",
    headers: telnyxHeaders(),
    body: JSON.stringify({ body: text }),
  })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) {
    const err =
      body?.errors?.[0]?.detail || body?.errors?.[0]?.title || `Telnyx ${r.status}`
    throw new Error(err)
  }
}
