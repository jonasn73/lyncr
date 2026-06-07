"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { SmsRegistrationForm } from "@/components/dashboard/sms-registration-form"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CarrierRegistrationModal({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(92vh,900px)] overflow-hidden border-border/80 bg-card/95 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Carrier 10DLC registration</DialogTitle>
          <DialogDescription>
            US carriers require a one-time business profile before lead-alert and customer SMS can deliver.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[calc(92vh-8rem)] overflow-y-auto pr-1">
          <SmsRegistrationForm variant="modal" onSubmitted={() => onOpenChange(false)} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
