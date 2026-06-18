"use client"

// Industry-specific intake fields — shared by owner scheduler booking + receptionist notepad.

import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { JobAddressAutocomplete } from "@/components/job-address-autocomplete"
import { VehiclePickerCascade, type VehicleCascadeValue } from "@/components/vehicle-picker-cascade"
import { VinLookupField } from "@/components/vin-lookup-field"
import { intakeFieldsForProfile, type FieldServiceFieldDef } from "@/lib/field-service-intake"
import {
  resolveWorkspaceIntakeProfile,
  type IntakeWorkspaceProfile,
} from "@/lib/workspace-intake-profile"
import type { IntakeFormValues } from "@/lib/intake-form-helpers"
import type { StructuredAddress } from "@/lib/structured-address"

export type { IntakeFormValues } from "@/lib/intake-form-helpers"
export {
  serializeIntakeValues,
  intakeValuesComplete,
  intakeTitleFromWorkspaceContext,
  intakeFieldsFromWorkspaceContext,
} from "@/lib/intake-form-helpers"

type IndustryIntakeFormFieldsProps = {
  /** Explicit field list — omit to auto-resolve from workspace context below. */
  fields?: FieldServiceFieldDef[]
  /** Resolved profile (locksmith / detailing / …). */
  intakeProfile?: IntakeWorkspaceProfile
  /** Active workspace display name (e.g. Key Squad 502). */
  organizationName?: string | null
  /** industry_tag values from lines in this workspace. */
  industryTags?: Array<string | null | undefined>
  values: IntakeFormValues
  onChange: (name: string, value: string | boolean | StructuredAddress | null) => void
  disabled?: boolean
  /** Grid columns wrapper class (receptionist uses sm:grid-cols-2). */
  gridClassName?: string
}

function vehicleFromValues(values: IntakeFormValues): VehicleCascadeValue {
  return {
    vehicle_year: String(values.vehicle_year ?? ""),
    vehicle_make: String(values.vehicle_make ?? ""),
    vehicle_model: String(values.vehicle_model ?? ""),
  }
}

export function IndustryIntakeFormFields({
  fields: fieldsProp,
  intakeProfile: intakeProfileProp,
  organizationName,
  industryTags,
  values,
  onChange,
  disabled,
  gridClassName = "grid gap-4 sm:grid-cols-2",
}: IndustryIntakeFormFieldsProps) {
  const intakeProfile =
    intakeProfileProp ??
    resolveWorkspaceIntakeProfile({
      organizationName,
      industryTags,
    })
  const fields = fieldsProp ?? intakeFieldsForProfile(intakeProfile)
  const renderedVehicle = fields.some((f) => f.type === "vehicle_cascade")

  function setVehicle(v: VehicleCascadeValue) {
    onChange("vehicle_year", v.vehicle_year)
    onChange("vehicle_make", v.vehicle_make)
    onChange("vehicle_model", v.vehicle_model)
  }

  return (
    <div className={gridClassName}>
      {fields.map((field) => {
        if (field.type === "vehicle_cascade") {
          if (renderedVehicle && field.name !== "vehicle_cascade") return null
          return (
            <div key={field.name} className={cn(field.full ? "sm:col-span-2" : "", "sm:col-span-2")}>
              <fieldset className="grid gap-3 rounded-lg border border-border/60 p-3">
                <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Vehicle details
                </legend>
                <VehiclePickerCascade value={vehicleFromValues(values)} onChange={setVehicle} disabled={disabled} />
              </fieldset>
            </div>
          )
        }

        return (
          <div key={field.name} className={cn(field.full ? "sm:col-span-2" : "")}>
            {field.type !== "checkbox" ? (
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                {field.label}
                {field.required ? <span className="text-emerald-400"> *</span> : null}
              </label>
            ) : null}

            {field.type === "vin_lookup" ? (
              <VinLookupField
                value={String(values[field.name] ?? "")}
                onVinChange={(v) => onChange(field.name, v)}
                onVehicleResolved={setVehicle}
                placeholder={field.placeholder}
                disabled={disabled}
              />
            ) : field.type === "address" ? (
              <JobAddressAutocomplete
                value={(values[field.name] as StructuredAddress | null) ?? null}
                onChange={(v) => onChange(field.name, v)}
                placeholder={field.placeholder}
                disabled={disabled}
              />
            ) : field.type === "textarea" ? (
              <textarea
                className={cn(inputClass, "min-h-[70px] resize-y")}
                placeholder={field.placeholder}
                value={String(values[field.name] ?? "")}
                disabled={disabled}
                onChange={(e) => onChange(field.name, e.target.value)}
              />
            ) : field.type === "select" ? (
              <select
                className={inputClass}
                value={String(values[field.name] ?? "")}
                disabled={disabled}
                onChange={(e) => onChange(field.name, e.target.value)}
              >
                <option value="">Select…</option>
                {field.options?.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : field.type === "checkbox" ? (
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border/70 bg-background px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border accent-emerald-500"
                  checked={values[field.name] === true}
                  disabled={disabled}
                  onChange={(e) => onChange(field.name, e.target.checked)}
                />
                <span className="text-foreground">{field.label}</span>
                {values[field.name] === true ? <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden /> : null}
              </label>
            ) : field.type === "toggle" ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(field.name, !(values[field.name] === true))}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition",
                  values[field.name] === true
                    ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-200"
                    : "border-border/70 bg-background text-zinc-400"
                )}
              >
                {values[field.name] === true ? "Yes" : "No"}
              </button>
            ) : (
              <input
                type="text"
                className={inputClass}
                placeholder={field.placeholder}
                value={String(values[field.name] ?? "")}
                disabled={disabled}
                onChange={(e) => onChange(field.name, e.target.value)}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
