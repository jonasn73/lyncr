"use client"

import { useState } from "react"
import { Loader2, Trash2 } from "lucide-react"
import { VehiclePickerCascade } from "@/components/vehicle-picker-cascade"
import { VehicleIntakeClarificationsPanel } from "@/components/vehicle-intake-clarifications-panel"
import { VehicleKeyInfoPanel } from "@/components/vehicle-key-info-panel"
import { ServiceQuoteCalculatorPanel } from "@/components/dashboard/service-quote-calculator-panel"
import { PriceNegotiationHelperPanel } from "@/components/price-negotiation-helper-panel"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { SCHEDULER_DURATION_OPTIONS } from "@/lib/scheduler-utils"
import {
  type SchedulerLifecyclePhase,
} from "@/lib/scheduler-job-status"
import { cn } from "@/lib/utils"
import { serviceTypeRequiresVehicle } from "@/lib/job-intake-fields"
import type { ServiceQuoteResult } from "@/lib/service-quote-calculator"
import type { ServiceQuoteTypeId } from "@/lib/service-rate-card"
import type { NegotiationDiscountId } from "@/lib/price-negotiation"
import type { VehicleClarificationOption } from "@/lib/vehicle-intake-clarifications"
import type { FieldTechnician } from "@/lib/types"

export type JobEditWorkflowStep = "CUSTOMER" | "SERVICE" | "DISPATCH"

const STEPS: { id: JobEditWorkflowStep; label: string }[] = [
  { id: "CUSTOMER", label: "Customer" },
  { id: "SERVICE", label: "Service" },
  { id: "DISPATCH", label: "Dispatch" },
]

const STATUS_SEGMENTS: {
  phase: SchedulerLifecyclePhase
  jobStatus: "assigned" | "en_route" | "arrived" | "completed"
  label: string
}[] = [
  { phase: "scheduled", jobStatus: "assigned", label: "Assigned" },
  { phase: "en_route", jobStatus: "en_route", label: "En route" },
  { phase: "on_site", jobStatus: "arrived", label: "On site" },
  { phase: "completed", jobStatus: "completed", label: "Completed" },
]

const fieldBlockClass = "flex w-full min-w-0 flex-col"
const labelClass = "mb-1.5 text-xs font-medium text-zinc-400"
const sectionClass = "mb-4 min-w-0 max-w-full overflow-hidden rounded-lg border border-zinc-800/60 bg-zinc-900/30 p-4"
const sectionTitleClass = "mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500"
const inputClass =
  "w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40"
const addressTextareaClass =
  "box-border block min-h-[72px] w-full max-w-full resize-none break-words whitespace-normal rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40"

export type JobEditWorkflowProps = {
  statusLabel: string
  lifecyclePhase: SchedulerLifecyclePhase
  initialStep?: JobEditWorkflowStep
  customerName: string
  customerPhone: string
  location: string
  jobNotes: string
  serviceQuoteTypeId: ServiceQuoteTypeId
  vehicleYear: string
  vehicleMake: string
  vehicleModel: string
  keyFccId: string
  keyFrequency: string
  keyChipset: string
  keyStyle: string
  keyVariantId: string
  keyProfileId: string
  answeredClarificationIds: string[]
  editablePrice: string
  priceOverridden: boolean
  negotiationDiscountApplied: NegotiationDiscountId | null
  liveQuote: ServiceQuoteResult
  startLocal: string
  durationMinutes: number
  assignedTechId: string
  assignableTechs: FieldTechnician[]
  hasAssignedTech: boolean
  statusUpdating: boolean
  saving: boolean
  deleting: boolean
  canSave: boolean
  error: string | null
  startInputRef: React.RefObject<HTMLInputElement | null>
  onBackToOverview: () => void
  onCustomerNameChange: (value: string) => void
  onCustomerPhoneChange: (value: string) => void
  onLocationChange: (value: string) => void
  onJobNotesChange: (value: string) => void
  onServiceTypeChange: (id: ServiceQuoteTypeId) => void
  onEditablePriceChange: (value: string) => void
  onEditablePriceBlur: () => void
  onNegotiationApply: (dollars: number, discountId: NegotiationDiscountId) => void
  onVehicleChange: (vehicle: { vehicle_year: string; vehicle_make: string; vehicle_model: string }) => void
  onVehicleClarification: (promptId: string, option: VehicleClarificationOption) => void
  onVehicleKeySelection: (
    sel: {
      profileId: string
      fccId: string
      frequency: string | null
      chipset: string | null
      keyStyle: string
      variantId?: string | null
    } | null
  ) => void
  onStartLocalChange: (value: string) => void
  onDurationChange: (minutes: number) => void
  onAssignedTechChange: (techId: string) => void
  onStatusChange: (status: (typeof STATUS_SEGMENTS)[number]["jobStatus"]) => void
  onSave: () => void
  onDeleteRequest: () => void
}

