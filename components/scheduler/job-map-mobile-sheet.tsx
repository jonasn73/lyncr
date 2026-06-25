"use client"

// Thumb-friendly bottom sheet for dispatch job actions on mobile map view.

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { JobMapPopupForm, type JobMapPopupSource } from "@/components/scheduler/job-map-popup-form"
import type { FieldTechnician, SchedulerEvent } from "@/lib/types"

type JobMapMobileSheetProps = {
  open: boolean
  job: JobMapPopupSource | null
  technicians: FieldTechnician[]
  onOpenChange: (open: boolean) => void
  onSaved: (event: SchedulerEvent) => void
}

export function JobMapMobileSheet({
  open,
  job,
  technicians,
  onOpenChange,
  onSaved,
}: JobMapMobileSheetProps) {
  return (
    <Sheet open={open && Boolean(job)} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto bg-zinc-950 px-4 pb-8">
        <SheetHeader className="border-b border-zinc-800 pb-4 text-left">
          <SheetTitle className="text-lg text-zinc-100">{job?.customer_name?.trim() || "Job details"}</SheetTitle>
          <SheetDescription className="text-zinc-400">
            Update field status, assign a technician, or call the customer.
          </SheetDescription>
        </SheetHeader>
        {job ? (
          <div className="py-4">
            <JobMapPopupForm
              job={job}
              technicians={technicians}
              variant="sheet"
              onCancel={() => onOpenChange(false)}
              onSaved={(event) => {
                onSaved(event)
                onOpenChange(false)
              }}
            />
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
