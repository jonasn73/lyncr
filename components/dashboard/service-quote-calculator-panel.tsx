"use client"

// Live service quote breakdown for the answered-call quick booking sheet.

import { memo, useEffect, useMemo, useRef, useState } from "react"
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
  RotateCcw,
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
import {
  WS_ICON_ACTIVE,
  WS_ICON_INACTIVE,
  WS_METADATA,
  WS_OPTION_ROW,
  WS_OPTION_ROW_ACTIVE,
  WS_ROW,
  WS_TEXT,
  WS_TEXT_ACTIVE,
} from "@/lib/workspace-ui-tokens"

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
          className="relative z-10 grid grid-cols-2 gap-2"
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
                  WS_ROW,
                  "touch-manipulation active:scale-[0.98]",
                  // Compact intake: denser padding + smaller type so context/actions stay on-screen.
                  compact ? "gap-2 p-3 text-xs" : "",
                  active ? WS_OPTION_ROW_ACTIVE : WS_OPTION_ROW
                )}
                aria-pressed={active}
              >
                <Icon
                  className={cn(active ? WS_ICON_ACTIVE : WS_ICON_INACTIVE, compact && "h-3.5 w-3.5")}
                  aria-hidden
                />
                <span
                  className={cn(
                    "min-w-0 flex-1 leading-snug",
                    compact ? "text-xs font-medium" : "",
                    active ? WS_TEXT_ACTIVE : WS_TEXT
                  )}
                >
                  {service.label}
                </span>
                {tag ? (
                  <span className={cn(WS_METADATA, "shrink-0 normal-case", active ? "text-emerald-400/70" : "")}>
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
  /** Fired when operator edits base/travel — totalCents is the live pitched estimate. */
  onEstimateChange?: (totalCents: number, overridden: boolean) => void
  /** selector-only = step 1; breakdown-only = step 3; full = default */
  variant?: "full" | "selector-only" | "breakdown-only"
  /** Tighter layout for manual intake sheets */
  compact?: boolean
  className?: string
}

const moneyInputClass =
  "w-16 border-0 bg-transparent p-0 text-right text-xs tabular-nums text-foreground outline-none ring-0 focus:ring-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"

export const ServiceQuoteCalculatorPanel = memo(function ServiceQuoteCalculatorPanel({
  quote,
  serviceTypeId,
  vehicleYear,
  vehicleMake,
  vehicleModel,
  onServiceTypeChange,
  onEstimateChange,
  variant = "full",
  compact = false,
  className,
}: ServiceQuoteCalculatorPanelProps) {
  const showSelector = variant === "full" || variant === "selector-only"
  const showBreakdown = variant === "full" || variant === "breakdown-only"
  const selectorOnlyCompact = compact && variant === "selector-only"
  const selectedLabel =
    SERVICE_QUOTE_TYPES.find((t) => t.id === serviceTypeId)?.label ?? "Selected service"

  // System baselines (dollars) — re-sync when the calculator recalculates.
  const baselineBase = Math.round(quote.baseCents / 100)
  const baselineTravel = Math.round(quote.distancePremiumCents / 100)

  const [customBase, setCustomBase] = useState(baselineBase)
  const [customTravel, setCustomTravel] = useState(baselineTravel)
  const [baseDirty, setBaseDirty] = useState(false)
  const [travelDirty, setTravelDirty] = useState(false)
  const [showCompetitorMatch, setShowCompetitorMatch] = useState(false)
  const [competitorDollars, setCompetitorDollars] = useState("")
  const onEstimateChangeRef = useRef(onEstimateChange)
  onEstimateChangeRef.current = onEstimateChange
  const wasOverriddenRef = useRef(false)

  // New service type → start from the fresh system calculation.
  useEffect(() => {
    setCustomBase(Math.round(quote.baseCents / 100))
    setCustomTravel(Math.round(quote.distancePremiumCents / 100))
    setBaseDirty(false)
    setTravelDirty(false)
    wasOverriddenRef.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reset on service type switches
  }, [serviceTypeId])

  useEffect(() => {
    if (!baseDirty) setCustomBase(baselineBase)
  }, [baselineBase, baseDirty])

  useEffect(() => {
    if (!travelDirty) setCustomTravel(baselineTravel)
  }, [baselineTravel, travelDirty])

  // Age / brand / parts / programming stay system-calculated.
  const otherCents = useMemo(
    () =>
      quote.lines
        .filter((line) => line.kind !== "base_rate" && line.kind !== "distance_travel")
        .reduce((sum, line) => sum + line.cents, 0),
    [quote.lines]
  )

  const otherLines = useMemo(
    () => quote.lines.filter((line) => line.kind !== "base_rate" && line.kind !== "distance_travel"),
    [quote.lines]
  )

  const baseLabel =
    quote.lines.find((line) => line.kind === "base_rate")?.label ?? `${selectedLabel} base`
  const travelLabel =
    quote.lines.find((line) => line.kind === "distance_travel")?.label ??
    (quote.distanceMiles != null
      ? `Travel (${quote.distanceMiles.toFixed(1)} mi)`
      : "Travel fee")

  const safeBase = Number.isFinite(customBase) && customBase >= 0 ? customBase : 0
  const safeTravel = Number.isFinite(customTravel) && customTravel >= 0 ? customTravel : 0
  const totalEstimateCents = Math.round(safeBase * 100) + Math.round(safeTravel * 100) + otherCents
  const totalEstimateDollars = Math.round(totalEstimateCents / 100)
  const rangeLow = Math.round(safeBase)
  const rangeHigh = Math.round(safeBase + safeTravel)
  const isOverridden =
    baseDirty ||
    travelDirty ||
    Math.round(safeBase) !== baselineBase ||
    Math.round(safeTravel) !== baselineTravel

  const [showCompetitorMatch, setShowCompetitorMatch] = useState(false)
  const [competitorDollars, setCompetitorDollars] = useState("")

  // Push edits (and resets) to the booking form — skip the untouched baseline mount path
  // so negotiation / custom-price overrides are not wiped on open.
  useEffect(() => {
    if (!showBreakdown) return
    if (isOverridden) {
      wasOverriddenRef.current = true
      onEstimateChangeRef.current?.(totalEstimateCents, true)
      return
    }
    if (wasOverriddenRef.current) {
      wasOverriddenRef.current = false
      onEstimateChangeRef.current?.(totalEstimateCents, false)
    }
  }, [showBreakdown, totalEstimateCents, isOverridden])

  const resetToBaseline = () => {
    setCustomBase(baselineBase)
    setCustomTravel(baselineTravel)
    setBaseDirty(false)
    setTravelDirty(false)
    setShowCompetitorMatch(false)
  }

  const waiveTravel = () => {
    setCustomTravel(0)
    setTravelDirty(true)
  }

  const applyTenPercentDiscount = () => {
    // Cut total ~10% by scaling the editable base + travel lines.
    const nextBase = Math.max(0, Math.round(safeBase * 0.9))
    const nextTravel = Math.max(0, Math.round(safeTravel * 0.9))
    setCustomBase(nextBase)
    setCustomTravel(nextTravel)
    setBaseDirty(true)
    setTravelDirty(true)
  }

  const applyCompetitorMatch = () => {
    const dollars = Number.parseFloat(competitorDollars.trim())
    if (!Number.isFinite(dollars) || dollars < 0) return
    const otherDollars = Math.round(otherCents / 100)
    // Flat total override: clear travel, put remainder into base (other lines stay).
    const nextBase = Math.max(0, Math.round(dollars) - otherDollars)
    setCustomTravel(0)
    setCustomBase(nextBase)
    setTravelDirty(true)
    setBaseDirty(true)
    setShowCompetitorMatch(false)
    setCompetitorDollars("")
  }

  const presetBtnClass =
    "inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-100 transition-colors hover:bg-emerald-500/25 active:scale-[0.98]"


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
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-400/90">
            Baseline quote (editable)
          </p>
          {isOverridden ? (
            <button
              type="button"
              onClick={resetToBaseline}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-emerald-300/90 hover:bg-emerald-500/10 hover:text-emerald-200"
              title="Restore the system-calculated base and travel fees"
            >
              <RotateCcw className="h-3 w-3" aria-hidden />
              Reset to baseline
            </button>
          ) : null}
        </div>
        <ul className="mt-1 space-y-0.5">
          <li className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="min-w-0">{baseLabel}</span>
            <span className="inline-flex shrink-0 items-center gap-0.5 text-foreground">
              <span className="text-muted-foreground">$</span>
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                aria-label="Service base price dollars"
                value={Number.isFinite(customBase) ? customBase : ""}
                onChange={(e) => {
                  setBaseDirty(true)
                  setCustomBase(e.target.value === "" ? Number.NaN : Number(e.target.value))
                }}
                className={cn(moneyInputClass, baseDirty && Math.round(safeBase) !== baselineBase && "text-amber-200")}
              />
            </span>
          </li>
          <li className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="min-w-0">{travelLabel}</span>
            <span className="inline-flex shrink-0 items-center gap-0.5 text-foreground">
              <span className="text-muted-foreground">$</span>
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                aria-label="Travel fee dollars"
                value={Number.isFinite(customTravel) ? customTravel : ""}
                onChange={(e) => {
                  setTravelDirty(true)
                  setCustomTravel(e.target.value === "" ? Number.NaN : Number(e.target.value))
                }}
                className={cn(
                  moneyInputClass,
                  travelDirty && Math.round(safeTravel) !== baselineTravel && "text-amber-200"
                )}
              />
            </span>
          </li>
          {otherLines.map((line) => (
            <li key={line.label} className="flex justify-between gap-2 text-xs text-muted-foreground">
              <span className="min-w-0">{line.label}</span>
              <span className="shrink-0 tabular-nums text-foreground">{formatQuoteDollars(line.cents)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] leading-snug text-emerald-200/80">
          Suggested Quote Range:{" "}
          <span className="font-semibold tabular-nums text-emerald-100">
            ${rangeLow} – ${rangeHigh}
          </span>
          <span className="text-muted-foreground"> · start with the low number</span>
        </p>
        <div className="mt-1.5 flex items-baseline justify-between border-t border-emerald-500/20 pt-2">
          <span className="text-xs font-medium text-foreground">Total estimate</span>
          <span
            className={cn(
              "text-lg font-bold tabular-nums",
              isOverridden ? "text-amber-200" : "text-emerald-300"
            )}
          >
            {formatQuoteDollars(totalEstimateCents)}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" className={presetBtnClass} onClick={waiveTravel}>
            Waive Travel
          </button>
          <button type="button" className={presetBtnClass} onClick={applyTenPercentDiscount}>
            10% Discount
          </button>
          <button
            type="button"
            className={presetBtnClass}
            onClick={() => {
              setShowCompetitorMatch((open) => !open)
              if (!competitorDollars.trim()) {
                setCompetitorDollars(String(totalEstimateDollars > 0 ? totalEstimateDollars : 95))
              }
            }}
          >
            Match Competitor
          </button>
        </div>

        {showCompetitorMatch ? (
          <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-emerald-500/25 bg-emerald-500/5 p-2">
            <label className="grid min-w-[7rem] flex-1 gap-0.5 text-[10px] text-muted-foreground">
              <span className="font-medium text-foreground">Competitor quote ($)</span>
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                autoFocus
                value={competitorDollars}
                onChange={(e) => setCompetitorDollars(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    applyCompetitorMatch()
                  }
                }}
                className="h-8 rounded-md border border-border/70 bg-background px-2 text-sm tabular-nums text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="95"
              />
            </label>
            <button
              type="button"
              onClick={applyCompetitorMatch}
              className="inline-flex h-8 items-center rounded-md border border-primary/40 bg-primary/15 px-3 text-[11px] font-semibold text-primary hover:bg-primary/20"
            >
              Apply flat ${competitorDollars.trim() || "—"}
            </button>
            <button
              type="button"
              onClick={() => setShowCompetitorMatch(false)}
              className="inline-flex h-8 items-center rounded-md px-2 text-[11px] text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        ) : null}

        {quote.distanceMiles != null || quote.keyBlankCents > 0 || quote.programmingCents > 0 ? (
          <p className="mt-1 text-[10px] text-muted-foreground">
            System baseline = {formatQuoteDollars(quote.baseCents)} service
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
