"use client"

// Dashboard banner — nudge owners to complete A2P 10DLC SMS carrier registration.

import { useEffect, useState } from "react"
import Link from "next/link"
import { MessageSquareWarning, X } from "lucide-react"

type BannerView = {
  sms_ready?: boolean
  pending_approval?: boolean
  organization_status?: string
  registration?: { status?: string } | null
}

const DISMISS_KEY = "lyncr_10dlc_nudge_dismissed"
const SMS_REGISTRATION_HREF = "/dashboard/settings?tab=sms-registration"

export function SmsAlertBanner() {
  const [view, setView] = useState<BannerView | null>(null)
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    if (typeof window !== "undefined") {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1")
    }
    fetch("/api/settings/10dlc", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.data) setView(json.data as BannerView)
      })
      .catch(() => {})
  }, [])

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
    if (typeof window !== "undefined") window.localStorage.setItem(DISMISS_KEY, "1")
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
      <Link
        href={SMS_REGISTRATION_HREF}
        className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20"
      >
        {needsAttention ? "Fix registration →" : isPending ? "View status →" : "Set up SMS →"}
      </Link>
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

/** @deprecated Use {@link SmsAlertBanner}. */
export const Sms10DlcNudgeBanner = SmsAlertBanner
