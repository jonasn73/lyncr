"use client"

// Collapsible quick discounts for price-shoppers — intake sheet + job editor.

import { cn } from "@/lib/utils"
import {
  applyNegotiationDiscount,
  NEGOTIATION_DISCOUNT_OPTIONS,
  negotiationDiscountLabel,
  parseQuoteDollars,
  type NegotiationDiscountId,
} from "@/lib/price-negotiation"

type PriceNegotiationHelperPanelProps = {
  baselineCents: number
  currentPriceDollars: string
  onApplyPrice: (dollars: number, discountId: NegotiationDiscountId) => void
  appliedDiscountId?: NegotiationDiscountId | null
  className?: string
}

export function PriceNegotiationHelperPanel({
  baselineCents,
  currentPriceDollars,
  onApplyPrice,
  appliedDiscountId = null,
  className,
}: PriceNegotiationHelperPanelProps) {
  const currentDollars = parseQuoteDollars(currentPriceDollars, baselineCents)

  return (
    <details
      className={cn(
        "rounded-lg border border-dashed border-zinc-600/60 bg-zinc-900/25 px-3 py-2",
        className
      )}
    >
      <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-wide text-zinc-400 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden>▸</span>
          Price Negotiation Tools
        </span>
      </summary>
      <div className="mt-3 grid gap-2">
        <p className="text-[11px] text-muted-foreground">
          Pitch a structured discount — updates the quote above instantly.
        </p>
        {NEGOTIATION_DISCOUNT_OPTIONS.map((option) => {
          const nextDollars = applyNegotiationDiscount({
            discountId: option.id,
            currentPriceDollars: currentDollars,
            baselineCents,
          })
          const active = appliedDiscountId === option.id
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onApplyPrice(nextDollars, option.id)}
              className={cn(
                "rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors",
                active
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-100"
                  : "border-zinc-700/80 bg-zinc-950/40 text-zinc-200 hover:border-primary/40 hover:bg-primary/5"
              )}
            >
              {option.label}
              <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">
                → ${nextDollars} pitched
              </span>
            </button>
          )
        })}
        {appliedDiscountId ? (
          <p className="text-[10px] text-emerald-400/90">
            Active negotiation: {negotiationDiscountLabel(appliedDiscountId)} — logged if you book.
          </p>
        ) : null}
      </div>
    </details>
  )
}
