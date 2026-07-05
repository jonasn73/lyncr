"use client"

// Live service quote breakdown for the answered-call quick booking sheet.

import { memo } from "react"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  formatQuoteDollars,
  SERVICE_QUOTE_TYPES,
  type ServiceQuoteResult,
  type ServiceQuoteTypeId,
} from "@/lib/service-quote-calculator"
import { estimateTravelMinutes } from "@/lib/geo"
import { cn } from "@/lib/utils"

type ServiceQuoteCalculatorPanelProps = {
  quote: ServiceQuoteResult
  serviceTypeId: ServiceQuoteTypeId
  vehicleYear: string
  vehicleMake: string
  vehicleModel: string
  onServiceTypeChange: (id: ServiceQuoteTypeId) => void
  className?: string
}

export const ServiceQuoteCalculatorPanel = memo(function ServiceQuoteCalculatorPanel({
  quote,
  serviceTypeId,
  vehicleYear,
  vehicleMake,
  vehicleModel,
  onServiceTypeChange,
  className,
}: ServiceQuoteCalculatorPanelProps) {
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
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs">Service type</Label>
          <Select value={serviceTypeId} onValueChange={(v) => onServiceTypeChange(v as ServiceQuoteTypeId)}>
            <SelectTrigger className="h-10 w-full">
              <SelectValue placeholder="Select service" />
            </SelectTrigger>
            <SelectContent>
              {SERVICE_QUOTE_TYPES.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div
        className="rounded-lg border border-emerald-500/20 bg-background/40 px-3 py-2"
        aria-live="polite"
        aria-atomic="true"
      >
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
        {quote.distanceMiles != null ? (
          <p className="mt-1 text-[10px] text-muted-foreground">
            Auto total = {formatQuoteDollars(quote.baseCents)} base +{" "}
            {formatQuoteDollars(quote.distancePremiumCents)} travel (
            {quote.distanceMiles.toFixed(1)} mi)
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
    </fieldset>
  )
})
