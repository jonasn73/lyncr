"use client"

import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Loader2, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatUsdFromCents } from "@/lib/billing-pricing"
import { confirmCreditPackCheckout, startCreditPackCheckout, startStripeSubscriptionCheckout } from "@/lib/onboarding-profile-client"
import { LOW_CARRIER_CREDIT_THRESHOLD_USD } from "@/lib/carrier-credit-threshold"
import { CHECKOUT_TIER_OPTIONS, type CheckoutSubscriptionTier } from "@/lib/subscription-checkout"
import { useToast } from "@/hooks/use-toast"
import {
  WorkspacePage,
  WorkspacePageHeader,
  WorkspacePanel,
  WorkspaceStatCard,
  WorkspaceTableWrap,
  WorkspaceTh,
  WorkspaceTd,
  WorkspaceUsageStatCard,
  WORKSPACE_TABLE_ROW_CLASS,
} from "@/components/dashboard-workspace-ui"

type BillingSummary = {
  current_plan: string
  credit_balance_cents: number
  credit_balance_label: string
  telnyx_carrier_balance_label: string | null
  telnyx_available_credit_label: string | null
  telnyx_number_purchase_label: string
  metered_voice_cents_per_minute: number
  suggested_credit_packs_cents: number[]
  subscription_active?: boolean
  subscription_tier?: string
  subscription_tier_label?: string
  needs_carrier_credit?: boolean
  low_balance_notified?: boolean
  low_carrier_credit_warning?: boolean
  low_carrier_credit_threshold_usd?: number
  plans?: { key: string; monthly_price_label: string; included_minutes_per_month: number }[]
}

const INVOICES = [
  { id: "inv_04", date: "Apr 1, 2026", amount: "$49.00" },
  { id: "inv_03", date: "Mar 1, 2026", amount: "$49.00" },
  { id: "inv_02", date: "Feb 1, 2026", amount: "$49.00" },
  { id: "inv_01", date: "Jan 15, 2026", amount: "$15.00" },
]

