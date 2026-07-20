"use client"

// Incoming-call context row + Decline / Quick SMS action toolbar.

import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, MessageSquare, PhoneOff, X } from "lucide-react"
import { resolveCallerContext, type CallerContextMatch } from "@/lib/caller-context-engine"
import { useLyncEngineOptional } from "@/lib/lync-engine-context"
import {
  formatRepeatAttemptBadgeLabel,
  formatRepeatCallerHistoryLine,
  type RepeatCallerUrgency,
} from "@/lib/repeat-caller-urgency"
import type { SchedulerPhoneLookupResult } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"

const QUICK_SMS_TEMPLATES = [
  "Stuck on a job, text you right back!",
  "On my way — give me 10 minutes.",
  "Got your call. What's the address?",
] as const

const BTN =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border py-1.5 px-3 text-xs font-semibold touch-manipulation transition-colors active:scale-95 disabled:opacity-50"

type IncomingCallOpsToolbarProps = {
  phoneE164: string
  businessLineE164: string
  callLogId: string | null
  organizationId: string | null
  isRinging: boolean
  onDeclined: () => void
  className?: string
  /** Repeat-caller scan from useRepeatCallerUrgency (parent owns the hook). */
  urgency?: RepeatCallerUrgency | null
}

const EMPTY_URGENCY: RepeatCallerUrgency = {
  attemptCount: 1,
  previousMissedCount: 0,
  minutesSinceLastMissed: null,
  lastMissedAt: null,
  isHighUrgency: false,
}

/** High-urgency badge — mount next to the incoming phone number. */
export function RepeatCallerUrgencyBadge({
  attemptCount,
  className,
}: {
  attemptCount: number
  className?: string
}) {
  return (
    <span
      className={cn(
        "bg-rose-500/20 border border-rose-500 text-rose-400 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full animate-pulse",
        className
      )}
    >
      {formatRepeatAttemptBadgeLabel(attemptCount)}
    </span>
  )
}

