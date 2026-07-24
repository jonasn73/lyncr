"use client"

// In-app Stripe Connect Express — Get paid (onboarding + balance).

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ConnectAccountOnboarding,
  ConnectAccountManagement,
  ConnectComponentsProvider,
} from "@stripe/react-connect-js"
import { loadConnectAndInitialize } from "@stripe/connect-js"
import { Banknote, CheckCircle2, ExternalLink, Loader2, X } from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

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

function fmtCents(cents: number, currency = "usd"): string {
  return (Math.max(0, cents) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: currency.toUpperCase() === "USD" ? "USD" : currency.toUpperCase(),
  })
}

function statusChip(status: ConnectStatus["status"]): { label: string; className: string } {
  if (status === "ready") {
    return { label: "Ready", className: "border-emerald-500/40 bg-emerald-500/15 text-emerald-200" }
  }
  if (status === "under_review") {
    return { label: "Under review", className: "border-amber-500/40 bg-amber-500/15 text-amber-100" }
  }
  if (status === "not_configured") {
    return { label: "Unavailable", className: "border-zinc-600 bg-zinc-800 text-zinc-400" }
  }
  return { label: "Needs setup", className: "border-sky-500/40 bg-sky-500/15 text-sky-100" }
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
  const [linkBusy, setLinkBusy] = useState(false)
  const [embedLoadHint, setEmbedLoadHint] = useState(false)

  const refreshStatus = useCallback(async () => {
    setLoading(true)
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

  useEffect(() => {
    if (open) void refreshStatus()
  }, [open, refreshStatus])

  // If the white Stripe box sits on a spinner too long, nudge toward hosted setup.
  useEffect(() => {
    if (!showOnboarding || !connectInstance) {
      setEmbedLoadHint(false)
      return
    }
    const id = window.setTimeout(() => setEmbedLoadHint(true), 12_000)
    return () => window.clearTimeout(id)
  }, [showOnboarding, connectInstance])

  async function startEmbedded(components: "onboarding" | "management" | "both") {
    setSessionBusy(true)
    setError(null)
    setEmbedLoadHint(false)
    try {
      const res = await fetch("/api/payments/connect/account-session", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ components }),
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
        appearance: {
          overlays: "dialog",
          variables: {
            colorPrimary: "#10b981",
          },
        },
      })
      setConnectInstance(instance)
      setShowOnboarding(components === "onboarding" || components === "both")
      setShowManage(components === "management" || (components === "both" && status?.ready === true))
      if (components === "onboarding") {
        setShowManage(false)
        setShowOnboarding(true)
      }
      if (components === "management") {
        setShowOnboarding(false)
        setShowManage(true)
      }
      await refreshStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start payout setup")
      setConnectInstance(null)
    } finally {
      setSessionBusy(false)
    }
  }

  async function openHostedStripeSetup() {
    setLinkBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/payments/connect/account-link", {
        method: "POST",
        credentials: "include",
      })
      const json = (await res.json()) as { error?: string; data?: { url?: string } }
      if (!res.ok || !json.data?.url) {
        throw new Error(json.error || "Could not open Stripe setup")
      }
      window.location.href = json.data.url
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open Stripe setup")
      setLinkBusy(false)
    }
  }

  const chip = useMemo(
    () => statusChip(status?.status || "needs_setup"),
    [status?.status]
  )

  const embedding = Boolean(connectInstance && (showOnboarding || showManage))

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        overlayClassName="z-[7000]"
        className={cn(
          "z-[7010] flex flex-col gap-0 overflow-hidden rounded-t-2xl border-zinc-800 bg-[#101018] p-0 sm:max-w-lg sm:rounded-2xl",
          // Give Stripe’s form room — cramped sheets often stick on a spinner.
          embedding ? "h-[96dvh] max-h-[96dvh]" : "max-h-[92dvh]"
        )}
      >
        <SheetHeader className="shrink-0 border-b border-zinc-800 px-4 py-3 text-left">
          <div className="flex items-start justify-between gap-3">
            <div>
              <SheetTitle className="text-base font-bold text-white">Get paid</SheetTitle>
              <p className="mt-0.5 text-xs text-zinc-500">
                Customers pay your business. Payouts go to your bank automatically.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-lg p-2 text-zinc-400 hover:text-white"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          {loading && !status ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                    chip.className
                  )}
                >
                  {chip.label}
                </span>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void refreshStatus()}
                  className="text-[11px] font-semibold text-sky-300 disabled:opacity-50"
                >
                  Refresh
                </button>
              </div>

              {status?.ready ? (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-4">
                  <div className="flex items-center gap-2 text-emerald-100">
                    <CheckCircle2 className="h-5 w-5" aria-hidden />
                    <p className="text-sm font-semibold">Ready to collect payments</p>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-200/70">
                        Available
                      </p>
                      <p className="mt-0.5 text-lg font-bold tabular-nums text-emerald-200">
                        {fmtCents(status.availableCents, status.currency)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-200/70">
                        Pending
                      </p>
                      <p className="mt-0.5 text-lg font-bold tabular-nums text-emerald-200">
                        {fmtCents(status.pendingCents, status.currency)}
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] text-emerald-200/70">
                    Stripe pays out to your linked bank on a regular schedule. Lyncr fee:{" "}
                    {status.feeLabel}.
                  </p>
                </div>
              ) : embedding ? null : (
                <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-500/20 text-sky-300">
                      <Banknote className="h-5 w-5" aria-hidden />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-sky-50">Set up payouts in Lyncr</p>
                      <p className="mt-1 text-xs leading-relaxed text-sky-100/75">
                        Verify your business and bank once. Your customers will see{" "}
                        <strong className="font-semibold text-sky-50">your</strong> business on their
                        statement — not Lyncr’s.
                      </p>
                      {status?.message ? (
                        <p className="mt-2 text-xs text-amber-100/90">{status.message}</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              )}

              {error ? (
                <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                  {error}
                </p>
              ) : null}

              {!embedding ? (
                <div className="flex flex-col gap-2">
                  {!status?.ready ? (
                    <>
                      <button
                        type="button"
                        disabled={sessionBusy || status?.status === "not_configured"}
                        onClick={() => void startEmbedded("onboarding")}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                      >
                        {sessionBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Banknote className="h-4 w-4" />
                        )}
                        {status?.detailsSubmitted ? "Continue setup" : "Set up payouts"}
                      </button>
                      <button
                        type="button"
                        disabled={linkBusy || status?.status === "not_configured"}
                        onClick={() => void openHostedStripeSetup()}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-600 bg-zinc-900 py-2.5 text-sm font-semibold text-slate-100 disabled:opacity-50"
                      >
                        {linkBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ExternalLink className="h-4 w-4" />
                        )}
                        Open setup in browser
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={sessionBusy}
                      onClick={() => void startEmbedded("management")}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-600 bg-zinc-900 py-3 text-sm font-semibold text-slate-100 disabled:opacity-50"
                    >
                      {sessionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Manage bank & business details
                    </button>
                  )}
                </div>
              ) : null}

              {embedding ? (
                <div className="flex min-h-0 flex-1 flex-col gap-2">
                  {embedLoadHint ? (
                    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                      Still loading? Use browser setup instead — it works better on phones.
                      <button
                        type="button"
                        disabled={linkBusy}
                        onClick={() => void openHostedStripeSetup()}
                        className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500/20 py-2 font-semibold text-amber-50"
                      >
                        {linkBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ExternalLink className="h-3.5 w-3.5" />
                        )}
                        Open setup in browser
                      </button>
                    </div>
                  ) : null}
                  <div className="min-h-[min(70dvh,640px)] overflow-auto rounded-xl border border-zinc-800 bg-white p-2">
                    <ConnectComponentsProvider connectInstance={connectInstance!}>
                      {showOnboarding ? (
                        <ConnectAccountOnboarding
                          onExit={() => {
                            setShowOnboarding(false)
                            setConnectInstance(null)
                            void refreshStatus()
                          }}
                          onLoadError={({ error: loadError }) => {
                            setError(
                              loadError?.message ||
                                "Stripe form failed to load. Try Open setup in browser."
                            )
                            setEmbedLoadHint(true)
                          }}
                        />
                      ) : null}
                      {showManage ? <ConnectAccountManagement /> : null}
                    </ConnectComponentsProvider>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
