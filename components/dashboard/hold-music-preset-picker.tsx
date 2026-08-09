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
  "w-full rounded-lg border border-zinc-800 bg-zinc-900/50 text-sm text-foreground transition-colors duration-200 placeholder:text-zinc-600 hover:border-zinc-600 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/40"

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
    <div className={cn("space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3", className)}>
      <label htmlFor={`${idPrefix}-preset`} className="text-xs font-semibold text-zinc-300">
        Hold music
      </label>
      <p className="hidden text-[10px] text-zinc-600 md:block">
        Classic call-center style while callers stay on the line. Royalty-free soft jazz /
        elevator loops — Busy is never silent by default (Classic hold).
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
      <p className="hidden text-[10px] text-zinc-500 md:block">
        {HOLD_MUSIC_PRESETS.find(
          (p) =>
            p.id ===
            (selectValue === "default" || selectValue === "custom"
              ? HOLD_MUSIC_DEFAULT_PRESET
              : selectValue)
        )?.description || "Choose a preset or paste your own HTTPS MP3/WAV."}
      </p>

      <div className="overflow-hidden rounded-md border border-zinc-800/80">
        <button
          type="button"
          onClick={() => setAdvancedOpen((o) => !o)}
          className="flex min-h-10 w-full items-center justify-between gap-2 px-2.5 py-2 text-left"
          aria-expanded={advancedOpen}
        >
          <span className="text-[11px] font-semibold text-zinc-400">Advanced · custom URL</span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform",
              advancedOpen && "rotate-180"
            )}
            aria-hidden
          />
        </button>
        {advancedOpen ? (
          <div className="space-y-1.5 border-t border-zinc-800 px-2.5 pb-2.5 pt-2">
            <label htmlFor={`${idPrefix}-url`} className="text-[10px] font-medium text-zinc-500">
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
            <p className="hidden text-[10px] text-zinc-600 md:block">
              Leave blank and pick Calm / Upbeat / Minimal above to use a bundled track.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
