"use client"

import { useEffect, type ReactNode } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { X } from "lucide-react"
import { createPortal } from "react-dom"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import { WORKSPACE_SHEET_CLASS } from "@/lib/workspace-sheet-classes"
import { SCHEDULER_DRAWER_SCRIM } from "@/lib/scheduler-ui-tokens"

type SchedulerJobSlideSheetProps = {
  open: boolean
  onClose: () => void
  children: ReactNode
  className?: string
}

/**
 * Job editor shell — desktop: right slide-over; mobile: compact bottom sheet
 * (not a full-screen page) so CRM / map stay visible behind it.
 */
export function SchedulerJobSlideSheet({
  open,
  onClose,
  children,
  className,
}: SchedulerJobSlideSheetProps) {
  const isMobile = useIsMobile()

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
              "scheduler-job-detail-sheet relative fixed z-[1410] flex flex-col overflow-hidden bg-card shadow-lg",
              // Phone: peek-style bottom sheet. Desktop: full-height right rail.
              isMobile
                ? "inset-x-0 bottom-0 top-auto max-h-[min(88dvh,720px)] rounded-t-2xl border border-b-0 border-border/60"
                : cn(
                    "scheduler-job-detail-panel inset-y-0 right-0 h-dvh max-h-dvh w-full border-l border-border/60",
                    WORKSPACE_SHEET_CLASS
                  ),
              className
            )}
            initial={isMobile ? { y: "100%" } : { x: "100%" }}
            animate={isMobile ? { y: 0 } : { x: 0 }}
            exit={isMobile ? { y: "100%" } : { x: "100%" }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            {isMobile ? (
              <div className="flex shrink-0 justify-center pt-3 pb-1" aria-hidden>
                <span className="h-1 w-10 rounded-full bg-zinc-600/80" />
              </div>
            ) : null}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
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
      // Large thumb target + high z so Edit never steals the tap (clears mobile drag handle).
      className="absolute right-2 top-1.5 z-30 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg p-2 text-zinc-500 hover:bg-muted hover:text-foreground md:right-3 md:top-3"
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
