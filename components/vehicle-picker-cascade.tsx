"use client"

// Year → Make → Model picker (NHTSA vPIC catalog) — dropdown or sequential tap chips.

import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Loader2 } from "lucide-react"
import { vehicleYearOptions } from "@/lib/nhtsa-vpic"
import { cn } from "@/lib/utils"
import { onOptionRowKeyDown } from "@/lib/hooks/use-workspace-keyboard"
import {
  WS_METADATA,
  WS_OPTION_ROW,
  WS_OPTION_ROW_ACTIVE,
  WS_STACK,
  WS_TEXT,
  WS_TEXT_ACTIVE,
} from "@/lib/workspace-ui-tokens"

const selectClass =
  "min-w-0 w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"

/** Matches manual intake step slide physics. */
const PICKER_STEP_MOTION = {
  initial: { opacity: 0, x: 60 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -60 },
  transition: { type: "spring" as const, stiffness: 320, damping: 30 },
}

export type VehicleCascadeValue = {
  vehicle_year: string
  vehicle_make: string
  vehicle_model: string
}

type ActivePicker = "year" | "make" | "model"

type VehiclePickerCascadeProps = {
  value: VehicleCascadeValue
  onChange: (next: VehicleCascadeValue) => void
  disabled?: boolean
  /** dropdown = legacy three selects; sequential = tap chips that auto-advance */
  variant?: "dropdown" | "sequential"
}

function activePickerFromValue(value: VehicleCascadeValue): ActivePicker {
  if (!value.vehicle_year) return "year"
  if (!value.vehicle_make) return "make"
  return "model"
}

function VehiclePickerDropdown({
  value,
  onChange,
  disabled,
  years,
  makes,
  models,
  loadingMakes,
  loadingModels,
}: {
  value: VehicleCascadeValue
  onChange: (next: VehicleCascadeValue) => void
  disabled?: boolean
  years: number[]
  makes: string[]
  models: string[]
  loadingMakes: boolean
  loadingModels: boolean
}) {
  return (
    <div className="@container w-full min-w-0">
      <div className="grid min-w-0 grid-cols-1 gap-3 @min-[26rem]:grid-cols-3">
        <label className="grid min-w-0 gap-1.5 text-sm">
          <span className="font-medium text-foreground">Year</span>
          <select
            className={selectClass}
            value={value.vehicle_year}
            disabled={disabled}
            onChange={(e) => onChange({ vehicle_year: e.target.value, vehicle_make: "", vehicle_model: "" })}
          >
            <option value="">Select year…</option>
            {years.map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 gap-1.5 text-sm">
          <span className="font-medium text-foreground">Make</span>
          <div className="relative">
            <select
              className={selectClass}
              value={value.vehicle_make}
              disabled={disabled || !value.vehicle_year || loadingMakes}
              onChange={(e) => onChange({ ...value, vehicle_make: e.target.value, vehicle_model: "" })}
            >
              <option value="">{loadingMakes ? "Loading…" : "Select make…"}</option>
              {makes.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            {loadingMakes ? (
              <Loader2 className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-zinc-500" />
            ) : null}
          </div>
        </label>
        <label className="grid min-w-0 gap-1.5 text-sm">
          <span className="font-medium text-foreground">Model</span>
          <div className="relative">
            <select
              className={selectClass}
              value={value.vehicle_model}
              disabled={disabled || !value.vehicle_make || loadingModels}
              onChange={(e) => onChange({ ...value, vehicle_model: e.target.value })}
            >
              <option value="">{loadingModels ? "Loading…" : "Select model…"}</option>
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            {loadingModels ? (
              <Loader2 className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-zinc-500" />
            ) : null}
          </div>
        </label>
      </div>
    </div>
  )
}

function SelectionChip({
  label,
  selected,
  active,
  disabled,
  onClick,
}: {
  label: string
  selected: boolean
  active: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "min-h-9 touch-manipulation rounded-xl border px-3 py-1.5 transition-all duration-150",
        active || selected ? WS_TEXT_ACTIVE : WS_TEXT,
        active
          ? WS_OPTION_ROW_ACTIVE
          : selected
            ? "border-emerald-500/40 bg-slate-900/80"
            : "border-slate-850 bg-slate-900/40 hover:border-emerald-500/30",
        disabled && "cursor-not-allowed opacity-40"
      )}
      aria-pressed={active}
    >
      {label}
    </button>
  )
}

function OptionChip({
  label,
  selected,
  onSelect,
  disabled,
}: {
  label: string
  selected: boolean
  onSelect: () => void
  disabled?: boolean
}) {
  return (
    <motion.button
      type="button"
      layout
      whileTap={{ scale: 0.97 }}
      disabled={disabled}
      onClick={onSelect}
      onKeyDown={(event) => onOptionRowKeyDown(event, onSelect)}
      className={cn(
        "min-h-10 touch-manipulation leading-snug",
        selected ? WS_OPTION_ROW_ACTIVE : WS_OPTION_ROW,
        selected ? WS_TEXT_ACTIVE : WS_TEXT
      )}
      aria-pressed={selected}
    >
      {label}
    </motion.button>
  )
}

