"use client"

import { cn } from "@/lib/utils"
import {
  CHECKOUT_TIER_OPTIONS,
  type CheckoutSubscriptionTier,
} from "@/lib/subscription-checkout"

type SubscriptionTierPickerProps = {
  value: CheckoutSubscriptionTier
  onChange: (tier: CheckoutSubscriptionTier) => void
  disabled?: boolean
}

/** Starter / Professional / Business plan cards for checkout. */
export function SubscriptionTierPicker({ value, onChange, disabled }: SubscriptionTierPickerProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {CHECKOUT_TIER_OPTIONS.map((plan) => {
        const selected = value === plan.tier
        return (
          <button
            key={plan.tier}
            type="button"
            disabled={disabled}
            onClick={() => onChange(plan.tier)}
            className={cn(
              "flex flex-col rounded-xl border p-3 text-left transition-[border-color,background-color,box-shadow]",
              selected
                ? "border-primary bg-primary/5 shadow-[var(--electric-glow)] ring-1 ring-primary/40"
                : "border-border bg-card hover:border-primary/30",
              disabled && "opacity-60"
            )}
          >
            {plan.highlighted ? (
              <span className="mb-1 text-micro font-bold uppercase tracking-wide text-primary">Popular</span>
            ) : (
              <span className="mb-1 h-[15px]" aria-hidden />
            )}
            <span className="text-sm font-semibold text-foreground">{plan.name}</span>
            <span className="mt-1 text-lg font-bold text-foreground">{plan.priceLabel}</span>
            <span className="mt-1 text-2xs text-muted-foreground">{plan.description}</span>
            <span className="mt-2 text-micro font-medium text-primary">{plan.lineLimitLabel}</span>
          </button>
        )
      })}
    </div>
  )
}
