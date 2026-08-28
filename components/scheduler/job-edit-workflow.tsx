"use client"

// Single-page edit form for scheduler jobs (no step wizard).

import { useState } from "react"
import { Loader2, Trash2 } from "lucide-react"
import { SERVICE_QUOTE_TYPES, isAutomotiveServiceQuoteType } from "@/lib/service-quote-calculator"
import { type SchedulerLifecyclePhase } from "@/lib/scheduler-job-status"
import { cn } from "@/lib/utils"
import {
  SCHEDULER_FIELD_STACK,
  SCHEDULER_INPUT,
  SCHEDULER_METADATA_LABEL,
  SCHEDULER_SECTION,
  SCHEDULER_TEXTAREA,
} from "@/lib/scheduler-ui-tokens"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { VinLookupField } from "@/components/vin-lookup-field"
import type { ServiceQuoteTypeId } from "@/lib/service-rate-card"

// Tight label→input stack so the form fits with less scroll
const fieldBlockClass = cn(SCHEDULER_FIELD_STACK, "w-full min-w-0 gap-0.5")
const labelClass = SCHEDULER_METADATA_LABEL
/** Compact section cards — overflow-visible so nested VIN/inputs are never clipped. */
const sectionClass = cn(SCHEDULER_SECTION, "overflow-visible p-2 sm:p-3")
const sectionTitleClass = cn(SCHEDULER_METADATA_LABEL, "mb-1 block")
// Slightly shorter inputs to reclaim vertical space
const inputClass = cn(SCHEDULER_INPUT, "h-8")
const addressTextareaClass = SCHEDULER_TEXTAREA
/** Dense stacks on laptop/mobile so the whole Edit Job form needs minimal scrolling. */
const stackClass = "flex flex-col gap-2"

export type JobEditWorkflowProps = {
  statusLabel: string
  lifecyclePhase: SchedulerLifecyclePhase
  customerName: string
  customerPhone: string
  customerEmail: string
  location: string
  jobNotes: string
  serviceQuoteTypeId: ServiceQuoteTypeId
  scheduledDate: string
  scheduledTime: string
  vehicleYear: string
  vehicleMake: string
  vehicleModel: string
  vehicleVin: string
  editablePrice: string
  saving: boolean
  deleting: boolean
  canSave: boolean
  error: string | null
  onBackToOverview: () => void
  onCustomerNameChange: (value: string) => void
  onCustomerPhoneChange: (value: string) => void
  onCustomerEmailChange: (value: string) => void
  onLocationChange: (value: string) => void
  onJobNotesChange: (value: string) => void
  onServiceTypeChange: (id: ServiceQuoteTypeId) => void
  onScheduledDateChange: (value: string) => void
  onScheduledTimeChange: (value: string) => void
  onVehicleYearChange: (value: string) => void
  onVehicleMakeChange: (value: string) => void
  onVehicleModelChange: (value: string) => void
  onVehicleVinChange: (value: string) => void
  onEditablePriceChange: (value: string) => void
  /** Persist edits — resolves true when the API save succeeded. */
  onSave: () => void | Promise<boolean>
  onDeleteRequest: () => void
  /** Called after a successful save so the drawer can return to overview. */
  onSaveSuccess?: () => void
}

