"use client"

// Key / remote reference panel — FCC IDs grouped with photos and compatible vehicles per FCC.

import { useEffect, useMemo, useState } from "react"
import { motion } from "framer-motion"
import { Check, ChevronDown, ExternalLink, Info, KeyRound, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  lookupMykeysProProfile,
  mykeysProKeyOptions,
} from "@/lib/mykeys-pro-database"
import { sanitizeFccIdInput, type ManualKeyFrequencyOption } from "@/lib/fcc-id-input"
import { KEY_STYLE_OPTIONS } from "@/lib/vehicle-key-styles"
import { resolveVariantKeyStyle, variantButtonLabel, variantDisplayLabel, inferProgrammingMethod } from "@/lib/vehicle-key-variant-labels"
import { buildTransponderIslandSku } from "@/lib/transponder-island-sku"
import {
  shouldShowAklTrimVerificationBanner,
  variantDisabledByTrim,
  type VehicleFactoryOption,
  type VehicleTrimProfile,
} from "@/lib/vehicle-trim-features"
import { getVehicleTrimHelper } from "@/lib/vehicle-trim-helpers"
import {
  WS_METADATA,
  WS_OPTION_ROW,
  WS_OPTION_ROW_ACTIVE,
  WS_ROW,
  WS_TEXT,
  WS_TEXT_ACTIVE,
} from "@/lib/workspace-ui-tokens"

function relatedFccLabels(
  fccId: string,
  profiles: Array<{ fcc_id: string; frequency: string | null; modulation: string | null }>
): string[] {
  const self = profiles.find((p) => p.fcc_id === fccId)
  if (!self) return []
  const selfNorm = sanitizeFccIdInput(fccId)
  return profiles
    .filter((other) => {
      if (other.fcc_id === fccId) return false
      if ((other.frequency ?? "") !== (self.frequency ?? "")) return false
      if ((other.modulation ?? "") !== (self.modulation ?? "")) return false
      const otherNorm = sanitizeFccIdInput(other.fcc_id)
      return otherNorm.startsWith(selfNorm) || selfNorm.startsWith(otherNorm)
    })
    .map((other) => other.fcc_id)
}

export type VehicleKeySelection = {
  profileId: string
  fccId: string
  frequency: string | null
  chipset: string | null
  keyStyle: string
  /** Selected visual variant from fccid.io (optional). */
  variantId?: string | null
  /** How this key is programmed (OBD2, on-board sequence, etc.). */
  programmingMethod?: string | null
}

type KeyProfile = {
  id: string
  fcc_id: string
  frequency: string | null
  modulation: string | null
  chipset: string | null
}

type FccVariant = {
  id: string
  title: string
  image_url: string | null
  key_type: string | null
  buttons: string | null
  battery: string | null
  fits_text: string | null
  suggested_key_style: string | null
  programming_method?: string | null
  reference_image?: boolean
  reference_note?: string
}

/** Normalized card fields for database + manual key pickers. */
export type KeySelectionCardModel = {
  id: string
  label: string
  description: string | null
  imageUrl: string | null
  programmingMethod: string
  referenceImage?: boolean
  referenceNote?: string | null
  /** Transponder Island catalog SKU badge (e.g. TI-SKU: PROX-HON-04). */
  tiSku?: string | null
  /** Operational specs under the SKU badge. */
  specs?: Array<{ label: string; value: string }>
  /** Demoted FCC ID footnote. */
  fccFootnote?: string | null
}

type ProfileDetail = {
  profile: KeyProfile
  variants: FccVariant[]
  compatible_summary: {
    lines: string[]
    overflow: number
  }
}

type KeyInfoPayload = {
  year: number
  make: string
  model: string
  matched_model: string
  match_type: "exact" | "family"
  profiles: KeyProfile[]
  profile_details: ProfileDetail[]
  transponder_island_url: string
  keysolved_url: string
  disclaimer: string
  photo_disclaimer?: string
}

type VehicleKeyInfoPanelProps = {
  year: string
  make: string
  model: string
  value: VehicleKeySelection | null
  onChange: (next: VehicleKeySelection | null) => void
  /** Fired when a key layout variant card is tapped — use to auto-advance intake steps. */
  onVariantSelected?: (selection: VehicleKeySelection) => void
  /** Trim from VIN decode or dispatcher (e.g. Base, SLT). */
  vehicleTrim?: string
  /** Confirmed factory equipment on this vehicle. */
  factoryOptions?: VehicleFactoryOption[]
  onVehicleTrimChange?: (trim: string) => void
  disabled?: boolean
  /** Step back to YMM vehicle picker when manual key lookup has no database match. */
  onBackToVehicleLookup?: () => void
}

