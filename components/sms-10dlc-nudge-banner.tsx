"use client"

// Dashboard nudge: reminds owners to register 10DLC so SMS lead alerts deliver.
// Hidden once the campaign is approved + a number is assigned (sms_ready), and
// dismissible per browser for the non-urgent states.

import { useEffect, useState } from "react"
import Link from "next/link"
import { MessageSquareWarning, X } from "lucide-react"

type View = {
  registration: { status: string } | null
  sms_ready: boolean
}

const DISMISS_KEY = "lyncr_10dlc_nudge_dismissed"

export function Sms10DlcNudgeBanner() {
  const [view, setView] = useState<View | null>(null)
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    if (typeof window !== "undefined") {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1")
    }
    fetch("/api/messaging/10dlc", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.data) setView(json.data as View)
      })
      .catch(() => {})
  }, [])

  if (!view || view.sms_ready) return null

  const status = view.registration?.status ?? "none"
  const isPending = ["paid", "submitted", "pending_review"].includes(status)
  const needsAttention = status === "rejected" || status === "failed"

  // Pending review = informational + dismissible. Other states are an action prompt.
  if (isPending && dismissed) return null

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
      ? "Your SMS registration is under carrier review. Lead-alert texts will start delivering once approved."
      : "Heads up: SMS lead alerts won't reach your phone until you register your business (one-time carrier requirement)."

  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${tone}`}>
      <MessageSquareWarning className="h-5 w-5 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 text-sm">{message}</p>
      <Link
        href="/dashboard/settings"
        className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20"
      >
        {needsAttention ? "Fix it" : isPending ? "View status" : "Set up SMS →"}
      </Link>
      {isPending ? (
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
