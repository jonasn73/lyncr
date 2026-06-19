"use client"

// After dropping a hopper job on the grid — pick tech + confirm time.

import { Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { vehicleLabelFromParts } from "@/lib/job-pool"
import type { FieldTechnician, UnassignedPoolJob } from "@/lib/types"

const selectClass =
  "w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"

type PoolScheduleDialogProps = {
  open: boolean
  job: UnassignedPoolJob | null
  scheduledAtLocal: string
  technicians: FieldTechnician[]
  techId: string
  saving: boolean
  error: string | null
  onTechChange: (techId: string) => void
  onScheduledChange: (value: string) => void
  onClose: () => void
  onConfirm: () => void
}

export function PoolScheduleDialog({
  open,
  job,
  scheduledAtLocal,
  technicians,
  techId,
  saving,
  error,
  onTechChange,
  onScheduledChange,
  onClose,
  onConfirm,
}: PoolScheduleDialogProps) {
  const vehicle = job
    ? vehicleLabelFromParts(job.vehicle_year, job.vehicle_make, job.vehicle_model)
    : null
  const assignable = technicians.filter((t) => t.is_active && t.portal_user_id)

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="border-border bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Schedule from pool</DialogTitle>
          <DialogDescription>
            Assign a tech and lock in the appointment time for this hopper job.
          </DialogDescription>
        </DialogHeader>

        {job ? (
          <div className="grid gap-3 py-1 text-sm">
            <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
              <p className="font-medium text-foreground">{job.customer_name || "Customer"}</p>
              <p className="text-xs text-zinc-500">{job.job_type || "Service"}</p>
              {vehicle ? <p className="mt-1 text-xs text-zinc-400">{vehicle}</p> : null}
              {job.neighborhood || job.location ? (
                <p className="mt-1 text-xs text-zinc-500">{job.neighborhood || job.location}</p>
              ) : null}
            </div>

            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-zinc-400">Assigned tech</span>
              <select className={selectClass} value={techId} onChange={(e) => onTechChange(e.target.value)}>
                <option value="">Select technician…</option>
                {assignable.map((t) => (
                  <option key={t.id} value={t.portal_user_id!}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-zinc-400">Start time</span>
              <input
                type="datetime-local"
                className={selectClass}
                value={scheduledAtLocal}
                onChange={(e) => onScheduledChange(e.target.value)}
              />
            </label>

            {error ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={saving || !techId || !job}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Schedule & assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
