"use client"

import { useCallback, useEffect, useState } from "react"
import { MessageSquareWarning, X } from "lucide-react"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { openCarrierRegistrationModal } from "@/lib/settings-modals-events"
import { readActiveOrganizationId } from "@/lib/workspace-organizations"

type BannerView = {
  sms_ready?: boolean
  pending_approval?: boolean
  organization_status?: string
  registration?: { status?: string } | null
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

export function SmsAlertBanner() {
  const { activeOrganizationId } = useDashboardWorkspace()
  const [view, setView] = useState<BannerView | null>(null)
  const [dismissed, setDismissed] = useState(true)

  const loadCompliance = useCallback(async (organizationId: string | null) => {
    const dismissKey = dismissStorageKey(organizationId)
    if (typeof window !== "undefined") {
      setDismissed(window.localStorage.getItem(dismissKey) === "1")
    }

    try {
      const res = await fetch(build10DlcUrl(organizationId), { credentials: "include" })
      const json = res.ok ? await res.json() : null
      if (json?.data) setView(json.data as BannerView)
      else setView(null)
    } catch {
      setView(null)
    }
  }, [])

  useEffect(() => {
    void loadCompliance(activeOrganizationId)
  }, [activeOrganizationId, loadCompliance])

  useEffect(() => {
    const onOrgChanged = () => {
      void loadCompliance(readActiveOrganizationId())
    }
    window.addEventListener("lyncr-organization-changed", onOrgChanged)
    return () => window.removeEventListener("lyncr-organization-changed", onOrgChanged)
  }, [loadCompliance])

  if (!view || view.sms_ready) return null

  const regStatus = view.registration?.status ?? ""
  const orgPending = view.organization_status === "PENDING_APPROVAL"
  const isPending =
    view.pending_approval === true ||
    orgPending ||
    regStatus === "PENDING_APPROVAL" ||
    ["paid", "submitted", "pending_review"].includes(regStatus)
  const needsAttention = regStatus === "REJECTED" || view.organization_status === "REJECTED"

  if (isPending && dismissed && !needsAttention) return null

  const dismiss = () => {
    setDismissed(true)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(dismissStorageKey(activeOrganizationId), "1")
    }
  }

  const tone = needsAttention
    ? "border-red-500/30 bg-red-500/10 text-red-100"
    : isPending
      ? "border-amber-500/30 bg-amber-500/10 text-amber-100"
      : "border-violet-500/30 bg-violet-500/10 text-violet-100"

  const message = needsAttention
    ? "Your SMS registration needs attention — lead-alert texts can't send until it's resolved."
    : isPending
      ? "⏳ Your SMS business registration is currently undergoing carrier review. Alerts will unlock shortly."
      : "Heads up: SMS lead alerts won't reach your phone until you register your business (one-time carrier requirement)."

  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${tone}`}>
      <MessageSquareWarning className="h-5 w-5 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 text-sm">{message}</p>
      <button
        type="button"
        onClick={openCarrierRegistrationModal}
        className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20"
      >
        {needsAttention ? "Fix registration →" : isPending ? "View status →" : "Set up SMS →"}
      </button>
      {isPending && !needsAttention ? (
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="rounded-md p-1 text-current/70 hover:bg-white/10"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </div>
  )
}

export const Sms10DlcNudgeBanner = SmsAlertBanner
