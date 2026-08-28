"use client"

// Money-on-the-job rail for Active Job: balance → deposit/pay link → collect → review.

import { useCallback, useEffect, useState } from "react"
import {
  CheckCircle2,
  CreditCard,
  Link2,
  Loader2,
  RefreshCw,
  Star,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  formatJobMoneyCents,
  suggestedJobDepositCents,
} from "@/lib/job-billing-balance"
import { buildDepositSmsStagingTemplate } from "@/lib/secure-deposit-link"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

const SECTION_LABEL =
  "text-micro uppercase font-bold tracking-widest text-muted-foreground"

type PayLinkRow = {
  token: string
  url: string
  chargeCents: number
  paymentStatus: string
  walletSettled: boolean
  createdAt?: string
}

type JobMoneyRailProps = {
  jobId: string
  customerName: string
  customerPhone: string
  /** Booked balance in dollars (persisted quote only). */
  billingBalanceDollars: number
  /** Job already completed — emphasize review, not new deposits. */
  isJobDone: boolean
  saving?: boolean
  reviewSmsFailed?: boolean
  /** ISO stamp when review SMS was last sent (done-state chip). */
  reviewSmsSentAt?: string | null
  /** ISO stamp when customer opened the review link. */
  reviewLinkOpenedAt?: string | null
  onCollect: () => void
  onSendReviewSms: () => void
  /** Mark job complete (same confirm flow as More actions). */
  onComplete?: () => void
}

