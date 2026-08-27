"use client"

// Shared post-pay receipt UI — phone is the primary channel (reused from the
// customer record), with an optional "also email a copy" add-on.
// Used by owner Collect and tech Charge so success feels the same.

import { Loader2, Mail, MessageSquare, Plus, X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  ChargeResultSummary,
  type TipChargeResult,
} from "@/components/payments/charge-result-summary"

export function PaymentReceiptPanel({
  baseCents,
  tip,
  baseKind = "card",
  showSend = true,
  cashNote,
  receiptName,
  onReceiptNameChange,
  receiptPhone,
  onReceiptPhoneChange,
  emailEnabled,
  onEmailEnabledChange,
  receiptEmail,
  onReceiptEmailChange,
  receiptBusy,
  error,
  onSend,
  onSkip,
  skipLabel = "Done",
}: {
  baseCents: number
  tip: TipChargeResult
  baseKind?: "card" | "cash"
  /** False for cash-only when there is no Stripe receipt to send. */
  showSend?: boolean
  cashNote?: string
  receiptName: string
  onReceiptNameChange: (value: string) => void
  receiptPhone: string
  onReceiptPhoneChange: (value: string) => void
  /** Whether the optional "also email a copy" field is expanded. */
  emailEnabled: boolean
  onEmailEnabledChange: (enabled: boolean) => void
  receiptEmail: string
  onReceiptEmailChange: (value: string) => void
  receiptBusy: boolean
  error?: string | null
  onSend: () => void
  onSkip: () => void
  skipLabel?: string
}) {
  return (
    <div className="flex flex-col gap-4">
      <ChargeResultSummary baseCents={baseCents} tip={tip} baseKind={baseKind} />

      {showSend ? (
        <div className="space-y-3 border-t border-zinc-800/80 pt-3">
          <p className="text-center text-[11px] font-medium text-zinc-500">
            Send a receipt?
          </p>

          <div className="space-y-2">
            <input
              type="text"
              autoComplete="name"
              value={receiptName}
              onChange={(e) => onReceiptNameChange(e.target.value)}
              placeholder="Customer name (optional)"
              className="w-full rounded-lg border-0 bg-zinc-900/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-zinc-800 placeholder:text-zinc-600 focus:ring-emerald-500/40"
            />

            {/* Phone is the primary channel — reused from the customer record. */}
            <div className="relative">
              <MessageSquare
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600"
                aria-hidden
              />
              <input
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                value={receiptPhone}
                onChange={(e) => onReceiptPhoneChange(e.target.value)}
                placeholder="(502) 555-0100"
                className="w-full rounded-lg border-0 bg-zinc-900/60 py-2 pl-8 pr-3 text-sm text-white outline-none ring-1 ring-zinc-800 placeholder:text-zinc-600 focus:ring-emerald-500/40"
              />
            </div>

            {emailEnabled ? (
              <div className="relative">
                <Mail
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600"
                  aria-hidden
                />
                <input
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  autoCapitalize="none"
                  autoFocus
                  value={receiptEmail}
                  onChange={(e) => onReceiptEmailChange(e.target.value)}
                  placeholder="customer@email.com"
                  className="w-full rounded-lg border-0 bg-zinc-900/60 py-2 pl-8 pr-8 text-sm text-white outline-none ring-1 ring-zinc-800 placeholder:text-zinc-600 focus:ring-emerald-500/40"
                />
                <button
                  type="button"
                  onClick={() => onEmailEnabledChange(false)}
                  aria-label="Remove email"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-500 hover:text-zinc-300"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onEmailEnabledChange(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-medium text-zinc-500 hover:text-zinc-300"
              >
                <Plus className="h-3 w-3" aria-hidden />
                Also email a copy
              </button>
            )}
          </div>

          {error ? <p className="text-center text-sm text-red-300">{error}</p> : null}

          <button
            type="button"
            disabled={receiptBusy}
            onClick={onSend}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {receiptBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <MessageSquare className="h-4 w-4" aria-hidden />
            )}
            Send receipt
          </button>
        </div>
      ) : cashNote ? (
        <p className="text-center text-xs text-zinc-500">{cashNote}</p>
      ) : null}

      <button
        type="button"
        disabled={receiptBusy}
        onClick={onSkip}
        className="w-full rounded-xl py-2.5 text-sm font-semibold text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200 disabled:opacity-50"
      >
        {skipLabel}
      </button>
    </div>
  )
}