function variantCardModel(
  variant: FccVariant,
  profile: KeyProfile,
  make?: string | null
): KeySelectionCardModel {
  const styleLabel = variantDisplayLabel(variant.title, variant.key_type)
  const buttonLabel = variantButtonLabel(
    variant.title,
    variant.buttons,
    variant.fits_text,
    variant.key_type
  )
  const blade = inferBladeType([variant])
  const specs: Array<{ label: string; value: string }> = []
  if (profile.chipset) specs.push({ label: "Chip Type", value: profile.chipset })
  if (blade) specs.push({ label: "Blade", value: blade.startsWith("High") ? blade : `High Security ${blade}` })
  if (profile.frequency) {
    const modulation =
      profile.modulation && profile.modulation !== "XXX" ? ` ${profile.modulation}` : ""
    specs.push({ label: "Frequency", value: `${profile.frequency} MHz${modulation}` })
  }
  return {
    id: variant.id,
    label: buttonLabel ? `${buttonLabel} · ${styleLabel}` : styleLabel,
    description: variant.title,
    imageUrl: variant.image_url,
    programmingMethod:
      variant.programming_method ??
      inferProgrammingMethod(variant.title, variant.key_type, profile.chipset ?? null),
    referenceImage: variant.reference_image,
    referenceNote: variant.reference_note ?? null,
    tiSku: buildTransponderIslandSku({
      make,
      title: variant.title,
      keyType: variant.key_type,
      variantId: variant.id,
    }),
    specs,
    fccFootnote: profile.fcc_id ? `FCC ${profile.fcc_id}` : null,
  }
}

function manualOptionCardModel(option: ManualKeyFrequencyOption): KeySelectionCardModel {
  return {
    id: option.id,
    label: option.label,
    description: option.description,
    imageUrl: option.imageUrl,
    programmingMethod: option.programmingMethod,
    tiSku: buildTransponderIslandSku({
      make: null,
      title: option.label,
      keyType: option.label,
      variantId: option.id,
    }),
    specs: option.description
      ? [{ label: "Spec", value: option.description }]
      : undefined,
    fccFootnote: null,
  }
}

function KeyThumbnail({ imageUrl, label }: { imageUrl: string | null; label: string }) {
  const [failed, setFailed] = useState(false)
  const showImage = Boolean(imageUrl) && !failed

  return (
    <div className="w-full h-32 bg-slate-850 rounded-lg border border-slate-800 flex items-center justify-center overflow-hidden">
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- fccid.io / bundled key thumbnails
        <img
          src={imageUrl!}
          alt={label}
          loading="lazy"
          className="h-full w-full object-contain p-2"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex flex-col items-center gap-1 text-slate-500">
          <KeyRound className="h-8 w-8 opacity-50" aria-hidden />
          <span className="text-[10px] font-medium uppercase tracking-wide">Key blank preview</span>
        </div>
      )}
    </div>
  )
}

export function KeySelectionCard({
  card,
  selected,
  disabled,
  disabledReason,
  onClick,
}: {
  card: KeySelectionCardModel
  selected: boolean
  disabled?: boolean
  disabledReason?: string | null
  onClick: () => void
}) {
  return (
    <div className="grid gap-1">
      <motion.button
        type="button"
        whileTap={disabled ? undefined : { scale: 0.98 }}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "relative w-full touch-manipulation rounded-xl border p-2.5 text-left transition-colors",
          disabled && "cursor-not-allowed opacity-40",
          !disabled && selected
            ? "border-emerald-500/50 bg-emerald-950/30"
            : !disabled
              ? "border-slate-800 bg-slate-950/50 hover:border-slate-700"
              : "border-slate-800 bg-slate-950/40"
        )}
        aria-pressed={selected}
        aria-disabled={disabled}
      >
        {selected ? (
          <span
            className="absolute top-2 right-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm"
            aria-hidden
          >
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
        ) : null}
        <KeyThumbnail imageUrl={card.imageUrl} label={card.label} />
        <div className="mt-2.5 min-w-0 space-y-2">
          {card.tiSku ? (
            <span className="inline-flex max-w-full truncate text-emerald-400 font-mono text-sm tracking-wider bg-emerald-950/40 border border-emerald-900/50 px-2 py-1 rounded-md">
              {card.tiSku}
            </span>
          ) : (
            <span className={cn("block text-sm font-semibold leading-snug", selected ? "text-emerald-100" : "text-slate-100")}>
              {card.label}
            </span>
          )}
          {card.specs && card.specs.length > 0 ? (
            <ul className="space-y-0.5 text-[11px] leading-snug text-slate-300">
              {card.specs.map((spec) => (
                <li key={spec.label}>
                  <span className="text-slate-500">{spec.label}:</span> {spec.value}
                </li>
              ))}
            </ul>
          ) : card.description ? (
            <p className="line-clamp-2 text-[11px] text-slate-400">{card.description}</p>
          ) : null}
          {card.programmingMethod ? (
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
              {card.programmingMethod}
            </p>
          ) : null}
          {card.fccFootnote ? (
            <p className="font-mono text-[9px] tracking-wide text-slate-600">{card.fccFootnote}</p>
          ) : null}
        </div>
        {disabledReason ? (
          <span className="mt-2 block rounded bg-amber-950/90 px-1 py-0.5 text-center text-[7px] font-semibold leading-tight text-amber-200">
            {disabledReason}
          </span>
        ) : null}
      </motion.button>
      {card.referenceNote ? (
        <p className={cn(WS_METADATA, "normal-case tracking-normal line-clamp-2")}>{card.referenceNote}</p>
      ) : null}
    </div>
  )
}

