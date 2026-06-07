"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { SmsAutomationForm } from "@/components/dashboard/sms-automation-form"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SmsAutomationModal({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(92vh,900px)] overflow-hidden border-border/80 bg-card/95 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>SMS automation engine</DialogTitle>
          <DialogDescription>
            Configure white-labeled customer texts at each stage of the job — booking, en route, and review.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[calc(92vh-8rem)] overflow-y-auto pr-1">
          <SmsAutomationForm onSaved={() => onOpenChange(false)} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
