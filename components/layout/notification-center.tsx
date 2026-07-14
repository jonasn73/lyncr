"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  Bell,
  Loader2,
  MessageSquare,
  MessageSquareWarning,
  ShieldAlert,
  Truck,
  type LucideIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { useDashboardActivationOptional } from "@/components/dashboard-activation-context"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { requestOpenPortingInteractionDrawer } from "@/components/dashboard/porting-interaction-context"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import {
  getPortingBannerPhase,
  isActivePortingOrder,
  sortPortingOrdersForBanner,
  type PortingBannerPhase,
} from "@/lib/porting-lifecycle"
import { orderPinSavedAwaitingCarrierReview, orderRequiresPinCorrection } from "@/lib/porting-pin-correction"
import { storedPortingPinForDesk } from "@/lib/porting-desk-validation"
import {
  CARRIER_REGISTRATION_UPDATED_EVENT,
  openCarrierRegistrationModal,
} from "@/lib/settings-modals-events"
import {
  fetchSmsComplianceView,
  resolveSmsNoticeState,
  smsDismissStorageKey,
  smsNoticeMessage,
  type SmsComplianceView,
} from "@/lib/sms-registration-notice"
import { organizationQueryString, readActiveOrganizationId } from "@/lib/workspace-organizations"
import { displayPortingMessageBody } from "@/lib/porting-display"
import {
  readNotificationPortingCache,
  writeNotificationPortingCache,
} from "@/lib/notification-porting-cache"
import { getPusherClient } from "@/lib/realtime/pusher-client"
import type { PortingNotificationEnriched, PortingOrder } from "@/lib/types"

type NotificationTone = "critical" | "warning" | "info" | "success"

type NotificationCenterItem = {
  id: string
  tone: NotificationTone
  icon: LucideIcon
  title: string
  message: string
  actionLabel?: string
  onAction?: () => void
  priority: number
}

type PortingOrderRow = PortingOrder & { unread_notification_count?: number }

function portingMessage(
  order: PortingOrderRow,
  phase: PortingBannerPhase,
  unread: number,
  latestAlertBody?: string | null
): string {
  const phone = formatPhoneDisplay(order.phone_number)
  if (unread > 0) {
    const excerpt = latestAlertBody?.trim()
      ? displayPortingMessageBody(latestAlertBody).slice(0, 160)
      : null
    if (excerpt) {
      return unread === 1
        ? `New carrier update for ${phone}: ${excerpt}`
        : `${unread} new carrier updates for ${phone}. Latest: ${excerpt}`
    }
    return `${unread} new carrier update${unread === 1 ? "" : "s"} for ${phone} — open the transfer desk.`
  }
  if (orderPinSavedAwaitingCarrierReview(order) && storedPortingPinForDesk(order)) {
    return `PIN submitted for ${phone} — carrier is re-reviewing your transfer.`
  }
  if (orderRequiresPinCorrection(order)) {
    return `PIN required for ${phone} — open the transfer desk to resubmit.`
  }
  if (phase === "rejected") {
    return `Transfer rejected for ${phone} — fix credentials and resubmit.`
  }
  if (phase === "action_needed") {
    return `Carrier needs information for ${phone}.`
  }
  return `Number transfer in progress for ${phone}.`
}

function portingPriority(phase: PortingBannerPhase): number {
  if (phase === "rejected") return 90
  if (phase === "action_needed") return 80
  return 50
}

async function fetchActivePortingOrders(organizationId: string | null): Promise<PortingOrderRow[]> {
  const orgId = organizationId ?? readActiveOrganizationId()
  const orgQs = organizationQueryString(orgId)
  const sep = orgQs ? "&" : "?"
  const res = await fetch(`/api/porting/orders${orgQs}${sep}active=1`, { credentials: "include" })
  if (!res.ok) return []
  const json = (await res.json().catch(() => ({}))) as { data?: { orders?: PortingOrderRow[] } }
  const orders = Array.isArray(json.data?.orders) ? json.data.orders : []
  const scoped =
    orgId && !orgId.startsWith("legacy-")
      ? orders.filter((o) => (o.organization_id ?? null) === orgId)
      : orders
  return scoped.filter(isActivePortingOrder)
}

async function fetchUnreadPortingAlerts(
  organizationId: string | null,
  syncFromTelnyx: boolean
): Promise<PortingNotificationEnriched[]> {
  const params = new URLSearchParams()
  params.set("unread", "1")
  if (syncFromTelnyx) params.set("sync", "1")
  const orgId = organizationId?.trim()
  if (orgId && !orgId.startsWith("legacy-")) params.set("organization_id", orgId)
  const res = await fetch(`/api/notifications/porting?${params.toString()}`, {
    credentials: "include",
    cache: "no-store",
  })
  if (!res.ok) return []
  const json = (await res.json().catch(() => ({}))) as {
    data?: { notifications?: PortingNotificationEnriched[] }
  }
  return Array.isArray(json.data?.notifications) ? json.data.notifications : []
}

