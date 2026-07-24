"use client"

// Clear card / tip charge result for the send-receipt step (success or fail + reason).

import { CheckCircle2, XCircle, MinusCircle } from "lucide-react"
import { cn } from "@/lib/utils"

/** Optional tip after the main card charge. */
export type TipChargeResult =
  | { kind: "none" }
  | { kind: "charged"; cents: number }
  | { kind: "skipped"; cents: number }
  | { kind: "failed"; cents: number; reason: string }

function fmtCents(cents: number): string {
  // Format cents as US dollars for the summary lines.
  return (Math.max(0, cents) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  })
}

export function ChargeResultSummary({
  baseCents,
  tip,
  baseKind = "card",
  className,
}: {
  /** Main job / walk-up amount that already succeeded. */
  baseCents: number
  tip: TipChargeResult
  /** How the main amount was collected (card vs cash). */
  baseKind?: "card" | "cash"
  className?: string
}) {
  // Only add tip to “total charged” when the tip card charge actually succeeded.
  const tipChargedCents = tip.kind === "charged" ? tip.cents : 0
  const totalChargedCents = Math.max(0, baseCents) + tipChargedCents
  const tipFailed = tip.kind === "failed"
  const isCash = baseKind === "cash"
  // Overall banner: amber if tip failed (base already succeeded to reach this screen).
  const borderClass = tipFailed
    ? "border-amber-500/40 bg-amber-500/10"
    : "border-emerald-500/30 bg-emerald-500/10"
  const headline = tipFailed
    ? isCash
      ? "Cash recorded — tip did not go through"
      : "Card charged — tip did not go through"
    : isCash
      ? "Cash payment recorded"
      : "Card charged successfully"

  return (
    <div className={cn("rounded-xl border px-3 py-3", borderClass, className)}>
      <div className="flex items-start gap-2">
        {tipFailed ? (
          <MinusCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden />
        ) : (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "text-sm font-semibold",
              tipFailed ? "text-amber-100" : "text-emerald-100"
            )}
          >
            {headline}
          </p>
          <p
            className={cn(
              "mt-0.5 text-lg font-bold tabular-nums",
              tipFailed ? "text-amber-200" : "text-emerald-300"
            )}
          >
            {fmtCents(totalChargedCents)}
            <span className="ml-1.5 text-xs font-medium opacity-70">
              {isCash && tip.kind !== "charged" ? "recorded" : "total charged"}
            </span>
          </p>
        </div>
      </div>

      <ul className="mt-3 space-y-2 border-t border-white/10 pt-3 text-xs">
        <li className="flex items-start justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 font-medium text-emerald-200/90">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
            Service / job
          </span>
          <span className="tabular-nums font-semibold text-emerald-100">
            {fmtCents(baseCents)}
          </span>
        </li>
        <li className="text-[11px] leading-snug text-emerald-200/60">
          {isCash ? "Cash marked collected in Lyncr." : "Stripe accepted this charge."}
        </li>

        {tip.kind === "charged" ? (
          <>
            <li className="flex items-start justify-between gap-3 pt-1">
              <span className="inline-flex items-center gap-1.5 font-medium text-emerald-200/90">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
                Tip
              </span>
              <span className="tabular-nums font-semibold text-emerald-100">
                {fmtCents(tip.cents)}
              </span>
            </li>
            <li className="text-[11px] leading-snug text-emerald-200/60">
              Tip card charge succeeded.
            </li>
          </>
        ) : null}

        {tip.kind === "skipped" ? (
          <>
            <li className="flex items-start justify-between gap-3 pt-1">
              <span className="inline-flex items-center gap-1.5 font-medium text-slate-300">
                <MinusCircle className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                Tip not charged
              </span>
              <span className="tabular-nums font-semibold text-slate-400">
                {fmtCents(tip.cents)}
              </span>
            </li>
            <li className="text-[11px] leading-snug text-slate-400">
              You skipped the tip card charge (tip may still be on the slip).
            </li>
          </>
        ) : null}

        {tip.kind === "failed" ? (
          <>
            <li className="flex items-start justify-between gap-3 pt-1">
              <span className="inline-flex items-center gap-1.5 font-medium text-rose-200">
                <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-400" aria-hidden />
                Tip failed
              </span>
              <span className="tabular-nums font-semibold text-rose-200">
                {fmtCents(tip.cents)}
              </span>
            </li>
            <li className="rounded-lg border border-rose-500/35 bg-rose-500/10 px-2.5 py-2 text-[11px] leading-snug text-rose-100">
              <span className="font-semibold text-rose-200">Why: </span>
              {tip.reason}
            </li>
          </>
        ) : null}
      </ul>

      <p className="mt-3 text-[11px] text-slate-400">
        Optional — send a receipt by email or text.
      </p>
    </div>
  )
}
