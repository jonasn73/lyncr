"use client"

// Shared owner → customer SMS composer (late/ETA + presets + custom).

import { useCallback, useEffect, useState } from "react"
import { Link2, Loader2, MessageSquare, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SendBookLinkSheet } from "@/components/activity/send-book-link-sheet"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import {
  CUSTOMER_SMS_QUICK_TEMPLATES,
  DEFAULT_LATE_ETA_MINUTES,
  MISSED_CALL_SMS_QUICK_TEMPLATES,
} from "@/lib/customer-sms-presets"
import { renderStatusSms, DEFAULT_SMS_STATUS_TEMPLATES } from "@/lib/sms-status-templates"
import type { OwnerSmsSnippet, OwnerSmsStatusTemplates } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"

type CustomerSmsComposerProps = {
  toPhone: string
  /** Prefill {{customer_name}} in status templates. */
  customerName?: string | null
  /** Business DID to send from (optional — server picks workspace line). */
  fromLine?: string | null
  organizationId?: string | null
  className?: string
  /** Show the Quick SMS template list. */
  showQuickTemplates?: boolean
  /** Show Running late + ETA minutes control. */
  showRunningLate?: boolean
  /** Show Re-send booking link (Missed Call Rescue). */
  showBookingLink?: boolean
  /**
   * Extra owner templates shown above built-ins (e.g. Couldn’t reach, Draft follow-up).
   */
  extraTemplates?: readonly { id: string; label: string; body: string }[]
  /**
   * `missed` = callback / booking recovery templates (no late/ETA).
   * `follow_up` = answered / active-job templates.
   */
  variant?: "follow_up" | "missed"
  /** Compact title for the panel. */
  title?: string
  /** Placeholder for the custom textarea. */
  customPlaceholder?: string
  onSent?: () => void
  onClose?: () => void
}