function clipAlertBody(body: string, max = 160): string {
  const text = displayPortingMessageBody(body).trim()
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

function toneClasses(tone: NotificationTone): string {
  if (tone === "critical") return "border-red-500/35 bg-red-500/10"
  if (tone === "warning") return "border-amber-500/35 bg-amber-500/10"
  if (tone === "success") return "border-emerald-500/35 bg-emerald-500/10"
  return "border-sky-500/35 bg-sky-500/10"
}

export const NotificationCenter = memo(function NotificationCenter() {
  const { activeOrganizationId } = useDashboardWorkspace()
  const activation = useDashboardActivationOptional()
  const [open, setOpen] = useState(false)
  const [impersonating, setImpersonating] = useState(false)
  const [viewingEmail, setViewingEmail] = useState<string | null>(null)
  const [exitingImpersonation, setExitingImpersonation] = useState(false)
  const cachedPorting = useMemo(
    () => readNotificationPortingCache(activeOrganizationId),
    [activeOrganizationId]
  )
  const [portingOrders, setPortingOrders] = useState<PortingOrderRow[]>(
    () => cachedPorting?.portingOrders ?? []
  )
  const [unreadPortingAlerts, setUnreadPortingAlerts] = useState<PortingNotificationEnriched[]>(
    () => cachedPorting?.unreadPortingAlerts ?? []
  )
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null)
  const [smsView, setSmsView] = useState<SmsComplianceView | null>(null)
  const [smsDismissed, setSmsDismissed] = useState(true)

  const loadSession = useCallback(() => {
    fetch("/api/auth/session", { credentials: "include" })
      .then(async (res) => (res.ok ? res.json() : null))
      .then((data) => {
        const imp = data?.data?.impersonation as { active?: boolean } | undefined
        setImpersonating(Boolean(imp?.active))
        setViewingEmail((data?.data?.user?.email as string | undefined) ?? null)
        setOwnerUserId((data?.data?.user?.id as string | undefined) ?? null)
      })
      .catch(() => setImpersonating(false))
  }, [])

  const refreshPorting = useCallback(async (syncFromTelnyx = false) => {
    const orgId = readActiveOrganizationId() ?? activeOrganizationId
    try {
      const [rows, alerts] = await Promise.all([
        fetchActivePortingOrders(orgId),
        fetchUnreadPortingAlerts(orgId, syncFromTelnyx),
      ])
      const unreadMap: Record<string, number> = {}
      for (const o of rows) {
        const id = o.telnyx_order_id?.trim()
        if (id) unreadMap[id] = o.unread_notification_count ?? 0
      }
      setUnreadPortingAlerts(alerts)
      setPortingOrders(sortPortingOrdersForBanner(rows, unreadMap))
      writeNotificationPortingCache(orgId, {
        portingOrders: sortPortingOrdersForBanner(rows, unreadMap),
        unreadPortingAlerts: alerts,
      })
    } catch {
      /* Keep last cached porting rows on transient errors — avoids badge pop-in. */
    }
  }, [activeOrganizationId])

  useEffect(() => {
    const snap = readNotificationPortingCache(activeOrganizationId)
    if (snap) {
      setPortingOrders(snap.portingOrders)
      setUnreadPortingAlerts(snap.unreadPortingAlerts)
    } else {
      setPortingOrders([])
      setUnreadPortingAlerts([])
    }
  }, [activeOrganizationId])

  const loadSms = useCallback(async (organizationId: string | null) => {
    const dismissKey = smsDismissStorageKey(organizationId)
    if (typeof window !== "undefined") {
      setSmsDismissed(window.localStorage.getItem(dismissKey) === "1")
    }
    const view = await fetchSmsComplianceView(organizationId)
    setSmsView(view)
    if (view && resolveSmsNoticeState(view) === "rejected" && typeof window !== "undefined") {
      window.localStorage.removeItem(dismissKey)
      setSmsDismissed(false)
    }
  }, [])

  useEffect(() => {
    loadSession()
    void refreshPorting()
    void loadSms(activeOrganizationId)
  }, [loadSession, refreshPorting, loadSms, activeOrganizationId])

  useEffect(() => {
    if (!open) return
    void loadSms(readActiveOrganizationId() ?? activeOrganizationId)
    void refreshPorting(true)
  }, [open, loadSms, activeOrganizationId, refreshPorting])

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshPorting(true)
    }, 60_000)
    return () => window.clearInterval(interval)
  }, [refreshPorting])

  useEffect(() => {
    if (!ownerUserId) return
    const pusher = getPusherClient()
    if (!pusher) return

    const channel = pusher.subscribe(`owner-${ownerUserId}`)
    const onPortingUpdate = (payload: { organization_id?: string | null }) => {
      const orgId = readActiveOrganizationId() ?? activeOrganizationId
      if (
        orgId &&
        !orgId.startsWith("legacy-") &&
        payload.organization_id &&
        payload.organization_id !== orgId
      ) {
        return
      }
      void refreshPorting(true)
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("zing-business-numbers-changed"))
      }
    }

    channel.bind("porting-update", onPortingUpdate)
    return () => {
      channel.unbind("porting-update", onPortingUpdate)
      pusher.unsubscribe(`owner-${ownerUserId}`)
    }
  }, [ownerUserId, activeOrganizationId, refreshPorting])

  useEffect(() => {
    const onChanged = () => {
      void refreshPorting()
      void loadSms(readActiveOrganizationId())
    }
    window.addEventListener("lyncr-organization-changed", onChanged)
    window.addEventListener("lyncr-workspace-data-changed", onChanged)
    window.addEventListener("zing-porting-orders-changed", onChanged)
    window.addEventListener(CARRIER_REGISTRATION_UPDATED_EVENT, onChanged)
    return () => {
      window.removeEventListener("lyncr-organization-changed", onChanged)
      window.removeEventListener("lyncr-workspace-data-changed", onChanged)
      window.removeEventListener("zing-porting-orders-changed", onChanged)
      window.removeEventListener(CARRIER_REGISTRATION_UPDATED_EVENT, onChanged)
    }
  }, [refreshPorting, loadSms])

  async function exitImpersonation() {
    setExitingImpersonation(true)
    try {
      const res = await fetch("/api/admin/impersonate/exit", { method: "POST", credentials: "include" })
      const json = (await res.json().catch(() => ({}))) as { error?: string; data?: { redirect?: string } }
      if (!res.ok) throw new Error(json.error || "Could not exit impersonation")
      window.location.href = json.data?.redirect ?? "/admin"
    } catch {
      setExitingImpersonation(false)
    }
  }

  const items = useMemo(() => {
    const list: NotificationCenterItem[] = []

    if (impersonating) {
      list.push({
        id: "impersonation",
        tone: "critical",
        icon: ShieldAlert,
        title: "Admin impersonation active",
        message: viewingEmail
          ? `You are viewing ${viewingEmail}. Changes apply to this customer account.`
          : "You are viewing a customer workspace.",
        actionLabel: exitingImpersonation ? "Exiting…" : "Exit impersonation",
        onAction: () => void exitImpersonation(),
        priority: 100,
      })
    }

    if (activation && !activation.loading && activation.showProvisioningBanner) {
      list.push({
        id: "provisioning",
        tone: "warning",
        icon: Loader2,
        title: "Line provisioning",
        message:
          "Payment received — your line is not live yet. Add carrier credit on Pay if provisioning has not started.",
        actionLabel: activation.activating ? "Retrying…" : "Retry provisioning",
        onAction: () => void activation.requestLineActivation(),
        priority: 70,
      })
    } else if (activation && !activation.loading && activation.showTrialBanner) {
      list.push({
        id: "sandbox",
        tone: "warning",
        icon: AlertTriangle,
        title: "Sandbox mode",
        message: "Incoming calls will not route to live phones until your line is fully verified.",
        actionLabel: activation.activating ? "Activating…" : "Activate line",
        onAction: () => void activation.requestLineActivation(),
        priority: 65,
      })
    }

    for (const alert of unreadPortingAlerts) {
      const phone = alert.phone_number ? formatPhoneDisplay(alert.phone_number) : "your line"
      const deskOrderId = alert.workspace_port_order_id
      list.push({
        id: `port-alert-${alert.id}`,
        tone: "warning",
        icon: MessageSquare,
        title: alert.title?.trim() || "New carrier update",
        message: `${phone} — ${clipAlertBody(alert.body)}`,
        actionLabel: "Open transfer desk",
        onAction: () => {
          setOpen(false)
          if (deskOrderId) requestOpenPortingInteractionDrawer(deskOrderId)
        },
        priority: 92,
      })
    }

    const ordersWithUnreadAlerts = new Set(
      unreadPortingAlerts
        .map((a) => a.workspace_port_order_id?.trim())
        .filter(Boolean) as string[]
    )

    for (const order of portingOrders) {
      if (ordersWithUnreadAlerts.has(order.id)) continue
      const unread = order.unread_notification_count ?? 0
      const phase = getPortingBannerPhase(order, unread)
      list.push({
        id: `port-${order.id}`,
        tone: phase === "rejected" ? "critical" : phase === "action_needed" ? "warning" : "info",
        icon: phase === "in_progress" ? Truck : AlertTriangle,
        title: "Number transfer",
        message: portingMessage(order, phase, unread),
        actionLabel: "Open transfer desk",
        onAction: () => {
          setOpen(false)
          requestOpenPortingInteractionDrawer(order.id)
        },
        priority: portingPriority(phase),
      })
    }

    if (smsView && !smsView.sms_ready) {
      const smsState = resolveSmsNoticeState(smsView)
      const isPending = smsState === "pending"
      const needsAttention = smsState === "rejected"

      if (!(isPending && smsDismissed && !needsAttention)) {
        list.push({
          id: "sms-10dlc",
          tone: needsAttention ? "critical" : isPending ? "warning" : "info",
          icon: MessageSquareWarning,
          title: needsAttention ? "SMS registration failed" : "SMS registration",
          message: smsNoticeMessage(smsView, smsState),
          actionLabel: needsAttention ? "Fix registration" : isPending ? "View status" : "Set up SMS",
          onAction: () => {
            setOpen(false)
            requestAnimationFrame(() => {
              openCarrierRegistrationModal({ edit: needsAttention })
            })
          },
          priority: needsAttention ? 85 : isPending ? 45 : 40,
        })
      }
    }

    return list.sort((a, b) => b.priority - a.priority)
  }, [
    impersonating,
    viewingEmail,
    exitingImpersonation,
    activation,
    portingOrders,
    unreadPortingAlerts,
    smsView,
    smsDismissed,
  ])

  const dismissSmsPending = () => {
    setSmsDismissed(true)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(smsDismissStorageKey(activeOrganizationId), "1")
    }
  }

  const triggerRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // Explicit outside-click close — reliable on mobile when overlays / map chrome compete with Radix.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (triggerRef.current?.contains(target)) return
      if (contentRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    return () => document.removeEventListener("pointerdown", onPointerDown, true)
  }, [open])

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="icon"
          className="relative h-11 w-11 shrink-0 text-muted-foreground hover:text-foreground sm:h-9 sm:w-9"
          aria-label={items.length > 0 ? `${items.length} notifications` : "Notifications"}
          aria-expanded={open}
          aria-haspopup="dialog"
          title="Notifications"
        >
          <Bell className="h-5 w-5" />
          {items.length > 0 ? (
            <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
              {items.length > 9 ? "9+" : items.length}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        align="end"
        sideOffset={8}
        // Sit above Leaflet panes / map chrome (z-index ~400–2000) and shell chrome.
        className="z-[9999] w-[min(92vw,22rem)] p-0"
        motion="fade"
        onPointerDownOutside={() => setOpen(false)}
        onInteractOutside={() => setOpen(false)}
        onEscapeKeyDown={() => setOpen(false)}
      >
        <div className="border-b border-border/60 px-4 py-3">
          <p className="text-sm font-semibold text-foreground">Notifications</p>
          <p className="text-xs text-muted-foreground">
            {items.length === 0 ? "You're all caught up." : `${items.length} item${items.length === 1 ? "" : "s"} need attention`}
          </p>
        </div>
        <div className="max-h-[min(60vh,24rem)] overflow-y-auto p-2">
          {items.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">No alerts for this workspace.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((item) => {
                const Icon = item.icon
                const isSmsPending = item.id === "sms-10dlc" && item.tone === "warning"
                return (
                  <li
                    key={item.id}
                    className={cn("rounded-xl border px-3 py-3", toneClasses(item.tone))}
                  >
                    <div className="flex items-start gap-2.5">
                      <Icon
                        className={cn(
                          "mt-0.5 h-4 w-4 shrink-0",
                          item.id === "provisioning" && "animate-spin"
                        )}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-foreground">{item.title}</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.message}</p>
                        {item.actionLabel && item.onAction ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={item.id === "impersonation" && exitingImpersonation}
                              onClick={item.onAction}
                              className="rounded-md bg-background/60 px-2.5 py-1 text-[11px] font-semibold text-foreground hover:bg-background/90"
                            >
                              {item.actionLabel}
                            </button>
                            {isSmsPending ? (
                              <button
                                type="button"
                                onClick={dismissSmsPending}
                                className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
                              >
                                Dismiss
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
})
