"use client"

import { memo } from "react"
import { ChevronRight, Hash, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { useDashboardNumbersModal } from "@/components/dashboard-numbers-modal-context"

export const DashboardRoutingSidebar = memo(function DashboardRoutingSidebar({
  lineCount,
  className,
}: {
  lineCount: number
  className?: string
}) {
  const { openBuyModal, openManageModal } = useDashboardNumbersModal()

  return (
    <aside
      className={cn(
        "w-full shrink-0 lg:w-56 xl:w-60",
        "rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm ring-1 ring-border/40",
        className
      )}
      aria-label="Phone lines"
    >
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/30 bg-primary/10">
          <Hash className="h-4 w-4 text-primary" aria-hidden />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">Phone lines</p>
          <p className="text-[11px] text-muted-foreground">
            {lineCount === 0 ? "No lines yet" : `${lineCount} active`}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={openBuyModal}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-[var(--electric-glow)] transition-[opacity,transform] hover:bg-primary/90"
      >
        <Plus className="h-4 w-4" aria-hidden />
        + Add business number
      </button>

      <nav className="mt-5 flex flex-col gap-1" aria-label="Number shortcuts">
        <button
          type="button"
          onClick={openManageModal}
          className="group flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
        >
          <span>Lines & numbers</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
        </button>
        <button
          type="button"
          onClick={openBuyModal}
          className="group flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
        >
          <span>Buy / manage numbers</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
        </button>
      </nav>
    </aside>
  )
})
