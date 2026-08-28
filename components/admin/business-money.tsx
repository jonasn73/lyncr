"use client"

// Plain-English per-business P&L — actual Stripe cash + fees − phone cost.

import type { AdminBusinessEconomics } from "@/lib/types"
import type { AdminMoneyPeriodUi } from "@/hooks/use-lyncr-admin-dashboard"
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
    <div className="flex items-start justify-between gap-3 border-b border-slate-800/80 py-3 last:border-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-slate-200">{label}</p>
          {badge ? (
            <span className="rounded-md bg-slate-800 px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
              {badge}
            </span>
          ) : null}
        </div>
        {note ? <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{note}</p> : null}
      </div>
      <p
        className={cn(
          "shrink-0 text-sm font-semibold tabular-nums",
          tone === "in" && "text-emerald-300",
          tone === "out" && "text-amber-300",
          tone === "net" && "text-slate-50",
          !tone && "text-slate-50"
        )}
      >
        {value}
      </p>
    </div>
  )
}

// Chip order: All time first (default), then calendar windows Ops asked for.
const PERIOD_OPTIONS: { id: AdminMoneyPeriodUi; label: string }[] = [
  { id: "all_time", label: "All time" },
  { id: "this_month", label: "This month" },
  { id: "last_month", label: "Last month" },
  { id: "this_year", label: "This year" },
]

/** All time / This month / Last month / This year chips — reloads call counts + Stripe fees. */
export function BusinessMoneyPeriodChips({
  period,
  onChange,
  disabled,
}: {
  period: AdminMoneyPeriodUi
  onChange: (period: AdminMoneyPeriodUi) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Money time period">
      {PERIOD_OPTIONS.map((opt) => {
        const active = period === opt.id
        return (
          <button
            key={opt.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.id)}
            className={cn(
              "rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50",
              "disabled:opacity-50",
              active
                ? "border-violet-500/50 bg-violet-950/50 text-violet-100"
                : "border-slate-700 bg-slate-900/40 text-muted-foreground hover:border-slate-600 hover:text-slate-200"
            )}
          >
            {opt.label}
          </button>
        )
      })}
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
            ? "border-emerald-500/35 bg-emerald-950/40"
            : "border-amber-500/35 bg-amber-950/40"
        )}
      >
        <p
          className={cn(
            "text-xs font-semibold uppercase tracking-wide",
            row.ahead ? "text-emerald-400/90" : "text-amber-400/90"
          )}
        >
          {row.verdict_label}
        </p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-slate-50">{row.net_abs_label}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Net for Lyncr · {row.month_label}
        </p>
        <p className="mt-1 text-2xs leading-snug text-muted-foreground">
          Actual plan cash + card fees + credit packs − phone cost
        </p>
      </div>

      {row.prior_period_note ? (
        <p className="mb-2 rounded-lg border border-amber-500/25 bg-amber-950/30 px-3 py-2 text-xs leading-snug text-amber-100/90">
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

/** Compact chip for a business row on Ops Home. */
export function BusinessMoneyChip({
  row,
  onClick,
}: {
  row: AdminBusinessEconomics
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left transition-colors",
        "hover:border-violet-500/40 hover:bg-violet-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50",
        "border-slate-800 bg-slate-900/60"
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-100">{row.business_name}</p>
        <p className="truncate text-2xs text-muted-foreground">
          {row.call_count_mtd} calls · {row.talk_minutes_mtd} min · {row.period_chip_label}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p
          className={cn(
            "text-sm font-bold tabular-nums",
            row.ahead ? "text-emerald-300" : "text-amber-300"
          )}
        >
          {row.net_abs_label}
        </p>
        <p className={cn("text-micro font-medium", row.ahead ? "text-emerald-500/80" : "text-amber-500/80")}>
          {row.verdict_label}
        </p>
      </div>
    </button>
  )
}
