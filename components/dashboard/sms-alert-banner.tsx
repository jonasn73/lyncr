"use client"

import { useCallback, useEffect, useState } from "react"
import { MessageSquareWarning, X } from "lucide-react"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { openCarrierRegistrationModal } from "@/lib/settings-modals-events"
import {
  fetchSmsComplianceView,
  resolveSmsNoticeState,
  smsDismissStorageKey,
  smsNoticeMessage,
  type SmsComplianceView,
} from "@/lib/sms-registration-notice"
import { readActiveOrganizationId } from "@/lib/workspace-organizations"

export function SmsAlertBanner() {
  const { activeOrganizationId } = useDashboardWorkspace()
  const [view, setView] = useState<SmsComplianceView | null>(null)
  const [dismissed, setDismissed] = useState(true)

  const loadCompliance = useCallback(async (organizationId: string | null) => {
    const dismissKey = smsDismissStorageKey(organizationId)
    if (typeof window !== "undefined") {
      setDismissed(window.localStorage.getItem(dismissKey) === "1")
    }
    const data = await fetchSmsComplianceView(organizationId)
    setView(data)
    if (data && resolveSmsNoticeState(data) === "rejected" && typeof window !== "undefined") {
      window.localStorage.removeItem(dismissKey)
      setDismissed(false)
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

  const smsState = resolveSmsNoticeState(view)
  const isPending = smsState === "pending"
  const needsAttention = smsState === "rejected"

  if (isPending && dismissed && !needsAttention) return null

  const dismiss = () => {
    setDismissed(true)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(smsDismissStorageKey(activeOrganizationId), "1")
    }
  }

  const tone = needsAttention
    ? "border-red-500/30 bg-red-500/10 text-red-100"
    : isPending
      ? "border-amber-500/30 bg-amber-500/10 text-amber-100"
      : "border-violet-500/30 bg-violet-500/10 text-violet-100"

  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${tone}`}>
      <MessageSquareWarning className="h-5 w-5 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 text-sm">{smsNoticeMessage(view, smsState)}</p>
      <button
        type="button"
        onClick={() => openCarrierRegistrationModal({ edit: needsAttention })}
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