export function IncomingCallOpsToolbar({
  phoneE164,
  businessLineE164,
  callLogId,
  organizationId,
  isRinging,
  onDeclined,
  className,
  urgency: urgencyProp,
}: IncomingCallOpsToolbarProps) {
  const { toast } = useToast()
  const engine = useLyncEngineOptional()
  const urgency = urgencyProp ?? EMPTY_URGENCY
  const [lookup, setLookup] = useState<SchedulerPhoneLookupResult | null>(null)
  const [lookupLoading, setLookupLoading] = useState(false)
  const [declining, setDeclining] = useState(false)
  // Inline panel (not Radix Popover) — Popover portals at z-50 and hides under Sheet z-[110].
  const [smsOpen, setSmsOpen] = useState(false)
  const [smsSending, setSmsSending] = useState(false)

  // Prefer engine-prefetched CRM context when the phone matches the live primary call.
  const engineContext: CallerContextMatch | null =
    engine?.primaryCall &&
    engine.primaryCall.fromNumber.replace(/\D/g, "").slice(-10) ===
      phoneE164.replace(/\D/g, "").slice(-10)
      ? engine.primaryCall.callerContext
      : null
  const engineLookupLoading =
    Boolean(engineContext === null && engine?.primaryCall?.lookupLoading) &&
    engine?.primaryCall?.fromNumber.replace(/\D/g, "").slice(-10) ===
      phoneE164.replace(/\D/g, "").slice(-10)

  useEffect(() => {
    // Skip duplicate fetch when the global engine already resolved this caller.
    if (engineContext || engineLookupLoading) {
      setLookup(null)
      setLookupLoading(false)
      return
    }
    const digits = phoneE164.replace(/\D/g, "")
    if (digits.length < 7) {
      setLookup(null)
      return
    }
    let cancelled = false
    setLookupLoading(true)
    const orgQs =
      organizationId && !organizationId.startsWith("legacy-")
        ? `&organization_id=${encodeURIComponent(organizationId)}`
        : ""
    void fetch(`/api/owner/scheduler/lookup?phone=${encodeURIComponent(phoneE164)}${orgQs}`, {
      credentials: "include",
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("lookup"))))
      .then((j: { data?: SchedulerPhoneLookupResult }) => {
        if (!cancelled) setLookup(j.data ?? { pool: [], scheduled: [] })
      })
      .catch(() => {
        if (!cancelled) setLookup({ pool: [], scheduled: [] })
      })
      .finally(() => {
        if (!cancelled) setLookupLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [phoneE164, organizationId, engineContext, engineLookupLoading])

  const context: CallerContextMatch = useMemo(() => {
    if (engineContext) return engineContext
    return resolveCallerContext(phoneE164, lookup)
  }, [phoneE164, lookup, engineContext])

  const showLookupSpinner = lookupLoading || engineLookupLoading

  const handleDecline = useCallback(async () => {
    setDeclining(true)
    try {
      if (callLogId && !callLogId.startsWith("ring-")) {
        await fetch("/api/calls/decline-voicemail", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ call_id: callLogId }),
        }).catch(() => null)
      } else if (callLogId?.startsWith("ring-")) {
        const sid = callLogId.slice("ring-".length)
        await fetch("/api/calls/decline-voicemail", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider_call_sid: sid }),
        }).catch(() => null)
      }
      toast({
        title: "Sent to voicemail",
        description: "Caller is being redirected to your fallback greeting.",
      })
      onDeclined()
    } finally {
      setDeclining(false)
    }
  }, [callLogId, onDeclined, toast])

  const sendQuickSms = useCallback(
    async (text: string) => {
      setSmsSending(true)
      try {
        const res = await fetch("/api/messaging/send", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: phoneE164,
            text,
            from_number: businessLineE164 || undefined,
            organization_id: organizationId && !organizationId.startsWith("legacy-") ? organizationId : undefined,
          }),
        })
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) {
          toast({
            title: "SMS failed",
            description: json.error || "Could not send the quick text.",
            variant: "destructive",
          })
          return
        }
        toast({ title: "SMS sent", description: text })
        setSmsOpen(false)
      } finally {
        setSmsSending(false)
      }
    },
    [businessLineE164, organizationId, phoneE164, toast]
  )

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Context Engine — active job badge or CNAM token + repeat history */}
      <div className="min-h-[1.25rem]">
        {showLookupSpinner ? (
          <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            Looking up caller…
          </p>
        ) : context.kind === "active_job" ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-200">
              ⚠️ Recent Job Active
            </span>
            <span className="text-[11px] font-medium text-slate-300">{context.metaLine}</span>
          </div>
        ) : (
          <p className="text-[11px] font-medium text-slate-400">{context.cnamToken}</p>
        )}
        {urgency.isHighUrgency && urgency.minutesSinceLastMissed != null ? (
          <p className="mt-1 text-[11px] font-medium text-amber-500/90">
            {formatRepeatCallerHistoryLine(urgency.minutesSinceLastMissed)}
          </p>
        ) : null}
      </div>

      {/* Quick interaction controls — between context and step dots */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={declining}
          onClick={() => void handleDecline()}
          className={cn(
            BTN,
            "border-rose-900/50 bg-rose-950/40 text-rose-400 hover:bg-rose-950/60"
          )}
          aria-label="Decline and send to voicemail"
        >
          {declining ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <PhoneOff className="h-3.5 w-3.5" aria-hidden />
          )}
          Decline / Voicemail
        </button>

        <button
          type="button"
          disabled={smsSending || !phoneE164.trim()}
          aria-expanded={smsOpen}
          aria-controls="incoming-quick-sms-panel"
          onClick={() => setSmsOpen((open) => !open)}
          className={cn(
            BTN,
            smsOpen
              ? "border-sky-400/50 bg-sky-500/20 text-sky-50"
              : "border-slate-800 bg-slate-900/50 text-slate-200 hover:border-slate-700 hover:bg-slate-900"
          )}
          aria-label="Quick SMS templates"
        >
          {smsSending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <MessageSquare className="h-3.5 w-3.5" aria-hidden />
          )}
          Quick SMS
        </button>

        {isRinging ? (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-primary/80">
            Ringing
          </span>
        ) : null}
      </div>

      {/* Lives inside the sheet — never clipped / buried by portal z-index */}
      {smsOpen ? (
        <div
          id="incoming-quick-sms-panel"
          data-quick-sms
          className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-2.5"
        >
          <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-300/80">
              One-tap texts
            </p>
            <button
              type="button"
              aria-label="Close Quick SMS"
              onClick={() => setSmsOpen(false)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-sky-200/80 hover:bg-sky-500/20 hover:text-sky-50"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
          <ul className="flex flex-col gap-1">
            {QUICK_SMS_TEMPLATES.map((template) => (
              <li key={template}>
                <button
                  type="button"
                  disabled={smsSending}
                  onClick={() => void sendQuickSms(template)}
                  className="w-full rounded-lg px-2.5 py-2 text-left text-xs font-medium text-slate-100 hover:bg-sky-500/15 disabled:opacity-50"
                >
                  {template}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