export function JobEditWorkflow({
  statusLabel,
  lifecyclePhase: _lifecyclePhase,
  customerName,
  customerPhone,
  customerEmail,
  location,
  jobNotes,
  serviceQuoteTypeId,
  scheduledDate,
  scheduledTime,
  vehicleYear,
  vehicleMake,
  vehicleModel,
  vehicleVin,
  editablePrice,
  saving,
  deleting,
  canSave,
  error,
  onBackToOverview,
  onCustomerNameChange,
  onCustomerPhoneChange,
  onCustomerEmailChange,
  onLocationChange,
  onJobNotesChange,
  onServiceTypeChange,
  onScheduledDateChange,
  onScheduledTimeChange,
  onVehicleYearChange,
  onVehicleMakeChange,
  onVehicleModelChange,
  onVehicleVinChange,
  onEditablePriceChange,
  onSave,
  onDeleteRequest,
  onSaveSuccess,
}: JobEditWorkflowProps) {
  const [submitting, setSubmitting] = useState(false)
  const isAutomotiveService = isAutomotiveServiceQuoteType(serviceQuoteTypeId)

  const handleSaveClick = async () => {
    if (submitting || saving || deleting) return
    setSubmitting(true)
    try {
      const ok = await onSave()
      if (ok) onSaveSuccess?.()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <header className="relative shrink-0 border-b border-border/60 px-3 py-2 pr-12 sm:px-4 sm:pr-14">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className={SCHEDULER_METADATA_LABEL}>Edit job</p>
            <p className={cn(SCHEDULER_METADATA_LABEL, "mt-0.5 text-muted-foreground")}>{statusLabel}</p>
          </div>
          <button
            type="button"
            onClick={onBackToOverview}
            className="mr-8 shrink-0 text-[11px] font-semibold text-muted-foreground underline-offset-2 transition-all duration-150 hover:text-emerald-300 hover:underline"
          >
            Back to overview
          </button>
        </div>
      </header>

      {/* Scrollable body — padding clears sticky Save footer so nothing tucks under it. */}
      <div
        className={cn(
          "min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain px-3 py-2 sm:px-4",
          stackClass,
          // Extra bottom space so last field (Notes) clears the sticky footer + safe area.
          "pb-[calc(env(safe-area-inset-bottom)+6.75rem)] sm:pb-6"
        )}
      >
        <section className={sectionClass}>
          <h3 className={sectionTitleClass}>Customer details</h3>
          <div className={stackClass}>
            {/* Name | Phone side-by-side to cut vertical height */}
            <div className="grid grid-cols-2 gap-2">
              <div className={fieldBlockClass}>
                <label className={labelClass} htmlFor="job-edit-customer-name">
                  Name
                </label>
                <Input
                  id="job-edit-customer-name"
                  className={inputClass}
                  value={customerName}
                  onChange={(e) => onCustomerNameChange(e.target.value)}
                  placeholder="Customer name"
                />
              </div>
              <div className={fieldBlockClass}>
                <label className={labelClass} htmlFor="job-edit-customer-phone">
                  Phone
                </label>
                <Input
                  id="job-edit-customer-phone"
                  type="tel"
                  className={inputClass}
                  value={customerPhone}
                  onChange={(e) => onCustomerPhoneChange(e.target.value)}
                  placeholder="(502) 555-0100"
                />
              </div>
            </div>
            {/* Email used by Send invoice — saved to lead + CRM */}
            <div className={fieldBlockClass}>
              <label className={labelClass} htmlFor="job-edit-customer-email">
                Customer email
              </label>
              <Input
                id="job-edit-customer-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                className={inputClass}
                value={customerEmail}
                onChange={(e) => onCustomerEmailChange(e.target.value)}
                placeholder="customer@email.com"
              />
            </div>
            <div className={fieldBlockClass}>
              <label className={labelClass} htmlFor="job-edit-location">
                Address
              </label>
              <textarea
                id="job-edit-location"
                className={cn(
                  addressTextareaClass,
                  "field-sizing-fixed min-h-[2.5rem] resize-none py-2"
                )}
                value={location}
                onChange={(e) => onLocationChange(e.target.value)}
                placeholder="Street address"
                rows={1}
              />
            </div>
          </div>
        </section>

        <section className={sectionClass}>
          <h3 className={sectionTitleClass}>Job settings</h3>
          <div className={stackClass}>
            <div className="grid grid-cols-2 gap-2">
              <div className={fieldBlockClass}>
                <label className={labelClass} htmlFor="job-edit-scheduled-date">
                  Scheduled date
                </label>
                <Input
                  id="job-edit-scheduled-date"
                  type="date"
                  className={inputClass}
                  value={scheduledDate}
                  onChange={(e) => onScheduledDateChange(e.target.value)}
                />
              </div>
              <div className={fieldBlockClass}>
                <label className={labelClass} htmlFor="job-edit-scheduled-time">
                  Time
                </label>
                <Input
                  id="job-edit-scheduled-time"
                  type="time"
                  className={inputClass}
                  value={scheduledTime}
                  onChange={(e) => onScheduledTimeChange(e.target.value)}
                />
              </div>
            </div>

            {/* Service type | Price side-by-side */}
            <div className="grid grid-cols-2 gap-2">
              <div className={fieldBlockClass}>
                <label className={labelClass} htmlFor="job-edit-service-type">
                  Service type
                </label>
                <select
                  id="job-edit-service-type"
                  className={inputClass}
                  value={serviceQuoteTypeId}
                  onChange={(e) => onServiceTypeChange(e.target.value as ServiceQuoteTypeId)}
                >
                  {SERVICE_QUOTE_TYPES.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className={fieldBlockClass}>
                <label className={labelClass} htmlFor="job-edit-price">
                  Price
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                    $
                  </span>
                  <Input
                    id="job-edit-price"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={1}
                    className={cn(inputClass, "pl-6")}
                    value={editablePrice}
                    onChange={(e) => onEditablePriceChange(e.target.value)}
                    placeholder="0"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Own section (not nested in Job settings) — avoids overflow-hidden clipping VIN. */}
        <section className={sectionClass}>
          <h3 className={sectionTitleClass}>
            Vehicle info
            {!isAutomotiveService ? (
              <span className="ml-1 font-normal normal-case tracking-normal text-muted-foreground">
                (optional)
              </span>
            ) : null}
          </h3>
          <div className={stackClass}>
            <div className="grid grid-cols-3 gap-2">
              <div className={fieldBlockClass}>
                <label className={labelClass} htmlFor="job-edit-vehicle-year">
                  Year
                </label>
                <Input
                  id="job-edit-vehicle-year"
                  type="text"
                  inputMode="numeric"
                  className={inputClass}
                  value={vehicleYear}
                  onChange={(e) => onVehicleYearChange(e.target.value)}
                  placeholder="2007"
                />
              </div>
              <div className={fieldBlockClass}>
                <label className={labelClass} htmlFor="job-edit-vehicle-make">
                  Make
                </label>
                <Input
                  id="job-edit-vehicle-make"
                  type="text"
                  className={inputClass}
                  value={vehicleMake}
                  onChange={(e) => onVehicleMakeChange(e.target.value)}
                  placeholder="Chevrolet"
                />
              </div>
              <div className={fieldBlockClass}>
                <label className={labelClass} htmlFor="job-edit-vehicle-model">
                  Model
                </label>
                <Input
                  id="job-edit-vehicle-model"
                  type="text"
                  className={inputClass}
                  value={vehicleModel}
                  onChange={(e) => onVehicleModelChange(e.target.value)}
                  placeholder="Avalanche"
                />
              </div>
            </div>
            <div className={fieldBlockClass}>
              <label className={labelClass} htmlFor="job-edit-vehicle-vin">
                VIN (for invoices)
              </label>
              <VinLookupField
                value={vehicleVin}
                onVinChange={onVehicleVinChange}
                onVehicleResolved={(vehicle) => {
                  onVehicleYearChange(vehicle.vehicle_year)
                  onVehicleMakeChange(vehicle.vehicle_make)
                  onVehicleModelChange(vehicle.vehicle_model)
                }}
                placeholder="17-character VIN"
                disabled={saving || deleting || submitting}
              />
            </div>
          </div>
        </section>

        <section className={sectionClass}>
          <h3 className={sectionTitleClass}>Notes</h3>
          <div className={cn(fieldBlockClass, "min-w-0")}>
            <label className="sr-only" htmlFor="job-edit-notes">
              Notes
            </label>
            <Textarea
              id="job-edit-notes"
              className={cn(
                addressTextareaClass,
                "field-sizing-fixed box-border h-14 min-h-14 max-h-14 w-full min-w-0 py-2"
              )}
              value={jobNotes}
              onChange={(e) => onJobNotesChange(e.target.value)}
              placeholder="Gate code, symptoms, access notes, etc."
              rows={2}
            />
          </div>
        </section>

        {error ? <p className="text-sm text-red-400">{error}</p> : null}
      </div>

      {/* Sticky footer — always visible; body scrolls above it. */}
      <footer
        className={cn(
          "shrink-0 border-t border-border/60 bg-card px-3 pt-2 sm:px-4 sm:pt-3",
          "pb-[calc(env(safe-area-inset-bottom)+0.5rem)]"
        )}
      >
        <Button
          type="button"
          className="h-10 w-full shadow-[0_0_14px_rgba(59,130,246,0.35)] ring-1 ring-primary/40"
          onClick={() => void handleSaveClick()}
          disabled={!canSave || saving || deleting || submitting}
        >
          {saving || submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              Saving…
            </>
          ) : (
            "Save Changes"
          )}
        </Button>
        <button
          type="button"
          className="mt-1 flex w-full items-center justify-center gap-2 py-1 text-xs font-semibold text-red-950/55 transition-colors hover:text-red-900/80 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={onDeleteRequest}
          disabled={saving || deleting}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          Delete job
        </button>
      </footer>
    </div>
  )
}
