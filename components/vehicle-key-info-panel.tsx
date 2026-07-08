"use client"

// Key / remote reference panel — FCC IDs grouped with photos and compatible vehicles per FCC.

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { Check, ChevronDown, ExternalLink, Info, KeyRound, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  MANUAL_KEY_FREQUENCY_OPTIONS,
  sanitizeFccIdInput,
  type ManualKeyFrequencyOption,
} from "@/lib/fcc-id-input"
import { KEY_STYLE_OPTIONS } from "@/lib/vehicle-key-styles"
import { resolveVariantKeyStyle, variantButtonLabel, variantDisplayLabel } from "@/lib/vehicle-key-variant-labels"

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
  reference_image?: boolean
  reference_note?: string
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
  disabled?: boolean
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
    <div className="flex flex-wrap gap-1.5">
      {pills.map((pill) => (
        <span
          key={pill.label}
          className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-emerald-400"
        >
          <span className="text-slate-500">{pill.label}</span>
          {pill.value}
        </span>
      ))}
    </div>
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
  selectedVariantId,
  selectedKeyId,
  disabled,
  onPick,
}: {
  variants: FccVariant[]
  selectedVariantId: string | null | undefined
  selectedKeyId: string | null
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

  return (
    <div className="flex gap-2 overflow-x-auto overscroll-x-contain pb-1 touch-pan-x [-webkit-overflow-scrolling:touch]">
      {visibleVariants.map((variant) => {
        const selected = selectedVariantId === variant.id
        const styleLabel = variantDisplayLabel(variant.title, variant.key_type)
        const buttonLabel = variantButtonLabel(
          variant.title,
          variant.buttons,
          variant.fits_text,
          variant.key_type
        )
        const cardLabel = buttonLabel ? `${buttonLabel} · ${styleLabel}` : styleLabel
        return (
          <motion.button
            key={variant.id}
            type="button"
            whileTap={{ scale: 0.97 }}
            disabled={disabled}
            onClick={() => onPick(variant)}
            className={cn(
              "relative h-[4.75rem] w-[5.25rem] shrink-0 touch-manipulation overflow-hidden rounded-lg border text-left transition-colors",
              selected
                ? "border-2 border-cyan-400 bg-slate-900"
                : "border border-slate-800 bg-background hover:border-primary/50"
            )}
            aria-pressed={selected}
          >
            {selected ? (
              <span
                className="absolute top-1 right-1 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm"
                aria-hidden
              >
                <Check className="h-2.5 w-2.5" strokeWidth={3} />
              </span>
            ) : null}
            <div className="flex h-full items-center justify-center bg-muted/20 p-1">
              {variant.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- external fccid.io thumbnails
                <img
                  src={variant.image_url}
                  alt={cardLabel}
                  loading="lazy"
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <KeyRound className="h-6 w-6 text-muted-foreground/50" aria-hidden />
              )}
            </div>
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/70 to-transparent px-1 pb-1 pt-5">
              <span className="block text-[9px] font-semibold leading-tight text-white line-clamp-2">
                {cardLabel}
              </span>
            </div>
            {variant.reference_image ? (
              <span className="absolute left-1 top-1 rounded bg-amber-500/90 px-1 text-[8px] font-semibold text-black">
                Ref
              </span>
            ) : null}
          </motion.button>
        )
      })}
    </div>
  )
}

function pickPrimaryProfileDetail(details: ProfileDetail[]): ProfileDetail {
  return [...details].sort((a, b) => b.variants.length - a.variants.length)[0]!
}

function FccProfileSection({
  detail,
  allProfiles,
  selectedProfileId,
  selectedFccId,
  selectedVariantId,
  selectedKeyId,
  disabled,
  onSelectProfile,
  onPickVariant,
}: {
  detail: ProfileDetail
  allProfiles: KeyProfile[]
  selectedProfileId: string | undefined
  selectedFccId: string | undefined
  selectedVariantId: string | null | undefined
  selectedKeyId: string | null
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
        selected ? "border-primary/50 bg-primary/10" : "border-border/60 bg-background/40"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={disabled}
          className="font-mono text-xs font-bold text-foreground"
          onClick={() => onSelectProfile(p)}
        >
          {p.fcc_id}
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

      <TechSpecsRow profile={p} variants={detail.variants} />

      {relatedFcc.length > 0 ? (
        <p className="text-[10px] text-amber-100/80">
          Related sticker: <span className="font-mono">{relatedFcc.join(", ")}</span>
        </p>
      ) : null}

      <VariantFilmstrip
        variants={detail.variants}
        selectedVariantId={selected ? selectedVariantId : null}
        selectedKeyId={selectedKeyId}
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
      <span className="min-w-0 truncate font-mono text-xs font-semibold text-foreground">{p.fcc_id}</span>
      <span className="shrink-0 text-[10px] text-muted-foreground">
        {p.frequency ? `${p.frequency} MHz` : "—"}
        {layoutCount > 0 ? ` · ${layoutCount} layout${layoutCount === 1 ? "" : "s"}` : ""}
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
}: {
  value: string
  disabled?: boolean
  onChange: (next: string) => void
  onSearch: () => void
}) {
  return (
    <label className="grid gap-1 text-[11px]">
      <span className="font-medium text-foreground">FCC ID on key (optional)</span>
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
          Search
        </button>
      </div>
    </label>
  )
}