export const PayWorkspaceView = memo(function PayWorkspaceView() {
  const { toast } = useToast()
  const searchParams = useSearchParams()
  const [billing, setBilling] = useState<BillingSummary | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [buyingPack, setBuyingPack] = useState<number | null>(null)
  const [checkoutTier, setCheckoutTier] = useState<CheckoutSubscriptionTier | null>(null)

  const refreshBilling = useCallback(async () => {
    setLoadError(null)
    const res = await fetch("/api/billing/summary", { credentials: "include" })
    if (res.status === 401) throw new Error("Sign in again to view billing.")
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(j.error || "Billing unavailable")
    }
    const json = (await res.json()) as { data?: BillingSummary }
    setBilling(json.data ?? null)
  }, [])

  useEffect(() => {
    void refreshBilling().catch((e) => {
      setBilling(null)
      setLoadError(e instanceof Error ? e.message : "Could not load billing")
    })
  }, [refreshBilling])

  useEffect(() => {
    const checkout = searchParams.get("credit_checkout")
    const sessionId = searchParams.get("session_id")
    if (checkout !== "success" || !sessionId) return

    void (async () => {
      try {
        const result = await confirmCreditPackCheckout(sessionId)
        toast({
          title: "Carrier credit added",
          description: `New balance: ${formatUsdFromCents(result.balance_after_cents)}. Your balance syncs with the Lyncr global routing network.`,
        })
        if (result.provisioned) {
          toast({
            title: "Line activated",
            description: "Your business number is now live on the Lyncr core network.",
          })
          window.dispatchEvent(new CustomEvent("zing-business-numbers-changed"))
        } else if (result.provision_error) {
          const needsPicker = /no longer available|pick a different/i.test(result.provision_error)
          toast({
            variant: needsPicker ? "default" : "destructive",
            title: needsPicker ? "Pick a replacement number" : "Line not live yet",
            description: result.provision_error,
          })
        }
        await refreshBilling()
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Credit sync failed",
          description: e instanceof Error ? e.message : "Could not apply credit purchase",
        })
      }
      window.history.replaceState({}, "", "/dashboard/pay")
    })()
  }, [searchParams, refreshBilling, toast])

  const balanceLabel = billing?.credit_balance_label ?? "$0.00"
  const planKey = billing?.current_plan ?? "starter"
  const subscriptionActive = billing?.subscription_active === true
  const needsCarrierCredit = billing?.needs_carrier_credit === true
  const lowCarrierCreditWarning = billing?.low_carrier_credit_warning === true
  const lowCreditThreshold = billing?.low_carrier_credit_threshold_usd ?? LOW_CARRIER_CREDIT_THRESHOLD_USD
  const includedMinutes = useMemo(() => {
    const fromPlan = billing?.plans?.find((p) => p.key === planKey)?.included_minutes_per_month
    return fromPlan && fromPlan > 0 ? fromPlan : 300
  }, [billing?.plans, planKey])

  const planLabel = billing?.plans?.find((p) => p.key === planKey)?.monthly_price_label ?? "$19/mo"
  const usageHint = billing
    ? subscriptionActive
      ? `${billing.subscription_tier_label ?? "Starter"} · ${planLabel} · active`
      : `${billing.current_plan} plan · ${planLabel}`
    : "Loading plan…"

  async function handleSubscribe(tier: CheckoutSubscriptionTier) {
    if (checkoutTier != null) return
    setCheckoutTier(tier)
    try {
      const result = await startStripeSubscriptionCheckout(tier)
      if (result.kind === "upgraded") {
        toast({
          title: `Upgraded to ${result.tierLabel}`,
          description: "Your plan was updated.",
        })
        await refreshBilling()
        setCheckoutTier(null)
        return
      }
      window.location.href = result.checkoutUrl
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Checkout failed",
        description: e instanceof Error ? e.message : "Could not start checkout",
      })
      setCheckoutTier(null)
    }
  }

  async function handleBuyCredit(amountCents: number) {
    if (buyingPack != null) return
    setBuyingPack(amountCents)
    try {
      const { checkoutUrl } = await startCreditPackCheckout(amountCents)
      window.location.href = checkoutUrl
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Checkout failed",
        description: e instanceof Error ? e.message : "Could not start checkout",
      })
      setBuyingPack(null)
    }
  }

  return (
    <WorkspacePage className="min-h-[32rem]">
      <WorkspacePageHeader eyebrow="Billing" title="Pay" />

      {loadError ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {loadError}
        </p>
      ) : null}

      {needsCarrierCredit ? (
        <p className="rounded-xl border border-amber-500/35 bg-amber-950/35 px-4 py-3 text-sm text-foreground/90">
          Your subscription is active, but your line is not live yet. Add at least{" "}
          {billing?.telnyx_number_purchase_label ?? "$2.00"} carrier credit below — then we will purchase and wire
          your number on Telnyx automatically.
        </p>
      ) : null}

      {lowCarrierCreditWarning ? (
        <p className="rounded-xl border border-rose-500/35 bg-rose-950/30 px-4 py-3 text-sm text-foreground/90">
          Your carrier credit is below ${lowCreditThreshold.toFixed(2)} ({balanceLabel} remaining). Add credit below
          soon so calls keep routing without interruption.
        </p>
      ) : null}

      <div className="flex flex-col gap-8">
        <div className="grid min-h-[5.75rem] gap-4 sm:grid-cols-3">
          <WorkspaceStatCard label="Your carrier credit" value={balanceLabel} accent="primary" />
          <WorkspaceStatCard
            label="Lyncr routing pool"
            value={billing?.telnyx_available_credit_label ?? "—"}
            accent="default"
          />
          <WorkspaceUsageStatCard
            label="Current month usage"
            used={0}
            included={includedMinutes}
            hint={usageHint}
          />
        </div>

        <WorkspacePanel>
          <div className="border-b border-zinc-800 px-5 py-4">
            <h2 className="text-sm font-semibold text-foreground">Subscription plans</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Each plan maps to a Stripe price — Starter ($19), Professional ($49), or Business ($99) per month.
            </p>
          </div>
          <div className="grid gap-3 p-5 sm:grid-cols-3">
            {CHECKOUT_TIER_OPTIONS.map((plan) => {
              const isCurrentPlan =
                subscriptionActive &&
                (billing?.subscription_tier === plan.tier ||
                  (plan.tier === "starter" && billing?.subscription_tier === "free_trial"))
              return (
              <button
                key={plan.tier}
                type="button"
                disabled={checkoutTier != null || isCurrentPlan}
                onClick={() => void handleSubscribe(plan.tier)}
                className={cn(
                  "flex flex-col items-start gap-2 rounded-xl border border-border/70 bg-card/80 p-4 text-left",
                  "transition-colors hover:border-primary/45 hover:bg-primary/5 disabled:opacity-60",
                  plan.highlighted && "border-primary/40 ring-1 ring-primary/20",
                  isCurrentPlan && "border-primary/50 bg-primary/10"
                )}
              >
                <span className="text-sm font-semibold text-foreground">{plan.name}</span>
                <span className="text-lg font-bold text-foreground">{plan.priceLabel}</span>
                <span className="text-xs text-muted-foreground">{plan.lineLimitLabel}</span>
                <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary">
                  {isCurrentPlan ? (
                    "Current plan"
                  ) : checkoutTier === plan.tier ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      Opening…
                    </>
                  ) : subscriptionActive ? (
                    "Change plan (contact support)"
                  ) : (
                    "Subscribe"
                  )}
                </span>
              </button>
            )})}
          </div>
        </WorkspacePanel>

        <WorkspacePanel>
          <div className="border-b border-zinc-800 px-5 py-4">
            <h2 className="text-sm font-semibold text-foreground">Add carrier credit</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {needsCarrierCredit
                ? "Required next step: prepaid balance activates your reserved number on Telnyx."
                : "Prepaid balance funds your phone number"}{" "}
              ({billing?.telnyx_number_purchase_label ?? "$2.00"} per line) and call usage. After payment, your balance
              syncs with the Lyncr global routing network automatically.
            </p>
          </div>
          <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
            {(billing?.suggested_credit_packs_cents ?? [1000, 2500, 5000, 10000]).map((cents) => (
              <button
                key={cents}
                type="button"
                disabled={buyingPack != null}
                onClick={() => void handleBuyCredit(cents)}
                className={cn(
                  "flex flex-col items-start gap-2 rounded-xl border border-border/70 bg-card/80 p-4 text-left",
                  "transition-colors hover:border-primary/45 hover:bg-primary/5 disabled:opacity-60"
                )}
              >
                <span className="text-lg font-semibold text-foreground">{formatUsdFromCents(cents)}</span>
                <span className="text-xs text-muted-foreground">One-time · Secure checkout</span>
                <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary">
                  {buyingPack === cents ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      Opening…
                    </>
                  ) : (
                    <>
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                      Add credit
                    </>
                  )}
                </span>
              </button>
            ))}
          </div>
        </WorkspacePanel>

        <WorkspacePanel className="min-h-[300px]">
          <div className="border-b border-zinc-800 px-5 py-4">
            <h2 className="text-sm font-semibold text-foreground">Invoice ledger</h2>
          </div>
          <WorkspaceTableWrap>
            <colgroup>
              <col className="w-[40%]" />
              <col className="w-[35%]" />
              <col className="w-[25%]" />
            </colgroup>
            <thead>
              <tr>
                <WorkspaceTh>Date</WorkspaceTh>
                <WorkspaceTh>Amount</WorkspaceTh>
                <WorkspaceTh> </WorkspaceTh>
              </tr>
            </thead>
            <tbody className="min-h-[208px]">
              {INVOICES.map((row) => (
                <tr key={row.id} className={cn("hover:bg-zinc-900/40", WORKSPACE_TABLE_ROW_CLASS)}>
                  <WorkspaceTd className="text-zinc-400">{row.date}</WorkspaceTd>
                  <WorkspaceTd className="font-medium tabular-nums">{row.amount}</WorkspaceTd>
                  <WorkspaceTd className="text-right text-xs text-muted-foreground">Sample</WorkspaceTd>
                </tr>
              ))}
            </tbody>
          </WorkspaceTableWrap>
        </WorkspacePanel>
      </div>
    </WorkspacePage>
  )
})
