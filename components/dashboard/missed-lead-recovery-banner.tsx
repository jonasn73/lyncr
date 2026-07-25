"use client"

// High-priority banner for unreturned missed prospects in the last 30 minutes.
// Typography + actions adapt to multi vs high-urgency repeat vs single isolated lead.
// Text actions open the SMS template interceptor sheet before sending.

import { memo, useCallback, useMemo, useState } from "react"
import { Loader2, MessageSquare, Phone } from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { SmsTemplateInterceptorSheet } from "@/components/dashboard/sms-template-interceptor-sheet"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { buildTelHref } from "@/lib/phone-e164"
import {
  classifyMissedLeadRecoveryMode,
  type MissedLeadHotProspect,
} from "@/lib/missed-lead-aggregation"
import type { MissedLeadSmsTemplate } from "@/lib/missed-lead-sms-templates"

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
  const [isTemplateMenuOpen, setIsTemplateMenuOpen] = useState(false)
  const [pendingPhones, setPendingPhones] = useState<string[]>([])

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

  const handleRescueCall = useCallback(
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
      onIntercepted?.([phone])
      window.location.href = href
    },
    [onIntercepted, toast]
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
      </>
    )
  }

  if (mode.kind === "high_urgency") {
    // Full number on its own line so Call/Text never squeeze it into “…”
    const phoneLabel = formatPhoneDisplay(mode.prospect.from_number) || mode.prospect.from_number
    return (
      <>
        <div
          className={cn(
            "border-rose-900 bg-rose-950/20 rounded-xl p-3",
            "border animate-[pulse_2.4s_ease-in-out_infinite]",
            className
          )}
          role="status"
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
            <button
              type="button"
              onClick={() => handleRescueCall(mode.prospect.from_number)}
              className={cn(
                "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg",
                "border border-rose-500/40 bg-rose-500/15 px-3 py-1.5",
                "text-xs font-semibold text-rose-100 transition-colors",
                "hover:bg-rose-500/25"
              )}
            >
              <Phone className="h-3.5 w-3.5" aria-hidden />
              Rescue
            </button>
          </div>
        </div>
        {templateSheet}
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
              Missed{missedAgo ? ` · ${missedAgo}` : ""} · waiting for callback
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
