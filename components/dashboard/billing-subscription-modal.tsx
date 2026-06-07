"use client"

import { useRouter } from "next/navigation"
import { CreditCard } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatBillingCycleDate } from "@/lib/format-billing-cycle"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  subscriptionActive: boolean
  billingCycleEnd: string | null
}

export function BillingSubscriptionModal({
  open,
  onOpenChange,
  subscriptionActive,
  billingCycleEnd,
}: Props) {
  const router = useRouter()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border/80 bg-card/95 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Billing & subscription</DialogTitle>
          <DialogDescription>Your Lyncr plan, renewal date, and carrier credit.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-4">
            <CreditCard className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-foreground">
                {subscriptionActive ? "Core plan active" : "Trial mode"}
              </p>
              {subscriptionActive && billingCycleEnd ? (
                <p className="mt-1 text-sm text-zinc-400">
                  Next billing date:{" "}
                  <span className="font-medium tabular-nums text-foreground">
                    {formatBillingCycleDate(billingCycleEnd)}
                  </span>
                </p>
              ) : subscriptionActive ? (
                <p className="mt-1 text-xs text-zinc-500">Renewal date will appear after Stripe syncs.</p>
              ) : (
                <p className="mt-1 text-xs text-zinc-500">
                  Activate your line from the dashboard banner to start billing.
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              onOpenChange(false)
              router.push("/dashboard/pay")
            }}
            className="w-full rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Open Pay & plans
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