function inferBladeType(variants: FccVariant[]): string | null {
  const first = variants[0]
  if (!first) return null
  const label = variantDisplayLabel(first.title, first.key_type)
  return label === "Key" || label === "Remote key" ? first.key_type ?? label : label
}

function techSpecPills(profile: KeyProfile, variants: FccVariant[]): Array<{ label: string; value: string }> {
  const pills: Array<{ label: string; value: string }> = []
  const blade = inferBladeType(variants)
  if (blade) pills.push({ label: "Blade", value: blade })
  if (profile.chipset) pills.push({ label: "Chip", value: profile.chipset })
  if (profile.frequency) {
    const modulation =
      profile.modulation && profile.modulation !== "XXX" ? ` ${profile.modulation}` : ""
    pills.push({ label: "Freq", value: `${profile.frequency} MHz${modulation}` })
  }
  return pills
}

function TechSpecsRow({ profile, variants }: { profile: KeyProfile; variants: FccVariant[] }) {
  const pills = techSpecPills(profile, variants)
  if (pills.length === 0) return null
  return (
    <p className={cn(WS_METADATA, "flex flex-wrap gap-x-3 gap-y-1")}>
      {pills.map((pill) => (
        <span key={pill.label}>
          {pill.label} · {pill.value}
        </span>
      ))}
    </p>
  )
}

function CompatibleVehiclesHint({
  summary,
}: {
  summary: { lines: string[]; overflow: number }
}) {
  if (summary.lines.length === 0) return null
  const tooltip = [
    ...summary.lines,
    ...(summary.overflow > 0
      ? [`+ ${summary.overflow} more model${summary.overflow === 1 ? "" : "s"}`]
      : []),
  ].join("\n")

  return (
    <button
      type="button"
      title={tooltip}
      aria-label="Compatible vehicles (edge cases)"
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border/50 text-muted-foreground hover:border-primary/40 hover:text-primary"
    >
      <Info className="h-3 w-3" aria-hidden />
    </button>
  )
}

function VariantFilmstrip({
  variants,
  profile,
  make,
  selectedVariantId,
  selectedKeyId,
  trimProfile,
  isAllKeysLost,
  disabled,
  onPick,
}: {
  variants: FccVariant[]
  profile: KeyProfile
  make?: string | null
  selectedVariantId: string | null | undefined
  selectedKeyId: string | null
  trimProfile: VehicleTrimProfile
  isAllKeysLost: boolean
  disabled?: boolean
  onPick: (variant: FccVariant) => void
}) {
  if (variants.length === 0) {
    return (
      <p className="text-[10px] text-muted-foreground">
        No key photos — use key style below.
      </p>
    )
  }

  const visibleVariants =
    selectedKeyId === null ? variants : variants.filter((variant) => variant.id === selectedKeyId)

  if (visibleVariants.length === 0) return null

  const selectedVariant = visibleVariants.find((variant) => variant.id === selectedVariantId) ?? null
  const showAklBanner =
    selectedVariant != null &&
    shouldShowAklTrimVerificationBanner(selectedVariant, trimProfile, isAllKeysLost)

  return (
    <div className="grid gap-2">
      <div className="grid gap-2">
        {visibleVariants.map((variant) => {
          const selected = selectedVariantId === variant.id
          const trimGate = variantDisabledByTrim(variant, trimProfile)
          const cardDisabled = disabled || trimGate.disabled
          return (
            <KeySelectionCard
              key={variant.id}
              card={variantCardModel(variant, profile, make)}
              selected={selected}
              disabled={cardDisabled}
              disabledReason={trimGate.disabled ? "Feature not supported by vehicle trim" : null}
              onClick={() => onPick(variant)}
            />
          )
        })}
      </div>
    {showAklBanner ? (
      <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] font-medium leading-snug text-amber-100">
        🚨 Verification Alert: Ensure the vehicle is equipped with factory remote start before
        cutting/programming this variant to prevent blank waste.
      </p>
    ) : null}
    </div>
  )
}

function pickPrimaryProfileDetail(details: ProfileDetail[]): ProfileDetail {
  return [...details].sort((a, b) => b.variants.length - a.variants.length)[0]!
}

