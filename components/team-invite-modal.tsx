"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export function TeamInviteModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sigo-marketplace-dialog sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>Invite team member</DialogTitle>
          <DialogDescription>
            Send a text invite so they can answer calls from the app. Full SMS invites ship soon — this is a preview of
            the flow.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <label className="block space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Name</span>
            <input
              type="text"
              placeholder="Alex Rivera"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </label>
          <label className="block space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Mobile number</span>
            <input
              type="tel"
              placeholder="(502) 555-0100"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </label>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex w-full items-center justify-center rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-[var(--electric-glow)] hover:bg-primary/90"
          >
            Send invite (preview)
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