export function JobMoneyRail({
  jobId,
  customerName,
  customerPhone,
  billingBalanceDollars,
  isJobDone,
  saving = false,
  reviewSmsFailed = false,
  reviewSmsSentAt = null,
  reviewLinkOpenedAt = null,
  onCollect,
  onSendReviewSms,
  onComplete,
}: JobMoneyRailProps) {
  const { toast } = useToast()
  // Starts on "refresh" when there is a job: the rail loads its links on mount,
  // so anything else would paint an idle button for one frame first.
  const [busy, setBusy] = useState<"deposit" | "refresh" | null>(
    jobId ? "refresh" : null
  )
  const [links, setLinks] = useState<PayLinkRow[]>([])
  const [lastSentUrl, setLastSentUrl] = useState<string | null>(null)
  const [smsStaging, setSmsStaging] = useState<string | null>(null)

  const balanceCents = Math.round(Math.max(0, billingBalanceDollars) * 100)
  const depositCents = suggestedJobDepositCents(balanceCents)
  const depositLabel = depositCents > 0 ? formatJobMoneyCents(depositCents) : null
  const balanceLabel =
    billingBalanceDollars > 0 ? formatJobMoneyCents(balanceCents) : "No balance"

  // Newest paid / unsettled link for the status chip.
  const paidLink = links.find(
    (l) => l.paymentStatus === "paid" || l.walletSettled
  )
  const openLink = links.find(
    (l) => l.paymentStatus === "unpaid" || l.paymentStatus === "unknown"
  )

  /** Fetches and stores the links. Leaves the busy flag to the caller. */
  const loadLinks = useCallback(
    async (sync: boolean) => {
      if (!jobId) return
      try {
        const qs = sync ? "&sync=1" : ""
        const res = await fetch(
          `/api/payments/pay-links?jobId=${encodeURIComponent(jobId)}${qs}`,
          { credentials: "include" }
        )
        const json = (await res.json().catch(() => ({}))) as {
          data?: { links?: PayLinkRow[] }
          error?: string
        }
        if (!res.ok) {
          // Soft-fail — Money rail still works without history.
          return
        }
        setLinks(Array.isArray(json.data?.links) ? json.data!.links! : [])
      } finally {
        setBusy(null)
      }
    },
    [jobId]
  )

  /** User-triggered refresh — shows the spinner before the request goes out. */
  const refreshLinks = useCallback(
    async (sync = false) => {
      if (!jobId) return
      setBusy("refresh")
      await loadLinks(sync)
    },
    [jobId, loadLinks]
  )

  useEffect(() => {
    void loadLinks(false)
  }, [loadLinks])

  const handleSendDeposit = useCallback(async () => {
    if (!customerPhone.trim()) {
      toast({
        title: "No phone on file",
        description: "Add a customer phone before sending a deposit link.",
        variant: "destructive",
      })
      return
    }
    if (depositCents < 50) {
      toast({
        title: "Set a balance first",
        description: "Edit the job price, then send a deposit.",
        variant: "destructive",
      })
      return
    }

    setBusy("deposit")
    try {
      // Real Stripe Checkout short link (lyncr.app/pay/…) — not the old mock URL.
      const res = await fetch("/api/payments/send-pay-link", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "sms",
          jobId,
          amount: depositCents / 100,
          note: "Booking deposit",
          customerName,
          phone: customerPhone,
          lineItems: [{ label: "Booking deposit", amountCents: depositCents }],
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        data?: { url?: string; chargeCents?: number; sent?: boolean }
      }
      const url = (json.data?.url ?? "").trim()
      if (url) {
        setLastSentUrl(url)
        setSmsStaging(
          buildDepositSmsStagingTemplate({
            customerName,
            depositUrl: url,
            amountLabel: depositLabel,
          })
        )
      }
      if (!res.ok) {
        toast({
          title: "Deposit link not sent",
          description:
            json.error ||
            (url
              ? "Link was created — copy it from the staging box below."
              : "Could not create a deposit link."),
          variant: "destructive",
        })
        return
      }
      toast({
        title: `Deposit ${depositLabel} sent`,
        description: "Customer got a secure Lyncr pay link by SMS.",
      })
      void refreshLinks(true)
    } catch {
      toast({
        title: "Deposit link failed",
        description: "Check bank setup in Money, then try again.",
        variant: "destructive",
      })
    } finally {
      setBusy(null)
    }
  }, [
    customerPhone,
    customerName,
    depositCents,
    depositLabel,
    jobId,
    refreshLinks,
    toast,
  ])

  // Review SMS chip when job is already done (Opened / Sent / Failed).
  const reviewStatusLabel = reviewLinkOpenedAt
    ? "Opened"
    : reviewSmsFailed
      ? "Failed"
      : reviewSmsSentAt
        ? "Sent"
        : null

  return (
    <section className="mt-2.5 space-y-2 rounded-xl border border-success/25 bg-success/[0.07] px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className={SECTION_LABEL}>Money</p>
        <button
          type="button"
          onClick={() => void refreshLinks(true)}
          disabled={busy === "refresh"}
          className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-micro font-semibold text-muted-foreground transition-colors hover:bg-card/50 hover:text-foreground disabled:opacity-50"
          aria-label="Refresh pay link status"
        >
          {busy === "refresh" ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="h-3 w-3" aria-hidden />
          )}
          Sync
        </button>
      </div>

      {/* One-line money status — balance + latest link state */}
      <p className="text-xs leading-snug text-foreground">
        <span className="font-semibold text-success/80">Balance</span>
        <span className="text-muted-foreground"> · </span>
        <span className="font-semibold tabular-nums text-success">
          {balanceLabel}
        </span>
        {paidLink ? (
          <>
            <span className="text-muted-foreground"> · </span>
            <span className="font-semibold text-success">
              Paid {formatJobMoneyCents(paidLink.chargeCents)}
            </span>
          </>
        ) : openLink ? (
          <>
            <span className="text-muted-foreground"> · </span>
            <span className="font-semibold text-warning/90">
              Link open {formatJobMoneyCents(openLink.chargeCents)}
            </span>
          </>
        ) : null}
        {isJobDone && reviewStatusLabel ? (
          <>
            <span className="text-muted-foreground"> · </span>
            <span
              className={cn(
                "font-semibold",
                reviewStatusLabel === "Failed"
                  ? "text-rose-300"
                  : reviewStatusLabel === "Opened"
                    ? "text-success"
                    : "text-warning/90"
              )}
            >
              Review {reviewStatusLabel}
            </span>
          </>
        ) : null}
      </p>

      {!isJobDone ? (
        // Deposit · Collect · Complete — no helper blurbs; Complete lives here (no Close Out section).
        <div className={cn("grid gap-2", onComplete ? "grid-cols-3" : "grid-cols-2")}>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="border-sky-500/40 bg-sky-500/10 px-2 text-sky-50 hover:bg-sky-500/20"
            disabled={saving || busy === "deposit" || depositCents < 50}
            onClick={() => void handleSendDeposit()}
            title="Send deposit pay link by SMS"
          >
            {busy === "deposit" ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Link2 className="mr-1 h-3.5 w-3.5" aria-hidden />
            )}
            {depositLabel ? `Deposit ${depositLabel}` : "Deposit"}
          </Button>
          <Button
            type="button"
            size="sm"
            className="bg-success px-2 text-success-foreground hover:bg-success/90"
            disabled={saving || balanceCents < 50}
            onClick={onCollect}
            title="Collect remaining balance"
          >
            <CreditCard className="mr-1 h-3.5 w-3.5" aria-hidden />
            Collect
          </Button>
          {onComplete ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-success/40 bg-success/15 px-2 text-success hover:bg-success/25"
              disabled={saving}
              onClick={onComplete}
              title="Complete job — works from In pool; no tech required"
            >
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden />
              Complete
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            size="sm"
            className={cn(
              reviewSmsFailed
                ? "border border-rose-500/40 bg-rose-500/20 text-rose-50 hover:bg-rose-500/30"
                : "border border-warning/35 bg-warning/15 text-warning hover:bg-warning/25"
            )}
            disabled={saving || !customerPhone.trim()}
            onClick={onSendReviewSms}
          >
            <Star className="mr-1 h-3.5 w-3.5" aria-hidden />
            {reviewSmsFailed
              ? "Retry review"
              : reviewSmsSentAt
                ? "Resend review"
                : "Send review"}
          </Button>
          {balanceCents >= 50 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-success/35 bg-success/10 text-success hover:bg-success/20"
              disabled={saving}
              onClick={onCollect}
            >
              <CreditCard className="mr-1 h-3.5 w-3.5" aria-hidden />
              Collect
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-success/25 text-success/70"
              disabled
            >
              Paid up
            </Button>
          )}
        </div>
      )}

      {/* Copy-paste fallback when SMS fails or owner wants to resend manually */}
      {smsStaging || lastSentUrl ? (
        <div className="space-y-1">
          <label htmlFor="job-money-deposit-staging" className={SECTION_LABEL}>
            Deposit SMS staging
          </label>
          <textarea
            id="job-money-deposit-staging"
            rows={2}
            value={
              smsStaging ||
              (lastSentUrl
                ? buildDepositSmsStagingTemplate({
                    customerName,
                    depositUrl: lastSentUrl,
                    amountLabel: depositLabel,
                  })
                : "")
            }
            onChange={(e) => setSmsStaging(e.target.value)}
            className="h-16 w-full resize-y rounded-lg border border-sky-900/40 bg-background/60 p-3 text-xs text-foreground placeholder-slate-600 focus:border-sky-500/50 focus:outline-none"
            placeholder="Edit the deposit SMS…"
          />
          {lastSentUrl ? (
            <p className="flex items-start gap-1 text-micro text-muted-foreground">
              <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-success" aria-hidden />
              <span className="break-all font-mono text-muted-foreground">{lastSentUrl}</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
