"use client"

// Live service quote breakdown for the answered-call quick booking sheet.

import { memo } from "react"
import { motion } from "framer-motion"
import {
  Building2,
  Copy,
  Cpu,
  Key,
  KeyRound,
  Lock,
  LockKeyhole,
  Sparkles,
  Wrench,
  type LucideIcon,
} from "lucide-react"
import { Label } from "@/components/ui/label"
import {
  formatQuoteDollars,
  SERVICE_QUOTE_TYPES,
  type ServiceQuoteResult,
  type ServiceQuoteTypeId,
} from "@/lib/service-quote-calculator"
import { estimateTravelMinutes } from "@/lib/geo"
import { cn } from "@/lib/utils"

const SERVICE_CARD_ICONS: Record<ServiceQuoteTypeId, LucideIcon> = {
  lockout: KeyRound,
  key_generation: Sparkles,
  key_duplication: Copy,
  programming_diagnostics: Cpu,
  ignition_repair: Wrench,
  key_extraction: Key,
  rekey: LockKeyhole,
  lock_installation: Lock,
  commercial_hardware: Building2,
  other: Wrench,
}

const SERVICE_CARD_TAGS: Partial<Record<ServiceQuoteTypeId, string>> = {
  lockout: "Fast",
  key_generation: "AKL",
  key_duplication: "Spare",
  programming_diagnostics: "Immobilizer",
  ignition_repair: "Ignition",
  key_extraction: "Extract",
  rekey: "Re-key",
  lock_installation: "Install",
  commercial_hardware: "Commercial",
  other: "Custom",
}

type ServiceQuoteCalculatorPanelProps = {
  quote: ServiceQuoteResult
  serviceTypeId: ServiceQuoteTypeId
  vehicleYear: string
  vehicleMake: string
  vehicleModel: string
  onServiceTypeChange: (id: ServiceQuoteTypeId) => void
  /** selector-only = step 1; breakdown-only = step 3; full = default */
  variant?: "full" | "selector-only" | "breakdown-only"
  className?: string
}

export const ServiceQuoteCalculatorPanel = memo(function ServiceQuoteCalculatorPanel({
  quote,
  serviceTypeId,
  vehicleYear,
  vehicleMake,
  vehicleModel,
  onServiceTypeChange,
  variant = "full",
  className,
}: ServiceQuoteCalculatorPanelProps) {
  const showSelector = variant === "full" || variant === "selector-only"
  const showBreakdown = variant === "full" || variant === "breakdown-only"
  const selectedLabel =
    SERVICE_QUOTE_TYPES.find((t) => t.id === serviceTypeId)?.label ?? "Selected service"

  return (
    <fieldset
      className={cn(
        "grid gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3",
        className
      )}
    >
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-emerald-300">
        Quick booking · service quote
      </legend>
      {showSelector ? (
        <div className="my-4 grid grid-cols-2 gap-3">
          <Label className="col-span-2 text-xs text-slate-300">Tap a service to continue</Label>
          {SERVICE_QUOTE_TYPES.map((service) => {
            const Icon = SERVICE_CARD_ICONS[service.id] ?? Wrench
            const tag = SERVICE_CARD_TAGS[service.id] ?? "Service"
            const active = serviceTypeId === service.id
            return (
              <motion.button
                key={service.id}
                type="button"
                layout
                whileTap={{ scale: 0.97 }}
                whileHover={{ scale: 1.02 }}
                onClick={() => onServiceTypeChange(service.id)}
                className={cn(
                  "flex min-h-[5.5rem] touch-manipulation flex-col items-start justify-between rounded-xl border bg-slate-900/90 p-3 text-left shadow-sm transition-colors",
                  active
                    ? "border-emerald-400/70 bg-emerald-500/10 ring-1 ring-emerald-400/40"
                    : "border-slate-700/80 hover:border-emerald-500/40 hover:bg-slate-800/90"
                )}
                aria-pressed={active}
              >
                <div className="flex w-full items-start justify-between gap-2">
                  <Icon
                    className={cn(
                      "h-5 w-5 shrink-0",
                      active ? "text-emerald-300" : "text-slate-400"
                    )}
                    aria-hidden
                  />
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                      active
                        ? "bg-emerald-500/20 text-emerald-200"
                        : "bg-slate-800 text-slate-400"
                    )}
                  >
                    {tag}
                  </span>
                </div>
                <span
                  className={cn(
                    "mt-2 text-xs font-semibold leading-snug",
                    active ? "text-emerald-50" : "text-slate-100"
                  )}
                >
                  {service.label}
                </span>
              </motion.button>
            )
          })}
        </div>
      ) : null}
      {showBreakdown ? (
      <div
        className="rounded-lg border border-emerald-500/20 bg-background/40 px-3 py-2"
        aria-live="polite"
        aria-atomic="true"
      >
        {variant === "breakdown-only" ? (
          <p className="text-[11px] font-medium text-emerald-200/90">{selectedLabel}</p>
        ) : null}
        <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-400/90">
          Baseline quote (transparent)
        </p>
        <ul className="mt-1 space-y-0.5">
          {quote.lines.map((line) => (
            <li key={line.label} className="flex justify-between gap-2 text-xs text-muted-foreground">
              <span className="min-w-0">{line.label}</span>
              <span className="shrink-0 tabular-nums text-foreground">{formatQuoteDollars(line.cents)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex items-baseline justify-between border-t border-emerald-500/20 pt-2">
          <span className="text-xs font-medium text-foreground">Total estimate</span>
          <span className="text-lg font-bold tabular-nums text-emerald-300">
            {formatQuoteDollars(quote.totalCents)}
          </span>
        </div>
        {quote.distanceMiles != null || quote.keyBlankCents > 0 || quote.programmingCents > 0 ? (
          <p className="mt-1 text-[10px] text-muted-foreground">
            Auto total = {formatQuoteDollars(quote.baseCents)} service
            {quote.distanceMiles != null
              ? ` + ${formatQuoteDollars(quote.distancePremiumCents)} travel (${quote.distanceMiles.toFixed(1)} mi)`
              : ""}
            {quote.keyBlankCents > 0 ? ` + ${formatQuoteDollars(quote.keyBlankCents)} parts` : ""}
            {quote.programmingCents > 0 ? ` + ${formatQuoteDollars(quote.programmingCents)} programming` : ""}
          </p>
        ) : null}
        <p className="mt-1 text-[10px] text-muted-foreground">
          {quote.dispatchJobTypeLabel}
          {vehicleYear || vehicleMake || vehicleModel
            ? ` · ${[vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(" ")}`
            : ""}
          {quote.distanceMiles != null
            ? ` · ${quote.distanceMiles.toFixed(1)} mi travel · ~${estimateTravelMinutes(quote.distanceMiles)} min ETA`
            : ""}
        </p>
      </div>
      ) : null}
    </fieldset>
  )
})
