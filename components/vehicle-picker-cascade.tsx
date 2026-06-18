"use client"

// Year → Make → Model dropdown cascade (NHTSA vPIC catalog).

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { vehicleYearOptions } from "@/lib/nhtsa-vpic"

const selectClass =
  "w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"

export type VehicleCascadeValue = {
  vehicle_year: string
  vehicle_make: string
  vehicle_model: string
}

type VehiclePickerCascadeProps = {
  value: VehicleCascadeValue
  onChange: (next: VehicleCascadeValue) => void
  disabled?: boolean
}

export function VehiclePickerCascade({ value, onChange, disabled }: VehiclePickerCascadeProps) {
  const [makes, setMakes] = useState<string[]>([])
  const [models, setModels] = useState<string[]>([])
  const [loadingMakes, setLoadingMakes] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)
  const years = vehicleYearOptions()

  useEffect(() => {
    setLoadingMakes(true)
    void fetch("/api/vehicle/makes", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("makes"))))
      .then((j: { data?: { makes?: string[] } }) => setMakes(Array.isArray(j.data?.makes) ? j.data!.makes! : []))
      .catch(() => setMakes([]))
      .finally(() => setLoadingMakes(false))
  }, [])

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

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="grid gap-1.5 text-sm">
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
      <label className="grid gap-1.5 text-sm">
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
      <label className="grid gap-1.5 text-sm">
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
  )
}
