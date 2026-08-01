"use client"

// Plain-English per-business P&L breakdown (plan + card fees − est. phone cost).

import type { AdminBusinessEconomics } from "@/lib/types"
import { cn } from "@/lib/utils"

function MoneyLine({
  label,
  value,
  note,
  tone,
}: {
  label: string
  value: string
  note?: string
  tone?: "in" | "out" | "net"
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-800/80 py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-200">{label}</p>
        {note ? <p className="mt-0.5 text-xs leading-snug text-slate-500">{note}</p> : null}
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

/** Full breakdown rows — used in Home sheet and Businesses drawer. */
export function BusinessMoneyBreakdown({ row }: { row: AdminBusinessEconomics }) {
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
        <p className="mt-1 text-2xl font-bold tabular-nums text-slate-50">{row.net_label}</p>
        <p className="mt-1 text-xs text-slate-400">
          Est. net for Lyncr this month · {row.month_label}
        </p>
        <p className="mt-1 text-[11px] leading-snug text-slate-500">
          List-price plan + est. card fees + credit packs − est. phone cost
        </p>
      </div>

      <MoneyLine
        label="Plan (list price)"
        value={row.plan_revenue_label}
        note={`${row.plan_tier_label} · not Stripe invoice cash`}
        tone="in"
      />
      <MoneyLine
        label="Est. card fees to Lyncr"
        value={row.card_fee_mtd_label}
        note="Formula on Collect / Tap / pay links this month (2.9% + $0.30)"
        tone="in"
      />
      {row.credit_pack_mtd_cents > 0 ? (
        <MoneyLine
          label="Credit packs sold"
          value={row.credit_pack_mtd_label}
          note="Prepaid phone minutes they bought this month"
          tone="in"
        />
      ) : null}
      <MoneyLine
        label="Est. phone cost"
        value={row.est_phone_cost_mtd_label}
        note={`${row.talk_minutes_mtd} talk min · ${row.call_count_mtd} calls · ${row.sms_count_mtd} SMS · this month only`}
        tone="out"
      />
      <MoneyLine label="Est. net for Lyncr" value={row.net_label} tone="net" />

      {row.breakdown_notes.length > 0 ? (
        <ul className="mt-3 space-y-1.5 px-0.5">
          {row.breakdown_notes.map((n) => (
            <li key={n} className="text-[11px] leading-snug text-slate-500">
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
        "flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
        "hover:border-violet-500/40 hover:bg-violet-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50",
        "border-slate-800 bg-slate-900/60"
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-100">{row.business_name}</p>
        <p className="truncate text-[11px] text-slate-500">{row.email}</p>
      </div>
      <div className="shrink-0 text-right">
        <p
          className={cn(
            "text-sm font-bold tabular-nums",
            row.ahead ? "text-emerald-300" : "text-amber-300"
          )}
        >
          {row.net_label}
        </p>
        <p className={cn("text-[10px] font-medium", row.ahead ? "text-emerald-500/80" : "text-amber-500/80")}>
          {row.verdict_label}
        </p>
      </div>
    </button>
  )
}
