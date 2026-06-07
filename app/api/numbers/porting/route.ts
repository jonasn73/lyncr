// ============================================
// GET /api/numbers/porting
// ============================================
// Returns Telnyx port orders with detailed status.
// Deduplicates by phone number — only shows the most recent order per number.
// Also cancels stale drafts to keep things clean.
// When a port completes ("ported"), auto-configures the number with the TeXML
// webhook and adds it to the database so everything works without extra steps.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  getPhoneNumberByNumberAndStatus,
  insertPhoneNumber,
  updatePhoneNumber,
} from "@/lib/db"
import {
  telnyxHeaders,
} from "@/lib/telnyx-config"
import { finalizePortedNumber } from "@/lib/port-number-finalize"
import {
  collectPortingStatuses,
  pickBestPortingStatus,
  labelForPortingStatus,
  PORTING_STATUS_PRIORITY,
} from "@/lib/telnyx-porting-status"

const TELNYX_BASE = "https://api.telnyx.com/v2"

/** Extra GETs when list still looks draft/submitted — detail payload often has the real carrier outcome. */
const MAX_ORDER_DETAIL_FETCH = 12

async function fetchPortingOrderDetail(orderId: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(`${TELNYX_BASE}/porting_orders/${orderId}?include_phone_numbers=true`, {
      headers: telnyxHeaders(),
    })
    if (!r.ok) return null
    const body = await r.json()
    const d = body?.data ?? body
    return d && typeof d === "object" ? (d as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  // Get current user so we can save completed ported numbers to their account
  const userId = getUserIdFromRequest(req.headers.get("cookie"))

  try {
    const res = await fetch(
      `${TELNYX_BASE}/porting_orders?page[size]=50&sort=-created_at&include_phone_numbers=true`,
      { headers: telnyxHeaders() }
    )

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      const errMsg = body?.errors?.[0]?.detail || `HTTP ${res.status}`

      if (res.status === 403 || /feature not permitted|10038/i.test(errMsg)) {
        return NextResponse.json({ porting: [], message: "Porting not available on your current plan." }, { status: 200 })
      }
      throw new Error(errMsg)
    }

    const body = await res.json()
    const rawOrders = (body?.data || []) as Record<string, unknown>[]

    // List response can be stale vs GET /porting_orders/{id} — refresh likely stuck orders.
    const candidatesForDetail = rawOrders
      .filter((o) => {
        const p = pickBestPortingStatus(collectPortingStatuses(o))
        return p === "draft" || p === "submitted"
      })
      .slice(0, MAX_ORDER_DETAIL_FETCH)

    const detailById = new Map<string, Record<string, unknown>>()
    await Promise.all(
      candidatesForDetail.map(async (o) => {
        const id = o.id
        if (typeof id !== "string") return
        const d = await fetchPortingOrderDetail(id)
        if (d) detailById.set(id, d)
      })
    )

    const orders = rawOrders.map((o) => {
      const id = o.id
      if (typeof id === "string" && detailById.has(id)) {
        return detailById.get(id)!
      }
      return o
    })

    const allEntries: { id: string; number: string; status: string; statusLabel: string; createdAt: string; customerRef: string }[] = []
    const staleDraftIds: string[] = []

    for (const order of orders) {
      const id = String(order.id ?? "")
      const statuses = collectPortingStatuses(order)
      const rawStatus = pickBestPortingStatus(statuses)
      const statusLabel = labelForPortingStatus(rawStatus)
      const createdAt = String(order.created_at ?? "")
      const customerRef = String(order.customer_reference ?? "")
      const numbers: { phone_number?: string }[] = (order.phone_numbers as { phone_number?: string }[]) ?? []

      for (const p of numbers) {
        const num = p.phone_number ?? ""
        if (num) allEntries.push({ id, number: num, status: rawStatus, statusLabel, createdAt, customerRef })
      }
    }

    const bestPerNumber = new Map<string, (typeof allEntries)[0]>()
    function priorityOf(status: string): number {
      return PORTING_STATUS_PRIORITY[status] ?? 30
    }
    function pickBetter(a: (typeof allEntries)[0], b: (typeof allEntries)[0]): (typeof allEntries)[0] {
      const pa = priorityOf(a.status)
      const pb = priorityOf(b.status)
      if (pa !== pb) return pa > pb ? a : b
      const ta = new Date(a.createdAt).getTime()
      const tb = new Date(b.createdAt).getTime()
      return ta >= tb ? a : b
    }
    for (const entry of allEntries) {
      const existing = bestPerNumber.get(entry.number)
      if (!existing) {
        bestPerNumber.set(entry.number, entry)
        continue
      }
      const winner = pickBetter(existing, entry)
      bestPerNumber.set(entry.number, winner)
      const loser = winner.id === existing.id ? entry : existing
      if (loser.status === "draft" && loser.id !== winner.id) {
        staleDraftIds.push(loser.id)
      }
    }

    // Delete stale drafts in background
    if (staleDraftIds.length > 0) {
      const uniqueIds = [...new Set(staleDraftIds)]
      console.log(`[Sigo] Deleting ${uniqueIds.length} stale draft port orders`)
      for (const draftId of uniqueIds) {
        fetch(`${TELNYX_BASE}/porting_orders/${draftId}`, {
          method: "DELETE",
          headers: telnyxHeaders(),
        }).catch(() => {})
      }
    }

    // Auto-configure completed ported numbers (runs silently in background)
    const portedNumbers = [...bestPerNumber.values()].filter((e) => e.status === "ported")
    if (portedNumbers.length > 0) {
      // Run in background — don't block the response
      (async () => {
        try {
          for (const entry of portedNumbers) {
            const refUserId = entry.customerRef.startsWith("zing-")
              ? entry.customerRef.slice(5)
              : userId

            if (!refUserId) continue

            const existingActive = await getPhoneNumberByNumberAndStatus(entry.number, "active")
            if (!existingActive) {
              const portingRow = await getPhoneNumberByNumberAndStatus(entry.number, "porting")
              if (portingRow && portingRow.user_id === refUserId) {
                await updatePhoneNumber(portingRow.id, refUserId, { status: "active" })
                console.log(`[Sigo] Ported number ${entry.number} activated from porting row for user ${refUserId}`)
              } else {
                await insertPhoneNumber({
                  user_id: refUserId,
                  number: entry.number,
                  friendly_name: entry.number,
                  label: "Ported Line",
                  type: "local",
                  status: "active",
                  provider_number_sid: entry.id,
                })
                console.log(`[Sigo] Ported number ${entry.number} added to database for user ${refUserId}`)
              }
            }

            await finalizePortedNumber({
              ownerUserId: refUserId,
              phoneNumberE164: entry.number,
              telnyxOrderId: entry.id,
            })
          }
        } catch (err) {
          console.error("[Sigo] Auto-configure ported numbers error:", err)
        }
      })()
    }

    // Show cancelled / rejected rows so users see the real outcome (do not hide them
    // and leave a stale draft as the only visible row).
    const list = [...bestPerNumber.values()].map(({ id, number, status, statusLabel, createdAt }) => ({
      id,
      number,
      status,
      statusLabel,
      createdAt,
    }))

    return NextResponse.json({ porting: list })
  } catch (error: unknown) {
    console.error("[Sigo] Error listing porting orders:", error)
    return NextResponse.json({ error: "Failed to load porting orders" }, { status: 500 })
  }
}
