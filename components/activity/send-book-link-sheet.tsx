"use client"

// Shared fee-options sheet: No fee / Service call $49 / Full quote → optional note → Send SMS.
// Used from Activity, Call Answered, ops toolbar, missed-call rescue, SMS composer, etc.

import { useEffect, useState, type MouseEvent } from "react"
import { Loader2, Link2 } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { SERVICE_CALL_FEE_DOLLARS } from "@/lib/service-call-fee"
import { useToast } from "@/hooks/use-toast"
import { toE164 } from "@/lib/phone-e164"

export type SendBookLinkSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  phone: string
  callerName?: string
  businessLine?: string | null
  callLogId?: string | null
  /** Prefill Full quote (e.g. live intake quote) when the API has no open lead. */
  suggestedQuoteDollars?: number | null
  /** Called after a successful SMS send (sheet also closes + toasts). */
  onSent?: () => void
}

type FeeMode = "none" | "service_call" | "full_quote"

export function SendBookLinkSheet({
  open,
  onOpenChange,
  phone,
  callerName,
  businessLine,
  callLogId,
  suggestedQuoteDollars,
  onSent,
}: SendBookLinkSheetProps) {
  const { toast } = useToast()
  const [feeMode, setFeeMode] = useState<FeeMode>("none")
  const [quoteDollars, setQuoteDollars] = useState("")
  const [note, setNote] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Prefill Full quote from parent hint and/or an existing draft/lead
  useEffect(() => {
    if (!open || !phone.trim()) return
    let cancelled = false

    // Parent (e.g. Call Answered live quote) wins as an immediate hint
    if (suggestedQuoteDollars != null && suggestedQuoteDollars > 0) {
      setQuoteDollars(String(suggestedQuoteDollars))
    }

    ;(async () => {
      try {
        const res = await fetch(
          `/api/activity/send-book-link?phone=${encodeURIComponent(phone)}`
        )
        const json = (await res.json().catch(() => ({}))) as {
          data?: { suggested_quote_dollars?: number | null }
        }
        const suggested = json.data?.suggested_quote_dollars
        // Only fill from API when the field is still empty (don't stomp parent hint)
        if (!cancelled && suggested != null && suggested > 0) {
          setQuoteDollars((prev) => (prev.trim() ? prev : String(suggested)))
        }
      } catch {
        // ignore — owner can type the amount
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, phone, suggestedQuoteDollars])

  // Reset ephemeral error when reopened
  useEffect(() => {
    if (open) setError(null)
  }, [open])

  async function onSend() {
    if (sending) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch("/api/activity/send-book-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          business_line: businessLine || undefined,
          call_log_id: callLogId || undefined,
          fee_mode: feeMode,
          quote_dollars: feeMode === "full_quote" ? quoteDollars : undefined,
          note: note.trim() || undefined,
          customer_name: callerName?.trim() || undefined,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        data?: { wallets?: string; form_url?: string }
      }
      if (!res.ok) throw new Error(json.error || "Could not send SMS")

      toast({
        title: "Book link sent",
        description:
          feeMode === "none"
            ? `Form texted to ${phone}.`
            : `Form + pay link texted. ${json.data?.wallets || ""}`.trim(),
      })
      onOpenChange(false)
      setNote("")
      setFeeMode("none")
      onSent?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send")
    } finally {
      setSending(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[88dvh] overflow-y-auto rounded-t-2xl border-zinc-800 bg-zinc-950 px-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-3 text-zinc-100"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center gap-2 text-base text-white">
            <Link2 className="h-4 w-4 text-emerald-400" aria-hidden />
            Send book link
          </SheetTitle>
          <SheetDescription className="text-sm text-muted-foreground">
            Text {callerName ? `${callerName} · ` : ""}
            {phone} a short form
            {feeMode !== "none" ? " + pay link" : ""}.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Fee
          </p>
          {(
            [
              { id: "none" as const, label: "No fee", hint: "Form only — capture info" },
              {
                id: "service_call" as const,
                label: `Service call $${SERVICE_CALL_FEE_DOLLARS}`,
                hint: "Form + pay $49",
              },
              {
                id: "full_quote" as const,
                label: "Full quote",
                hint: "Form + pay the quote amount",
              },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setFeeMode(opt.id)}
              className={cn(
                "flex w-full flex-col items-start rounded-xl border px-3 py-3 text-left transition-colors",
                feeMode === opt.id
                  ? "border-emerald-500/50 bg-emerald-500/15"
                  : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-600"
              )}
            >
              <span className="text-sm font-semibold text-zinc-100">{opt.label}</span>
              <span className="text-[11px] text-muted-foreground">{opt.hint}</span>
            </button>
          ))}

          {feeMode === "full_quote" ? (
            <label className="block space-y-2">
              <span className="text-xs font-medium text-zinc-300">Quote amount ($)</span>
              <input
                inputMode="decimal"
                value={quoteDollars}
                onChange={(e) => setQuoteDollars(e.target.value)}
                placeholder="e.g. 185"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-3 text-sm text-white outline-none focus:border-emerald-500/60"
              />
            </label>
          ) : null}

          <label className="block space-y-2">
            <span className="text-xs font-medium text-zinc-300">Short note (optional)</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={280}
              placeholder="We’ll call when we’re close…"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-3 text-sm text-white outline-none focus:border-emerald-500/60"
            />
          </label>

          {error ? <p className="text-sm text-red-300">{error}</p> : null}

          <button
            type="button"
            disabled={sending || (feeMode === "full_quote" && !quoteDollars.trim())}
            onClick={() => void onSend()}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 text-base font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Send SMS
          </button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** Button + shared fee sheet — reuse anywhere “Send / Text book link” appears. */
export function SendBookLinkButton({
  phone,
  callerName,
  businessLine,
  callLogId,
  suggestedQuoteDollars,
  compact = false,
  label = "Send book link",
  className,
  onSent,
  onClick,
}: {
  phone: string
  callerName?: string
  businessLine?: string | null
  callLogId?: string | null
  suggestedQuoteDollars?: number | null
  compact?: boolean
  /** Visible button label (defaults to “Send book link”). */
  label?: string
  className?: string
  onSent?: () => void
  /** Extra click handler (e.g. stopPropagation) before the sheet opens. */
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
}) {
  const [open, setOpen] = useState(false)
  // Need a usable phone (E.164 or at least 10 digits)
  const canSend = Boolean(toE164(phone) || phone.replace(/\D/g, "").length >= 10)
  if (!canSend) return null

  // Empty label = icon-only (e.g. dense Activity rows); keep accessible name via aria-label.
  const visibleLabel = label.trim()
  const accessibleLabel = visibleLabel || "Send book link"

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          onClick?.(e)
          setOpen(true)
        }}
        aria-label={accessibleLabel}
        title={accessibleLabel}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 font-semibold text-emerald-100 transition-[color,background-color,border-color,transform] duration-150 hover:border-emerald-400/55 hover:bg-emerald-500/20 active:scale-[0.98]",
          compact ? "h-8 px-3 text-[11px]" : "min-h-11 w-full px-4 py-3 text-sm",
          !visibleLabel && compact && "w-8 px-0",
          className
        )}
      >
        <Link2 className={cn("shrink-0", compact ? "h-3.5 w-3.5" : "h-4 w-4")} aria-hidden />
        {visibleLabel || null}
      </button>
      <SendBookLinkSheet
        open={open}
        onOpenChange={setOpen}
        phone={phone}
        callerName={callerName}
        businessLine={businessLine}
        callLogId={callLogId}
        suggestedQuoteDollars={suggestedQuoteDollars}
        onSent={onSent}
      />
    </>
  )
}
