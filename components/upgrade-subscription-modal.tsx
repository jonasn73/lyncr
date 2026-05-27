"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { SubscriptionTierPicker } from "@/components/subscription-tier-picker"
import { startStripeSubscriptionCheckout } from "@/lib/onboarding-profile-client"
import {
  CHECKOUT_TIER_OPTIONS,
  normalizeCheckoutSubscriptionTier,
  type CheckoutSubscriptionTier,
} from "@/lib/subscription-checkout"
import { tierUpgradeTarget, TIER_DISPLAY_NAME, type SubscriptionTier } from "@/lib/subscription-tier"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { requestOpenBuyNumberModal } from "@/components/dashboard-numbers-modal-context"

export const UPGRADE_SUBSCRIPTION_MODAL_EVENT = "zing-show-upgrade-modal"

export type UpgradeModalDetail = {
  message?: string
  currentTier?: SubscriptionTier
  suggestedTier?: CheckoutSubscriptionTier
  subscriptionActive?: boolean
}

/** Prompt user to upgrade plan when they hit a line limit. */
export function UpgradeSubscriptionModal() {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [currentTier, setCurrentTier] = useState<SubscriptionTier>("starter")
  const [subscriptionActive, setSubscriptionActive] = useState(false)
  const [selectedTier, setSelectedTier] = useState<CheckoutSubscriptionTier>("professional")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onShow = (event: Event) => {
      const detail = (event as CustomEvent<UpgradeModalDetail>).detail
      setMessage(detail?.message ?? "Upgrade your plan to add more business numbers.")
      setCurrentTier(detail?.currentTier ?? "starter")
      setSubscriptionActive(detail?.subscriptionActive === true)
      const suggested =
        detail?.suggestedTier ??
        (detail?.currentTier ? tierUpgradeTarget(detail.currentTier) : null) ??
        "professional"
      setSelectedTier(normalizeCheckoutSubscriptionTier(suggested ?? "professional"))
      setError(null)
      setOpen(true)
    }
    window.addEventListener(UPGRADE_SUBSCRIPTION_MODAL_EVENT, onShow)
    return () => window.removeEventListener(UPGRADE_SUBSCRIPTION_MODAL_EVENT, onShow)
  }, [])

  const handleCheckout = useCallback(async () => {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await startStripeSubscriptionCheckout(selectedTier)
      if (result.kind === "upgraded") {
        setOpen(false)
        toast({
          title: `Upgraded to ${result.tierLabel}`,
          description: "You can add another business number now.",
        })
        requestOpenBuyNumberModal()
        setSubmitting(false)
        return
      }
      window.location.href = result.checkoutUrl
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update plan")
      setSubmitting(false)
    }
  }, [selectedTier, submitting, toast])

  const selectedLabel = CHECKOUT_TIER_OPTIONS.find((o) => o.tier === selectedTier)?.priceLabel
  const currentLabel = TIER_DISPLAY_NAME[currentTier]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="border-border/80 bg-card/95 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{subscriptionActive ? "Upgrade your plan" : "Choose a plan"}</DialogTitle>
          <DialogDescription>
            {message ??
              (subscriptionActive
                ? `You're on ${currentLabel}. Pick a higher tier to add more business numbers.`
                : "Choose a higher tier to add more business numbers.")}
          </DialogDescription>
        </DialogHeader>
        <SubscriptionTierPicker value={selectedTier} onChange={setSelectedTier} disabled={submitting} />
        {error ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          disabled={submitting}
          onClick={() => void handleCheckout()}
          className={cn(
            "flex items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground",
            "shadow-[var(--electric-glow)] hover:bg-primary/90 disabled:opacity-40"
          )}
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {subscriptionActive ? "Upgrading plan…" : "Opening checkout…"}
            </>
          ) : subscriptionActive ? (
            `Upgrade to ${CHECKOUT_TIER_OPTIONS.find((o) => o.tier === selectedTier)?.name ?? "plan"} · ${selectedLabel ?? ""}`
          ) : (
            `Continue to checkout · ${selectedLabel ?? ""}`
          )}
        </button>
      </DialogContent>
    </Dialog>
  )
}

export function showUpgradeSubscriptionModal(detail?: UpgradeModalDetail) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(UPGRADE_SUBSCRIPTION_MODAL_EVENT, { detail }))
}
