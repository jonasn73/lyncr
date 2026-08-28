"use client"

// Low-profile overhead banner for a secondary ring while intake is already live.

import { useCallback, useState } from "react"
import { Loader2, MessageSquare, PhoneOff } from "lucide-react"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import {
  SECONDARY_DECLINE_SMS_TEMPLATE,
  SECONDARY_HOLD_SMS_TEMPLATE,
} from "@/lib/secondary-call-intercept"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"

export type SecondaryIncomingLeg = {
  callSid: string
  callLogId: string | null
  fromNumber: string
  toNumber: string
}

export function SecondaryCallInterceptBanner({
  leg,
  organizationId,
  onDismiss,
  className,
}: {
  leg: SecondaryIncomingLeg
  organizationId: string | null
  onDismiss: () => void
  className?: string
}) {
  const { toast } = useToast()
  const [busy, setBusy] = useState<"hold" | "decline" | null>(null)

  const sendSms = useCallback(
    async (text: string) => {
      const res = await fetch("/api/messaging/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: leg.fromNumber,
          text,
          from_number: leg.toNumber || undefined,
          organization_id:
            organizationId && !organizationId.startsWith("legacy-") ? organizationId : undefined,
        }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error || "SMS failed")
      }
    },
    [leg.fromNumber, leg.toNumber, organizationId]
  )

  const resolveCallIds = useCallback(() => {
    const callLogId = leg.callLogId?.trim() || ""
    const sid = leg.callSid?.trim() || ""
    if (callLogId && !callLogId.startsWith("ring-")) {
      return { call_id: callLogId, provider_call_sid: sid || undefined }
    }
    if (sid) return { provider_call_sid: sid }
    if (callLogId.startsWith("ring-")) {
      return { provider_call_sid: callLogId.slice("ring-".length) }
    }
    return {}
  }, [leg.callLogId, leg.callSid])

  const handleHoldAndSms = useCallback(async () => {
    setBusy("hold")
    try {
      const ids = resolveCallIds()
      await fetch("/api/calls/hold", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids),
      }).catch(() => null)
      await sendSms(SECONDARY_HOLD_SMS_TEMPLATE)
      toast({
        title: "Second caller on hold",
        description: "Delay text sent — finish intake, then return to them.",
      })
      onDismiss()
    } catch (e) {
      toast({
        title: "Hold / SMS failed",
        description: e instanceof Error ? e.message : "Could not intercept the second call.",
        variant: "destructive",
      })
    } finally {
      setBusy(null)
    }
  }, [onDismiss, resolveCallIds, sendSms, toast])

  const handleDeclineAndSms = useCallback(async () => {
    setBusy("decline")
    try {
      const ids = resolveCallIds()
      const res = await fetch("/api/calls/decline-voicemail", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast({
          title: "Decline failed",
          description: json.error || "Could not send the second caller to voicemail.",
          variant: "destructive",
        })
        return
      }
      await sendSms(SECONDARY_DECLINE_SMS_TEMPLATE)
      toast({
        title: "Second call declined",
        description: "Stalling text sent to the waiting caller.",
      })
      onDismiss()
    } catch (e) {
      toast({
        title: "Decline / SMS failed",
        description: e instanceof Error ? e.message : "Could not decline the second call.",
        variant: "destructive",
      })
    } finally {
      setBusy(null)
    }
  }, [onDismiss, resolveCallIds, sendSms, toast])

  const phoneLabel = formatPhoneDisplay(leg.fromNumber)

  return (
    <div
      className={cn(
        // Above Map/Leaflet stacking (PiP / intake sheet sit at 6200–6010).
        "fixed top-4 left-4 right-4 z-[6200] rounded-xl border border-destructive/40 bg-background p-3 shadow-overlay",
        "md:left-auto md:right-6 md:w-[min(100%,24rem)]",
        className
      )}
      role="alertdialog"
      aria-label={`Incoming second call from ${phoneLabel}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-micro font-bold uppercase tracking-wider text-destructive">
            Second line ringing
          </p>
          <p className="mt-0.5 truncate text-sm font-semibold tabular-nums text-foreground">
            {phoneLabel}
          </p>
          <p className="mt-1 text-2xs text-muted-foreground">
            Keep working intake — hold or decline without losing your draft.
          </p>
        </div>
        <span className="relative mt-1 flex h-2.5 w-2.5 shrink-0" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-destructive" />
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy != null}
          onClick={() => void handleHoldAndSms()}
          className={cn(
            "inline-flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg border px-2 py-2",
            "border-warning/40 bg-warning/10 text-warning",
            "text-2xs font-semibold touch-manipulation disabled:opacity-50"
          )}
        >
          {busy === "hold" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <MessageSquare className="h-3.5 w-3.5" aria-hidden />
          )}
          <span>Hold &amp; SMS</span>
        </button>
        <button
          type="button"
          disabled={busy != null}
          onClick={() => void handleDeclineAndSms()}
          className={cn(
            "inline-flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg border px-2 py-2",
            "border-destructive/40 bg-destructive/10 text-destructive",
            "text-2xs font-semibold touch-manipulation disabled:opacity-50"
          )}
        >
          {busy === "decline" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <PhoneOff className="h-3.5 w-3.5" aria-hidden />
          )}
          <span>Decline/SMS</span>
        </button>
      </div>
    </div>
  )
}
