"use client"

// Single-page edit form for scheduler jobs (no step wizard).

import { useState } from "react"
import { Loader2, Trash2 } from "lucide-react"
import { SERVICE_QUOTE_TYPES } from "@/lib/service-quote-calculator"
import { type SchedulerLifecyclePhase } from "@/lib/scheduler-job-status"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { ServiceQuoteTypeId } from "@/lib/service-rate-card"

const fieldBlockClass = "flex w-full min-w-0 flex-col"
const labelClass = "mb-1.5 text-xs font-medium text-zinc-400"
const sectionClass =
  "mb-4 min-w-0 max-w-full overflow-hidden rounded-lg border border-zinc-800/60 bg-zinc-900/30 p-4"
const sectionTitleClass = "mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500"
const inputClass =
  "w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40"
const addressTextareaClass =
  "box-border block min-h-[72px] w-full max-w-full resize-none break-words whitespace-normal rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40"

export type JobEditWorkflowProps = {
  statusLabel: string
  lifecyclePhase: SchedulerLifecyclePhase
  customerName: string
  customerPhone: string
  location: string
  jobNotes: string
  serviceQuoteTypeId: ServiceQuoteTypeId
  editablePrice: string
  saving: boolean
  deleting: boolean
  canSave: boolean
  error: string | null
  onBackToOverview: () => void
  onCustomerNameChange: (value: string) => void
  onCustomerPhoneChange: (value: string) => void
  onLocationChange: (value: string) => void
  onJobNotesChange: (value: string) => void
  onServiceTypeChange: (id: ServiceQuoteTypeId) => void
  onEditablePriceChange: (value: string) => void
  /** Persist edits — resolves true when the API save succeeded. */
  onSave: () => void | Promise<boolean>
  onDeleteRequest: () => void
  /** Called after a successful save so the drawer can return to overview. */
  onSaveSuccess?: () => void
}

export function JobEditWorkflow({
  statusLabel,
  lifecyclePhase,
  customerName,
  customerPhone,
  location,
  jobNotes,
  serviceQuoteTypeId,
  editablePrice,
  saving,
  deleting,
  canSave,
  error,
  onBackToOverview,
  onCustomerNameChange,
  onCustomerPhoneChange,
  onLocationChange,
  onJobNotesChange,
  onServiceTypeChange,
  onEditablePriceChange,
  onSave,
  onDeleteRequest,
  onSaveSuccess,
}: JobEditWorkflowProps) {
  const [submitting, setSubmitting] = useState(false)

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
      </header>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain px-5 py-4">
        <section className={sectionClass}>
          <h3 className={sectionTitleClass}>Customer details</h3>
          <div className="space-y-3">
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
            <div className={fieldBlockClass}>
              <label className={labelClass} htmlFor="job-edit-location">
                Address
              </label>
              <textarea
                id="job-edit-location"
                className={addressTextareaClass}
                value={location}
                onChange={(e) => onLocationChange(e.target.value)}
                placeholder="Street address"
                rows={3}
              />
            </div>
          </div>
        </section>

        <section className={sectionClass}>
          <h3 className={sectionTitleClass}>Job settings</h3>
          <div className="space-y-3">
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
                Billing balance / price
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-zinc-500">
                  $
                </span>
                <Input
                  id="job-edit-price"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={1}
                  className={cn(inputClass, "pl-7")}
                  value={editablePrice}
                  onChange={(e) => onEditablePriceChange(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
          </div>
        </section>

        <section className={sectionClass}>
          <h3 className={sectionTitleClass}>Notes</h3>
          <div className={fieldBlockClass}>
            <label className="sr-only" htmlFor="job-edit-notes">
              Notes
            </label>
            <Textarea
              id="job-edit-notes"
              className={addressTextareaClass}
              value={jobNotes}
              onChange={(e) => onJobNotesChange(e.target.value)}
              placeholder="Gate code, symptoms, vehicle details, etc."
              rows={4}
            />
          </div>
        </section>

        {error ? <p className="text-sm text-red-400">{error}</p> : null}
      </div>

      <footer className="mt-auto shrink-0 border-t border-border/60 bg-card px-5 py-4">
        <Button
          type="button"
          className="h-11 w-full shadow-[0_0_14px_rgba(59,130,246,0.35)] ring-1 ring-primary/40"
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
        <div className="mt-3 border-t border-border/40 pt-3">
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
