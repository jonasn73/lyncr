"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { RoutingStrategyForm } from "@/components/routing-strategy-form"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RoutingStrategyModal({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(92vh,900px)] overflow-hidden border-border/80 bg-card/95 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Call routing strategy</DialogTitle>
          <DialogDescription>
            Choose whether calls ring your private team, the Lyncr operator pool, or hybrid fallback.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[calc(92vh-8rem)] overflow-y-auto pr-1">
          <RoutingStrategyForm onSaved={() => onOpenChange(false)} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
