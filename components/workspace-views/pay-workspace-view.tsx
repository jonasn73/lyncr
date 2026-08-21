"use client"

import { memo, Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Loader2, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatUsdFromCents } from "@/lib/billing-pricing"
import { confirmCreditPackCheckout, startCreditPackCheckout, startStripeSubscriptionCheckout } from "@/lib/onboarding-profile-client"
import { LOW_CARRIER_CREDIT_THRESHOLD_USD } from "@/lib/carrier-credit-threshold"
import { CHECKOUT_TIER_OPTIONS, type CheckoutSubscriptionTier } from "@/lib/subscription-checkout"
import {
  readBillingSummaryCache,
  writeBillingSummaryCache,
  type BillingSummaryCache,
} from "@/lib/billing-summary-cache"
import { useDashboardPaintSeeds } from "@/lib/dashboard-paint-seeds"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"
import { useSessionSeed } from "@/lib/hooks/use-client-seed"
import { useToast } from "@/hooks/use-toast"
import {
  WorkspacePage,
  WorkspacePageHeader,
  WorkspacePanel,
  WorkspaceStatCard,
  WorkspaceTableWrap,
  WorkspaceTh,
  WorkspaceTd,
  WORKSPACE_TABLE_ROW_CLASS,
} from "@/components/dashboard-workspace-ui"

type BillingSummary = BillingSummaryCache

/** Minimal shape we read from /api/calls for the talk-time consumption ledger. */
type TalkTimeCall = {
  id: string
  created_at: string
  duration_seconds: number
  routed_to_name: string | null
  status: string
}

const CALLS_LEDGER_CACHE_KEY = persistedCacheKey("pay-talk-ledger", "default")
const EMPTY_CALLS: TalkTimeCall[] = []

function readCallsLedgerCache(): TalkTimeCall[] {
  const cached = readPersistedCache<{ calls: TalkTimeCall[] }>(CALLS_LEDGER_CACHE_KEY)
  return Array.isArray(cached?.calls) ? cached.calls : EMPTY_CALLS
}

function formatLedgerDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  return `${date}, ${time}`
}

/** Round seconds to a tenth of a minute for display. */
function minutesFromSeconds(seconds: number): number {
  return Math.round((seconds / 60) * 10) / 10
}

