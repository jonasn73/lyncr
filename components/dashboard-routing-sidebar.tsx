"use client"

import { memo } from "react"
import { ChevronRight, Hash, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { useDashboardNumbersModal } from "@/components/dashboard-numbers-modal-context"
import { useDashboardActivationOptional } from "@/components/dashboard-activation-context"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import {
  PhoneLinesList,
  phoneLinesHasLines,
  phoneLinesSubtitle,
} from "@/components/dashboard/phone-lines-list"
import type { RoutingStrategy } from "@/lib/types"

export const DashboardRoutingSidebar = memo(function DashboardRoutingSidebar({
  activeLineDisplay,
  routingStrategy,
  className,
  onConfigureRouting,
}: {
  activeLineDisplay: string | null
  routingStrategy: RoutingStrategy
  className?: string
  onConfigureRouting?: () => void
}) {
  const { openBuyModal, openManageModal } = useDashboardNumbersModal()
  const { businessNumbers, businessNumbersLoading } = useDashboardWorkspace()
  const activation = useDashboardActivationOptional()
  const subscriptionActive = activation?.subscriptionActive === true
  const lineCarrierLive = activation?.lineCarrierLive === true

  const hasLines = phoneLinesHasLines(businessNumbers, activeLineDisplay)
  const showEmptyState = !businessNumbersLoading && !hasLines
  const subtitle = phoneLinesSubtitle(businessNumbers, businessNumbersLoading)

  return (
    <>
      <aside
        className={cn(
          "w-full shrink-0 lg:w-56 xl:w-60",
          "rounded-2xl border border-white/8 bg-neutral-950/50 p-4 shadow-sm ring-1 ring-white/5 backdrop-blur-md",
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
            <p className="text-[11px] text-muted-foreground">{subtitle}</p>
          </div>
        </div>

        <PhoneLinesList
          routingStrategy={routingStrategy}
          activeLineDisplay={activeLineDisplay}
          onConfigureRouting={onConfigureRouting}
          subscriptionActive={subscriptionActive}
          lineCarrierLive={lineCarrierLive}
        />

        {showEmptyState ? (
          <button
            type="button"
            onClick={openBuyModal}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-[var(--electric-glow)] transition-[opacity,transform] hover:bg-primary/90 motion-safe:active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add business number
          </button>
        ) : null}

        <nav className="mt-5 flex flex-col gap-1" aria-label="Number shortcuts">
          <button
            type="button"
            onClick={openManageModal}
            className="group flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-white/5"
          >
            <span>Lines & numbers</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
          </button>
          <button
            type="button"
            onClick={openBuyModal}
            className="group flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-white/5"
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span>Buy / manage numbers</span>
              {hasLines && !businessNumbersLoading ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-primary/25 bg-primary/5 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  <Plus className="h-3 w-3" aria-hidden />
                  Add
                </span>
              ) : null}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
          </button>
        </nav>
      </aside>
    </>
  )
})