export function CustomerSmsComposer({
  toPhone,
  customerName = null,
  fromLine = null,
  organizationId = null,
  className,
  showQuickTemplates = true,
  showRunningLate = true,
  showBookingLink = false,
  extraTemplates = [],
  variant = "follow_up",
  title = "Text customer",
  customPlaceholder,
  onSent,
  onClose,
}: CustomerSmsComposerProps) {
  const isMissed = variant === "missed"
  const templates = isMissed ? MISSED_CALL_SMS_QUICK_TEMPLATES : CUSTOMER_SMS_QUICK_TEMPLATES
  const lateEnabled = showRunningLate && !isMissed
  const draftPlaceholder =
    customPlaceholder ??
    (isMissed ? "Or type a custom missed-call text…" : "Or type a custom follow-up…")
  const customerFirst =
    String(customerName ?? "")
      .trim()
      .split(/\s+/)[0] || "there"
  const { toast } = useToast()
  const [draft, setDraft] = useState("")
  const [etaMinutes, setEtaMinutes] = useState(String(DEFAULT_LATE_ETA_MINUTES))
  const [sending, setSending] = useState(false)
  // Fee-options sheet (same UI as Activity “Send book link”)
  const [bookLinkOpen, setBookLinkOpen] = useState(false)
  // Owner-saved reusable texts + late/status copy from Settings → SMS templates.
  const [customSnippets, setCustomSnippets] = useState<OwnerSmsSnippet[]>([])
  const [statusTemplates, setStatusTemplates] = useState<OwnerSmsStatusTemplates>({
    ...DEFAULT_SMS_STATUS_TEMPLATES,
  })
  const [businessName, setBusinessName] = useState("")

  useEffect(() => {
    let cancelled = false
    void fetch("/api/owner/sms-settings", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          json: {
            data?: {
              sms_custom_snippets?: OwnerSmsSnippet[]
              sms_status_templates?: OwnerSmsStatusTemplates
            }
          } | null
        ) => {
          if (cancelled || !json?.data) return
          const list = Array.isArray(json.data.sms_custom_snippets) ? json.data.sms_custom_snippets : []
          setCustomSnippets(list.filter((s) => s?.body?.trim()))
          if (json.data.sms_status_templates && typeof json.data.sms_status_templates === "object") {
            setStatusTemplates({
              ...DEFAULT_SMS_STATUS_TEMPLATES,
              ...json.data.sms_status_templates,
            })
          }
        }
      )
      .catch(() => {
        /* built-ins still work */
      })
    void fetch("/api/auth/session", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { data?: { user?: { business_name?: string } } } | null) => {
        if (cancelled) return
        setBusinessName(String(json?.data?.user?.business_name ?? "").trim())
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const sendText = useCallback(
    async (text: string) => {
      const body = text.trim()
      if (!body) return
      if (!toPhone.trim()) {
        toast({
          title: "No phone on file",
          description: "Add a customer phone before sending SMS.",
          variant: "destructive",
        })
        return
      }
      setSending(true)
      try {
        const res = await fetch("/api/messaging/send", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: toPhone,
            text: body,
            from_number: fromLine?.trim() || undefined,
            organization_id:
              organizationId && !organizationId.startsWith("legacy-")
                ? organizationId
                : undefined,
          }),
        })
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) {
          toast({
            title: "SMS failed",
            description: json.error || "Could not send the text.",
            variant: "destructive",
          })
          return
        }
        toast({ title: "SMS sent", description: body })
        setDraft("")
        onSent?.()
      } finally {
        setSending(false)
      }
    },
    [fromLine, onSent, organizationId, toPhone, toast]
  )

  const sendRunningLate = useCallback(() => {
    const mins = Number(etaMinutes)
    const eta = Number.isFinite(mins) ? mins : DEFAULT_LATE_ETA_MINUTES
    const body = renderStatusSms(statusTemplates.late || DEFAULT_SMS_STATUS_TEMPLATES.late, {
      customer_name: customerFirst,
      business_name: businessName || "us",
      eta_minutes: eta,
    })
    void sendText(body)
  }, [businessName, customerFirst, etaMinutes, sendText, statusTemplates.late])

  const sendStatusQuick = useCallback(
    (key: keyof OwnerSmsStatusTemplates) => {
      if (key === "late") {
        sendRunningLate()
        return
      }
      const body = renderStatusSms(statusTemplates[key] || DEFAULT_SMS_STATUS_TEMPLATES[key], {
        customer_name: customerFirst,
        business_name: businessName || "us",
      })
      void sendText(body)
    },
    [businessName, customerFirst, sendRunningLate, sendText, statusTemplates]
  )

  const openBookLinkSheet = useCallback(() => {
    if (!toPhone.trim()) {
      toast({
        title: "No phone on file",
        description: "Need a customer number to send a booking link.",
        variant: "destructive",
      })
      return
    }
    setBookLinkOpen(true)
  }, [toPhone, toast])

  const busy = sending

  return (
    <div
      className={cn(
        "space-y-2 rounded-xl border border-sky-500/30 bg-sky-500/10 p-3",
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-sky-300/80">
            <MessageSquare className="h-3 w-3" aria-hidden />
            {title}
          </p>
          <p className="mt-0.5 truncate font-mono text-xs text-sky-100">
            To {formatPhoneDisplay(toPhone)}
          </p>
        </div>
        {onClose ? (
          <button
            type="button"
            aria-label="Close SMS composer"
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sky-200/80 hover:bg-sky-500/20 hover:text-sky-50"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>

      {lateEnabled ? (
        <div className="space-y-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-2.5">
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 text-[11px] font-medium text-amber-100/90">
              Running late
              <span className="mt-1 flex items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  max={180}
                  disabled={busy}
                  value={etaMinutes}
                  onChange={(e) => setEtaMinutes(e.target.value)}
                  className="h-9 w-16 rounded-md border border-amber-500/30 bg-slate-950/70 px-2 text-center text-sm font-semibold tabular-nums text-amber-50 focus:border-amber-400/50 focus:outline-none disabled:opacity-50"
                  aria-label="Minutes late"
                />
                <span className="text-[11px] text-amber-200/70">min</span>
              </span>
            </label>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={sendRunningLate}
              className="shrink-0 bg-amber-600 text-white hover:bg-amber-500"
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : "Send late text"}
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => sendStatusQuick("arrived")}
              className="rounded-md border border-amber-500/30 bg-slate-950/40 px-2 py-1 text-[11px] font-semibold text-amber-50 hover:bg-amber-500/20 disabled:opacity-50"
            >
              I&apos;m here
            </button>
          </div>
        </div>
      ) : null}

      {showBookingLink ? (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={openBookLinkSheet}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-semibold disabled:opacity-50",
              isMissed
                ? "border-rose-500/40 bg-rose-500/15 text-rose-50 hover:bg-rose-500/25"
                : "border-emerald-500/35 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20"
            )}
          >
            <Link2 className="h-3.5 w-3.5" aria-hidden />
            Send book link
          </button>
          <SendBookLinkSheet
            open={bookLinkOpen}
            onOpenChange={setBookLinkOpen}
            phone={toPhone}
            businessLine={fromLine}
            onSent={onSent}
          />
        </>
      ) : null}

      {showQuickTemplates && extraTemplates.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-300/70">
            Suggested
          </p>
          <ul className="flex flex-col gap-1">
            {extraTemplates.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void sendText(t.body)}
                  className="w-full rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-left text-xs font-medium text-amber-50 hover:border-amber-400/50 hover:bg-amber-500/20 disabled:opacity-50"
                >
                  <span className="block font-semibold text-amber-200">{t.label}</span>
                  <span className="mt-0.5 line-clamp-2 text-[11px] text-amber-100/80">{t.body}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {showQuickTemplates && customSnippets.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-300/70">Your texts</p>
          <ul className="flex flex-col gap-1">
            {customSnippets.map((snip) => (
              <li key={snip.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void sendText(snip.body)}
                  className="w-full rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-2 text-left text-xs font-medium text-emerald-50 hover:border-emerald-400/50 hover:bg-emerald-500/20 disabled:opacity-50"
                >
                  <span className="block font-semibold text-emerald-200">{snip.label}</span>
                  <span className="mt-0.5 line-clamp-2 text-[11px] text-emerald-100/80">{snip.body}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {showQuickTemplates ? (
        <ul className="flex flex-col gap-1">
          {templates.map((template) => (
            <li key={template}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void sendText(template)}
                className={cn(
                  "w-full rounded-lg border px-2.5 py-2 text-left text-xs font-medium disabled:opacity-50",
                  isMissed
                    ? "border-rose-500/25 bg-slate-950/50 text-slate-100 hover:border-rose-400/40 hover:bg-slate-900"
                    : "border-sky-500/20 bg-slate-950/50 text-slate-100 hover:border-sky-400/40 hover:bg-slate-900"
                )}
              >
                {template}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="space-y-1.5 pt-1">
        <label htmlFor="customer-sms-draft" className="sr-only">
          Custom SMS message
        </label>
        <textarea
          id="customer-sms-draft"
          rows={2}
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={draftPlaceholder}
          className="w-full resize-y rounded-lg border border-sky-900/40 bg-slate-950/70 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-500/50 focus:outline-none disabled:opacity-60"
        />
        <Button
          type="button"
          size="sm"
          className="w-full"
          disabled={busy || !draft.trim()}
          onClick={() => void sendText(draft)}
        >
          {sending ? (
            <>
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />
              Sending…
            </>
          ) : (
            "Send SMS"
          )}
        </Button>
      </div>
    </div>
  )
}
