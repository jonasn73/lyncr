"use client"

// In-app Stripe Connect — Get paid (onboarding, balance, manual bank transfer).

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ConnectAccountOnboarding,
  ConnectAccountManagement,
  ConnectComponentsProvider,
} from "@stripe/react-connect-js"
import { loadConnectAndInitialize } from "@stripe/connect-js"
import { Banknote, CheckCircle2, Loader2, RefreshCw, X } from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"

type PayoutRow = {
  id: string
  amountCents: number
  currency: string
  status: string
  arrivalDateLabel: string
  createdLabel: string
  method: string
  failureMessage: string | null
}

/** Mirrors ConnectBusinessKind in lib/stripe-connect (keep client bundle free of Stripe server SDK). */
type ConnectBusinessKind = "sole" | "llc" | "corporation"

type ConnectStatus = {
  configured: boolean
  ready: boolean
  status: "ready" | "under_review" | "needs_setup" | "not_configured"
  accountId: string | null
  chargesEnabled: boolean
  payoutsEnabled: boolean
  detailsSubmitted: boolean
  availableCents: number
  pendingCents: number
  currency: string
  feeLabel: string
  message: string | null
}

const BUSINESS_KINDS: {
  id: ConnectBusinessKind
  title: string
  subtitle: string
}[] = [
  { id: "sole", title: "Sole proprietor", subtitle: "Just you — not an LLC" },
  { id: "llc", title: "LLC", subtitle: "Most shops — Single-member LLC" },
  { id: "corporation", title: "Corporation", subtitle: "Inc. / private corp" },
]

function fmtCents(cents: number, currency = "usd"): string {
  return (Math.max(0, cents) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: currency.toUpperCase() === "USD" ? "USD" : currency.toUpperCase(),
  })
}

function statusChip(status: ConnectStatus["status"]): { label: string; className: string } {
  if (status === "ready") {
    return { label: "Ready", className: "border-success/40 bg-success/15 text-success" }
  }
  if (status === "under_review") {
    return { label: "Under review", className: "border-warning/40 bg-warning/15 text-warning" }
  }
  if (status === "not_configured") {
    return { label: "Unavailable", className: "border-border bg-muted text-muted-foreground" }
  }
  return { label: "Needs setup", className: "border-sky-500/40 bg-sky-500/15 text-sky-100" }
}

function payoutStatusClass(status: string): string {
  const s = status.toLowerCase()
  if (s === "paid") return "border-success/35 bg-success/10 text-success"
  if (s === "pending" || s === "in_transit") {
    return "border-warning/35 bg-warning/10 text-warning"
  }
  if (s === "failed" || s === "canceled") {
    return "border-rose-500/35 bg-rose-500/10 text-rose-300"
  }
  return "border-border bg-card text-muted-foreground"
}

/** Lyncr dark theme for Stripe Connect embeds. */
const LYNCR_CONNECT_APPEARANCE = {
  overlays: "dialog" as const,
  variables: {
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif",
    fontSizeBase: "13px",
    borderRadius: "8px",
    // Tighter than Stripe default — less scroll on phones.
    spacingUnit: "8px",
    colorPrimary: "#10b981",
    colorBackground: "#101018",
    formBackgroundColor: "#101018",
    offsetBackgroundColor: "#18181f",
    colorText: "#e4e4e7",
    colorSecondaryText: "#a1a1aa",
    colorBorder: "#27272a",
    colorDanger: "#fb7185",
    buttonPrimaryColorBackground: "#059669",
    buttonPrimaryColorBorder: "#059669",
    buttonPrimaryColorText: "#ffffff",
    buttonSecondaryColorBackground: "#18181f",
    buttonSecondaryColorText: "#e4e4e7",
    actionSecondaryColorText: "#6ee7b7",
    actionSecondaryTextDecorationColor: "#6ee7b7",
    badgeNeutralColorBackground: "#18181f",
    badgeNeutralColorBorder: "#27272a",
    badgeNeutralColorText: "#a1a1aa",
    badgeSuccessColorBackground: "#052e1c",
    badgeSuccessColorBorder: "#065f46",
    badgeSuccessColorText: "#6ee7b7",
    badgeWarningColorBackground: "#422006",
    badgeWarningColorBorder: "#854d0e",
    badgeWarningColorText: "#fde68a",
    badgeDangerColorBackground: "#4c0519",
    badgeDangerColorBorder: "#9f1239",
    badgeDangerColorText: "#fda4af",
    overlayBackdropColor: "rgba(0,0,0,0.65)",
  },
}

