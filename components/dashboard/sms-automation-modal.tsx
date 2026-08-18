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
      <DialogContent className="flex max-h-[min(92vh,720px)] flex-col overflow-hidden border-border/80 bg-card/95 sm:max-w-lg">
        <DialogHeader className="shrink-0">
          <DialogTitle>SMS templates</DialogTitle>
          <DialogDescription>
            Edit the texts you actually send. Follow-up is the auto we-got-it after they book. Status is the chip in Messages.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <SmsAutomationForm onSaved={() => onOpenChange(false)} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