export function JobEditWorkflow({
  statusLabel,
  lifecyclePhase,
  initialStep = "CUSTOMER",
  customerName,
  customerPhone,
  location,
  jobNotes,
  serviceQuoteTypeId,
  vehicleYear,
  vehicleMake,
  vehicleModel,
  keyFccId,
  keyFrequency,
  keyChipset,
  keyStyle,
  keyVariantId,
  keyProfileId,
  answeredClarificationIds,
  editablePrice,
  priceOverridden,
  negotiationDiscountApplied,
  liveQuote,
  startLocal,
  durationMinutes,
  assignedTechId,
  assignableTechs,
  hasAssignedTech,
  statusUpdating,
  saving,
  deleting,
  canSave,
  error,
  startInputRef,
  onBackToOverview,
  onCustomerNameChange,
  onCustomerPhoneChange,
  onLocationChange,
  onJobNotesChange,
  onServiceTypeChange,
  onEditablePriceChange,
  onEditablePriceBlur,
  onNegotiationApply,
  onVehicleChange,
  onVehicleClarification,
  onVehicleKeySelection,
  onStartLocalChange,
  onDurationChange,
  onAssignedTechChange,
  onStatusChange,
  onSave,
  onDeleteRequest,
}: JobEditWorkflowProps) {
  const [step, setStep] = useState<JobEditWorkflowStep>(initialStep)
  const requiresVehicle = serviceTypeRequiresVehicle(serviceQuoteTypeId)
  const stepIndex = STEPS.findIndex((entry) => entry.id === step)
  const isFirstStep = stepIndex <= 0
  const isLastStep = stepIndex >= STEPS.length - 1

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="relative shrink-0 border-b border-border/60 px-5 py-4 pr-14">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Edit job</p>
            <span
              className={cn(
                "mt-2 inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                lifecyclePhase === "unassigned" && "bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/30",
                lifecyclePhase === "scheduled" && "bg-teal-500/20 text-teal-100 ring-1 ring-teal-500/30",
                lifecyclePhase === "en_route" && "bg-sky-500/20 text-sky-100 ring-1 ring-sky-500/30",
                lifecyclePhase === "on_site" && "bg-yellow-500/20 text-yellow-100 ring-1 ring-yellow-500/30",
                lifecyclePhase === "completed" && "bg-zinc-600/30 text-zinc-400 ring-1 ring-zinc-600/40"
              )}
            >
              {statusLabel}
            </span>
          </div>
          <button
            type="button"
            onClick={onBackToOverview}
            className="shrink-0 text-[11px] font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Back to overview
          </button>
        </div>
        <div className="mt-3 flex gap-1">
          {STEPS.map((entry, index) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setStep(entry.id)}
              className={cn(
                "flex-1 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors",
                step === entry.id
                  ? "border-primary/50 bg-primary/15 text-primary"
                  : "border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-foreground"
              )}
              aria-current={step === entry.id ? "step" : undefined}
            >
              {index + 1}. {entry.label}
            </button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain px-5 py-4">
        {step === "CUSTOMER" ? (
          <section className={sectionClass}>
            <h3 className={sectionTitleClass}>Customer &amp; location</h3>
            <div className="space-y-3">
              <div className={fieldBlockClass}>
                <label className={labelClass} htmlFor="job-customer-name">
                  Customer name
                </label>
                <Input
                  id="job-customer-name"
                  className={inputClass}
                  value={customerName}
                  onChange={(e) => onCustomerNameChange(e.target.value)}
                  placeholder="Customer name"
                />
              </div>
              <div className={fieldBlockClass}>
                <label className={labelClass} htmlFor="job-customer-phone">
                  Phone
                </label>
                <Input
                  id="job-customer-phone"
                  type="tel"
                  className={inputClass}
                  value={customerPhone}
                  onChange={(e) => onCustomerPhoneChange(e.target.value)}
                  placeholder="(502) 555-0100"
                />
              </div>
              <div className={fieldBlockClass}>
                <label className={labelClass} htmlFor="job-location">
                  Service address
                </label>
                <textarea
                  id="job-location"
                  className={addressTextareaClass}
                  value={location}
                  onChange={(e) => onLocationChange(e.target.value)}
                  placeholder="Street address"
                  rows={3}
                />
              </div>
              <div className={fieldBlockClass}>
                <label className={labelClass} htmlFor="job-notes">
                  Notes
                </label>
                <Textarea
                  id="job-notes"
                  className={addressTextareaClass}
                  value={jobNotes}
                  onChange={(e) => onJobNotesChange(e.target.value)}
                  placeholder="Gate code, symptoms, etc."
                  rows={2}
                />
              </div>
            </div>
          </section>
        ) : null}

        {step === "SERVICE" ? (
          <section className={sectionClass}>
            <h3 className={sectionTitleClass}>Service profile</h3>
            <div className="space-y-3">
              <ServiceQuoteCalculatorPanel
                quote={liveQuote}
                serviceTypeId={serviceQuoteTypeId}
                vehicleYear={vehicleYear}
                vehicleMake={vehicleMake}
                vehicleModel={vehicleModel}
                onServiceTypeChange={onServiceTypeChange}
                className="border-emerald-500/20 bg-emerald-500/[0.07]"
              />
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-3">
                <Label
                  htmlFor="job-quote-price"
                  className="text-[10px] font-semibold uppercase tracking-wide text-emerald-400/90"
                >
                  Quote before dispatch
                </Label>
                <div className="relative mt-2">
                  <span className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-2xl font-bold text-emerald-400/80">
                    $
                  </span>
                  <input
                    id="job-quote-price"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={1}
                    value={editablePrice}
                    onChange={(e) => onEditablePriceChange(e.target.value)}
                    onBlur={onEditablePriceBlur}
                    className="w-full border-none bg-transparent pl-7 text-center text-4xl font-bold text-emerald-400 focus:outline-none focus:ring-0"
                  />
                </div>
                <p className="mt-2 text-center text-[10px] text-muted-foreground">
                  {priceOverridden
                    ? "Custom quote — edit before saving."
                    : `Auto-calculated: ${liveQuote.dispatchJobTypeLabel}${
                        liveQuote.distanceMiles != null
                          ? ` + ${liveQuote.distanceMiles.toFixed(1)} mi travel`
                          : ""
                      }.`}
                </p>
              </div>
              <PriceNegotiationHelperPanel
                baselineCents={liveQuote.totalCents}
                currentPriceDollars={editablePrice}
                onApplyPrice={onNegotiationApply}
                appliedDiscountId={negotiationDiscountApplied}
              />
              {requiresVehicle ? (
                <fieldset className="@container grid min-w-0 max-w-full gap-3 overflow-hidden rounded-lg border border-primary/40 bg-primary/10 p-3">
                  <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-primary">
                    Vehicle metadata
                  </legend>
                  <VehiclePickerCascade
                    value={{
                      vehicle_year: vehicleYear,
                      vehicle_make: vehicleMake,
                      vehicle_model: vehicleModel,
                    }}
                    onChange={onVehicleChange}
                  />
                  <VehicleIntakeClarificationsPanel
                    year={vehicleYear}
                    make={vehicleMake}
                    model={vehicleModel}
                    answeredIds={new Set(answeredClarificationIds)}
                    onAnswer={onVehicleClarification}
                  />
                  <VehicleKeyInfoPanel
                    year={vehicleYear}
                    make={vehicleMake}
                    model={vehicleModel}
                    value={
                      keyFccId
                        ? {
                            profileId: keyProfileId,
                            fccId: keyFccId,
                            frequency: keyFrequency || null,
                            chipset: keyChipset || null,
                            keyStyle: keyStyle || "Not sure yet",
                            variantId: keyVariantId || null,
                          }
                        : null
                    }
                    onChange={onVehicleKeySelection}
                  />
                </fieldset>
              ) : null}
            </div>
          </section>
        ) : null}

        {step === "DISPATCH" ? (
          <section className={sectionClass}>
            <h3 className={sectionTitleClass}>Dispatch &amp; schedule</h3>
            <div className="space-y-3">
              <div className={fieldBlockClass}>
                <label className={labelClass}>Status controls</label>
                <div className="flex flex-wrap gap-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
                  {STATUS_SEGMENTS.map((segment) => {
                    const active = lifecyclePhase === segment.phase
                    const disabled =
                      statusUpdating ||
                      (segment.jobStatus !== "completed" && !hasAssignedTech && segment.phase !== "scheduled")
                    return (
                      <button
                        key={segment.jobStatus}
                        type="button"
                        disabled={disabled}
                        onClick={() => onStatusChange(segment.jobStatus)}
                        className={cn(
                          "flex-1 rounded-md px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide transition-colors",
                          active
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-zinc-400 hover:bg-zinc-800/80 hover:text-foreground",
                          disabled && !active && "cursor-not-allowed opacity-40"
                        )}
                      >
                        {segment.label}
                      </button>
                    )
                  })}
                </div>
                {statusUpdating ? (
                  <p className="mt-2 flex items-center gap-1.5 text-[10px] text-zinc-500">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    Updating status…
                  </p>
                ) : null}
              </div>
              <div className={fieldBlockClass}>
                <label className={labelClass} htmlFor="job-start">
                  Start time
                </label>
                <Input
                  id="job-start"
                  ref={startInputRef}
                  type="datetime-local"
                  className={inputClass}
                  value={startLocal}
                  onChange={(e) => onStartLocalChange(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className={fieldBlockClass}>
                  <label className={labelClass} htmlFor="job-duration">
                    Duration
                  </label>
                  <select
                    id="job-duration"
                    className={inputClass}
                    value={durationMinutes}
                    onChange={(e) => onDurationChange(Number(e.target.value) || 60)}
                  >
                    {SCHEDULER_DURATION_OPTIONS.map((opt) => (
                      <option key={opt.minutes} value={opt.minutes}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={fieldBlockClass}>
                  <label className={labelClass} htmlFor="job-tech">
                    Assigned tech
                  </label>
                  <select
                    id="job-tech"
                    className={inputClass}
                    value={assignedTechId}
                    onChange={(e) => onAssignedTechChange(e.target.value)}
                  >
                    <option value="">Unassigned</option>
                    {assignableTechs.map((t) => (
                      <option key={t.portal_user_id!} value={t.portal_user_id!}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}
      </div>

      <footer className="mt-auto shrink-0 border-t border-border/60 bg-card px-5 py-4">
        <div className="mb-4 grid grid-cols-2 gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={isFirstStep || saving || deleting}
            onClick={() => setStep(STEPS[Math.max(0, stepIndex - 1)]!.id)}
          >
            Back
          </Button>
          {isLastStep ? (
            <Button
              type="button"
              className="shadow-[0_0_14px_rgba(59,130,246,0.4)] ring-1 ring-primary/45"
              onClick={onSave}
              disabled={!canSave || saving || deleting}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save changes"}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={saving || deleting}
              onClick={() => setStep(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)]!.id)}
            >
              Next
            </Button>
          )}
        </div>
        <div className="border-t border-border/40 pt-3">
          <button
            type="button"
            className="flex w-full items-center justify-center gap-2 py-2 text-xs font-semibold text-red-950/55 transition-colors hover:text-red-900/80 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onDeleteRequest}
            disabled={saving || deleting}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Delete job
          </button>
        </div>
      </footer>
    </div>
  )
}