/** Stripe return URL — isolated so useSearchParams cannot remount the Pay pane. */
function PayCreditCheckoutBridge({
  refreshBilling,
}: {
  refreshBilling: () => Promise<void>
}) {
  const searchParams = useSearchParams()
  const { toast } = useToast()

  useEffect(() => {
    const checkout = searchParams.get("credit_checkout")
    const sessionId = searchParams.get("session_id")
    if (checkout !== "success" || !sessionId) return

    void (async () => {
      try {
        const result = await confirmCreditPackCheckout(sessionId)
        toast({
          title: "Carrier credit added",
          description: `New balance: ${formatUsdFromCents(result.balance_after_cents)}.`,
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

  return null
}

export const PayWorkspaceView = memo(function PayWorkspaceView({
  isActive = true,
}: {
  isActive?: boolean
}) {
  const { toast } = useToast()
  const paint = useDashboardPaintSeeds()
  const billingPaint = paint.billing
  // Last-known wallet / ledger before fetch — avoids $0.00 flash on Pay tab.
  const billingSeed = useSessionSeed(
    () => readBillingSummaryCache(undefined, billingPaint),
    null,
    "billing-summary"
  )
  const callsSeed = useSessionSeed(readCallsLedgerCache, EMPTY_CALLS, "calls-ledger")
  const [liveBilling, setLiveBilling] = useState<BillingSummary | null>(null)
  const billing = liveBilling ?? billingSeed
  const [loadError, setLoadError] = useState<string | null>(null)
  const [buyingPack, setBuyingPack] = useState<number | null>(null)
  const [checkoutTier, setCheckoutTier] = useState<CheckoutSubscriptionTier | null>(null)
  const [liveCalls, setLiveCalls] = useState<TalkTimeCall[] | null>(null)
  const calls = liveCalls ?? callsSeed
  // Seeded ledger paints immediately — never flash “Loading talk-time…” on revisit / hard refresh.
  const [callsLoaded, setCallsLoaded] = useState(() => callsSeed.length > 0)

  useEffect(() => {
    if (callsSeed.length > 0) setCallsLoaded(true)
  }, [callsSeed.length])

  const refreshBilling = useCallback(async () => {
    setLoadError(null)
    const res = await fetch("/api/billing/summary", { credentials: "include" })
    if (res.status === 401) throw new Error("Sign in again to view billing.")
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(j.error || "Billing unavailable")
    }
    const json = (await res.json()) as { data?: BillingSummary }
    const next = json.data ?? null
    setLiveBilling(next)
    if (next) writeBillingSummaryCache(next)
  }, [])

  useEffect(() => {
    if (!isActive) return
    void refreshBilling().catch((e) => {
      // Keep session seed on failure — avoid blanking a painted wallet.
      if (!billingSeed) setLiveBilling(null)
      setLoadError(e instanceof Error ? e.message : "Could not load billing")
    })
  }, [refreshBilling, billingSeed, isActive])

  useEffect(() => {
    if (!isActive) return
    let cancelled = false
    fetch("/api/calls?limit=50", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("calls"))))
      .then((j: { calls?: TalkTimeCall[] }) => {
        if (cancelled) return
        const next = Array.isArray(j.calls) ? j.calls : []
        setLiveCalls((prev) => {
          const baseline = prev ?? callsSeed
          const same =
            baseline.length === next.length &&
            baseline.every(
              (row, i) =>
                row.id === next[i]?.id &&
                row.duration_seconds === next[i]?.duration_seconds &&
                row.routed_to_name === next[i]?.routed_to_name &&
                row.created_at === next[i]?.created_at
            )
          return same ? prev ?? baseline : next
        })
        writePersistedCache(CALLS_LEDGER_CACHE_KEY, { calls: next })
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setCallsLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [isActive, callsSeed])

  const balanceLabel = billing?.credit_balance_label ?? "—"
  const subscriptionActive = billing?.subscription_active === true
  const needsCarrierCredit = billing?.needs_carrier_credit === true
  const lowCarrierCreditWarning = billing?.low_carrier_credit_warning === true
  const lowCreditThreshold = billing?.low_carrier_credit_threshold_usd ?? LOW_CARRIER_CREDIT_THRESHOLD_USD

  const meteredRate = billing?.metered_voice_cents_per_minute ?? 0
  // Only use 0 cents when we have a real billing object — never while still loading.
  const balanceCents = billing?.credit_balance_cents ?? null
  const balanceKnown = balanceCents != null

  // Reframe the prepaid balance as available talk-time at the metered per-minute rate.
  const availableTalkMinutes = useMemo(() => {
    if (!balanceKnown || balanceCents == null || meteredRate <= 0) return null
    return Math.max(0, Math.floor(balanceCents / meteredRate))
  }, [balanceCents, balanceKnown, meteredRate])

  // Build the consumption ledger from answered/talked calls: each call's billed cost = minutes × rate.
  const ledger = useMemo(() => {
    return calls
      .filter((c) => Number(c.duration_seconds) > 0)
      .map((c) => {
        const seconds = Number(c.duration_seconds) || 0
        const costCents = Math.round((seconds / 60) * meteredRate)
        return {
          id: c.id,
          date: formatLedgerDate(c.created_at),
          operator: c.routed_to_name?.trim() || "Unrouted",
          minutes: minutesFromSeconds(seconds),
          costCents,
        }
      })
  }, [calls, meteredRate])

  const consumedSeconds = useMemo(
    () => calls.reduce((sum, c) => sum + (Number(c.duration_seconds) || 0), 0),
    [calls]
  )
  const consumedCostCents = useMemo(
    () => ledger.reduce((sum, row) => sum + row.costCents, 0),
    [ledger]
  )
  const rateLabel = formatUsdFromCents(meteredRate)

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
      {/* Isolated Suspense: checkout query must not unmount painted Pay chrome. */}
      <Suspense fallback={null}>
        <PayCreditCheckoutBridge refreshBilling={refreshBilling} />
      </Suspense>
      <WorkspacePageHeader eyebrow="Lyncr bill" title="Your Lyncr subscription" />
      <p className="text-sm text-muted-foreground">
        This is what you pay Lyncr for the app — not customer Collect charges.
      </p>

      {loadError ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {loadError}
        </p>
      ) : null}

      {needsCarrierCredit ? (
        <p className="rounded-xl border border-amber-500/35 bg-amber-950/35 px-4 py-3 text-sm text-foreground/90">
          Your subscription is active, but your line is not live yet. Add at least{" "}
          {billing?.telnyx_number_purchase_label ?? "$2.00"} carrier credit below — then we will purchase and wire
          your number automatically.
        </p>
      ) : null}

      {lowCarrierCreditWarning ? (
        <p className="rounded-xl border border-rose-500/35 bg-rose-950/30 px-4 py-3 text-sm text-foreground/90">
          Your carrier credit is below ${lowCreditThreshold.toFixed(2)} ({balanceLabel} remaining). Add credit below
          soon so calls keep routing without interruption.
        </p>
      ) : null}

      <div className="flex flex-col gap-8">
        <div className="grid min-h-[5.75rem] gap-4 sm:grid-cols-2">
          <WorkspaceStatCard
            label="Lyncr Talk-Time Balance"
            value={balanceLabel}
            hint={
              availableTalkMinutes != null
                ? `≈ ${availableTalkMinutes.toLocaleString()} min of live operator time at ${rateLabel}/min`
                : "Add carrier credit below to start routing"
            }
            accent="primary"
          />
          <WorkspaceStatCard
            label="Talk-time used (recent)"
            value={`${minutesFromSeconds(consumedSeconds).toLocaleString()} min`}
            hint={
              !callsLoaded
                ? "Loading usage…"
                : meteredRate > 0
                  ? `${formatUsdFromCents(consumedCostCents)} across ${ledger.length} answered call${ledger.length === 1 ? "" : "s"}`
                  : `${ledger.length} answered call${ledger.length === 1 ? "" : "s"}`
            }
            accent="success"
          />
        </div>

        <WorkspacePanel>
          <div className="border-b border-zinc-800 px-5 py-4">
            <h2 className="text-sm font-semibold text-foreground">Subscription plans</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Each plan maps to a Stripe price — Starter ($19), Professional ($49), or Business ($99) per month.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 p-5 md:grid-cols-3">
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
                ? "Required next step: prepaid balance activates your reserved number on the network."
                : "Prepaid balance funds your phone number"}{" "}
              ({billing?.telnyx_number_purchase_label ?? "$2.00"} per line) and call usage. After payment, your prepaid
              balance updates automatically.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
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
            <h2 className="text-sm font-semibold text-foreground">Talk-time consumption</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Live operator minutes deducted from your balance, billed at {rateLabel}/min.
            </p>
          </div>
          <WorkspaceTableWrap bleed>
            <colgroup>
              <col className="w-[28%]" />
              <col className="w-[34%]" />
              <col className="w-[18%]" />
              <col className="w-[20%]" />
            </colgroup>
            <thead>
              <tr>
                <WorkspaceTh>Date/Time</WorkspaceTh>
                <WorkspaceTh>Answered By</WorkspaceTh>
                <WorkspaceTh>Duration (Min)</WorkspaceTh>
                <WorkspaceTh>Total Deducted</WorkspaceTh>
              </tr>
            </thead>
            {callsLoaded && ledger.length > 0 ? (
              <tbody>
                {ledger.map((row) => (
                  <tr key={row.id} className={cn("hover:bg-zinc-900/40", WORKSPACE_TABLE_ROW_CLASS)}>
                    <WorkspaceTd className="text-zinc-400">{row.date}</WorkspaceTd>
                    <WorkspaceTd className="font-medium text-foreground">{row.operator}</WorkspaceTd>
                    <WorkspaceTd className="tabular-nums text-zinc-300">{row.minutes} min</WorkspaceTd>
                    <WorkspaceTd className="font-medium tabular-nums text-foreground">
                      {meteredRate > 0 ? formatUsdFromCents(row.costCents) : "—"}
                    </WorkspaceTd>
                  </tr>
                ))}
              </tbody>
            ) : null}
          </WorkspaceTableWrap>
          {!callsLoaded || ledger.length === 0 ? (
            <div className="flex min-h-[208px] items-center justify-center border-t border-zinc-800/50 px-5 py-12 text-center text-sm text-zinc-500">
              {!callsLoaded ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
                  Loading talk-time…
                </span>
              ) : (
                "No operator talk-time recorded yet."
              )}
            </div>
          ) : null}
        </WorkspacePanel>
      </div>
    </WorkspacePage>
  )
})
