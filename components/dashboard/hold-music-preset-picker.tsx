"use client"

// Hold music preset picker — Calm / Upbeat / Minimal + optional Custom URL.

import { useMemo, useState } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  HOLD_MUSIC_DEFAULT_PRESET,
  HOLD_MUSIC_PRESETS,
  holdMusicValueForPreset,
  matchHoldMusicPreset,
  type HoldMusicPresetId,
} from "@/lib/hold-music-presets"

const fieldClass =
  "w-full rounded-lg border border-border bg-card/50 text-sm text-foreground transition-colors duration-200 placeholder:text-muted-foreground hover:border-border focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/40"

export type HoldMusicPresetPickerProps = {
  /** Stored hold_music_url (https://… or /audio/…). */
  value: string
  onChange: (nextUrl: string) => void
  /** Prefix for input ids (configure vs greetings form). */
  idPrefix?: string
  className?: string
}

export function HoldMusicPresetPicker({
  value,
  onChange,
  idPrefix = "hold-music",
  className,
}: HoldMusicPresetPickerProps) {
  const matched = matchHoldMusicPreset(value)
  const [advancedOpen, setAdvancedOpen] = useState(
    () => matched === "custom"
  )

  const selectValue: HoldMusicPresetId | "custom" | "default" = matched

  const customUrl = useMemo(() => {
    if (matched === "custom") return value
    return value.startsWith("http") ? value : ""
  }, [matched, value])

  return (
    <div className={cn("space-y-2 rounded-lg border border-border bg-background/40 p-3", className)}>
      <label htmlFor={`${idPrefix}-preset`} className="text-xs font-semibold text-foreground">
        Hold music
      </label>
      <p className="hidden text-micro text-muted-foreground md:block">
        Classic US call-center hold while callers stay on the line. Royalty-free Muzak /
        soft jazz loops — Busy is never silent by default (Classic hold).
      </p>
      <select
        id={`${idPrefix}-preset`}
        value={selectValue === "default" ? HOLD_MUSIC_DEFAULT_PRESET : selectValue}
        onChange={(e) => {
          const v = e.target.value
          if (v === "custom") {
            setAdvancedOpen(true)
            // Keep prior custom URL if any; otherwise blank until they paste one.
            if (matched !== "custom") onChange("")
            return
          }
          onChange(holdMusicValueForPreset(v as HoldMusicPresetId))
        }}
        className={cn(fieldClass, "min-h-11 px-3 py-2")}
      >
        {HOLD_MUSIC_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
        <option value="custom">Custom URL…</option>
      </select>
      <p className="hidden text-micro text-muted-foreground md:block">
        {HOLD_MUSIC_PRESETS.find(
          (p) =>
            p.id ===
            (selectValue === "default" || selectValue === "custom"
              ? HOLD_MUSIC_DEFAULT_PRESET
              : selectValue)
        )?.description || "Choose a preset or paste your own HTTPS MP3/WAV."}
      </p>

      <div className="overflow-hidden rounded-md border border-border/80">
        <button
          type="button"
          onClick={() => setAdvancedOpen((o) => !o)}
          className="flex min-h-10 w-full items-center justify-between gap-2 px-3 py-2 text-left"
          aria-expanded={advancedOpen}
        >
          <span className="text-2xs font-semibold text-muted-foreground">Advanced · custom URL</span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
              advancedOpen && "rotate-180"
            )}
            aria-hidden
          />
        </button>
        {advancedOpen ? (
          <div className="space-y-2 border-t border-border px-3 pb-3 pt-2">
            <label htmlFor={`${idPrefix}-url`} className="text-micro font-medium text-muted-foreground">
              Public HTTPS MP3/WAV
            </label>
            <input
              id={`${idPrefix}-url`}
              type="url"
              value={customUrl}
              onChange={(e) => onChange(e.target.value)}
              className={cn(fieldClass, "min-h-11 px-3 py-2")}
              placeholder="https://…/hold-music.mp3"
            />
            <p className="hidden text-micro text-muted-foreground md:block">
              Leave blank and pick Calm / Upbeat / Minimal above to use a bundled track.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
