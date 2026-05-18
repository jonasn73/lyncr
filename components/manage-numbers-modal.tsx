"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, Phone, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { fetchOnboardingProfile } from "@/lib/onboarding-profile-client"
import { formatBillingCycleDate } from "@/lib/format-billing-cycle"

type OwnedLine = {
  number: string
  status: string
  line_business_name?: string | null
}

export function ManageNumbersModal({
  open,
  onOpenChange,
  onBuyAnother,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onBuyAnother?: () => void
}) {
  const [lines, setLines] = useState<OwnedLine[]>([])
  const [loading, setLoading] = useState(false)
  const [billingCycleEnd, setBillingCycleEnd] = useState<string | null>(null)

  const loadLines = useCallback(() => {
    setLoading(true)
    void fetchOnboardingProfile()
      .then(({ profile }) => setBillingCycleEnd(profile?.billing_cycle_end?.trim() || null))
      .catch(() => setBillingCycleEnd(null))
    fetch("/api/numbers/mine", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : { numbers: [] }))
      .then((data: { numbers?: OwnedLine[] }) => {
        const rows = Array.isArray(data.numbers) ? data.numbers : []
        setLines(rows.filter((n) => n.status === "active"))
      })
      .catch(() => setLines([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (open) loadLines()
  }, [open, loadLines])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className={cn(
          "sigo-marketplace-dialog gap-0 overflow-hidden border-border/60 p-0 sm:max-w-md",
          "transform-gpu will-change-transform backface-hidden"
        )}
      >
        <DialogHeader className="border-b border-border/60 px-6 py-5 text-left">
          <DialogTitle className="text-xl font-semibold tracking-tight">Lines & numbers</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Published business numbers on your account.
          </DialogDescription>
        </DialogHeader>

        {billingCycleEnd ? (
          <p className="border-b border-border/60 px-6 py-3 text-xs text-muted-foreground">
            Next billing date:{" "}
            <span className="font-medium text-foreground">{formatBillingCycleDate(billingCycleEnd)}</span>
          </p>
        ) : null}

        <div className="max-h-[min(55vh,24rem)] overflow-y-auto overscroll-contain px-6 py-5">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading lines" />
            </div>
          ) : lines.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 px-4 py-10 text-center text-sm text-zinc-500">
              No active lines yet. Buy a number to publish your first business line.
            </p>
          ) : (
            <ul className="space-y-3">
              {lines.map((line) => (
                <li
                  key={line.number}
                  className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10">
                    <Phone className="h-4 w-4 text-primary" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold tabular-nums text-foreground">{formatPhoneDisplay(line.number)}</p>
                    {line.line_business_name ? (
                      <p className="truncate text-xs text-zinc-500">{line.line_business_name}</p>
                    ) : null}
                  </div>
                  <span className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                    Active
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {onBuyAnother ? (
          <div className="border-t border-border/60 px-6 py-4">
            <button
              type="button"
              onClick={onBuyAnother}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-[var(--electric-glow)] transition-[opacity,transform] hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Buy another line
            </button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
