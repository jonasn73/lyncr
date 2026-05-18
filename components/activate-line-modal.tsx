"use client"

import { useState } from "react"
import { CreditCard, Loader2, Lock } from "lucide-react"
import { submitFormEvent } from "@/lib/form-keyboard"
import { cn } from "@/lib/utils"
import type { OnboardingProfile } from "@/lib/types"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const CARD_INPUT_CLASS = cn(
  "h-10 w-full rounded-xl border border-border/80 bg-secondary/90 px-3.5 text-sm text-foreground",
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

type ActivateLineModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  reservedDisplay: string | null
  onActivated: (profile: OnboardingProfile) => void | Promise<void>
  onSubmitActivation: () => Promise<{ profile: OnboardingProfile }>
}

export function ActivateLineModal({
  open,
  onOpenChange,
  reservedDisplay,
  onActivated,
  onSubmitActivation,
}: ActivateLineModalProps) {
  const [cardNumber, setCardNumber] = useState("")
  const [expiry, setExpiry] = useState("")
  const [cvc, setCvc] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = cardFieldsReady(cardNumber, expiry, cvc)

  async function handleSubmit() {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 450))
      const result = await onSubmitActivation()
      onOpenChange(false)
      setCardNumber("")
      setExpiry("")
      setCvc("")
      await onActivated(result.profile)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Activation failed"
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border/80 bg-card/95 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Activate Your Live Business Line</DialogTitle>
          <DialogDescription>
            Add a payment method to activate your line. Card details from onboarding are not on file for this account.
            {reservedDisplay ? (
              <>
                {" "}
                Line: <span className="font-medium text-foreground">{reservedDisplay}</span>
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            submitFormEvent(e)
            void handleSubmit()
          }}
        >
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <CreditCard className="h-4 w-4 text-primary" />
              Payment method
            </div>
            <div className="space-y-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="activate-card-number" className="text-xs font-medium text-muted-foreground">
                  Card number
                </label>
                <input
                  id="activate-card-number"
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
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="activate-card-expiry" className="text-xs font-medium text-muted-foreground">
                    Expiry
                  </label>
                  <input
                    id="activate-card-expiry"
                    type="text"
                    inputMode="numeric"
                    autoComplete="cc-exp"
                    placeholder="MM / YY"
                    maxLength={7}
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                    className={CARD_INPUT_CLASS}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="activate-card-cvc" className="text-xs font-medium text-muted-foreground">
                    CVC
                  </label>
                  <input
                    id="activate-card-cvc"
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
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Lock className="h-3 w-3 shrink-0" aria-hidden />
              Test mode — any card details save billing and activate your subscription (no real charge).
            </p>
          </div>

          {error ? (
            <p
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={!canSubmit || submitting}
            className={cn(
              "flex items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground",
              "shadow-[var(--electric-glow)] transition-colors hover:bg-primary/90 disabled:opacity-40"
            )}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Confirming…
              </>
            ) : (
              "Confirm Activation"
            )}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
