"use client"

// Celebratory paid hero for the send-receipt step (success or tip-fail + reason).

import { Check, MinusCircle, XCircle } from "lucide-react"
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

  // Soft breakdown under the hero amount (not a dense checklist).
  const detailParts: string[] = [`Service ${fmtCents(baseCents)}`]
  if (tip.kind === "charged") {
    detailParts.push(`Tip ${fmtCents(tip.cents)}`)
  } else if (tip.kind === "skipped") {
    detailParts.push("No tip")
  } else if (tip.kind === "none" && tipChargedCents === 0) {
    // Keep line short when tip was never offered / zero.
  }

  return (
    <div className={cn("relative overflow-hidden text-center", className)}>
      {/* Soft emerald wash — atmosphere without a heavy bordered “box”. */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 -top-6 h-28 opacity-60",
          tipFailed
            ? "bg-[radial-gradient(ellipse_at_top,_rgba(245,158,11,0.22),_transparent_70%)]"
            : "bg-[radial-gradient(ellipse_at_top,_rgba(16,185,129,0.28),_transparent_70%)]"
        )}
        aria-hidden
      />

      <div className="relative flex flex-col items-center pt-1">
        {/* Big check / status mark as the visual star. */}
        <div
          className={cn(
            "flex h-14 w-14 items-center justify-center rounded-full shadow-[0_0_28px_-4px]",
            tipFailed
              ? "bg-amber-500/20 text-amber-300 shadow-amber-500/30 ring-1 ring-amber-400/35"
              : "bg-emerald-500/20 text-emerald-300 shadow-emerald-500/40 ring-1 ring-emerald-400/40"
          )}
        >
          {tipFailed ? (
            <MinusCircle className="h-7 w-7" aria-hidden />
          ) : (
            <Check className="h-8 w-8 stroke-[2.5]" aria-hidden />
          )}
        </div>

        <p
          className={cn(
            "mt-3 text-[11px] font-semibold uppercase tracking-[0.14em]",
            tipFailed ? "text-amber-200/80" : "text-emerald-300/80"
          )}
        >
          {tipFailed ? (isCash ? "Cash recorded" : "Partially paid") : "Paid"}
        </p>

        <p
          className={cn(
            "mt-1 text-4xl font-bold tabular-nums tracking-tight",
            tipFailed ? "text-amber-100" : "text-white"
          )}
        >
          {fmtCents(totalChargedCents)}
        </p>

        {detailParts.length > 0 ? (
          <p
            className={cn(
              "mt-1.5 text-xs tabular-nums",
              tipFailed ? "text-amber-200/70" : "text-zinc-400"
            )}
          >
            {detailParts.join(" · ")}
          </p>
        ) : null}

        {tipFailed ? (
          <div className="mt-3 w-full max-w-sm rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-left">
            <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-rose-200">
              <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Tip failed · {fmtCents(tip.cents)}
            </p>
            <p className="mt-1 text-[11px] leading-snug text-rose-100/90">{tip.reason}</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
