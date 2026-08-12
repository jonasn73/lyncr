"use client"

// High-priority banner for unreturned missed prospects in the last 30 minutes.
// Typography + actions adapt to multi vs high-urgency repeat vs single isolated lead.
// Text actions open the SMS template interceptor sheet before sending.
// High-urgency card opens a compact options dialog (call / intake / booking link / dismiss).

import { memo, useCallback, useMemo, useState } from "react"
import {
  ClipboardList,
  Link2,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Phone,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { SmsTemplateInterceptorSheet } from "@/components/dashboard/sms-template-interceptor-sheet"
import { SendBookLinkSheet } from "@/components/activity/send-book-link-sheet"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { buildTelHref, toE164 } from "@/lib/phone-e164"
import { useInboundCallPanelOptional } from "@/lib/inbound-call-panel-context"
import {
  classifyMissedLeadRecoveryMode,
  type MissedLeadHotProspect,
} from "@/lib/missed-lead-aggregation"
import type { MissedLeadSmsTemplate } from "@/lib/missed-lead-sms-templates"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

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
  const inbound = useInboundCallPanelOptional()
  const { businessNumbers, activeOrganizationId, activeLine } = useDashboardWorkspace()
  const [sending, setSending] = useState(false)
  const [isTemplateMenuOpen, setIsTemplateMenuOpen] = useState(false)
  const [pendingPhones, setPendingPhones] = useState<string[]>([])
  // High-urgency options dialog (Call back / Intake / Booking link / Dismiss).
  const [urgencyOptionsOpen, setUrgencyOptionsOpen] = useState(false)
  const [bookLinkOpen, setBookLinkOpen] = useState(false)
  const [bookLinkPhone, setBookLinkPhone] = useState("")

  const mode = useMemo(() => classifyMissedLeadRecoveryMode(prospects), [prospects])

  const fromNumber =
    activeLine?.trim() ||
    businessNumbers.find((n) => n.status === "active")?.number ||
    businessNumbers[0]?.number ||
    ""

  const openTemplateMenu = useCallback((phones: string[]) => {
    if (phones.length === 0) return
    setPendingPhones(phones)
    setIsTemplateMenuOpen(true)
  }, [])

  const closeTemplateMenu = useCallback(() => {
    if (sending) return
    setIsTemplateMenuOpen(false)
    setPendingPhones([])
  }, [sending])

  const sendInterceptSms = useCallback(
    async (phones: string[], template: MissedLeadSmsTemplate) => {
      if (sending || phones.length === 0) return
      setSending(true)
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
              text: template.body,
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
        setIsTemplateMenuOpen(false)
        setPendingPhones([])
        const preview =
          template.body.length > 96 ? `${template.body.slice(0, 96).trimEnd()}...` : template.body
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
    },
    [sending, fromNumber, activeOrganizationId, onIntercepted, toast]
  )

  const handleTemplateSelect = useCallback(
    (template: MissedLeadSmsTemplate) => {
      void sendInterceptSms(pendingPhones, template)
    },
    [pendingPhones, sendInterceptSms]
  )

  /** Dial only — does not clear the urgency banner (Dismiss does that). */
  const dialPhone = useCallback(
    (phone: string) => {
      const href = buildTelHref(phone)
      if (!href) {
        toast({
          title: "Could not start call",
          description: "That phone number is not dialable.",
          variant: "destructive",
        })
        return
      }
      window.location.href = href
    },
    [toast]
  )

  /** Single-lead Call still dials + clears (unchanged). High-urgency uses dialPhone + Dismiss. */
  const handleRescueCall = useCallback(
    (phone: string) => {
      dialPhone(phone)
      onIntercepted?.([phone])
    },
    [dialPhone, onIntercepted]
  )

  const handleOpenIntake = useCallback(
    (phone: string) => {
      const e164 = toE164(phone) || phone.trim()
      if (!e164) {
        toast({
          title: "Could not open intake",
          description: "That phone number is not usable.",
          variant: "destructive",
        })
        return
      }
      setUrgencyOptionsOpen(false)
      inbound?.openManualCallPanel({
        phoneNumber: e164,
        callStatus: "completed",
        toNumber: fromNumber || undefined,
        intakeMode: "quick",
      })
    },
    [inbound, fromNumber, toast]
  )

  const handleTextBookingLink = useCallback(
    (phone: string) => {
      const e164 = toE164(phone) || phone.trim()
      if (!e164) {
        toast({
          title: "Could not send booking link",
          description: "That phone number is not usable.",
          variant: "destructive",
        })
        return
      }
      setBookLinkPhone(e164)
      setBookLinkOpen(true)
    },
    [toast]
  )

  const handleDismissUrgency = useCallback(
    (phone: string) => {
      setUrgencyOptionsOpen(false)
      onIntercepted?.([phone])
    },
    [onIntercepted]
  )

  const templateSheet = (
    <SmsTemplateInterceptorSheet
      open={isTemplateMenuOpen}
      sending={sending}
      recipientCount={pendingPhones.length}
      onClose={closeTemplateMenu}
      onSelect={handleTemplateSelect}
    />
  )

  // Same fee-options sheet as Activity — opens from high-urgency “Text booking link”
  const bookLinkSheet = (
    <SendBookLinkSheet
      open={bookLinkOpen}
      onOpenChange={setBookLinkOpen}
      phone={bookLinkPhone}
      businessLine={fromNumber || null}
      onSent={() => setUrgencyOptionsOpen(false)}
    />
  )

  if (!mode) return null

  if (mode.kind === "multi") {
    return (
      <>
        <div
          className={cn(
            "bg-amber-950/20 border border-amber-900/50 rounded-xl p-3 flex items-center justify-between gap-3",
            className
          )}
          role="status"
        >
          <p className="min-w-0 text-sm font-medium text-amber-100/95">
            ⚠️ {mode.uniqueLeadsCount} unreturned prospects waiting
          </p>
          <button
            type="button"
            disabled={sending}
            onClick={() => openTemplateMenu(prospects.map((p) => p.from_number))}
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
        {templateSheet}
        {bookLinkSheet}
      </>
    )
  }

  if (mode.kind === "high_urgency") {
    const phoneLabel = formatPhoneDisplay(mode.prospect.from_number) || mode.prospect.from_number
    const rescuePhone = mode.prospect.from_number

    const optionBtn =
      "flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left text-sm font-semibold transition-colors touch-manipulation"

    return (
      <>
        {/* Whole card opens the options sheet — does not dial or dismiss by itself. */}
        <button
          type="button"
          onClick={() => setUrgencyOptionsOpen(true)}
          aria-label={`Options for high urgency caller ${phoneLabel}`}
          className={cn(
            "w-full text-left cursor-pointer",
            "border-rose-900 bg-rose-950/20 rounded-xl p-3",
            "border animate-[pulse_2.4s_ease-in-out_infinite]",
            "transition-colors hover:bg-rose-950/35 focus-visible:outline-none",
            "focus-visible:ring-2 focus-visible:ring-rose-400/50",
            className
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-200/80">
                🚨 High urgency · called {mode.maxRepetitionCount}x
              </p>
              <p className="mt-0.5 break-all text-base font-semibold tabular-nums text-rose-50">
                {phoneLabel}
              </p>
            </div>
            <span
              aria-hidden
              className={cn(
                "pointer-events-none inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg",
                "border border-rose-500/40 bg-rose-500/15 px-3 py-1.5",
                "text-xs font-semibold text-rose-100"
              )}
            >
              <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
              Options
            </span>
          </div>
        </button>

        <Dialog open={urgencyOptionsOpen} onOpenChange={setUrgencyOptionsOpen}>
          <DialogContent
            className={cn(
              "gap-0 overflow-hidden border-zinc-800 bg-zinc-950 p-0 shadow-2xl",
              "max-h-[min(85dvh,28rem)] w-[calc(100%-2rem)] max-w-sm",
              "[&>button]:top-3 [&>button]:right-3 [&>button]:text-zinc-400"
            )}
          >
            <DialogHeader className="border-b border-zinc-800 px-4 pb-3 pt-4 pr-12 text-left">
              <DialogTitle className="text-base text-zinc-50">High urgency</DialogTitle>
              <DialogDescription className="text-zinc-400">
                {phoneLabel} · called {mode.maxRepetitionCount}x
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-2 px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
              <button
                type="button"
                onClick={() => {
                  setUrgencyOptionsOpen(false)
                  dialPhone(rescuePhone)
                }}
                className={cn(
                  optionBtn,
                  "border-emerald-500/40 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20"
                )}
              >
                <Phone className="h-4 w-4 shrink-0" aria-hidden />
                Call back
              </button>

              <button
                type="button"
                onClick={() => handleOpenIntake(rescuePhone)}
                className={cn(
                  optionBtn,
                  "border-sky-500/35 bg-sky-500/10 text-sky-100 hover:bg-sky-500/20"
                )}
              >
                <ClipboardList className="h-4 w-4 shrink-0" aria-hidden />
                Open intake
              </button>

              <button
                type="button"
                onClick={() => handleTextBookingLink(rescuePhone)}
                className={cn(
                  optionBtn,
                  "border-amber-500/35 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20"
                )}
              >
                <Link2 className="h-4 w-4 shrink-0" aria-hidden />
                Text booking link
              </button>

              <button
                type="button"
                onClick={() => handleDismissUrgency(rescuePhone)}
                className={cn(
                  optionBtn,
                  "border-zinc-700 bg-zinc-900/60 text-zinc-300 hover:bg-zinc-900"
                )}
              >
                <X className="h-4 w-4 shrink-0" aria-hidden />
                Dismiss
              </button>
            </div>
          </DialogContent>
        </Dialog>

        {templateSheet}
        {bookLinkSheet}
      </>
    )
  }

  // Case 3 — single isolated caller (phone on its own line so it stays fully visible)
  const phone = mode.prospect.from_number
  const phoneLabel = formatPhoneDisplay(phone) || phone
  const missedAgo = formatMissedAgo(mode.prospect.latestAt)
  return (
    <>
      <div
        className={cn(
          "bg-amber-950/20 border border-amber-900/50 rounded-xl p-3",
          className
        )}
        role="status"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-200/75">
              ⚠️ Unreturned
            </p>
            {/* break-all + no truncate — full (502) xxx-xxxx always readable */}
            <p className="mt-0.5 break-all text-base font-semibold tabular-nums text-amber-50">
              {phoneLabel}
            </p>
            <p className="mt-0.5 text-[11px] text-amber-200/70">
              {/* Relative “12m ago” can differ by a second SSR vs client — suppress that node only. */}
              Missed
              {missedAgo ? (
                <span suppressHydrationWarning>{` · ${missedAgo}`}</span>
              ) : null}{" "}
              · waiting for callback
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => handleRescueCall(phone)}
              className={cn(
                "inline-flex items-center justify-center gap-1 rounded-lg px-3 py-1.5",
                "bg-emerald-950 text-emerald-400 border border-emerald-900",
                "text-xs font-semibold transition-colors hover:bg-emerald-950/80"
              )}
            >
              <Phone className="h-3.5 w-3.5" aria-hidden />
              Call
            </button>
            <button
              type="button"
              disabled={sending}
              onClick={() => openTemplateMenu([phone])}
              className={cn(
                "inline-flex items-center justify-center gap-1 rounded-lg px-3 py-1.5",
                "bg-slate-900 text-slate-300 border border-slate-800",
                "text-xs font-semibold transition-colors hover:bg-slate-800 disabled:opacity-50"
              )}
            >
              {sending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <MessageSquare className="h-3.5 w-3.5" aria-hidden />
              )}
              {sending ? "…" : "Text"}
            </button>
          </div>
        </div>
      </div>
      {templateSheet}
      {bookLinkSheet}
    </>
  )
})

/** Short relative time for the missed-call banner (e.g. “12m ago”). */
function formatMissedAgo(iso: string): string {
  // Turn the ISO timestamp string into milliseconds since 1970.
  const t = Date.parse(iso)
  // If the date is invalid, show nothing instead of "NaN ago".
  if (!Number.isFinite(t)) return ""
  // How many whole minutes have passed since that missed call.
  const mins = Math.max(0, Math.round((Date.now() - t) / 60_000))
  // Under one minute → say it just happened.
  if (mins < 1) return "just now"
  // Under one hour → show minutes (e.g. "12m ago").
  if (mins < 60) return `${mins}m ago`
  // Convert leftover minutes into hours.
  const hours = Math.floor(mins / 60)
  // Under one day → show hours (e.g. "2h ago").
  if (hours < 24) return `${hours}h ago`
  // Older than a day → show days (e.g. "1d ago").
  return `${Math.floor(hours / 24)}d ago`
}