export function GetPaidSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [status, setStatus] = useState<ConnectStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connectInstance, setConnectInstance] = useState<ReturnType<
    typeof loadConnectAndInitialize
  > | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [showManage, setShowManage] = useState(false)
  const [sessionBusy, setSessionBusy] = useState(false)
  const [businessKind, setBusinessKind] = useState<ConnectBusinessKind>("llc")
  const [formReady, setFormReady] = useState(false)
  const [payouts, setPayouts] = useState<PayoutRow[]>([])
  const [payoutsLoading, setPayoutsLoading] = useState(false)
  const [transferDollars, setTransferDollars] = useState("")
  const [transferBusy, setTransferBusy] = useState(false)
  const { toast } = useToast()

  const refreshStatus = useCallback(async (opts?: { quiet?: boolean }) => {
    // Quiet refresh keeps the last status visible (no full-sheet spinner on reopen).
    if (!opts?.quiet) setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/payments/connect/status", {
        credentials: "include",
        cache: "no-store",
      })
      const json = (await res.json()) as { error?: string; data?: ConnectStatus }
      if (!res.ok || !json.data) throw new Error(json.error || "Could not load payout status")
      setStatus(json.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load payout status")
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshPayouts = useCallback(async () => {
    setPayoutsLoading(true)
    try {
      const res = await fetch("/api/payments/connect/payouts?limit=20", {
        credentials: "include",
        cache: "no-store",
      })
      const json = (await res.json()) as { error?: string; data?: { payouts?: PayoutRow[] } }
      if (!res.ok) throw new Error(json.error || "Could not load bank transfers")
      setPayouts(Array.isArray(json.data?.payouts) ? json.data!.payouts! : [])
    } catch (e) {
      // Keep prior list; surface message only when ready (transfer section visible).
      console.warn("[get-paid] payouts list:", e)
    } finally {
      setPayoutsLoading(false)
    }
  }, [])

  async function sendToBank(opts?: { fullAvailable?: boolean }) {
    setTransferBusy(true)
    setError(null)
    try {
      let amountCents: number | undefined
      if (!opts?.fullAvailable) {
        const dollars = parseFloat(transferDollars)
        if (!Number.isFinite(dollars) || dollars < 1) {
          throw new Error("Enter at least $1.00, or tap Send all available.")
        }
        amountCents = Math.round(dollars * 100)
      }
      const res = await fetch("/api/payments/connect/payouts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          opts?.fullAvailable
            ? { fullAvailable: true }
            : { amountCents }
        ),
      })
      const json = (await res.json()) as {
        error?: string
        data?: { payout?: PayoutRow }
      }
      if (!res.ok || !json.data?.payout) {
        throw new Error(json.error || "Could not transfer to bank")
      }
      const paid = json.data.payout
      toast({
        title: "Transfer started",
        description: `${fmtCents(paid.amountCents, paid.currency)} is on the way to your bank (usually 1–2 business days).`,
      })
      setTransferDollars("")
      await Promise.all([refreshStatus({ quiet: true }), refreshPayouts()])
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not transfer to bank"
      setError(message)
      toast({ title: "Transfer failed", description: message, variant: "destructive" })
    } finally {
      setTransferBusy(false)
    }
  }

  useEffect(() => {
    if (!open) return
    // Status + payout history in parallel — don’t wait for status.ready to start bank list.
    void Promise.all([
      refreshStatus({ quiet: Boolean(status) }),
      refreshPayouts(),
    ])
    // Only re-run when the sheet opens — not on every status update.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional open-only refresh
  }, [open, refreshStatus, refreshPayouts])

  async function startEmbedded(components: "onboarding" | "management" | "both") {
    setSessionBusy(true)
    setError(null)
    setFormReady(false)
    try {
      const res = await fetch("/api/payments/connect/account-session", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          components,
          business_kind: components === "onboarding" ? businessKind : undefined,
        }),
      })
      const json = (await res.json()) as {
        error?: string
        data?: { clientSecret?: string; publishableKey?: string | null }
      }
      if (!res.ok || !json.data?.clientSecret) {
        throw new Error(json.error || "Could not start payout setup")
      }
      const pk = json.data.publishableKey?.trim()
      if (!pk) throw new Error("Missing Stripe publishable key")

      const secret = json.data.clientSecret
      const instance = loadConnectAndInitialize({
        publishableKey: pk,
        fetchClientSecret: async () => secret,
        appearance: LYNCR_CONNECT_APPEARANCE,
      })
      setConnectInstance(instance)
      if (components === "onboarding") {
        setShowManage(false)
        setShowOnboarding(true)
      } else if (components === "management") {
        setShowOnboarding(false)
        setShowManage(true)
      } else {
        setShowOnboarding(true)
        setShowManage(status?.ready === true)
      }
      await refreshStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start payout setup")
      setConnectInstance(null)
    } finally {
      setSessionBusy(false)
    }
  }

  const chip = useMemo(
    () => statusChip(status?.status || "needs_setup"),
    [status?.status]
  )

  const embedding = Boolean(connectInstance && (showOnboarding || showManage))

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setShowOnboarding(false)
          setShowManage(false)
          setConnectInstance(null)
          setFormReady(false)
        }
        onOpenChange(next)
      }}
    >
      <SheetContent
        side="bottom"
        showCloseButton={false}
        overlayClassName="z-[7000]"
        className={cn(
          "z-[7010] flex flex-col gap-0 overflow-hidden rounded-t-2xl border-border bg-[#101018] p-0 sm:max-w-lg sm:rounded-2xl",
          embedding ? "h-[96dvh] max-h-[96dvh]" : "max-h-[92dvh]"
        )}
      >
        <SheetHeader
          className={cn(
            "shrink-0 border-b border-border text-left",
            embedding ? "px-4 py-3" : "px-4 py-3"
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle className="text-base font-bold text-white">
                {embedding
                  ? "Finish bank setup"
                  : status?.ready
                    ? "Bank account"
                    : "Set up bank"}
              </SheetTitle>
              {embedding ? null : (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {status?.ready
                    ? "Change bank details here. Send money from the Money wallet."
                    : "Add your bank so card money can go to you."}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-lg p-2 text-muted-foreground hover:text-white"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </SheetHeader>

        {/* When Stripe form is open: only the form — no extra chrome (less scroll). */}
        {embedding ? (
          <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-1">
            {!formReady ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#101018]/90">
                <Loader2 className="h-5 w-5 animate-spin text-success" aria-hidden />
              </div>
            ) : null}
            <ConnectComponentsProvider connectInstance={connectInstance!}>
              {showOnboarding ? (
                <ConnectAccountOnboarding
                  collectionOptions={{
                    fields: "currently_due",
                    futureRequirements: "omit",
                  }}
                  onExit={() => {
                    setShowOnboarding(false)
                    setConnectInstance(null)
                    setFormReady(false)
                    void refreshStatus()
                  }}
                  onLoaderStart={() => setFormReady(true)}
                  onLoadError={({ error: loadError }) => {
                    setError(
                      loadError?.message ||
                        "Could not load the payout form. Close and try Set up payouts again."
                    )
                    setFormReady(true)
                  }}
                />
              ) : null}
              {showManage ? <ConnectAccountManagement /> : null}
            </ConnectComponentsProvider>
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
            {loading && !status ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "inline-flex rounded-full border px-3 py-1 text-2xs font-semibold",
                      chip.className
                    )}
                  >
                    {chip.label}
                  </span>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void refreshStatus()}
                    className="text-2xs font-semibold text-sky-300 disabled:opacity-50"
                  >
                    Refresh
                  </button>
                </div>

                {status?.ready ? (
                  <div className="rounded-xl border border-success/30 bg-success/10 px-4 py-3">
                    <div className="flex items-center gap-2 text-success">
                      <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
                      <p className="text-sm font-semibold">Bank is connected</p>
                    </div>
                    <p className="mt-1.5 text-2xs leading-snug text-success/70">
                      Wallet and Send to bank live on Money. This page is only for bank details and
                      past transfers.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-3">
                    <p className="text-sm font-semibold text-sky-50">Set up payouts in Lyncr</p>
                    <p className="mt-1 text-xs leading-relaxed text-sky-100/75">
                      Pick your business type (short), then finish bank details. Customers see{" "}
                      <strong className="font-semibold text-sky-50">your</strong> name on the
                      statement.
                    </p>
                    {status?.message ? (
                      <p className="mt-2 text-xs text-warning/90">{status.message}</p>
                    ) : null}
                  </div>
                )}

                {error ? (
                  <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                    {error}
                  </p>
                ) : null}

                {!status?.ready ? (
                  <>
                    <div>
                      <p className="mb-1.5 px-0.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Business type
                      </p>
                      <div className="grid gap-2">
                        {BUSINESS_KINDS.map((k) => {
                          const selected = businessKind === k.id
                          return (
                            <button
                              key={k.id}
                              type="button"
                              onClick={() => setBusinessKind(k.id)}
                              className={cn(
                                "flex items-center justify-between gap-2 rounded-xl border px-3 py-3 text-left transition-colors",
                                selected
                                  ? "border-success/60 bg-success/10"
                                  : "border-border bg-background/40 hover:border-border"
                              )}
                            >
                              <span>
                                <span className="block text-sm font-semibold text-foreground">
                                  {k.title}
                                </span>
                                <span className="block text-2xs text-muted-foreground">{k.subtitle}</span>
                              </span>
                              <span
                                className={cn(
                                  "h-4 w-4 shrink-0 rounded-full border-2",
                                  selected
                                    ? "border-success bg-success"
                                    : "border-border"
                                )}
                                aria-hidden
                              />
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={sessionBusy || status?.status === "not_configured"}
                      onClick={() => void startEmbedded("onboarding")}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-success py-3 text-sm font-semibold text-white hover:bg-success disabled:opacity-50"
                    >
                      {sessionBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Banknote className="h-4 w-4" />
                      )}
                      {status?.detailsSubmitted ? "Continue setup" : "Continue"}
                    </button>
                  </>
                ) : (
                  <>
                    {/* Manual bank transfer — only when something is actually ready */}
                    <section className="space-y-2 rounded-xl border border-border bg-background/50 px-3 py-3">
                      <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Send to bank
                      </p>
                      {!status.payoutsEnabled ? (
                        <p className="text-xs text-warning/90">
                          Stripe has not enabled bank payouts yet. Open Manage bank below, or wait
                          for approval.
                        </p>
                      ) : status.availableCents < 100 ? (
                        <p className="text-xs text-muted-foreground">
                          Nothing ready yet. Close this and use Money — Send to bank appears there
                          after charges clear (usually 1–2 days).
                        </p>
                      ) : (
                        <>
                          <label className="block">
                            <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Amount (USD)
                            </span>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={transferDollars}
                              onChange={(e) => setTransferDollars(e.target.value)}
                              placeholder={(status.availableCents / 100).toFixed(2)}
                              className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-3 text-sm text-white outline-none placeholder:text-muted-foreground"
                            />
                          </label>
                          <button
                            type="button"
                            disabled={transferBusy}
                            onClick={() => void sendToBank()}
                            className="flex w-full items-center justify-center gap-2 rounded-xl bg-success py-3 text-sm font-semibold text-white hover:bg-success disabled:opacity-50"
                          >
                            {transferBusy ? (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                            ) : (
                              <Banknote className="h-4 w-4" aria-hidden />
                            )}
                            Transfer to bank
                          </button>
                          <button
                            type="button"
                            disabled={transferBusy}
                            onClick={() => void sendToBank({ fullAvailable: true })}
                            className="w-full rounded-xl border border-border py-3 text-sm font-semibold text-foreground hover:bg-card disabled:opacity-50"
                          >
                            Send all available ({fmtCents(status.availableCents, status.currency)})
                          </button>
                          <p className="text-2xs leading-snug text-muted-foreground">
                            Standard transfer — usually arrives in 1–2 business days.
                          </p>
                        </>
                      )}
                    </section>

                    {/* Bank transfer history */}
                    <section className="space-y-2">
                      <div className="flex items-center justify-between gap-2 px-0.5">
                        <div className="min-w-0">
                          <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Bank transfers (net to bank)
                          </p>
                          <p className="mt-0.5 text-micro leading-snug text-muted-foreground">
                            Recent payouts only — amount after fees, not the Collected total.
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={payoutsLoading}
                          onClick={() => void refreshPayouts()}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-2xs font-semibold text-sky-300 disabled:opacity-50"
                        >
                          <RefreshCw
                            className={cn("h-3.5 w-3.5", payoutsLoading && "animate-spin")}
                            aria-hidden
                          />
                          Refresh
                        </button>
                      </div>
                      {payoutsLoading && payouts.length === 0 ? (
                        <p className="py-4 text-center text-xs text-muted-foreground">Loading transfers…</p>
                      ) : payouts.length === 0 ? (
                        <p className="rounded-xl border border-border bg-background/40 px-3 py-4 text-center text-xs text-muted-foreground">
                          No bank transfers yet. When you send money (or Stripe auto-pays), it
                          shows here.
                        </p>
                      ) : (
                        <ul className="space-y-2">
                          {payouts.map((p) => (
                            <li
                              key={p.id}
                              className="rounded-xl border border-border bg-card/50 px-3 py-3"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold tabular-nums text-foreground">
                                    {fmtCents(p.amountCents, p.currency)}
                                  </p>
                                  <p className="mt-0.5 text-2xs text-muted-foreground">
                                    {p.createdLabel}
                                    {p.arrivalDateLabel !== "—"
                                      ? ` · arrives ${p.arrivalDateLabel}`
                                      : ""}
                                  </p>
                                  {p.failureMessage ? (
                                    <p className="mt-1 text-2xs text-rose-300">
                                      {p.failureMessage}
                                    </p>
                                  ) : null}
                                </div>
                                <span
                                  className={cn(
                                    "shrink-0 rounded-full border px-2 py-0.5 text-micro font-semibold uppercase tracking-wide",
                                    payoutStatusClass(p.status)
                                  )}
                                >
                                  {p.status.replace(/_/g, " ")}
                                </span>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>

                    <button
                      type="button"
                      disabled={sessionBusy}
                      onClick={() => void startEmbedded("management")}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card py-3 text-sm font-semibold text-foreground disabled:opacity-50"
                    >
                      {sessionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Manage bank & business details
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
