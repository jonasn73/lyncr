"use client"

// Admin "Infra" — this month's real Vercel spend + estimated Neon spend (each against a
// budget threshold, broken down by category), plus the Telnyx prepaid wallet balance
// against a low-balance floor (the real operational risk there: hit $0 and live calls
// and SMS stop working — not a monthly-invoice concept like the other two).

import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { GaugeBar } from "@/components/admin/shared/gauge-bar"
import { useAdminInfraCost, type InfraProviderCost, type TelnyxBalanceData } from "@/hooks/use-admin-infra-cost"

function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100)
}

function ProviderCard({
  title,
  cost,
  estimateNote,
}: {
  title: string
  cost: InfraProviderCost
  estimateNote?: string
}) {
  const pct = Math.max(0, Math.min(100, cost.percent_of_budget))
  const overBudget = cost.percent_of_budget >= 100
  const nearBudget = cost.percent_of_budget >= 80

  const failedToLoad = cost.configured && !cost.data_available

  return (
    <div className="rounded-xl border border-border bg-card/40 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {!cost.configured ? (
            <p className="mt-1 text-2xs text-muted-foreground">Not configured — API key missing.</p>
          ) : failedToLoad ? (
            <p className="mt-1 text-2xs text-destructive">
              Unable to load — not $0 spend.{" "}
              {cost.error ? <span className="font-mono">{cost.error}</span> : "See server logs for the exact error."}
            </p>
          ) : estimateNote ? (
            <p className="mt-1 text-2xs text-muted-foreground">{estimateNote}</p>
          ) : null}
        </div>
        {!failedToLoad ? (
          <div className="text-right">
            <p className="text-lg font-semibold text-foreground">{formatUsd(cost.spend_cents)}</p>
            <p className="text-2xs text-muted-foreground">of {formatUsd(cost.budget_cents)} budget</p>
          </div>
        ) : null}
      </div>

      {cost.configured && !failedToLoad ? (
        <>
          <GaugeBar
            percent={pct}
            tone={overBudget ? "destructive" : nearBudget ? "warning" : "success"}
            className="mt-3"
          />

          <div className="mt-3 space-y-1">
            {cost.categories.length === 0 ? (
              <p className="text-2xs text-muted-foreground">No charges this month.</p>
            ) : (
              cost.categories
                .slice()
                .sort((a, b) => b.costCents - a.costCents)
                .map((c) => (
                  <div key={c.category} className="flex items-center justify-between text-2xs">
                    <span className="text-muted-foreground">{c.category}</span>
                    <span className="font-medium text-foreground">{formatUsd(c.costCents)}</span>
                  </div>
                ))
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}

function TelnyxBalanceCard({ telnyx }: { telnyx: TelnyxBalanceData }) {
  const failedToLoad = !telnyx.data_available
  // Scale the bar so the floor sits at 50% — gives visual headroom above it, and empties
  // toward 0 as balance approaches/crosses the floor (the actual risk moment).
  const scaleMaxCents = Math.max(telnyx.floor_cents * 2, telnyx.balance_cents, 1)
  const pct = Math.max(0, Math.min(100, Math.round((telnyx.balance_cents / scaleMaxCents) * 100)))

  return (
    <div className="rounded-xl border border-border bg-card/40 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">Telnyx</p>
          {failedToLoad ? (
            <p className="mt-1 text-2xs text-destructive">
              Unable to load —{" "}
              {telnyx.error ? <span className="font-mono">{telnyx.error}</span> : "see server logs for the exact error."}
            </p>
          ) : telnyx.low_balance ? (
            <p className="mt-1 text-2xs text-destructive">Low balance — live calls and SMS may stop working.</p>
          ) : (
            <p className="mt-1 text-2xs text-muted-foreground">Prepaid carrier wallet — healthy.</p>
          )}
        </div>
        {!failedToLoad ? (
          <div className="text-right">
            <p className="text-lg font-semibold text-foreground">{formatUsd(telnyx.balance_cents)}</p>
            <p className="text-2xs text-muted-foreground">floor {formatUsd(telnyx.floor_cents)}</p>
          </div>
        ) : null}
      </div>

      {!failedToLoad ? (
        <GaugeBar percent={pct} tone={telnyx.low_balance ? "destructive" : "success"} className="mt-3" />
      ) : null}
    </div>
  )
}

export function InfraCostBoard() {
  const { data, loading, refreshing, refetch } = useAdminInfraCost()

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Infra</h1>
          <p className="text-sm text-muted-foreground">
            Hosting + database spend this month vs. budget, plus the Telnyx carrier wallet balance.
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void refetch()}>
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {loading || !data ? (
        <div className="rounded-xl border border-border bg-card/40 p-8 text-center text-sm text-muted-foreground">
          Loading infra cost…
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ProviderCard title="Vercel" cost={data.vercel} />
          <ProviderCard
            title="Neon"
            cost={data.neon}
            estimateNote="Estimated from usage — Neon has no billed-cost API yet."
          />
          <TelnyxBalanceCard telnyx={data.telnyx} />
        </div>
      )}

      {data ? (
        <p className="text-2xs text-muted-foreground">
          Vercel figures are real billed costs. Neon figures are{" "}
          <Badge variant="outline" className="text-2xs">
            Estimated
          </Badge>{" "}
          from raw usage at published per-unit pricing — your actual Neon invoice may differ slightly.
        </p>
      ) : null}
    </div>
  )
}
