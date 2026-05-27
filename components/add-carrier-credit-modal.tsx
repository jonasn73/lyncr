"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import Link from "next/link"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { startCreditPackCheckout } from "@/lib/onboarding-profile-client"
import { formatUsdFromCents } from "@/lib/billing-pricing"
import { cn } from "@/lib/utils"

export const ADD_CARRIER_CREDIT_MODAL_EVENT = "zing-show-add-credit-modal"

export type AddCreditModalDetail = {
  message?: string
  carrierCredit?: number
  provisioningFeeUsd?: number
}

const QUICK_PACKS_CENTS = [1000, 2500, 5000]

/** Prompt user to add prepaid carrier credit before buying a line. */
export function AddCarrierCreditModal() {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [carrierCredit, setCarrierCredit] = useState(0)
  const [provisioningFeeUsd, setProvisioningFeeUsd] = useState(2)
  const [submitting, setSubmitting] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onShow = (event: Event) => {
      const detail = (event as CustomEvent<AddCreditModalDetail>).detail
      setMessage(
        detail?.message ??
          "Add prepaid carrier credit before purchasing another business number."
      )
      setCarrierCredit(Number(detail?.carrierCredit ?? 0))
      setProvisioningFeeUsd(Number(detail?.provisioningFeeUsd ?? 2))
      setError(null)
      setOpen(true)
    }
    window.addEventListener(ADD_CARRIER_CREDIT_MODAL_EVENT, onShow)
    return () => window.removeEventListener(ADD_CARRIER_CREDIT_MODAL_EVENT, onShow)
  }, [])

  const handleBuy = useCallback(async (amountCents: number) => {
    if (submitting != null) return
    setSubmitting(amountCents)
    setError(null)
    try {
      const { checkoutUrl } = await startCreditPackCheckout(amountCents)
      window.location.href = checkoutUrl
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start checkout")
      setSubmitting(null)
    }
  }, [submitting])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="border-border/80 bg-card/95 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add carrier credit</DialogTitle>
          <DialogDescription>
            {message ??
              "Each new business line uses a small prepaid balance on Telnyx."}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          Current balance:{" "}
          <span className="font-medium text-foreground">${carrierCredit.toFixed(2)}</span>
          {" · "}
          Need at least{" "}
          <span className="font-medium text-foreground">${provisioningFeeUsd.toFixed(2)}</span>{" "}
          per new line
        </div>

        <div className="grid grid-cols-3 gap-2">
          {QUICK_PACKS_CENTS.map((cents) => (
            <button
              key={cents}
              type="button"
              disabled={submitting != null}
              onClick={() => void handleBuy(cents)}
              className={cn(
                "rounded-lg border border-border/80 py-3 text-sm font-semibold",
                "hover:border-primary/50 hover:bg-primary/5 disabled:opacity-40"
              )}
            >
              {submitting === cents ? (
                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              ) : (
                formatUsdFromCents(cents)
              )}
            </button>
          ))}
        </div>

        {error ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Link
          href="/dashboard/pay"
          onClick={() => setOpen(false)}
          className="block text-center text-sm font-medium text-primary hover:underline"
        >
          Open Pay tab for more options →
        </Link>
      </DialogContent>
    </Dialog>
  )
}

export function showAddCarrierCreditModal(detail?: AddCreditModalDetail) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(ADD_CARRIER_CREDIT_MODAL_EVENT, { detail }))
}
