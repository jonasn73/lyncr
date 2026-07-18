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
import {
  competitiveBaseTargetDollars,
  getCompetitorDensity,
  HIGH_COMPETITION_BASE_FLOOR_DOLLARS,
} from "@/lib/competitor-density"
import { estimateTravelMinutes } from "@/lib/geo"
import { cn } from "@/lib/utils"
import {
  AUTOMOTIVE_JOB_TYPE_IDS,
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

function servicesForSector(
  sector: ServiceSector,
  /** Hide AKL/Spare/etc. on first Service screen — chosen after YMM on JOB_TYPE. */
  deferAutomotiveKeyTypes = false
): (typeof SERVICE_QUOTE_TYPES)[number][] {
  const deferred = new Set<ServiceQuoteTypeId>(AUTOMOTIVE_JOB_TYPE_IDS)
  const ids = new Set<ServiceQuoteTypeId>([...SERVICE_IDS_BY_SECTOR[sector], "other"])
  return SERVICE_QUOTE_TYPES.filter((service) => {
    if (!ids.has(service.id)) return false
    if (deferAutomotiveKeyTypes && sector === "automotive" && deferred.has(service.id)) return false
    return true
  })
}

type ServiceSectorSelectorProps = {
  serviceTypeId: ServiceQuoteTypeId
  onServiceTypeChange: (id: ServiceQuoteTypeId) => void
  compact?: boolean
  /**
   * Automotive Service screen: show Lockout + “Car key / fob” instead of AKL vs Spare.
   * Used by step intake so year/make/model comes before job type.
   */
  deferAutomotiveKeyTypes?: boolean
}

function ServiceSectorSelector({
  serviceTypeId,
  onServiceTypeChange,
  compact,
  deferAutomotiveKeyTypes = false,
}: ServiceSectorSelectorProps) {
  const [activeSector, setActiveSector] = useState<ServiceSector>(() => serviceSectorForType(serviceTypeId))
  const [sectorDirection, setSectorDirection] = useState(1)

  const visibleServices = useMemo(
    () => servicesForSector(activeSector, deferAutomotiveKeyTypes),
    [activeSector, deferAutomotiveKeyTypes]
  )
  const carKeyFobActive =
    deferAutomotiveKeyTypes &&
    activeSector === "automotive" &&
    (AUTOMOTIVE_JOB_TYPE_IDS as readonly string[]).includes(serviceTypeId)

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
          {deferAutomotiveKeyTypes && activeSector === "automotive" ? (
            <button
              type="button"
              data-intake-primary-option=""
              onClick={() => onServiceTypeChange("key_generation")}
              onKeyDown={(event) =>
                onOptionRowKeyDown(event, () => onServiceTypeChange("key_generation"))
              }
              className={cn(
                WS_ROW,
                "touch-manipulation active:scale-[0.98]",
                compact ? "gap-2 p-3 text-xs" : "",
                carKeyFobActive ? WS_OPTION_ROW_ACTIVE : WS_OPTION_ROW
              )}
              aria-pressed={carKeyFobActive}
            >
              <Key
                className={cn(
                  carKeyFobActive ? WS_ICON_ACTIVE : WS_ICON_INACTIVE,
                  compact && "h-3.5 w-3.5"
                )}
                aria-hidden
              />
              <span
                className={cn(
                  "min-w-0 flex-1 leading-snug",
                  compact ? "text-xs font-medium" : "",
                  carKeyFobActive ? WS_TEXT_ACTIVE : WS_TEXT
                )}
              >
                Car key / fob
              </span>
              <span
                className={cn(
                  WS_METADATA,
                  "shrink-0 normal-case",
                  carKeyFobActive ? "text-emerald-400/70" : ""
                )}
              >
                YMM first
              </span>
            </button>
          ) : null}
          {visibleServices.map((service, index) => {
            const Icon = SERVICE_CARD_ICONS[service.id] ?? Wrench
            const tag = SERVICE_CARD_TAGS[service.id]
            const active = serviceTypeId === service.id
            return (
              <button
                key={service.id}
                type="button"
                data-intake-primary-option={
                  !deferAutomotiveKeyTypes && index === 0 ? "" : undefined
                }
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
  /** Appointment ZIP — drives geofenced competitor density / aggressive floors. */
  postalCode?: string | null
  onServiceTypeChange: (id: ServiceQuoteTypeId) => void
  /** Fired when operator edits base/travel — totalCents is the live pitched estimate. */
  onEstimateChange?: (totalCents: number, overridden: boolean) => void
  /**
   * Fired when line-item estimate and/or flat negotiated lock change.
   * calculatedCents = system Total estimate; finalCents = locked flat (or calculated when unlocked).
   */
  onFlatPriceChange?: (payload: {
    calculatedCents: number
    finalCents: number
    isOverridden: boolean
  }) => void
  /** selector-only = step 1; breakdown-only = step 3; full = default */
  variant?: "full" | "selector-only" | "breakdown-only"
  /** Tighter layout for manual intake sheets */
  compact?: boolean
  /** Defer AKL/Spare to JOB_TYPE after vehicle YMM (step intake Service screen). */
  deferAutomotiveKeyTypes?: boolean
  className?: string
}

type PriceStage = "silent" | "starting" | "firm"

const moneyInputClass =
  "w-16 border-0 bg-transparent p-0 text-right text-sm font-semibold tabular-nums text-foreground outline-none ring-0 focus:ring-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"

const dealPillClass =
  "inline-flex h-8 shrink-0 items-center justify-center rounded-full border border-emerald-400/50 bg-emerald-500/20 px-3 text-[10px] font-bold uppercase tracking-wide text-emerald-50 transition-colors hover:bg-emerald-500/35 active:scale-[0.98]"

export const ServiceQuoteCalculatorPanel = memo(function ServiceQuoteCalculatorPanel({
  quote,
  serviceTypeId,
  vehicleYear,
  vehicleMake,
  vehicleModel,
  postalCode = null,
  onServiceTypeChange,
  onEstimateChange,
  onFlatPriceChange,
  variant = "full",
  compact = false,
  deferAutomotiveKeyTypes = false,
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
  const competitorDensity = getCompetitorDensity(postalCode)
  const highCompetition = competitorDensity === "high"
  // Geofenced firm-stage floor (e.g. $75 in 40216) — never higher than the system base.
  const aggressiveBaseFloor = competitiveBaseTargetDollars(baselineBase, postalCode)

  const [priceStage, setPriceStage] = useState<PriceStage>("silent")
  const [customBase, setCustomBase] = useState(baselineBase)
  const [customTravel, setCustomTravel] = useState(baselineTravel)
  const [baseDirty, setBaseDirty] = useState(false)
  const [travelDirty, setTravelDirty] = useState(false)
  // Operator can waive blank / programming when customer already has hardware.
  const [includeKeyBlank, setIncludeKeyBlank] = useState(true)
  const [includeKeyProgramming, setIncludeKeyProgramming] = useState(true)
  /** Flat negotiated lock (dollars string) — empty means use the system Total estimate. */
  const [flatLockDollars, setFlatLockDollars] = useState("")
  const [competitorPrice, setCompetitorPrice] = useState("")
  const [diagnosticCushion, setDiagnosticCushion] = useState(false)
  const onEstimateChangeRef = useRef(onEstimateChange)
  onEstimateChangeRef.current = onEstimateChange
  const onFlatPriceChangeRef = useRef(onFlatPriceChange)
  onFlatPriceChangeRef.current = onFlatPriceChange
  const wasOverriddenRef = useRef(false)

  // New service type → collapse pricing and reset to system numbers.
  useEffect(() => {
    setPriceStage("silent")
    setCustomBase(Math.round(quote.baseCents / 100))
    setCustomTravel(Math.round(quote.distancePremiumCents / 100))
    setBaseDirty(false)
    setTravelDirty(false)
    setIncludeKeyBlank(true)
    setIncludeKeyProgramming(true)
    setFlatLockDollars("")
    setCompetitorPrice("")
    setDiagnosticCushion(false)
    wasOverriddenRef.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reset on service type switches
  }, [serviceTypeId])

  useEffect(() => {
    if (!baseDirty) setCustomBase(baselineBase)
  }, [baselineBase, baseDirty])

  useEffect(() => {
    if (!travelDirty) setCustomTravel(baselineTravel)
  }, [baselineTravel, travelDirty])

  // Age / brand stay system-calculated; blank + programming are checkbox-gated.
  const otherFixedCents = useMemo(
    () =>
      quote.lines
        .filter(
          (line) =>
            line.kind !== "base_rate" &&
            line.kind !== "distance_travel" &&
            line.kind !== "key_blank" &&
            line.kind !== "key_programming"
        )
        .reduce((sum, line) => sum + line.cents, 0),
    [quote.lines]
  )

  const otherFixedLines = useMemo(
    () =>
      quote.lines.filter(
        (line) =>
          line.kind !== "base_rate" &&
          line.kind !== "distance_travel" &&
          line.kind !== "key_blank" &&
          line.kind !== "key_programming"
      ),
    [quote.lines]
  )

  const blankLine = quote.lines.find((line) => line.kind === "key_blank") ?? null
  const programmingLine = quote.lines.find((line) => line.kind === "key_programming") ?? null
  // Active (checked) hardware costs — uncheck to drop them from the live total.
  const activeBlankCents = includeKeyBlank && blankLine ? blankLine.cents : 0
  const activeProgrammingCents =
    includeKeyProgramming && programmingLine ? programmingLine.cents : 0

  const baseLabel =
    quote.lines.find((line) => line.kind === "base_rate")?.label ?? `${selectedLabel} base`
  const travelLabel =
    quote.lines.find((line) => line.kind === "distance_travel")?.label ??
    (quote.distanceMiles != null
      ? `Travel (${quote.distanceMiles.toFixed(1)} mi)`
      : "Travel fee")

  const safeBase = Number.isFinite(customBase) && customBase >= 0 ? customBase : 0
  const safeTravel = Number.isFinite(customTravel) && customTravel >= 0 ? customTravel : 0
  const calculatedEstimateCents =
    Math.round(safeBase * 100) +
    Math.round(safeTravel * 100) +
    otherFixedCents +
    activeBlankCents +
    activeProgrammingCents
  // Flat lock → displayed / booked total; otherwise the system line-item estimate.
  const flatLockParsed = Number.parseFloat(flatLockDollars.trim())
  const flatLockActive =
    flatLockDollars.trim() !== "" && Number.isFinite(flatLockParsed) && flatLockParsed >= 0
  const flatLockCents = flatLockActive ? Math.round(flatLockParsed * 100) : 0
  const totalEstimateCents = flatLockActive ? flatLockCents : calculatedEstimateCents
  // Suggested range: low = Base+Travel; high = Base+Travel+active Blank+active Programming.
  const suggestedRangeLowDollars = Math.round(safeBase + safeTravel)
  const suggestedRangeHighDollars = Math.round(
    safeBase + safeTravel + activeBlankCents / 100 + activeProgrammingCents / 100
  )
  const blankWaived = Boolean(blankLine && !includeKeyBlank)
  const programmingWaived = Boolean(programmingLine && !includeKeyProgramming)
  const isOverridden =
    priceStage === "firm" &&
    (flatLockActive ||
      baseDirty ||
      travelDirty ||
      diagnosticCushion ||
      blankWaived ||
      programmingWaived ||
      Math.round(safeBase) !== baselineBase ||
      Math.round(safeTravel) !== baselineTravel)

  const competitorNum = Number.parseFloat(competitorPrice.trim())
  const competitorTarget =
    Number.isFinite(competitorNum) && competitorNum > 0 ? Math.max(0, Math.round(competitorNum) - 10) : null

  // Live competitor match: target = competitor − $10, applied to editable lines.
  useEffect(() => {
    if (priceStage !== "firm" || competitorTarget == null) return
    const lockedDollars = Math.round(
      (otherFixedCents + activeBlankCents + activeProgrammingCents) / 100
    )
    const nextBase = Math.max(0, competitorTarget - lockedDollars)
    setCustomTravel(0)
    setCustomBase(nextBase)
    setTravelDirty(true)
    setBaseDirty(true)
  }, [
    competitorTarget,
    otherFixedCents,
    activeBlankCents,
    activeProgrammingCents,
    priceStage,
  ])

  // Sync firm-stage totals into the booking ticket; silent/starting keep system auto-quote.
  useEffect(() => {
    if (!showBreakdown) return
    if (priceStage !== "firm") {
      if (wasOverriddenRef.current) {
        wasOverriddenRef.current = false
        onEstimateChangeRef.current?.(quote.totalCents, false)
        onFlatPriceChangeRef.current?.({
          calculatedCents: quote.totalCents,
          finalCents: quote.totalCents,
          isOverridden: false,
        })
      }
      return
    }
    if (isOverridden) {
      wasOverriddenRef.current = true
      onEstimateChangeRef.current?.(totalEstimateCents, true)
    } else {
      // Firm but still on baseline numbers — still persist so Continue captures the visible total.
      onEstimateChangeRef.current?.(totalEstimateCents, false)
    }
    onFlatPriceChangeRef.current?.({
      calculatedCents: calculatedEstimateCents,
      finalCents: totalEstimateCents,
      isOverridden: flatLockActive,
    })
  }, [
    showBreakdown,
    priceStage,
    totalEstimateCents,
    calculatedEstimateCents,
    flatLockActive,
    isOverridden,
    quote.totalCents,
  ])

  const resetToBaseline = () => {
    setCustomBase(baselineBase)
    setCustomTravel(baselineTravel)
    setBaseDirty(false)
    setTravelDirty(false)
    setIncludeKeyBlank(true)
    setIncludeKeyProgramming(true)
    setFlatLockDollars("")
    setCompetitorPrice("")
    setDiagnosticCushion(false)
  }

  const waiveTravel = () => {
    setCustomTravel(0)
    setTravelDirty(true)
  }

  const applyTenPercentDiscount = () => {
    // Deduct 10% from the baseline (service base) only.
    setCustomBase(Math.max(0, Math.round(safeBase * 0.9)))
    setBaseDirty(true)
  }

  const toggleDiagnosticCushion = () => {
    setDiagnosticCushion((on) => !on)
  }

  /** Enter firm stage — in high-competition ZIPs, seed the aggressive floor immediately. */
  const openFirmStage = () => {
    if (highCompetition && !baseDirty) {
      setCustomBase(aggressiveBaseFloor)
      if (aggressiveBaseFloor !== baselineBase) setBaseDirty(true)
    }
    setPriceStage("firm")
  }

  const competitionBadge = highCompetition ? (
    <p className="rounded-md border border-orange-500/40 bg-orange-500/15 px-2.5 py-1.5 text-[11px] font-semibold leading-snug text-orange-100">
      🔥 High Competition Area — Aggressive Quote Suggested
      {postalCode ? (
        <span className="font-normal text-orange-100/80"> · ZIP {String(postalCode).slice(0, 5)}</span>
      ) : null}
    </p>
  ) : null

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
          deferAutomotiveKeyTypes={deferAutomotiveKeyTypes}
        />
      ) : null}
      {showBreakdown ? (
        <div
          className="rounded-lg border border-emerald-500/20 bg-background/40 px-3 py-2.5"
          aria-live="polite"
          aria-atomic="true"
        >
          {variant === "breakdown-only" ? (
            <p className="mb-2 text-[11px] font-medium text-emerald-200/90">{selectedLabel}</p>
          ) : null}

          {/* Stage: silent — zero pricing friction */}
          {priceStage === "silent" ? (
            <div className="grid gap-2">
              {competitionBadge}
              <p className="text-[11px] text-muted-foreground">
                Skip the price talk if the caller is ready to book — or open a guided pitch.
              </p>
              <button
                type="button"
                onClick={() => setPriceStage("starting")}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-emerald-400/50 bg-emerald-500/15 text-sm font-semibold text-emerald-50 transition-colors hover:bg-emerald-500/25"
              >
                💵 Discuss Pricing
              </button>
            </div>
          ) : null}

          {/* Stage: starting — soft anchor + script */}
          {priceStage === "starting" ? (
            <div className="grid gap-3">
              {competitionBadge}
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-emerald-100">
                  Quote Base: Starting at $
                  {highCompetition ? aggressiveBaseFloor || HIGH_COMPETITION_BASE_FLOOR_DOLLARS : baselineBase || 85}{" "}
                  + travel
                  {baselineTravel > 0 ? ` ($${baselineTravel})` : ""}
                </p>
                <button
                  type="button"
                  onClick={() => setPriceStage("silent")}
                  className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground"
                >
                  Hide
                </button>
              </div>
              <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[12px] leading-relaxed text-amber-50">
                🏷️ Pitch: &ldquo;Our baseline starts at $
                {highCompetition ? aggressiveBaseFloor || HIGH_COMPETITION_BASE_FLOOR_DOLLARS : baselineBase || 85}.
                We&apos;ll inspect your vehicle&apos;s specific immobilizer features on-site to give you a
                final quote before starting.&rdquo;
              </p>
              <button
                type="button"
                onClick={openFirmStage}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-amber-400/40 bg-amber-500/15 text-xs font-semibold text-amber-50 transition-colors hover:bg-amber-500/25"
              >
                ⚠️ Customer Insists on Exact Price
              </button>
            </div>
          ) : null}

          {/* Stage: firm — full negotiation workspace */}
          {priceStage === "firm" ? (
            <div className="grid gap-2">
              {competitionBadge}
              <div className="flex items-center justify-between gap-2">
                <p className="flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400/90">
                  <span>Exact price workspace</span>
                  {quote.pricingTier === "tier3" ? (
                    <span className="inline-flex items-center rounded-md border border-amber-400/50 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-amber-100">
                      ⚠️ High-Security Vehicle - Specialized Programming Required
                    </span>
                  ) : null}
                </p>
                <div className="flex items-center gap-2">
                  {isOverridden ? (
                    <button
                      type="button"
                      onClick={resetToBaseline}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-emerald-300/90 hover:bg-emerald-500/10"
                    >
                      <RotateCcw className="h-3 w-3" aria-hidden />
                      Reset
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setPriceStage("starting")}
                    className="text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    Soft pitch
                  </button>
                </div>
              </div>

              {diagnosticCushion ? (
                <div className="rounded-lg border border-sky-500/35 bg-sky-500/10 px-3 py-2">
                  <p className="text-sm font-bold tabular-nums text-sky-100">
                    Entry fee: $29 on-site diagnostic
                  </p>
                  <p className="mt-0.5 text-[11px] leading-snug text-sky-100/85">
                    Waived when we proceed with key cutting / programming. Full job estimate stays{" "}
                    <span className="font-semibold tabular-nums">
                      {formatQuoteDollars(totalEstimateCents)}
                    </span>
                    .
                  </p>
                </div>
              ) : null}

              <ul className="space-y-1">
                <li className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="min-w-0">{baseLabel}</span>
                  <span className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-border/50 bg-background/80 px-2 py-1 text-foreground">
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
                      className={cn(
                        moneyInputClass,
                        baseDirty && Math.round(safeBase) !== baselineBase && "text-amber-200"
                      )}
                    />
                  </span>
                </li>
                <li className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="min-w-0">{travelLabel}</span>
                  <span className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-border/50 bg-background/80 px-2 py-1 text-foreground">
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
                {otherFixedLines.map((line) => (
                  <li key={line.label} className="flex justify-between gap-2 text-xs text-muted-foreground">
                    <span className="min-w-0">{line.label}</span>
                    <span className="shrink-0 tabular-nums text-foreground">
                      {formatQuoteDollars(line.cents)}
                    </span>
                  </li>
                ))}
                {blankLine ? (
                  <li className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <label className="flex min-w-0 cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={includeKeyBlank}
                        onChange={(e) => setIncludeKeyBlank(e.target.checked)}
                        className="h-3.5 w-3.5 shrink-0 rounded border-border accent-emerald-500"
                        aria-label={`Include ${blankLine.label}`}
                      />
                      <span className={cn("min-w-0", !includeKeyBlank && "line-through opacity-60")}>
                        {blankLine.label} (${Math.round(blankLine.cents / 100)})
                      </span>
                    </label>
                    <span
                      className={cn(
                        "shrink-0 tabular-nums",
                        includeKeyBlank ? "text-foreground" : "text-muted-foreground line-through"
                      )}
                    >
                      {formatQuoteDollars(activeBlankCents)}
                    </span>
                  </li>
                ) : null}
                {programmingLine ? (
                  <li className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <label className="flex min-w-0 cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={includeKeyProgramming}
                        onChange={(e) => setIncludeKeyProgramming(e.target.checked)}
                        className="h-3.5 w-3.5 shrink-0 rounded border-border accent-emerald-500"
                        aria-label={`Include ${programmingLine.label}`}
                      />
                      <span
                        className={cn("min-w-0", !includeKeyProgramming && "line-through opacity-60")}
                      >
                        {programmingLine.label} (${Math.round(programmingLine.cents / 100)})
                      </span>
                    </label>
                    <span
                      className={cn(
                        "shrink-0 tabular-nums",
                        includeKeyProgramming
                          ? "text-foreground"
                          : "text-muted-foreground line-through"
                      )}
                    >
                      {formatQuoteDollars(activeProgrammingCents)}
                    </span>
                  </li>
                ) : null}
              </ul>

              <label className="mt-1 grid gap-1 rounded-md border border-border/40 bg-background/30 p-2 text-[11px]">
                <span className="font-medium text-foreground">Competitor Price Match</span>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">They quoted $</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    value={competitorPrice}
                    onChange={(e) => setCompetitorPrice(e.target.value)}
                    placeholder="e.g. 150"
                    className="h-8 w-24 rounded-md border border-border/70 bg-background px-2 text-sm tabular-nums text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  {competitorTarget != null ? (
                    <span className="text-[11px] font-semibold text-emerald-200">
                      → Beat by $10 → pitch ${competitorTarget}
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">
                      Auto-sets our total $10 under their number
                    </span>
                  )}
                </div>
              </label>

              <p className="text-[11px] leading-snug text-emerald-200/80">
                Suggested Quote Range:{" "}
                <span className="font-semibold tabular-nums text-emerald-100">
                  ${suggestedRangeLowDollars} – ${suggestedRangeHighDollars}
                </span>
              </p>

              <div className="flex items-baseline justify-between border-t border-emerald-500/20 pt-2">
                <span className="text-xs font-medium text-foreground">Total estimate</span>
                <span className="inline-flex items-baseline gap-2">
                  {flatLockActive ? (
                    <span className="text-sm font-semibold tabular-nums text-muted-foreground line-through decoration-rose-400/80">
                      {formatQuoteDollars(calculatedEstimateCents)}
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      "text-lg font-bold tabular-nums",
                      flatLockActive || isOverridden ? "text-amber-200" : "text-emerald-300"
                    )}
                  >
                    {formatQuoteDollars(totalEstimateCents)}
                  </span>
                </span>
              </div>

              <label className="mt-1 grid gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px]">
                <span className="font-medium text-amber-50">🔒 Lock Flat Negotiated Price</span>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-amber-100/80">$</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    value={flatLockDollars}
                    onChange={(e) => setFlatLockDollars(e.target.value)}
                    placeholder="e.g. 375"
                    aria-label="Lock flat negotiated price in dollars"
                    className="h-8 w-28 rounded-md border border-amber-500/40 bg-background px-2 text-sm tabular-nums text-foreground focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
                  />
                  {flatLockActive ? (
                    <button
                      type="button"
                      onClick={() => setFlatLockDollars("")}
                      className="text-[10px] font-medium text-amber-200 underline-offset-2 hover:underline"
                    >
                      Clear lock
                    </button>
                  ) : (
                    <span className="text-[10px] text-amber-100/70">
                      Optional — overrides the system total when you book
                    </span>
                  )}
                </div>
              </label>

              <div className="mt-1 flex flex-wrap gap-1.5">
                <button type="button" className={dealPillClass} onClick={waiveTravel}>
                  Waive Travel Fee
                </button>
                <button type="button" className={dealPillClass} onClick={applyTenPercentDiscount}>
                  Apply 10% Discount
                </button>
                <button
                  type="button"
                  className={cn(
                    dealPillClass,
                    diagnosticCushion && "border-sky-400/60 bg-sky-500/25 text-sky-50"
                  )}
                  onClick={toggleDiagnosticCushion}
                >
                  Add $29 On-Site Diagnostic Cushion
                </button>
              </div>

              {(quote.distanceMiles != null ||
                quote.keyBlankCents > 0 ||
                quote.programmingCents > 0) && (
                <p className="text-[10px] text-muted-foreground">
                  System baseline = {formatQuoteDollars(quote.baseCents)} service
                  {quote.distanceMiles != null
                    ? ` + ${formatQuoteDollars(quote.distancePremiumCents)} travel (${quote.distanceMiles.toFixed(1)} mi)`
                    : ""}
                  {quote.keyBlankCents > 0
                    ? ` + ${formatQuoteDollars(quote.keyBlankCents)} parts`
                    : ""}
                  {quote.programmingCents > 0
                    ? ` + ${formatQuoteDollars(quote.programmingCents)} programming`
                    : ""}
                </p>
              )}
              <p className="text-[10px] text-muted-foreground">
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
        </div>
      ) : null}
    </fieldset>
  )
})