function VehiclePickerSequential({
  value,
  onChange,
  disabled,
  years,
  makes,
  models,
  loadingMakes,
  loadingModels,
}: {
  value: VehicleCascadeValue
  onChange: (next: VehicleCascadeValue) => void
  disabled?: boolean
  years: number[]
  makes: string[]
  models: string[]
  loadingMakes: boolean
  loadingModels: boolean
}) {
  const [activePicker, setActivePicker] = useState<ActivePicker>(() => activePickerFromValue(value))

  useEffect(() => {
    setActivePicker(activePickerFromValue(value))
  }, [value.vehicle_year, value.vehicle_make, value.vehicle_model])

  const handleYearSelect = (year: string) => {
    onChange({ vehicle_year: year, vehicle_make: "", vehicle_model: "" })
    setActivePicker("make")
  }

  const handleMakeSelect = (make: string) => {
    onChange({ ...value, vehicle_make: make, vehicle_model: "" })
    setActivePicker("model")
  }

  const handleModelSelect = (model: string) => {
    onChange({ ...value, vehicle_model: model })
  }

  const pickerTitle =
    activePicker === "year" ? "Tap year" : activePicker === "make" ? "Tap make" : "Tap model"

  const pickerOptions: string[] =
    activePicker === "year"
      ? years.map(String)
      : activePicker === "make"
        ? makes
        : models

  const pickerLoading =
    activePicker === "make" ? loadingMakes : activePicker === "model" ? loadingModels : false

  const selectedValue =
    activePicker === "year"
      ? value.vehicle_year
      : activePicker === "make"
        ? value.vehicle_make
        : value.vehicle_model

  return (
    <div className={cn(WS_STACK, "w-full min-w-0")}>
      <div className="flex flex-wrap items-center gap-3">
        <SelectionChip
          label={value.vehicle_year ? value.vehicle_year : "Year"}
          selected={Boolean(value.vehicle_year)}
          active={activePicker === "year"}
          disabled={disabled}
          onClick={() => setActivePicker("year")}
        />
        <SelectionChip
          label={value.vehicle_make ? value.vehicle_make : "Make"}
          selected={Boolean(value.vehicle_make)}
          active={activePicker === "make"}
          disabled={disabled || !value.vehicle_year}
          onClick={() => {
            if (!value.vehicle_year) return
            setActivePicker("make")
          }}
        />
        <SelectionChip
          label={value.vehicle_model ? value.vehicle_model : "Model"}
          selected={Boolean(value.vehicle_model)}
          active={activePicker === "model"}
          disabled={disabled || !value.vehicle_make}
          onClick={() => {
            if (!value.vehicle_make) return
            setActivePicker("model")
          }}
        />
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={activePicker} {...PICKER_STEP_MOTION} className={WS_STACK}>
          <p className={WS_METADATA}>{pickerTitle}</p>
          {pickerLoading ? (
            <div className="flex min-h-[8rem] items-center justify-center rounded-xl border border-slate-850 bg-slate-900/40">
              <Loader2 className="h-5 w-5 animate-spin text-slate-500" aria-hidden />
              <span className="sr-only">Loading options</span>
            </div>
          ) : pickerOptions.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-850 px-3 py-6 text-center text-xs text-slate-500">
              {activePicker === "make"
                ? "Pick a year first."
                : activePicker === "model"
                  ? "Pick a make first."
                  : "No years available."}
            </p>
          ) : (
            <div className="grid max-h-56 grid-cols-2 gap-3 overflow-y-auto overscroll-y-contain pr-0.5 sm:grid-cols-3">
              {pickerOptions.map((option) => {
                const selected = selectedValue === option
                return (
                  <OptionChip
                    key={option}
                    label={option}
                    selected={selected}
                    disabled={disabled}
                    onSelect={() => {
                      if (activePicker === "year") handleYearSelect(option)
                      else if (activePicker === "make") handleMakeSelect(option)
                      else handleModelSelect(option)
                    }}
                  />
                )
              })}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

export function VehiclePickerCascade({
  value,
  onChange,
  disabled,
  variant = "dropdown",
}: VehiclePickerCascadeProps) {
  const [makes, setMakes] = useState<string[]>([])
  const [models, setModels] = useState<string[]>([])
  const [loadingMakes, setLoadingMakes] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)
  const years = vehicleYearOptions()

  useEffect(() => {
    if (!value.vehicle_year) {
      setMakes([])
      return
    }
    setLoadingMakes(true)
    void fetch("/api/vehicle/makes", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("makes"))))
      .then((j: { data?: { makes?: string[] } }) => setMakes(Array.isArray(j.data?.makes) ? j.data!.makes! : []))
      .catch(() => setMakes([]))
      .finally(() => setLoadingMakes(false))
  }, [value.vehicle_year])

  useEffect(() => {
    if (!value.vehicle_year || !value.vehicle_make) {
      setModels([])
      return
    }
    setLoadingModels(true)
    void fetch(
      `/api/vehicle/models?make=${encodeURIComponent(value.vehicle_make)}&year=${encodeURIComponent(value.vehicle_year)}`,
      { credentials: "include", cache: "no-store" }
    )
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("models"))))
      .then((j: { data?: { models?: string[] } }) => setModels(Array.isArray(j.data?.models) ? j.data!.models! : []))
      .catch(() => setModels([]))
      .finally(() => setLoadingModels(false))
  }, [value.vehicle_year, value.vehicle_make])

  const sharedProps = {
    value,
    onChange,
    disabled,
    years,
    makes,
    models,
    loadingMakes,
    loadingModels,
  }

  if (variant === "sequential") {
    return <VehiclePickerSequential {...sharedProps} />
  }

  return <VehiclePickerDropdown {...sharedProps} />
}