function FccProfileSection({
  detail,
  allProfiles,
  make,
  selectedProfileId,
  selectedFccId,
  selectedVariantId,
  selectedKeyId,
  trimProfile,
  isAllKeysLost,
  disabled,
  onSelectProfile,
  onPickVariant,
}: {
  detail: ProfileDetail
  allProfiles: KeyProfile[]
  make?: string | null
  selectedProfileId: string | undefined
  selectedFccId: string | undefined
  selectedVariantId: string | null | undefined
  selectedKeyId: string | null
  trimProfile: VehicleTrimProfile
  isAllKeysLost: boolean
  disabled?: boolean
  onSelectProfile: (profile: KeyProfile) => void
  onPickVariant: (profile: KeyProfile, variant: FccVariant) => void
}) {
  const p = detail.profile
  const selected = selectedProfileId === p.id || selectedFccId === p.fcc_id
  const relatedFcc = relatedFccLabels(p.fcc_id, allProfiles)

  return (
    <section
      className={cn(
        "grid gap-2 rounded-lg border p-2 transition-colors",
        selected ? "border-emerald-500/40 bg-emerald-950/20" : "border-border/60 bg-background/40"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={disabled}
          className="text-left text-xs font-semibold text-slate-200"
          onClick={() => onSelectProfile(p)}
        >
          Key blank options
        </button>
        <div className="flex items-center gap-1.5">
          <CompatibleVehiclesHint summary={detail.compatible_summary} />
          <a
            href={`https://fccid.io/${encodeURIComponent(p.fcc_id.replace(/\s+/g, ""))}/Remote-Keyfob-Replacement`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center text-muted-foreground hover:text-primary"
            aria-label={`Photos for ${p.fcc_id} on FCCID.io`}
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      <p className="font-mono text-[9px] tracking-wide text-slate-600">FCC {p.fcc_id}</p>

      {relatedFcc.length > 0 ? (
        <p className="text-[10px] text-amber-100/80">
          Related sticker: <span className="font-mono">{relatedFcc.join(", ")}</span>
        </p>
      ) : null}

      <VariantFilmstrip
        variants={detail.variants}
        profile={p}
        make={make}
        selectedVariantId={selected ? selectedVariantId : null}
        selectedKeyId={selectedKeyId}
        trimProfile={trimProfile}
        isAllKeysLost={isAllKeysLost}
        disabled={disabled}
        onPick={(variant) => onPickVariant(p, variant)}
      />
    </section>
  )
}

function CollapsedFccSummary({
  detail,
  expanded,
  disabled,
  onToggle,
}: {
  detail: ProfileDetail
  expanded: boolean
  disabled?: boolean
  onToggle: () => void
}) {
  const p = detail.profile
  const layoutCount = detail.variants.length
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      className="flex w-full items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/30 px-2.5 py-2 text-left hover:border-primary/40"
    >
      <span className="min-w-0 truncate text-xs font-semibold text-slate-200">
        {layoutCount > 0
          ? `${layoutCount} key blank${layoutCount === 1 ? "" : "s"}`
          : "Key options"}
      </span>
      <span className="shrink-0 font-mono text-[9px] text-slate-600">
        FCC {p.fcc_id}
        {p.frequency ? ` · ${p.frequency} MHz` : ""}
      </span>
      <ChevronDown
        className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")}
        aria-hidden
      />
    </button>
  )
}

function PanelToolbar({
  manualBypassMode,
  onManualBypass,
  onReturnToLookup,
}: {
  manualBypassMode: boolean
  onManualBypass: () => void
  onReturnToLookup: () => void
}) {
  return (
    <div className="flex items-start justify-end">
      {manualBypassMode ? (
        <button
          type="button"
          onClick={onReturnToLookup}
          className="text-[10px] font-semibold text-primary underline-offset-2 hover:underline"
        >
          Back to database lookup
        </button>
      ) : (
        <button
          type="button"
          onClick={onManualBypass}
          className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[10px] font-semibold text-primary hover:bg-primary/15"
        >
          Can&apos;t find FCC ID? Choose manually
        </button>
      )}
    </div>
  )
}

function FccSearchField({
  value,
  disabled,
  onChange,
  onSearch,
  hint,
}: {
  value: string
  disabled?: boolean
  onChange: (next: string) => void
  onSearch: () => void
  /** Helper shown under the label (e.g. expected MYKEYS FCC). */
  hint?: string
}) {
  return (
    <label className="grid gap-1 text-[11px]">
      <span className="font-medium text-foreground">FCC ID stamped on customer&apos;s key</span>
      {hint ? <span className="text-[10px] text-muted-foreground">{hint}</span> : null}
      <div className="flex gap-2">
        <input
          className="h-9 min-w-0 flex-1 rounded-lg border border-border/70 bg-background px-2 font-mono text-sm uppercase text-foreground"
          value={value}
          disabled={disabled}
          placeholder="KR5TXN1"
          onChange={(e) => onChange(sanitizeFccIdInput(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              onSearch()
            }
          }}
        />
        <button
          type="button"
          disabled={disabled || !value.trim()}
          onClick={onSearch}
          className="shrink-0 rounded-lg border border-primary/40 bg-primary/10 px-3 text-[11px] font-semibold text-primary hover:bg-primary/15 disabled:opacity-40"
        >
          Look up
        </button>
      </div>
    </label>
  )
}

function ManualFrequencyGrid({
  make,
  model,
  selectedVariantId,
  disabled,
  onPick,
}: {
  make: string
  model: string
  selectedVariantId: string | null | undefined
  disabled?: boolean
  onPick: (option: ManualKeyFrequencyOption) => void
}) {
  const options = useMemo(() => mykeysProKeyOptions(make, model), [make, model])
  const mkpProfile = useMemo(() => lookupMykeysProProfile(make, model), [make, model])

  return (
    <div className="grid gap-2">
      {mkpProfile ? (
        <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-[11px] text-emerald-100">
          MYKEYS Pro matched this vehicle — FCC{" "}
          <span className="font-mono font-semibold">{mkpProfile.fccId}</span>
        </p>
      ) : null}
      {options.map((option) => {
        const selected = selectedVariantId === option.id
        return (
          <KeySelectionCard
            key={option.id}
            card={manualOptionCardModel(option)}
            selected={selected}
            disabled={disabled}
            onClick={() => onPick(option)}
          />
        )
      })}
    </div>
  )
}

export function VehicleKeyInfoPanel({
  year,
  make,
  model,
  value,
  onChange,
  onVariantSelected,
  vehicleTrim = "",
  factoryOptions = [],
  onVehicleTrimChange,
  disabled,
  onBackToVehicleLookup,
}: VehicleKeyInfoPanelProps) {
  const [loading, setLoading] = useState(false)
  const [info, setInfo] = useState<KeyInfoPayload | null>(null)
  const [error, setError] = useState(false)
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null)
  const [fccSearchInput, setFccSearchInput] = useState("")
  const [activeFccQuery, setActiveFccQuery] = useState("")
  const [lookupSource, setLookupSource] = useState<"fcc" | "ymm" | "ymm_fallback" | null>(null)
  const [manualBypassMode, setManualBypassMode] = useState(false)
  const [fccSearchExpanded, setFccSearchExpanded] = useState(false)
  const [fccSearchFeedback, setFccSearchFeedback] = useState<string | null>(null)
  const [expandedSecondaryFcc, setExpandedSecondaryFcc] = useState<Set<string>>(new Set())
  const [isAllKeysLost, setIsAllKeysLost] = useState(false)

  const trimProfile = useMemo<VehicleTrimProfile>(
    () => ({
      trim: vehicleTrim.trim() || null,
      factoryOptions,
      excludedOptions: [],
    }),
    [vehicleTrim, factoryOptions]
  )

  const ready = Boolean(year && make && model)

  const mkpProfile = useMemo(() => lookupMykeysProProfile(make, model), [make, model])

  const trimHelperMessage = useMemo(() => {
    if (!info) return null
    const details = info.profile_details?.length
      ? info.profile_details
      : info.profiles.map((p) => ({
          profile: p,
          variants: [] as FccVariant[],
          compatible_summary: { lines: [], overflow: 0 },
        }))
    return getVehicleTrimHelper(year, make, info.model, { multipleFcc: details.length > 1 })
  }, [info, year, make])

  useEffect(() => {
    setSelectedKeyId(null)
    setFccSearchInput("")
    setActiveFccQuery("")
    setManualBypassMode(false)
    setFccSearchExpanded(false)
    setFccSearchFeedback(null)
    setLookupSource(null)
    setExpandedSecondaryFcc(new Set())
  }, [year, make, model])

  useEffect(() => {
    setSelectedKeyId(value?.variantId ?? null)
  }, [value?.variantId])

  useEffect(() => {
    if (!ready) {
      setInfo(null)
      setError(false)
      onChange(null)
      return
    }

    if (manualBypassMode) return

    let cancel = false
    setLoading(true)
    setError(false)
    setInfo(null)

    const q = new URLSearchParams({ year, make, model })
    const sanitizedFcc = activeFccQuery ? sanitizeFccIdInput(activeFccQuery) : ""
    if (sanitizedFcc) q.set("fcc_id", sanitizedFcc)

    void fetch(`/api/vehicle/key-info?${q}`, { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("key-info"))))
      .then(
        (j: {
          data?: {
            key_info?: KeyInfoPayload | null
            lookup_source?: "fcc" | "ymm" | "ymm_fallback"
            fcc_matched?: boolean
          }
        }) => {
        if (cancel) return
        const payload = j.data?.key_info ?? null
        setLookupSource(j.data?.lookup_source ?? null)
        setInfo(payload)
        if (!payload || payload.profiles.length === 0) {
          setManualBypassMode(true)
          if (sanitizedFcc) {
            setFccSearchFeedback(
              mkpProfile
                ? `No FCC database match for ${sanitizedFcc}. MYKEYS Pro cards below use FCC ${mkpProfile.fccId}.`
                : `No FCC database match for ${sanitizedFcc}. Pick the closest key type below.`
            )
            setFccSearchExpanded(true)
          }
          onChange(null)
          return
        }
        setFccSearchFeedback(null)
        const first = payload.profiles[0]!
        const keepVariant =
          value?.variantId &&
          payload.profiles.some(
            (profile) =>
              (profile.id === value.profileId || profile.fcc_id === value.fccId) && value.variantId
          )
        onChange({
          profileId: value?.profileId && keepVariant ? value.profileId : first.id,
          fccId: value?.fccId && keepVariant ? value.fccId : first.fcc_id,
          frequency: keepVariant ? value?.frequency ?? first.frequency : first.frequency,
          chipset: keepVariant ? value?.chipset ?? first.chipset : first.chipset,
          keyStyle: value?.keyStyle || KEY_STYLE_OPTIONS[5],
          variantId: keepVariant ? value?.variantId ?? null : null,
        })
      })
      .catch(() => {
        if (!cancel) {
          setError(true)
          setInfo(null)
          setManualBypassMode(true)
          onChange(null)
        }
      })
      .finally(() => {
        if (!cancel) setLoading(false)
      })

    return () => {
      cancel = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when YMM or FCC query changes
  }, [year, make, model, ready, activeFccQuery, manualBypassMode])

  const selectedProfile =
    info?.profiles.find((p) => p.id === value?.profileId || p.fcc_id === value?.fccId) ??
    info?.profiles[0]

  const applyManualOption = (option: ManualKeyFrequencyOption) => {
    setSelectedKeyId(option.id)
    const selection: VehicleKeySelection = {
      profileId: "manual",
      fccId: option.fccId?.trim() ?? "",
      frequency: option.frequency,
      chipset: null,
      keyStyle: option.keyStyle,
      variantId: option.id,
      programmingMethod: option.programmingMethod,
    }
    onChange(selection)
    onVariantSelected?.(selection)
  }

  const runFccSearch = () => {
    const sanitized = sanitizeFccIdInput(fccSearchInput)
    if (!sanitized) return
    setFccSearchFeedback(null)
    setManualBypassMode(false)
    setActiveFccQuery(sanitized)
  }

  const handleReturnToLookup = () => {
    const stuckWithoutDatabaseMatch =
      manualBypassMode && (error || !info || info.profiles.length === 0)
    if (stuckWithoutDatabaseMatch && onBackToVehicleLookup) {
      onBackToVehicleLookup()
      return
    }
    setManualBypassMode(false)
    if (!info || info.profiles.length === 0) {
      setActiveFccQuery("")
      setFccSearchInput("")
    }
  }

  if (!ready) return null

  if (loading && !manualBypassMode) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Looking up key info…
      </div>
    )
  }

  if (error && manualBypassMode) {
    return (
      <div className="@container grid w-full min-w-0 gap-2 rounded-lg border border-primary/25 bg-primary/5 p-3">
        <PanelToolbar
          manualBypassMode={manualBypassMode}
          onManualBypass={() => setManualBypassMode(true)}
          onReturnToLookup={handleReturnToLookup}
        />
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          Could not load key reference — choose a manual key type below to keep the call moving.
        </p>
        <ManualFrequencyGrid
          make={make}
          model={model}
          selectedVariantId={value?.variantId}
          disabled={disabled}
          onPick={applyManualOption}
        />
      </div>
    )
  }

  if (manualBypassMode || !info || info.profiles.length === 0) {
    return (
      <div className="@container grid w-full min-w-0 gap-2 rounded-lg border border-primary/25 bg-primary/5 p-3">
        <PanelToolbar
          manualBypassMode
          onManualBypass={() => setManualBypassMode(true)}
          onReturnToLookup={handleReturnToLookup}
        />
        {mkpProfile ? (
          <>
            <p className="text-[11px] text-muted-foreground">
              MYKEYS Pro profile loaded — pick the key that matches the customer fob.
            </p>
            {!fccSearchExpanded ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => setFccSearchExpanded(true)}
                className="text-left text-[11px] font-semibold text-primary underline-offset-2 hover:underline disabled:opacity-40"
              >
                Customer has a different FCC ID? Look it up
              </button>
            ) : (
              <div className="grid gap-2 rounded-lg border border-border/50 bg-background/40 p-2">
                <FccSearchField
                  value={fccSearchInput}
                  disabled={disabled}
                  onChange={setFccSearchInput}
                  onSearch={runFccSearch}
                  hint={`MYKEYS expects FCC ${mkpProfile.fccId} for this ${make} ${model}.`}
                />
                {fccSearchFeedback ? (
                  <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-100">
                    {fccSearchFeedback}
                  </p>
                ) : (
                  <p className="text-[10px] text-muted-foreground">
                    A match loads real FCC photos from our database. If nothing matches, keep using the MYKEYS cards
                    below.
                  </p>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <FccSearchField
              value={fccSearchInput}
              disabled={disabled}
              onChange={setFccSearchInput}
              onSearch={runFccSearch}
              hint="Optional — narrows key photos when our FCC database has this ID."
            />
            {fccSearchFeedback ? (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-100">
                {fccSearchFeedback}
              </p>
            ) : null}
            <p className="text-[11px] text-muted-foreground">
              {activeFccQuery && lookupSource === "ymm_fallback"
                ? `No exact match for FCC ${sanitizeFccIdInput(activeFccQuery)} — pick a regional key type or search again.`
                : "No database match for this vehicle — pick the closest key type to keep advancing."}
            </p>
          </>
        )}
        <ManualFrequencyGrid
          make={make}
          model={model}
          selectedVariantId={value?.variantId}
          disabled={disabled}
          onPick={applyManualOption}
        />
      </div>
    )
  }

  const profile = selectedProfile!
  const profileDetails = info.profile_details?.length
    ? info.profile_details
    : info.profiles.map((p) => ({
        profile: p,
        variants: [] as FccVariant[],
        compatible_summary: { lines: [], overflow: 0 },
      }))

  const multipleFcc = profileDetails.length > 1
  const primaryDetail = pickPrimaryProfileDetail(profileDetails)
  const secondaryDetails = profileDetails.filter((d) => d.profile.id !== primaryDetail.profile.id)

  const toggleSecondaryFcc = (profileId: string) => {
    setExpandedSecondaryFcc((prev) => {
      const next = new Set(prev)
      if (next.has(profileId)) next.delete(profileId)
      else next.add(profileId)
      return next
    })
  }

  const selectProfile = (p: KeyProfile) => {
    setSelectedKeyId(null)
    onChange({
      profileId: p.id,
      fccId: p.fcc_id,
      frequency: p.frequency,
      chipset: p.chipset,
      keyStyle: value?.keyStyle || KEY_STYLE_OPTIONS[5],
      variantId: null,
    })
  }

  const applyVariant = (p: KeyProfile, variant: FccVariant) => {
    setSelectedKeyId(variant.id)
    const card = variantCardModel(variant, p, make)
    const selection: VehicleKeySelection = {
      profileId: p.id,
      fccId: p.fcc_id,
      frequency: p.frequency,
      chipset: p.chipset,
      keyStyle: resolveVariantKeyStyle(
        variant.title,
        variant.key_type,
        variant.suggested_key_style,
        value?.keyStyle || KEY_STYLE_OPTIONS[5],
        KEY_STYLE_OPTIONS
      ),
      variantId: variant.id,
      programmingMethod: card.programmingMethod,
    }
    onChange(selection)
    onVariantSelected?.(selection)
  }

  const resetKeySelection = () => {
    setSelectedKeyId(null)
    if (!profile) return
    onChange({
      profileId: profile.id,
      fccId: profile.fcc_id,
      frequency: profile.frequency,
      chipset: profile.chipset,
      keyStyle: value?.keyStyle || KEY_STYLE_OPTIONS[5],
      variantId: null,
    })
  }

  const selectedVariantDetail =
    selectedKeyId != null
      ? profileDetails
          .map((detail) => ({
            detail,
            variant: detail.variants.find((variant) => variant.id === selectedKeyId) ?? null,
          }))
          .find((row) => row.variant != null) ?? null
      : null

  return (
    <div className="@container grid w-full min-w-0 gap-2 rounded-lg border border-primary/25 bg-primary/5 p-3">
      <PanelToolbar
        manualBypassMode={manualBypassMode}
        onManualBypass={() => setManualBypassMode(true)}
        onReturnToLookup={handleReturnToLookup}
      />
      <FccSearchField
        value={fccSearchInput}
        disabled={disabled}
        onChange={setFccSearchInput}
        onSearch={runFccSearch}
        hint="Overrides vehicle lookup — use the FCC ID printed on the customer's fob."
      />
      {fccSearchFeedback ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-100">
          {fccSearchFeedback}
        </p>
      ) : null}

      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
        <KeyRound className="h-3.5 w-3.5" aria-hidden />
        Key types for {year} {make} {info.model}
      </div>

      {lookupSource === "ymm_fallback" && activeFccQuery ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-100">
          No exact FCC match for <span className="font-mono font-medium">{sanitizeFccIdInput(activeFccQuery)}</span>
          — showing all remotes registered to this {year} {make} {info.model}.
        </p>
      ) : null}

      {lookupSource === "fcc" && activeFccQuery ? (
        <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-[11px] text-emerald-100">
          Matched FCC <span className="font-mono font-medium">{sanitizeFccIdInput(activeFccQuery)}</span> — confirm the
          photo on the customer&apos;s key.
        </p>
      ) : null}

      {info.match_type === "family" && info.matched_model !== info.model ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-100">
          No exact match for <span className="font-medium">{info.model}</span> — showing closest reference:{" "}
          <span className="font-medium">{info.matched_model}</span>. Confirm on the vehicle before ordering keys.
        </p>
      ) : null}

      {multipleFcc ? (
        <p className="text-[10px] text-sky-100">
          {profileDetails.length} possible FCC IDs — primary match expanded; tap others to compare.
        </p>
      ) : null}

      <div className="grid gap-2 rounded-lg border border-border/50 bg-background/40 p-2">
        <label className="grid gap-1 text-[11px]">
          <span className="font-medium text-foreground">Vehicle trim (optional)</span>
          <input
            className="h-9 rounded-lg border border-border/70 bg-background px-2 text-sm text-foreground"
            value={vehicleTrim}
            disabled={disabled}
            placeholder="Base, SLT, Denali…"
            onChange={(e) => onVehicleTrimChange?.(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-[11px] text-foreground">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border"
            checked={isAllKeysLost}
            disabled={disabled}
            onChange={(e) => setIsAllKeysLost(e.target.checked)}
          />
          All keys lost (AKL) — require factory-feature verification before programming
        </label>
      </div>

      {trimHelperMessage ? (
        <p className="text-[11px] italic leading-snug text-amber-200">{trimHelperMessage}</p>
      ) : null}

      <div className="grid gap-2">
        {selectedKeyId && selectedVariantDetail?.variant ? (
          <section className="grid gap-2 rounded-lg border border-primary/50 bg-primary/10 p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-foreground">Selected layout</span>
              <button
                type="button"
                disabled={disabled}
                onClick={resetKeySelection}
                className="text-[11px] font-semibold text-primary underline-offset-2 hover:underline"
              >
                Change
              </button>
            </div>
            <VariantFilmstrip
              variants={selectedVariantDetail.detail.variants}
              profile={selectedVariantDetail.detail.profile}
              make={make}
              selectedVariantId={selectedKeyId}
              selectedKeyId={selectedKeyId}
              trimProfile={trimProfile}
              isAllKeysLost={isAllKeysLost}
              disabled={disabled}
              onPick={(variant) => applyVariant(selectedVariantDetail.detail.profile, variant)}
            />
          </section>
        ) : (
          <>
            <FccProfileSection
              detail={primaryDetail}
              allProfiles={info.profiles}
              make={make}
              selectedProfileId={value?.profileId}
              selectedFccId={value?.fccId}
              selectedVariantId={value?.variantId}
              selectedKeyId={selectedKeyId}
              trimProfile={trimProfile}
              isAllKeysLost={isAllKeysLost}
              disabled={disabled}
              onSelectProfile={selectProfile}
              onPickVariant={applyVariant}
            />
            {secondaryDetails.map((detail) => {
              const expanded = expandedSecondaryFcc.has(detail.profile.id)
              return (
                <div key={detail.profile.id} className="grid gap-2">
                  <CollapsedFccSummary
                    detail={detail}
                    expanded={expanded}
                    disabled={disabled}
                    onToggle={() => toggleSecondaryFcc(detail.profile.id)}
                  />
                  {expanded ? (
                    <FccProfileSection
                      detail={detail}
                      allProfiles={info.profiles}
                      make={make}
                      selectedProfileId={value?.profileId}
                      selectedFccId={value?.fccId}
                      selectedVariantId={value?.variantId}
                      selectedKeyId={selectedKeyId}
                      trimProfile={trimProfile}
                      isAllKeysLost={isAllKeysLost}
                      disabled={disabled}
                      onSelectProfile={selectProfile}
                      onPickVariant={applyVariant}
                    />
                  ) : null}
                </div>
              )
            })}
          </>
        )}
      </div>

      <label className="grid gap-1 text-[11px]">
        <span className="font-medium text-foreground">Key style (confirm on vehicle)</span>
        <select
          className="h-9 rounded-lg border border-border/70 bg-background px-2 text-sm text-foreground"
          disabled={disabled}
          value={value?.keyStyle ?? KEY_STYLE_OPTIONS[5]}
          onChange={(e) =>
            onChange({
              profileId: profile.id,
              fccId: profile.fcc_id,
              frequency: profile.frequency,
              chipset: profile.chipset,
              keyStyle: e.target.value,
              variantId: value?.variantId ?? null,
            })
          }
        >
          {KEY_STYLE_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </label>

      {info.photo_disclaimer ? (
        <p className="text-[10px] text-muted-foreground">{info.photo_disclaimer}</p>
      ) : null}
    </div>
  )
}
