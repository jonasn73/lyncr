"use client"

import { useEffect, type ReactNode } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { X } from "lucide-react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"
import { WORKSPACE_SHEET_CLASS } from "@/lib/workspace-sheet-classes"
import { SCHEDULER_DRAWER_SCRIM } from "@/lib/scheduler-ui-tokens"

type SchedulerJobSlideSheetProps = {
  open: boolean
  onClose: () => void
  children: ReactNode
  className?: string
}

/** Right-anchored job editor shell — Framer Motion slide (x: 100% → 0). */
export function SchedulerJobSlideSheet({
  open,
  onClose,
  children,
  className,
}: SchedulerJobSlideSheetProps) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, onClose])

  if (typeof document === "undefined") return null

  return createPortal(
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            type="button"
            aria-label="Close job panel"
            className={cn("scheduler-job-detail-sheet fixed inset-0 z-[1400]", SCHEDULER_DRAWER_SCRIM)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            className={cn(
              "scheduler-job-detail-sheet scheduler-job-detail-panel fixed inset-y-0 right-0 z-[1410] flex w-full flex-col border-l border-border/60 bg-card shadow-lg",
              WORKSPACE_SHEET_CLASS,
              className
            )}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            {children}
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>,
    document.body
  )
}

export function SchedulerJobSheetCloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      aria-label="Close"
      // Large thumb target + high z so Edit Job Details never steals the tap.
      className="absolute right-3 top-3 z-30 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg p-2 text-zinc-500 hover:bg-muted hover:text-foreground"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
    >
      <X className="h-5 w-5" aria-hidden />
    </button>
  )
}
