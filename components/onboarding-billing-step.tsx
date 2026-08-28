"use client"

import { useState } from "react"
import { CreditCard, Loader2, Lock, Phone } from "lucide-react"
import type { OnboardingLineReservation } from "@/lib/onboarding-reservation"
import type { CheckoutSubscriptionTier } from "@/lib/subscription-checkout"
import { SubscriptionTierPicker } from "@/components/subscription-tier-picker"
import { submitFormEvent } from "@/lib/form-keyboard"
import { cn } from "@/lib/utils"

type OnboardingBillingStepProps = {
  reservedLine: OnboardingLineReservation | null
  launchError?: string | null
  selectedTier: CheckoutSubscriptionTier
  onTierChange: (tier: CheckoutSubscriptionTier) => void
  /** simulation = open dashboard; live = Stripe Checkout for selected tier */
  simulationMode: boolean
  onLaunch: (tier: CheckoutSubscriptionTier) => void | Promise<void>
}

const CARD_INPUT_CLASS = cn(
  "h-10 w-full rounded-xl border border-border/80 bg-secondary/90 px-4 text-sm text-foreground",
  "placeholder:text-muted-foreground/50",
  "transition-[border-color,box-shadow] duration-150",
  "focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/35"
)

function cardFieldsReady(cardNumber: string, expiry: string, cvc: string): boolean {
  const digits = cardNumber.replace(/\D/g, "")
  const expDigits = expiry.replace(/\D/g, "")
  const cvcDigits = cvc.replace(/\D/g, "")
  return digits.length >= 4 && expDigits.length >= 4 && cvcDigits.length >= 3
}

export function OnboardingBillingStep({
  reservedLine,
  launchError,
  selectedTier,
  onTierChange,
  simulationMode,
  onLaunch,
}: OnboardingBillingStepProps) {
  const [cardNumber, setCardNumber] = useState("")
  const [expiry, setExpiry] = useState("")
  const [cvc, setCvc] = useState("")
  const [isLaunching, setIsLaunching] = useState(false)

  const canLaunch = simulationMode || cardFieldsReady(cardNumber, expiry, cvc)

  async function handleLaunch() {
    if (!canLaunch || isLaunching) return
    setIsLaunching(true)
    try {
      if (simulationMode) {
        await new Promise((resolve) => window.setTimeout(resolve, 450))
      }
      await onLaunch(selectedTier)
    } finally {
      setIsLaunching(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        submitFormEvent(e)
        void handleLaunch()
      }}
    >
      <div>
        <h1 className="text-2xl font-bold text-foreground">Choose your plan</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Pick Starter ($19), Professional ($49), or Business ($99). Stripe checkout opens for live billing.
        </p>
      </div>

      <SubscriptionTierPicker value={selectedTier} onChange={onTierChange} disabled={isLaunching} />

      {reservedLine ? (
        <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 shadow-[var(--electric-glow)]">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15">
            <Phone className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-micro font-semibold uppercase tracking-wide text-primary">Reserved for checkout</p>
            <p className="truncate text-sm font-semibold tabular-nums text-foreground">{reservedLine.display}</p>
            <p className="text-2xs text-muted-foreground">
              {reservedLine.method === "port" ? "Port request" : reservedLine.lineType ?? "Local"} ·{" "}
              {reservedLine.trialNote}
            </p>
          </div>
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-3 text-xs text-muted-foreground">
          No line reserved in this session. You can still complete checkout to open your dashboard.
        </p>
      )}

      {simulationMode ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <CreditCard className="h-4 w-4 text-primary" />
            Development mode
          </div>
          <p className="text-sm text-muted-foreground">
            Simulation skips Stripe — your line is saved in the database only until you activate live billing from the
            dashboard.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <CreditCard className="h-4 w-4 text-primary" />
            Stripe secure checkout
          </div>
          <div className="space-y-3">
            <div className="flex flex-col gap-2">
              <label htmlFor="onboarding-card-number" className="sr-only">
                Card number
              </label>
              <input
                id="onboarding-card-number"
                type="text"
                inputMode="numeric"
                autoComplete="cc-number"
                placeholder="4242 •••• •••• ••••"
                value={cardNumber}
                onChange={(e) => setCardNumber(e.target.value)}
                className={CARD_INPUT_CLASS}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input
                id="onboarding-card-expiry"
                type="text"
                inputMode="numeric"
                autoComplete="cc-exp"
                placeholder="MM / YY"
                maxLength={7}
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                className={CARD_INPUT_CLASS}
              />
              <input
                id="onboarding-card-cvc"
                type="text"
                inputMode="numeric"
                autoComplete="cc-csc"
                placeholder="CVC"
                maxLength={4}
                value={cvc}
                onChange={(e) => setCvc(e.target.value)}
                className={CARD_INPUT_CLASS}
              />
            </div>
          </div>
          <p className="mt-3 flex items-center gap-2 text-micro text-muted-foreground">
            <Lock className="h-3 w-3 shrink-0" aria-hidden />
            Card details are handled by Stripe — we open checkout for your selected plan.
          </p>
        </div>
      )}

      {launchError ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {launchError}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!canLaunch || isLaunching}
        className={cn(
          "flex items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground",
          "shadow-[var(--electric-glow)] transition-colors hover:bg-primary/90 disabled:opacity-40"
        )}
      >
        {isLaunching ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {simulationMode ? "Activating…" : "Opening checkout…"}
          </>
        ) : simulationMode ? (
          "Open Dashboard"
        ) : (
          "Subscribe & open dashboard"
        )}
      </button>
    </form>
  )
}