function ManualFrequencyGrid({
  selectedVariantId,
  disabled,
  onPick,
}: {
  selectedVariantId: string | null | undefined
  disabled?: boolean
  onPick: (option: ManualKeyFrequencyOption) => void
}) {
  return (
    <div className="grid gap-2">
      {MANUAL_KEY_FREQUENCY_OPTIONS.map((option) => {
        const selected = selectedVariantId === option.id
        return (
          <motion.button
            key={option.id}
            type="button"
            whileTap={{ scale: 0.98 }}
            disabled={disabled}
            onClick={() => onPick(option)}
            className={cn(
              "relative flex touch-manipulation flex-col rounded-lg border px-3 py-2.5 text-left transition-colors",
              selected
                ? "border-2 border-cyan-400 bg-slate-900"
                : "border border-slate-800 bg-background hover:border-primary/50"
            )}
            aria-pressed={selected}
          >
            {selected ? (
              <span
                className="absolute top-1.5 right-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm"
                aria-hidden
              >
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
            ) : null}
            <span className="text-sm font-semibold text-foreground">{option.label}</span>
            <span className="mt-0.5 text-[11px] text-muted-foreground">{option.description}</span>
          </motion.button>
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
  disabled,
}: VehicleKeyInfoPanelProps) {
  const [loading, setLoading] = useState(false)
  const [info, setInfo] = useState<KeyInfoPayload | null>(null)
  const [error, setError] = useState(false)
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null)
  const [fccSearchInput, setFccSearchInput] = useState("")
  const [activeFccQuery, setActiveFccQuery] = useState("")
  const [lookupSource, setLookupSource] = useState<"fcc" | "ymm" | "ymm_fallback" | null>(null)
  const [manualBypassMode, setManualBypassMode] = useState(false)
  const [expandedSecondaryFcc, setExpandedSecondaryFcc] = useState<Set<string>>(new Set())

  const ready = Boolean(year && make && model)

  useEffect(() => {
    setSelectedKeyId(null)
    setFccSearchInput("")
    setActiveFccQuery("")
    setManualBypassMode(false)
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
          onChange(null)
          return
        }
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
      fccId: "",
      frequency: option.frequency,
      chipset: null,
      keyStyle: option.keyStyle,
      variantId: option.id,
    }
    onChange(selection)
    onVariantSelected?.(selection)
  }

  const runFccSearch = () => {
    setManualBypassMode(false)
    setActiveFccQuery(sanitizeFccIdInput(fccSearchInput))
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
          onReturnToLookup={() => setManualBypassMode(false)}
        />
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          Could not load key reference — choose a manual key type below to keep the call moving.
        </p>
        <ManualFrequencyGrid
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
          onReturnToLookup={() => {
            setManualBypassMode(false)
            setActiveFccQuery("")
            setFccSearchInput("")
          }}
        />
        <FccSearchField
          value={fccSearchInput}
          disabled={disabled}
          onChange={setFccSearchInput}
          onSearch={runFccSearch}
        />
        <p className="text-[11px] text-muted-foreground">
          {activeFccQuery && lookupSource === "ymm_fallback"
            ? `No exact match for FCC ${sanitizeFccIdInput(activeFccQuery)} — pick a regional key type or search again.`
            : "No database match for this vehicle — pick the closest key type to keep advancing."}
        </p>
        <ManualFrequencyGrid
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
        onReturnToLookup={() => setManualBypassMode(false)}
      />
      <FccSearchField
        value={fccSearchInput}
        disabled={disabled}
        onChange={setFccSearchInput}
        onSearch={runFccSearch}
      />

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
              selectedVariantId={selectedKeyId}
              selectedKeyId={selectedKeyId}
              disabled={disabled}
              onPick={(variant) => applyVariant(selectedVariantDetail.detail.profile, variant)}
            />
          </section>
        ) : (
          <>
            <FccProfileSection
              detail={primaryDetail}
              allProfiles={info.profiles}
              selectedProfileId={value?.profileId}
              selectedFccId={value?.fccId}
              selectedVariantId={value?.variantId}
              selectedKeyId={selectedKeyId}
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
                      selectedProfileId={value?.profileId}
                      selectedFccId={value?.fccId}
                      selectedVariantId={value?.variantId}
                      selectedKeyId={selectedKeyId}
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
