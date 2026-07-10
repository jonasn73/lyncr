"use client"

// Compact job editor anchored to a map pin (replaces the full-width drawer in map view).

import { useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import { vehicleLabelFromParts } from "@/lib/job-pool"
import {
  SCHEDULER_STATUS_LABEL,
  schedulerLifecyclePhase,
  type SchedulerLifecyclePhase,
} from "@/lib/scheduler-job-status"
import { cn } from "@/lib/utils"
import {
  SCHEDULER_FIELD_STACK,
  SCHEDULER_GLASS_CARD,
  SCHEDULER_INPUT,
  SCHEDULER_INTERACTIVE_HOVER,
  SCHEDULER_INTERACTIVE_TEXT_LINK,
  SCHEDULER_MAP_POPUP_SHELL,
  SCHEDULER_METADATA_LABEL,
} from "@/lib/scheduler-ui-tokens"
import type { FieldTechnician, SchedulerEvent } from "@/lib/types"

/** Job fields needed to render and PATCH from the map popup. */
export type JobMapPopupSource = {
  id: string
  customer_name: string | null
  customer_phone: string | null
  vehicle_year: string | null
  vehicle_make: string | null
  vehicle_model: string | null
  job_type: string | null
  job_status?: string | null
  dispatch_status?: string | null
  assigned_tech_id?: string | null
}

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

function formatPhoneLink(phone: string | null): string {
  if (!phone?.trim()) return ""
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 10) return `tel:+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `tel:+${digits}`
  return `tel:${phone.trim()}`
}

function formatPhoneDisplay(phone: string | null): string {
  if (!phone?.trim()) return "—"
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  return phone.trim()
}

type JobMapPopupFormProps = {
  job: JobMapPopupSource
  technicians: FieldTechnician[]
  onCancel: () => void
  onSaved: (event: SchedulerEvent) => void
  /** `sheet` = full-width mobile bottom drawer with larger tap targets. */
  variant?: "compact" | "sheet"
}

export function JobMapPopupForm({
  job,
  technicians,
  onCancel,
  onSaved,
  variant = "compact",
}: JobMapPopupFormProps) {
  const assignableTechs = useMemo(
    () => technicians.filter((t) => t.is_active && t.portal_user_id),
    [technicians]
  )

  const initialPhase = schedulerLifecyclePhase({
    job_status: job.job_status,
    dispatch_status: job.dispatch_status,
    assigned_tech_id: job.assigned_tech_id,
  })

  const initialStatus =
    STATUS_SEGMENTS.find((s) => s.phase === initialPhase)?.jobStatus ?? "assigned"

  const [pendingStatus, setPendingStatus] = useState(initialStatus)
  const [assignedTechId, setAssignedTechId] = useState(job.assigned_tech_id ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const vehicleLine = vehicleLabelFromParts(job.vehicle_year, job.vehicle_make, job.vehicle_model)
  const profileLine = [vehicleLine, job.job_type].filter(Boolean).join(" · ") || "No vehicle on file"
  const phoneHref = formatPhoneLink(job.customer_phone)
  const hasAssignedTech = Boolean(assignedTechId.trim())

  async function handleSave() {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const saveRes = await fetch(`/api/owner/scheduler/${encodeURIComponent(job.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assigned_tech_id: assignedTechId.trim() || null,
        }),
      })
      const saveJson = (await saveRes.json()) as { error?: string; data?: { event?: SchedulerEvent } }
      if (!saveRes.ok) throw new Error(saveJson.error ?? "Could not save job")

      let event = saveJson.data?.event
      const currentStatus = (event?.job_status ?? job.job_status ?? "").toLowerCase()
      const targetStatus = pendingStatus
      const statusChanged = currentStatus !== targetStatus

      if (statusChanged) {
        if (targetStatus !== "completed" && !hasAssignedTech) {
          throw new Error("Assign a technician before updating field status.")
        }
        const statusRes = await fetch(`/api/owner/jobs/${encodeURIComponent(job.id)}/status`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: targetStatus }),
        })
        const statusJson = (await statusRes.json()) as { error?: string; data?: { event?: SchedulerEvent } }
        if (!statusRes.ok) throw new Error(statusJson.error ?? "Could not update status")
        event = statusJson.data?.event ?? event
      }

      if (!event) throw new Error("No updated job returned")
      onSaved(event)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save changes")
    } finally {
      setSaving(false)
    }
  }

  const isSheet = variant === "sheet"

  return (
    <div
      className={cn(
        "flex flex-col gap-3 text-slate-100",
        isSheet ? "w-full gap-4 p-1" : SCHEDULER_MAP_POPUP_SHELL
      )}
    >
      <div className={cn("space-y-2 border-b border-slate-800/80 pb-2", !isSheet && "pr-6")}>
        <p className={cn("truncate font-bold text-slate-100", isSheet ? "text-lg" : "text-sm")}>
          {job.customer_name?.trim() || "Customer"}
        </p>
        <div className={cn(SCHEDULER_FIELD_STACK, "text-sm text-slate-400 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2 sm:gap-y-0.5")}>
          {phoneHref ? (
            <a href={phoneHref} className={cn(SCHEDULER_INTERACTIVE_TEXT_LINK, "inline-flex min-h-11 items-center")}>
              {formatPhoneDisplay(job.customer_phone)}
            </a>
          ) : (
            <span>{formatPhoneDisplay(job.customer_phone)}</span>
          )}
          {!isSheet ? (
            <>
              <span className="hidden text-slate-600 sm:inline" aria-hidden>
                ·
              </span>
              <span className={cn(SCHEDULER_METADATA_LABEL, "truncate")}>{profileLine}</span>
            </>
          ) : (
            <>
              {vehicleLine ? <p className={SCHEDULER_METADATA_LABEL}>{vehicleLine}</p> : null}
              {job.job_type ? <p className={SCHEDULER_METADATA_LABEL}>{job.job_type}</p> : null}
            </>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div
          className={cn(
            "grid gap-2",
            isSheet ? "grid-cols-2" : cn("flex flex-wrap gap-1 p-0.5", SCHEDULER_GLASS_CARD)
          )}
        >
          {STATUS_SEGMENTS.map((segment) => {
            const active = pendingStatus === segment.jobStatus
            const disabled =
              segment.jobStatus !== "completed" && !hasAssignedTech && segment.jobStatus !== "assigned"
            return (
              <button
                key={segment.jobStatus}
                type="button"
                disabled={disabled || saving}
                onClick={() => setPendingStatus(segment.jobStatus)}
                className={cn(
                  "rounded-lg font-semibold uppercase tracking-wide transition-colors",
                  isSheet
                    ? "min-h-12 px-3 py-3 text-sm"
                    : "flex-1 rounded px-1.5 py-1 text-[9px]",
                  active
                    ? "bg-primary text-primary-foreground"
                    : cn(
                        "border border-slate-800/80 bg-slate-900/60 text-slate-400",
                        SCHEDULER_INTERACTIVE_HOVER,
                        "hover:text-slate-200"
                      ),
                  disabled && !active && "cursor-not-allowed opacity-40"
                )}
              >
                {segment.label}
              </button>
            )
          })}
        </div>

        <label className={SCHEDULER_FIELD_STACK}>
          <span className={cn(SCHEDULER_METADATA_LABEL, isSheet && "text-xs")}>Technician</span>
          <select
            value={assignedTechId}
            disabled={saving}
            onChange={(e) => setAssignedTechId(e.target.value)}
            className={cn(SCHEDULER_INPUT, isSheet ? "min-h-12 px-3 py-3 text-base" : "px-2 py-1.5 text-xs")}
          >
            <option value="">Unassigned</option>
            {assignableTechs.map((t) => (
              <option key={t.portal_user_id!} value={t.portal_user_id!}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? <p className={cn("text-red-400", isSheet ? "text-sm" : "text-[11px]")}>{error}</p> : null}

      <div className={cn("flex gap-2", isSheet && "flex-col sm:flex-row")}>
        <button
          type="button"
          disabled={saving}
          onClick={onCancel}
          className={cn(
            "flex-1 rounded-md border border-slate-800/80 font-medium text-slate-300",
            SCHEDULER_INTERACTIVE_HOVER,
            isSheet ? "min-h-12 px-4 py-3 text-base" : "px-2 py-1.5 text-xs"
          )}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleSave()}
          className={cn(
            "flex-1 rounded-md bg-primary font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60",
            isSheet ? "min-h-12 px-4 py-3 text-base" : "px-2 py-1.5 text-xs"
          )}
        >
          {saving ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" aria-hidden /> : "Save changes"}
        </button>
      </div>

      <p className="text-[10px] text-zinc-600">
        {SCHEDULER_STATUS_LABEL[schedulerLifecyclePhase({
          job_status: pendingStatus,
          dispatch_status: job.dispatch_status,
          assigned_tech_id: assignedTechId || null,
        })]}
      </p>
    </div>
  )
}
