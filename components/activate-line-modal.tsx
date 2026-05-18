"use client"

import { useState } from "react"
import { CreditCard, Loader2, Lock } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type ActivateLineModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  reservedDisplay: string | null
  onContinueToCheckout: () => Promise<void>
}

/** Shown only when onboarding did not save a billing method — redirects to Stripe Checkout. */
export function ActivateLineModal({
  open,
  onOpenChange,
  reservedDisplay,
  onContinueToCheckout,
}: ActivateLineModalProps) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleContinue() {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onContinueToCheckout()
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not start checkout"
      setError(msg)
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border/80 bg-card/95 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Activate Your Live Business Line</DialogTitle>
          <DialogDescription>
            Complete secure checkout to subscribe to the Lyncr core plan ($29/month) and provision your line on
            Telnyx.
            {reservedDisplay ? (
              <>
                {" "}
                Line: <span className="font-medium text-foreground">{reservedDisplay}</span>
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <CreditCard className="h-4 w-4 text-primary" />
              Stripe secure checkout
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              You skipped billing during signup. Stripe will collect your payment method and start your subscription.
              After payment succeeds, we purchase your reserved number on Telnyx automatically.
            </p>
            <p className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Lock className="h-3 w-3 shrink-0" aria-hidden />
              Card details are handled by Stripe — never stored on our servers.
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
            type="button"
            disabled={submitting}
            onClick={() => void handleContinue()}
            className={cn(
              "flex items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground",
              "shadow-[var(--electric-glow)] transition-colors hover:bg-primary/90 disabled:opacity-40"
            )}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Opening checkout…
              </>
            ) : (
              "Continue to Stripe Checkout"
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
