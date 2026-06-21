"use client"

import { memo, useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  Bell,
  Loader2,
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
import { organizationQueryString, readActiveOrganizationId } from "@/lib/workspace-organizations"
import {
  CARRIER_REGISTRATION_UPDATED_EVENT,
  openCarrierRegistrationModal,
} from "@/lib/settings-modals-events"
import type { PortingOrder } from "@/lib/types"

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

type BannerView = {
  sms_ready?: boolean
  pending_approval?: boolean
  organization_status?: string
  registration?: { status?: string } | null
  legacy_registration?: { status?: string; status_detail?: string | null } | null
  submission_summary?: {
    lifecycle_stage?: string
    telnyx_status?: string | null
    rejection_reason?: string | null
  } | null
}

function truncateNotice(text: string, max = 140): string {
  const t = text.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

/** Match the carrier registration modal — failed/rejected beats generic "pending review". */
function resolveSmsNoticeState(view: BannerView): "ready" | "rejected" | "pending" | "setup" {
  if (view.sms_ready) return "ready"
  const telnyxStatus = (
    view.submission_summary?.telnyx_status ??
    view.legacy_registration?.status ??
    ""
  )
    .trim()
    .toLowerCase()
  const regStatus = view.registration?.status ?? ""
  const orgStatus = view.organization_status ?? ""
  const stage = view.submission_summary?.lifecycle_stage ?? ""

  if (
    stage === "rejected" ||
    regStatus === "REJECTED" ||
    orgStatus === "REJECTED" ||
    telnyxStatus === "failed" ||
    telnyxStatus === "rejected"
  ) {
    return "rejected"
  }

  const isPending =
    view.pending_approval === true ||
    orgStatus === "PENDING_APPROVAL" ||
    regStatus === "PENDING_APPROVAL" ||
    stage === "carrier_review" ||
    ["paid", "submitted", "pending_review"].includes(telnyxStatus)

  if (isPending) return "pending"
  return "setup"
}

function dismissStorageKey(organizationId: string | null): string {
  const orgKey =
    organizationId && !organizationId.startsWith("legacy-") ? organizationId : "default"
  return `lyncr_10dlc_nudge_dismissed_${orgKey}`
}

function build10DlcUrl(organizationId: string | null): string {
  if (organizationId && !organizationId.startsWith("legacy-")) {
    return `/api/settings/10dlc?organization_id=${encodeURIComponent(organizationId)}`
  }
  return "/api/settings/10dlc"
}

function portingMessage(order: PortingOrderRow, phase: PortingBannerPhase): string {
  const phone = formatPhoneDisplay(order.phone_number)
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
  const [portingOrders, setPortingOrders] = useState<PortingOrderRow[]>([])
  const [smsView, setSmsView] = useState<BannerView | null>(null)
  const [smsDismissed, setSmsDismissed] = useState(true)

  const loadSession = useCallback(() => {
    fetch("/api/auth/session", { credentials: "include" })
      .then(async (res) => (res.ok ? res.json() : null))
      .then((data) => {
        const imp = data?.data?.impersonation as { active?: boolean } | undefined
        setImpersonating(Boolean(imp?.active))
        setViewingEmail((data?.data?.user?.email as string | undefined) ?? null)
      })
      .catch(() => setImpersonating(false))
  }, [])

  const refreshPorting = useCallback(async () => {
    const orgId = readActiveOrganizationId() ?? activeOrganizationId
    try {
      const rows = await fetchActivePortingOrders(orgId)
      const unreadMap: Record<string, number> = {}
      for (const o of rows) {
        const id = o.telnyx_order_id?.trim()
        if (id) unreadMap[id] = o.unread_notification_count ?? 0
      }
      setPortingOrders(sortPortingOrdersForBanner(rows, unreadMap))
    } catch {
      setPortingOrders([])
    }
  }, [activeOrganizationId])

  const loadSms = useCallback(async (organizationId: string | null) => {
    const dismissKey = dismissStorageKey(organizationId)
    if (typeof window !== "undefined") {
      setSmsDismissed(window.localStorage.getItem(dismissKey) === "1")
    }
    try {
      const res = await fetch(build10DlcUrl(organizationId), { credentials: "include" })
      const json = res.ok ? await res.json() : null
      setSmsView(json?.data ? (json.data as BannerView) : null)
    } catch {
      setSmsView(null)
    }
  }, [])

  useEffect(() => {
    loadSession()
    void refreshPorting()
    void loadSms(activeOrganizationId)
  }, [loadSession, refreshPorting, loadSms, activeOrganizationId])

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

    for (const order of portingOrders) {
      const unread = order.unread_notification_count ?? 0
      const phase = getPortingBannerPhase(order, unread)
      list.push({
        id: `port-${order.id}`,
        tone: phase === "rejected" ? "critical" : phase === "action_needed" ? "warning" : "info",
        icon: phase === "in_progress" ? Truck : AlertTriangle,
        title: "Number transfer",
        message: portingMessage(order, phase),
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
      const rejectionReason =
        smsView.submission_summary?.rejection_reason?.trim() ||
        smsView.legacy_registration?.status_detail?.trim() ||
        null
      const isPending = smsState === "pending"
      const needsAttention = smsState === "rejected"

      if (!(isPending && smsDismissed && !needsAttention)) {
        list.push({
          id: "sms-10dlc",
          tone: needsAttention ? "critical" : isPending ? "warning" : "info",
          icon: MessageSquareWarning,
          title: needsAttention ? "SMS registration failed" : "SMS registration",
          message: needsAttention
            ? rejectionReason
              ? truncateNotice(`Carrier rejection: ${rejectionReason}`)
              : "Your 10DLC registration failed at the carrier. Update and resubmit to unlock business texts."
            : isPending
              ? "SMS business registration is undergoing carrier review. Alerts will unlock shortly."
              : "Register your business for SMS lead alerts (one-time carrier requirement).",
          actionLabel: needsAttention ? "Fix registration" : isPending ? "View status" : "Set up SMS",
          onAction: () => {
            setOpen(false)
            openCarrierRegistrationModal()
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
    smsView,
    smsDismissed,
  ])

  const dismissSmsPending = () => {
    setSmsDismissed(true)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(dismissStorageKey(activeOrganizationId), "1")
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={items.length > 0 ? `${items.length} notifications` : "Notifications"}
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
      <PopoverContent align="end" sideOffset={8} className="w-[min(92vw,22rem)] p-0" motion="fade">
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
