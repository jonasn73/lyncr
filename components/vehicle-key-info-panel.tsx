"use client"

// Key / remote reference panel — FCC IDs grouped with photos and compatible vehicles per FCC.

import { useEffect, useState } from "react"
import { ExternalLink, KeyRound, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { KEY_STYLE_OPTIONS } from "@/lib/vehicle-key-styles"
import { resolveVariantKeyStyle, variantDisplayLabel } from "@/lib/vehicle-key-variant-labels"

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
  disabled?: boolean
}

function VariantGrid({
  variants,
  selectedVariantId,
  disabled,
  onPick,
}: {
  variants: FccVariant[]
  selectedVariantId: string | null | undefined
  disabled?: boolean
  onPick: (variant: FccVariant) => void
}) {
  if (variants.length === 0) {
    return (
      <p className="text-[10px] text-muted-foreground">
        No key photos for this FCC on this vehicle — use the key style dropdown below.
      </p>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {variants.map((variant) => {
        const selected = selectedVariantId === variant.id
        const label = variantDisplayLabel(variant.title, variant.key_type)
        return (
          <button
            key={variant.id}
            type="button"
            disabled={disabled}
            onClick={() => onPick(variant)}
            className={cn(
              "flex flex-col overflow-hidden rounded-lg border text-left transition-colors",
              selected
                ? "border-primary bg-primary/15 ring-1 ring-primary/40"
                : "border-border/70 bg-background hover:border-primary/50"
            )}
          >
            <div className="flex h-20 items-center justify-center bg-muted/30 p-1">
              {variant.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- external fccid.io thumbnails
                <img
                  src={variant.image_url}
                  alt={label}
                  loading="lazy"
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <KeyRound className="h-8 w-8 text-muted-foreground/50" aria-hidden />
              )}
            </div>
            <div className="grid gap-0.5 p-2">
              <span className="text-[11px] font-medium leading-tight text-foreground">{label}</span>
              {variant.buttons ? (
                <span className="text-[10px] text-muted-foreground">{variant.buttons}</span>
              ) : null}
              {variant.battery ? (
                <span className="text-[10px] text-muted-foreground">Battery: {variant.battery}</span>
              ) : null}
              {variant.fits_text ? (
                <span className="text-[10px] text-muted-foreground line-clamp-2">{variant.fits_text}</span>
              ) : null}
              {variant.reference_image ? (
                <span className="text-[10px] text-amber-200/90">Reference photo (same FCC)</span>
              ) : null}
            </div>
          </button>
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
  disabled,
}: VehicleKeyInfoPanelProps) {
  const [loading, setLoading] = useState(false)
  const [info, setInfo] = useState<KeyInfoPayload | null>(null)
  const [error, setError] = useState(false)

  const ready = Boolean(year && make && model)

  useEffect(() => {
    if (!ready) {
      setInfo(null)
      setError(false)
      onChange(null)
      return
    }

    let cancel = false
    setLoading(true)
    setError(false)
    setInfo(null)
    const q = new URLSearchParams({ year, make, model })
    void fetch(`/api/vehicle/key-info?${q}`, { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("key-info"))))
      .then((j: { data?: { key_info?: KeyInfoPayload | null } }) => {
        if (cancel) return
        const payload = j.data?.key_info ?? null
        setInfo(payload)
        if (!payload || payload.profiles.length === 0) {
          onChange(null)
          return
        }
        const first = payload.profiles[0]!
        onChange({
          profileId: first.id,
          fccId: first.fcc_id,
          frequency: first.frequency,
          chipset: first.chipset,
          keyStyle: value?.keyStyle || KEY_STYLE_OPTIONS[5],
          variantId: null,
        })
      })
      .catch(() => {
        if (!cancel) {
          setError(true)
          setInfo(null)
          onChange(null)
        }
      })
      .finally(() => {
        if (!cancel) setLoading(false)
      })

    return () => {
      cancel = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset selection when YMM changes
  }, [year, make, model, ready])

  const selectedProfile =
    info?.profiles.find((p) => p.id === value?.profileId || p.fcc_id === value?.fccId) ??
    info?.profiles[0]

  if (!ready) return null

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Looking up key info…
      </div>
    )
  }

  if (error) {
    return (
      <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
        Could not load key reference. Use Transponder Island below.
      </p>
    )
  }

  if (!info || info.profiles.length === 0) {
    return (
      <div className="rounded-lg border border-border/60 bg-muted/15 px-3 py-2 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">No FCC reference for this vehicle in our database.</p>
        <p className="mt-1">Search your supplier for parts and programming steps:</p>
        <a
          href={`https://transponderisland.com/shop?search=${encodeURIComponent(`${year} ${make} ${model}`)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-primary hover:underline"
        >
          Transponder Island <ExternalLink className="h-3 w-3" />
        </a>
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

  const selectProfile = (p: KeyProfile) => {
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
    onChange({
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
    })
  }

  return (
    <div className="grid gap-2 rounded-lg border border-primary/25 bg-primary/5 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
        <KeyRound className="h-3.5 w-3.5" aria-hidden />
        Key types for {year} {make} {info.model}
      </div>

      {info.match_type === "family" && info.matched_model !== info.model ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-100">
          No exact match for <span className="font-medium">{info.model}</span> — showing closest reference:{" "}
          <span className="font-medium">{info.matched_model}</span>. Confirm on the vehicle before ordering keys.
        </p>
      ) : null}

      {multipleFcc ? (
        <p className="rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1.5 text-[11px] text-sky-100">
          This vehicle has <span className="font-semibold">{profileDetails.length} possible FCC IDs</span>. Only one
          remote applies — check the FCC sticker on the customer&apos;s key or match the photo below.
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Reference FCC for this vehicle. Confirm the physical key before ordering.
        </p>
      )}

      <div className="grid gap-3">
        {profileDetails.map((detail) => {
          const p = detail.profile
          const selected = value?.profileId === p.id || value?.fccId === p.fcc_id
          const summary = detail.compatible_summary

          return (
            <section
              key={p.id}
              className={cn(
                "grid gap-2 rounded-lg border p-2.5 transition-colors",
                selected
                  ? "border-primary/50 bg-primary/10"
                  : "border-border/60 bg-background/40 hover:border-primary/30"
              )}
            >
              <button
                type="button"
                disabled={disabled}
                className="flex w-full flex-wrap items-center gap-2 text-left"
                onClick={() => selectProfile(p)}
              >
                <span
                  className={cn(
                    "rounded-md border px-2 py-0.5 font-mono text-xs font-semibold",
                    selected
                      ? "border-primary bg-primary/20 text-foreground"
                      : "border-border/70 bg-muted/30 text-muted-foreground"
                  )}
                >
                  {p.fcc_id}
                </span>
                {p.frequency ? (
                  <span className="text-[11px] text-muted-foreground">{p.frequency} MHz</span>
                ) : null}
                {p.modulation && p.modulation !== "XXX" ? (
                  <span className="text-[11px] text-muted-foreground">{p.modulation}</span>
                ) : null}
                {p.chipset ? (
                  <span className="text-[11px] text-muted-foreground">Chip: {p.chipset}</span>
                ) : null}
              </button>

              {summary.lines.length > 0 ? (
                <div className="grid gap-1 rounded-md border border-border/50 bg-muted/15 px-2 py-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Compatible vehicles
                  </span>
                  <ul className="grid gap-0.5 text-[10px] text-foreground">
                    {summary.lines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  {summary.overflow > 0 ? (
                    <p className="text-[10px] text-muted-foreground">
                      + {summary.overflow} more model{summary.overflow === 1 ? "" : "s"} share this FCC ID
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="grid gap-1.5">
                <span className="text-[11px] font-medium text-foreground">
                  Keys for {p.fcc_id} — tap to match
                </span>
                <VariantGrid
                  variants={detail.variants}
                  selectedVariantId={selected ? value?.variantId : null}
                  disabled={disabled}
                  onPick={(variant) => applyVariant(p, variant)}
                />
              </div>

              <a
                href={`https://fccid.io/${encodeURIComponent(p.fcc_id.replace(/\s+/g, ""))}/Remote-Keyfob-Replacement`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
              >
                All photos for {p.fcc_id} on FCCID.io <ExternalLink className="h-3 w-3" />
              </a>
            </section>
          )
        })}
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

      <div className="flex flex-wrap gap-3 text-[11px]">
        <a
          href={info.transponder_island_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          Transponder Island <ExternalLink className="h-3 w-3" />
        </a>
        <a
          href={info.keysolved_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          Keysolved <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {info.photo_disclaimer ? (
        <p className="text-[10px] text-muted-foreground">{info.photo_disclaimer}</p>
      ) : null}
      <p className="text-[10px] text-muted-foreground">{info.disclaimer}</p>
    </div>
  )
}
