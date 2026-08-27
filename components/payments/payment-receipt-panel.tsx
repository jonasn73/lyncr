"use client"

// Shared post-pay receipt UI — Email / Text choice + send or skip.
// Used by owner Collect and tech Charge so success feels the same.

import { Loader2, Mail, MessageSquare } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  ChargeResultSummary,
  type TipChargeResult,
} from "@/components/payments/charge-result-summary"

export type ReceiptChannel = "email" | "sms"

export function PaymentReceiptPanel({
  baseCents,
  tip,
  baseKind = "card",
  showSend = true,
  cashNote,
  receiptName,
  onReceiptNameChange,
  receiptChannel,
  onReceiptChannelChange,
  receiptEmail,
  onReceiptEmailChange,
  receiptPhone,
  onReceiptPhoneChange,
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
  receiptChannel: ReceiptChannel
  onReceiptChannelChange: (channel: ReceiptChannel) => void
  receiptEmail: string
  onReceiptEmailChange: (value: string) => void
  receiptPhone: string
  onReceiptPhoneChange: (value: string) => void
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

          {/* Segmented Email | Text — secondary to the Paid hero. */}
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-zinc-900/80 p-1 ring-1 ring-zinc-800">
            <button
              type="button"
              onClick={() => onReceiptChannelChange("email")}
              className={cn(
                "flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition-colors",
                receiptChannel === "email"
                  ? "bg-zinc-700 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              <Mail className="h-3.5 w-3.5" aria-hidden />
              Email
            </button>
            <button
              type="button"
              onClick={() => onReceiptChannelChange("sms")}
              className={cn(
                "flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition-colors",
                receiptChannel === "sms"
                  ? "bg-zinc-700 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              <MessageSquare className="h-3.5 w-3.5" aria-hidden />
              Text
            </button>
          </div>

          <div className="space-y-2">
            <input
              type="text"
              autoComplete="name"
              value={receiptName}
              onChange={(e) => onReceiptNameChange(e.target.value)}
              placeholder="Customer name (optional)"
              className="w-full rounded-lg border-0 bg-zinc-900/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-zinc-800 placeholder:text-zinc-600 focus:ring-emerald-500/40"
            />
            {receiptChannel === "email" ? (
              <input
                type="email"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                value={receiptEmail}
                onChange={(e) => onReceiptEmailChange(e.target.value)}
                placeholder="customer@email.com"
                className="w-full rounded-lg border-0 bg-zinc-900/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-zinc-800 placeholder:text-zinc-600 focus:ring-emerald-500/40"
              />
            ) : (
              <input
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                value={receiptPhone}
                onChange={(e) => onReceiptPhoneChange(e.target.value)}
                placeholder="(502) 555-0100"
                className="w-full rounded-lg border-0 bg-zinc-900/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-zinc-800 placeholder:text-zinc-600 focus:ring-emerald-500/40"
              />
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
            ) : receiptChannel === "email" ? (
              <Mail className="h-4 w-4" aria-hidden />
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
        className="w-full rounded-xl py-3 text-sm font-semibold text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200 disabled:opacity-50"
      >
        {skipLabel}
      </button>
    </div>
  )
}
