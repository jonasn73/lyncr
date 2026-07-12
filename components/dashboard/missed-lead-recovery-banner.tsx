"use client"

// High-priority banner for unreturned missed prospects in the last 30 minutes.

import { memo, useCallback, useState } from "react"
import { Loader2, MessageSquare } from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import {
  MISSED_LEAD_INTERCEPT_SMS,
  type MissedLeadHotProspect,
} from "@/lib/missed-lead-aggregation"

export const MissedLeadRecoveryBanner = memo(function MissedLeadRecoveryBanner({
  prospects,
  className,
  onIntercepted,
}: {
  prospects: MissedLeadHotProspect[]
  className?: string
  onIntercepted?: (phones: string[]) => void
}) {
  const { toast } = useToast()
  const { businessNumbers, activeOrganizationId, activeLine } = useDashboardWorkspace()
  const [sending, setSending] = useState(false)

  const fromNumber =
    activeLine?.trim() ||
    businessNumbers.find((n) => n.status === "active")?.number ||
    businessNumbers[0]?.number ||
    ""

  const handleTextAll = useCallback(async () => {
    if (sending || prospects.length === 0) return
    setSending(true)
    const phones = prospects.map((p) => p.from_number)
    let sent = 0
    let failed = 0
    try {
      for (const to of phones) {
        const res = await fetch("/api/messaging/send", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to,
            text: MISSED_LEAD_INTERCEPT_SMS,
            from_number: fromNumber || undefined,
            organization_id:
              activeOrganizationId && !activeOrganizationId.startsWith("legacy-")
                ? activeOrganizationId
                : undefined,
          }),
        })
        if (res.ok) sent += 1
        else failed += 1
      }
      onIntercepted?.(phones)
      const preview =
        MISSED_LEAD_INTERCEPT_SMS.length > 96
          ? `${MISSED_LEAD_INTERCEPT_SMS.slice(0, 96).trimEnd()}...`
          : MISSED_LEAD_INTERCEPT_SMS
      toast({
        title: sent > 0 ? "Intercept texts sent" : "Could not send intercept texts",
        description:
          failed > 0
            ? `Delivered ${sent} of ${phones.length}. Check SMS / 10DLC if some failed.`
            : `Hold message sent to ${sent} prospect${sent === 1 ? "" : "s"}: '${preview}'`,
        variant: sent > 0 ? "default" : "destructive",
      })
    } finally {
      setSending(false)
    }
  }, [sending, prospects, fromNumber, activeOrganizationId, onIntercepted, toast])

  const uniqueCount = prospects.length
  if (uniqueCount === 0) return null

  return (
    <div
      className={cn(
        "bg-amber-950/20 border border-amber-900/50 rounded-xl p-3 flex items-center justify-between gap-3",
        className
      )}
      role="status"
    >
      <p className="min-w-0 text-sm font-medium text-amber-100/95">
        ⚠️ {uniqueCount} unreturned prospect{uniqueCount === 1 ? "" : "s"} waiting
      </p>
      <button
        type="button"
        disabled={sending}
        onClick={() => void handleTextAll()}
        className={cn(
          "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg",
          "border border-amber-500/40 bg-amber-500/15 px-3 py-1.5",
          "text-xs font-semibold text-amber-100 transition-colors",
          "hover:bg-amber-500/25 disabled:opacity-50"
        )}
      >
        {sending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <MessageSquare className="h-3.5 w-3.5" aria-hidden />
        )}
        {sending ? "Sending…" : "Text All Intercept"}
      </button>
    </div>
  )
})
