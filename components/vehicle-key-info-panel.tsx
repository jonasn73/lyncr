"use client"

// Key / remote reference panel — FCC IDs, frequency, chipset after year + make + model.

import { useEffect, useState } from "react"
import { ExternalLink, KeyRound, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { KEY_STYLE_OPTIONS } from "@/lib/vehicle-key-styles"

export type VehicleKeySelection = {
  profileId: string
  fccId: string
  frequency: string | null
  chipset: string | null
  keyStyle: string
}

type KeyProfile = {
  id: string
  fcc_id: string
  frequency: string | null
  modulation: string | null
  chipset: string | null
}

type KeyInfoPayload = {
  year: number
  make: string
  model: string
  matched_model: string
  match_type: "exact" | "family"
  profiles: KeyProfile[]
  transponder_island_url: string
  keysolved_url: string
  disclaimer: string
}

type VehicleKeyInfoPanelProps = {
  year: string
  make: string
  model: string
  value: VehicleKeySelection | null
  onChange: (next: VehicleKeySelection | null) => void
  disabled?: boolean
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

  const selectedProfile =
    info.profiles.find((p) => p.id === value?.profileId || p.fcc_id === value?.fccId) ?? info.profiles[0]!

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

      {info.profiles.length > 1 ? (
        <div className="grid gap-1.5">
          <span className="text-[11px] font-medium text-foreground">FCC ID / remote variant</span>
          <div className="flex flex-wrap gap-1.5">
            {info.profiles.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={disabled}
                className={cn(
                  "rounded-md border px-2 py-1 text-[11px] font-mono transition-colors",
                  value?.profileId === p.id || value?.fccId === p.fcc_id
                    ? "border-primary bg-primary/20 text-foreground"
                    : "border-border/70 bg-background text-muted-foreground hover:border-primary/50"
                )}
                onClick={() =>
                  onChange({
                    profileId: p.id,
                    fccId: p.fcc_id,
                    frequency: p.frequency,
                    chipset: p.chipset,
                    keyStyle: value?.keyStyle || KEY_STYLE_OPTIONS[5],
                  })
                }
              >
                {p.fcc_id}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="font-mono text-sm text-foreground">FCC ID: {selectedProfile.fcc_id}</p>
      )}

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {selectedProfile.frequency ? (
          <>
            <dt>Frequency</dt>
            <dd className="text-foreground">{selectedProfile.frequency} MHz</dd>
          </>
        ) : null}
        {selectedProfile.modulation && selectedProfile.modulation !== "XXX" ? (
          <>
            <dt>Modulation</dt>
            <dd className="text-foreground">{selectedProfile.modulation}</dd>
          </>
        ) : null}
        {selectedProfile.chipset ? (
          <>
            <dt>Chip / transponder</dt>
            <dd className="text-foreground">{selectedProfile.chipset}</dd>
          </>
        ) : null}
      </dl>

      <label className="grid gap-1 text-[11px]">
        <span className="font-medium text-foreground">Key style (confirm on vehicle)</span>
        <select
          className="h-9 rounded-lg border border-border/70 bg-background px-2 text-sm text-foreground"
          disabled={disabled}
          value={value?.keyStyle ?? KEY_STYLE_OPTIONS[5]}
          onChange={(e) =>
            onChange({
              profileId: selectedProfile.id,
              fccId: selectedProfile.fcc_id,
              frequency: selectedProfile.frequency,
              chipset: selectedProfile.chipset,
              keyStyle: e.target.value,
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
          href={`https://fccid.io/${encodeURIComponent(selectedProfile.fcc_id.replace(/\s+/g, ""))}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          FCC lookup <ExternalLink className="h-3 w-3" />
        </a>
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

      <p className="text-[10px] text-muted-foreground">{info.disclaimer}</p>
    </div>
  )
}
