"use client"

// Permanent lifecycle banner for in-flight number transfers (all non-completed orders).

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Truck } from "lucide-react"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { requestOpenPortingInteractionDrawer } from "@/components/dashboard/porting-interaction-context"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import {
  getPortingBannerPhase,
  isActivePortingOrder,
  portingBannerMessage,
  sortPortingOrdersForBanner,
  type PortingBannerPhase,
} from "@/lib/porting-lifecycle"
import { organizationQueryString } from "@/lib/workspace-organizations"
import type { PortingOrder } from "@/lib/types"
import { cn } from "@/lib/utils"

type PortingOrderRow = PortingOrder & { unread_notification_count?: number }

async function fetchActivePortingOrders(organizationId: string | null): Promise<PortingOrderRow[]> {
  const orgQs = organizationQueryString(organizationId)
  const sep = orgQs ? "&" : "?"
  const res = await fetch(`/api/porting/orders${orgQs}${sep}active=1`, { credentials: "include" })
  if (!res.ok) return []
  const json = (await res.json().catch(() => ({}))) as { data?: { orders?: PortingOrderRow[] } }
  const orders = Array.isArray(json.data?.orders) ? json.data.orders : []
  return orders.filter(isActivePortingOrder)
}

function bannerTone(phase: PortingBannerPhase): string {
  if (phase === "rejected") {
    return "border-red-500/40 bg-gradient-to-r from-red-950/95 via-red-900/90 to-red-950/85 text-red-50"
  }
  if (phase === "action_needed") {
    return "border-amber-500/40 bg-gradient-to-r from-amber-950/95 via-orange-900/85 to-amber-950/80 text-amber-50"
  }
  return "border-sky-500/30 bg-gradient-to-r from-slate-900/95 via-sky-950/80 to-slate-900/90 text-sky-50"
}

function buildDisplayMessage(order: PortingOrderRow, phase: PortingBannerPhase): string {
  const phone = formatPhoneDisplay(order.phone_number)
  if (phase === "rejected") {
    return `❌ Transfer Overdue/Rejected: Click to fix credentials and resubmit.`
  }
  if (phase === "action_needed") {
    return `⚠️ Telnyx Response Needed: Telnyx has requested information for ${phone} to avoid carrier rejection. Click to view message.`
  }
  return `🚚 Number Transfer in Progress: ${phone} is transferring onto Lyncr. Tracking status...`
}

export function PortingStatusBanner() {
  const { activeOrganizationId } = useDashboardWorkspace()
  const [orders, setOrders] = useState<PortingOrderRow[]>([])

  const refresh = useCallback(async () => {
    try {
      const rows = await fetchActivePortingOrders(activeOrganizationId)
      const unreadMap: Record<string, number> = {}
      for (const o of rows) {
        const id = o.telnyx_order_id?.trim()
        if (id) unreadMap[id] = o.unread_notification_count ?? 0
      }
      setOrders(sortPortingOrdersForBanner(rows, unreadMap))
    } catch {
      setOrders([])
    }
  }, [activeOrganizationId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const onChanged = () => void refresh()
    window.addEventListener("lyncr-organization-changed", onChanged)
    window.addEventListener("lyncr-workspace-data-changed", onChanged)
    window.addEventListener("zing-porting-orders-changed", onChanged)
    return () => {
      window.removeEventListener("lyncr-organization-changed", onChanged)
      window.removeEventListener("lyncr-workspace-data-changed", onChanged)
      window.removeEventListener("zing-porting-orders-changed", onChanged)
    }
  }, [refresh])

  if (orders.length === 0) return null

  const primary = orders[0]
  const unread = primary.unread_notification_count ?? 0
  const phase = getPortingBannerPhase(primary, unread)
  const extraCount = orders.length - 1
  const Icon = phase === "in_progress" ? Truck : AlertTriangle

  return (
    <button
      type="button"
      onClick={() => requestOpenPortingInteractionDrawer(primary.id)}
      className={cn(
        "group -mx-5 mb-5 flex w-[calc(100%+2.5rem)] cursor-pointer items-start gap-3 border-b px-5 py-3.5 text-left shadow-lg transition-opacity hover:opacity-95 sm:-mx-8 sm:w-[calc(100%+4rem)] sm:px-8",
        bannerTone(phase)
      )}
      aria-label="Open number transfer tracking desk"
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0 opacity-90" aria-hidden />
      <span className="min-w-0 flex-1 text-sm font-medium leading-snug">
        {buildDisplayMessage(primary, phase)}
        {extraCount > 0 ? (
          <span className="mt-1 block text-xs font-normal opacity-80">
            +{extraCount} more active transfer{extraCount === 1 ? "" : "s"} in this workspace
          </span>
        ) : null}
      </span>
      <span className="hidden shrink-0 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-bold uppercase tracking-wide group-hover:bg-white/15 sm:inline">
        {phase === "rejected" ? "Fix & resubmit →" : phase === "action_needed" ? "View message →" : "Track transfer →"}
      </span>
    </button>
  )
}
