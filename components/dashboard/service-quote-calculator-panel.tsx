"use client"

// Live service quote breakdown for the answered-call quick booking sheet.

import { memo, useEffect, useMemo, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import {
  Building2,
  Copy,
  Cpu,
  DoorClosed,
  Key,
  KeyRound,
  Lock,
  LockKeyhole,
  Smartphone,
  Sparkles,
  Vault,
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
import {
  SERVICE_IDS_BY_SECTOR,
  SERVICE_SECTOR_LABELS,
  SERVICE_SECTOR_ORDER,
  serviceSectorForType,
  type ServiceSector,
} from "@/lib/service-sector-routing"
import { onOptionRowKeyDown } from "@/lib/hooks/use-workspace-keyboard"

const SERVICE_CARD_ICONS: Record<ServiceQuoteTypeId, LucideIcon> = {
  lockout: KeyRound,
  key_generation: Sparkles,
  key_duplication: Copy,
  programming_diagnostics: Cpu,
  ignition_repair: Wrench,
  key_extraction: Key,
  rekey: LockKeyhole,
  lock_installation: Lock,
  safe_lockout: Vault,
  keypad_smart_lock: Smartphone,
  commercial_hardware: Building2,
  master_key_system: KeyRound,
  door_closer_repair: DoorClosed,
  other: Wrench,
}

/** Only keep critical action tags — card titles already name the service. */
const SERVICE_CARD_TAGS: Partial<Record<ServiceQuoteTypeId, string>> = {
  lockout: "Fast",
}

function servicesForSector(sector: ServiceSector): (typeof SERVICE_QUOTE_TYPES)[number][] {
  const ids = new Set<ServiceQuoteTypeId>([...SERVICE_IDS_BY_SECTOR[sector], "other"])
  return SERVICE_QUOTE_TYPES.filter((service) => ids.has(service.id))
}

type ServiceSectorSelectorProps = {
  serviceTypeId: ServiceQuoteTypeId
  onServiceTypeChange: (id: ServiceQuoteTypeId) => void
  compact?: boolean
}

function ServiceSectorSelector({ serviceTypeId, onServiceTypeChange, compact }: ServiceSectorSelectorProps) {
  const [activeSector, setActiveSector] = useState<ServiceSector>(() => serviceSectorForType(serviceTypeId))
  const [sectorDirection, setSectorDirection] = useState(1)

  const visibleServices = useMemo(() => servicesForSector(activeSector), [activeSector])

  /** Keep the sector pill aligned when a phone-keyed draft restores a saved service type. */
  useEffect(() => {
    setActiveSector(serviceSectorForType(serviceTypeId))
  }, [serviceTypeId])

  const handleSectorChange = (next: ServiceSector) => {
    const prevIndex = SERVICE_SECTOR_ORDER.indexOf(activeSector)
    const nextIndex = SERVICE_SECTOR_ORDER.indexOf(next)
    setSectorDirection(nextIndex >= prevIndex ? 1 : -1)
    setActiveSector(next)
  }

  return (
    <div className={cn("relative z-10", compact ? "my-0" : "my-4")}>
      {compact ? null : (
        <Label className="mb-3 block text-xs text-slate-300">Tap a service to continue</Label>
      )}

      <div
        className={cn(
          "relative z-10 grid grid-cols-3 gap-2 rounded-xl border border-slate-800 bg-slate-900/50 p-1.5",
          compact ? "mb-3" : "mb-4"
        )}
      >
        {SERVICE_SECTOR_ORDER.map((sector) => {
          const active = activeSector === sector
          return (
            <button
              key={sector}
              type="button"
              onClick={() => handleSectorChange(sector)}
              className={cn(
                "relative touch-manipulation rounded-lg px-2 py-2 text-center text-[11px] font-semibold transition-colors active:scale-[0.98]",
                compact ? "min-h-9" : "min-h-10",
                active
                  ? "border border-emerald-500/40 bg-emerald-500/15 text-emerald-100 shadow-[0_0_12px_rgba(16,185,129,0.15)]"
                  : "border border-transparent text-slate-400 hover:text-slate-200"
              )}
              aria-pressed={active}
            >
              {SERVICE_SECTOR_LABELS[sector]}
            </button>
          )
        })}
      </div>

      <AnimatePresence mode="wait" initial={false} custom={sectorDirection}>
        <motion.div
          key={activeSector}
          custom={sectorDirection}
          variants={{
            enter: (direction: number) => ({ opacity: 0, x: direction * 20 }),
            center: { opacity: 1, x: 0 },
            exit: (direction: number) => ({ opacity: 0, x: direction * -20, pointerEvents: "none" }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.16 }}
          className="relative z-10 grid grid-cols-2 gap-3"
        >
          {visibleServices.map((service, index) => {
            const Icon = SERVICE_CARD_ICONS[service.id] ?? Wrench
            const tag = SERVICE_CARD_TAGS[service.id]
            const active = serviceTypeId === service.id
            return (
              <button
                key={service.id}
                type="button"
                data-intake-primary-option={index === 0 ? "" : undefined}
                onClick={() => onServiceTypeChange(service.id)}
                onKeyDown={(event) =>
                  onOptionRowKeyDown(event, () => onServiceTypeChange(service.id))
                }
                className={cn(
                  "flex touch-manipulation flex-row items-center gap-3 rounded-xl border bg-slate-900/40 p-3 text-left transition-all active:scale-[0.98]",
                  active
                    ? "border-emerald-500/50 bg-emerald-500/10 ring-1 ring-emerald-500/30"
                    : "border-slate-800 hover:border-emerald-500/30 hover:bg-slate-900/60"
                )}
                aria-pressed={active}
              >
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0 transition-colors",
                    active ? "text-emerald-400" : "text-slate-500"
                  )}
                  aria-hidden
                />
                <span
                  className={cn(
                    "min-w-0 flex-1 text-xs font-medium leading-snug",
                    active ? "text-emerald-100" : "text-slate-300"
                  )}
                >
                  {service.label}
                </span>
                {tag ? (
                  <span
                    className={cn(
                      "shrink-0 text-[9px] font-medium uppercase tracking-wider",
                      active ? "text-emerald-400/70" : "text-slate-600"
                    )}
                  >
                    {tag}
                  </span>
                ) : null}
              </button>
            )
          })}
        </motion.div>
      </AnimatePresence>
    </div>
  )
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
  /** Tighter layout for manual intake sheets */
  compact?: boolean
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
  compact = false,
  className,
}: ServiceQuoteCalculatorPanelProps) {
  const showSelector = variant === "full" || variant === "selector-only"
  const showBreakdown = variant === "full" || variant === "breakdown-only"
  const selectorOnlyCompact = compact && variant === "selector-only"
  const selectedLabel =
    SERVICE_QUOTE_TYPES.find((t) => t.id === serviceTypeId)?.label ?? "Selected service"

  return (
    <fieldset
      className={cn(
        selectorOnlyCompact
          ? "grid gap-2 border-0 bg-transparent p-0"
          : "grid gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3",
        className
      )}
    >
      {selectorOnlyCompact ? null : (
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-emerald-300">
          Quick booking · service quote
        </legend>
      )}
      {showSelector ? (
        <ServiceSectorSelector
          serviceTypeId={serviceTypeId}
          onServiceTypeChange={onServiceTypeChange}
          compact={compact}
        />
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
