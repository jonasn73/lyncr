"use client"

// In-app Stripe Connect — Get paid (onboarding + balance).

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ConnectAccountOnboarding,
  ConnectAccountManagement,
  ConnectComponentsProvider,
} from "@stripe/react-connect-js"
import { loadConnectAndInitialize } from "@stripe/connect-js"
import { Banknote, CheckCircle2, Loader2, X } from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

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

  useEffect(() => {
    if (!open) return
    void refreshStatus({ quiet: Boolean(status) })
    // Only re-run when the sheet opens — not on every status update.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional open-only refresh
  }, [open, refreshStatus])

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
          "z-[7010] flex flex-col gap-0 overflow-hidden rounded-t-2xl border-zinc-800 bg-[#101018] p-0 sm:max-w-lg sm:rounded-2xl",
          embedding ? "h-[96dvh] max-h-[96dvh]" : "max-h-[92dvh]"
        )}
      >
        <SheetHeader
          className={cn(
            "shrink-0 border-b border-zinc-800 text-left",
            embedding ? "px-4 py-2.5" : "px-4 py-3"
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle className="text-base font-bold text-white">
                {embedding ? "Finish payout setup" : "Get paid"}
              </SheetTitle>
              {embedding ? null : (
                <p className="mt-0.5 text-xs text-zinc-500">
                  Customers pay your business. Payouts go to your bank automatically.
                </p>
              )}
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

        {/* When Stripe form is open: only the form — no extra chrome (less scroll). */}
        {embedding ? (
          <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-1">
            {!formReady ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#101018]/90">
                <Loader2 className="h-5 w-5 animate-spin text-emerald-400" aria-hidden />
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
                ) : (
                  <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-3">
                    <p className="text-sm font-semibold text-sky-50">Set up payouts in Lyncr</p>
                    <p className="mt-1 text-xs leading-relaxed text-sky-100/75">
                      Pick your business type (short), then finish bank details. Customers see{" "}
                      <strong className="font-semibold text-sky-50">your</strong> name on the
                      statement.
                    </p>
                    {status?.message ? (
                      <p className="mt-2 text-xs text-amber-100/90">{status.message}</p>
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
                      <p className="mb-1.5 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                        Business type
                      </p>
                      <div className="grid gap-1.5">
                        {BUSINESS_KINDS.map((k) => {
                          const selected = businessKind === k.id
                          return (
                            <button
                              key={k.id}
                              type="button"
                              onClick={() => setBusinessKind(k.id)}
                              className={cn(
                                "flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors",
                                selected
                                  ? "border-emerald-500/60 bg-emerald-500/10"
                                  : "border-zinc-800 bg-zinc-950/40 hover:border-zinc-700"
                              )}
                            >
                              <span>
                                <span className="block text-sm font-semibold text-zinc-100">
                                  {k.title}
                                </span>
                                <span className="block text-[11px] text-zinc-500">{k.subtitle}</span>
                              </span>
                              <span
                                className={cn(
                                  "h-4 w-4 shrink-0 rounded-full border-2",
                                  selected
                                    ? "border-emerald-400 bg-emerald-500"
                                    : "border-zinc-600"
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
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
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
              </>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
