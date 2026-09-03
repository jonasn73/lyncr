"use client"

// Plain-English per-business P&L — actual Stripe cash + fees − phone cost.

import type { AdminBusinessEconomics } from "@/lib/types"
import { cn } from "@/lib/utils"

function MoneyLine({
  label,
  value,
  note,
  tone,
  badge,
}: {
  label: string
  value: string
  note?: string
  tone?: "in" | "out" | "net"
  badge?: string
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/80 py-3 last:border-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-foreground">{label}</p>
          {badge ? (
            <span className="rounded-md bg-muted px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
              {badge}
            </span>
          ) : null}
        </div>
        {note ? <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{note}</p> : null}
      </div>
      <p
        className={cn(
          "shrink-0 text-sm font-semibold tabular-nums",
          tone === "in" && "text-success",
          tone === "out" && "text-warning",
          tone === "net" && "text-foreground",
          !tone && "text-foreground"
        )}
      >
        {value}
      </p>
    </div>
  )
}

/** Full breakdown rows — used in Home sheet and Businesses drawer. */
export function BusinessMoneyBreakdown({ row }: { row: AdminBusinessEconomics }) {
  const cardBadge =
    row.card_fee_source === "stripe" ? "Actual" : row.card_fee_source === "estimate" ? "Est." : undefined
  const phoneBadge = row.phone_cost_is_estimate ? "Est." : "Actual"
  // Plain-English window under fee / phone lines (matches the selected chip).
  const windowNote =
    row.period === "all_time"
      ? "all time"
      : row.period === "this_year"
        ? "this year"
        : row.period === "last_30_days"
          ? "last 30 days"
          : row.period === "last_month"
            ? "last month"
            : "this month only"

  return (
    <div className="space-y-1">
      <div
        className={cn(
          "mb-3 rounded-xl border px-3 py-3",
          row.ahead
            ? "border-success/35 bg-success/40"
            : "border-warning/35 bg-warning/40"
        )}
      >
        <p
          className={cn(
            "text-xs font-semibold uppercase tracking-wide",
            row.ahead ? "text-success/90" : "text-warning/90"
          )}
        >
          {row.verdict_label}
        </p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{row.net_abs_label}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Net for Lyncr · {row.month_label}
        </p>
        <p className="mt-1 text-2xs leading-snug text-muted-foreground">
          Actual plan cash + card fees + credit packs − phone cost
        </p>
      </div>

      {row.prior_period_note ? (
        <p className="mb-2 rounded-lg border border-warning/25 bg-warning/30 px-3 py-2 text-xs leading-snug text-warning/90">
          {row.prior_period_note}
        </p>
      ) : null}

      <MoneyLine
        label="Plan cash (Stripe)"
        value={row.plan_revenue_label}
        note={row.plan_status_label}
        badge="Actual"
        tone="in"
      />
      <MoneyLine
        label="Card fees to Lyncr"
        value={row.card_fee_mtd_label}
        note={
          row.card_fee_source === "stripe"
            ? `Real Stripe Connect application fees · ${windowNote}`
            : row.card_fee_source === "estimate"
              ? "Estimate from Collect / Tap charges (2.9% + $0.30)"
              : `No Connect card fees · ${windowNote}`
        }
        badge={cardBadge}
        tone="in"
      />
      {row.credit_pack_mtd_cents > 0 ? (
        <MoneyLine
          label="Credit packs sold"
          value={row.credit_pack_mtd_label}
          note="Prepaid phone minutes they bought in this window"
          badge="Actual"
          tone="in"
        />
      ) : null}
      <MoneyLine
        label={row.phone_cost_is_estimate ? "Phone cost" : "Phone cost (wallet)"}
        value={row.est_phone_cost_mtd_label}
        note={`${row.talk_minutes_mtd} talk min · ${row.call_count_mtd} calls · ${row.sms_count_mtd} SMS · ${windowNote}`}
        badge={phoneBadge}
        tone="out"
      />
      <MoneyLine label="Net for Lyncr" value={row.net_label} tone="net" />

      <div className="mt-3 rounded-xl border border-border/80 bg-background/40 px-3 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Their wallet, right now
        </p>
        <p className="mt-1 text-xl font-bold tabular-nums text-foreground">
          {row.collected_wallet_balance_label}
        </p>
        <p className="mt-1 text-2xs leading-snug text-muted-foreground">
          What this business currently has sitting in their own job-payment wallet — not a
          Lyncr number, and not period-scoped. Updates the instant they collect a charge, get
          refunded/disputed, or send money to their bank.
        </p>
      </div>

      {(row.saas_last_paid_label || row.saas_next_bill_label) && (
        <p className="mt-2 text-2xs leading-snug text-muted-foreground">
          Last SaaS payment: {row.saas_last_paid_label ?? "never"}
          {" · "}
          Next bill: {row.saas_next_bill_label ?? "none"}
        </p>
      )}

      {row.breakdown_notes.length > 0 ? (
        <ul className="mt-3 space-y-2 px-0.5">
          {row.breakdown_notes.map((n) => (
            <li key={n} className="text-2xs leading-snug text-muted-foreground">
              {n}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
