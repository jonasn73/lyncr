"use client"

import { memo } from "react"
import { ChevronRight, Hash, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { useDashboardNumbersModal } from "@/components/dashboard-numbers-modal-context"
import { useDashboardActivationOptional } from "@/components/dashboard-activation-context"
import { LineRoutingStatus } from "@/components/line-routing-status"
import type { RoutingStrategy } from "@/lib/types"

export const DashboardRoutingSidebar = memo(function DashboardRoutingSidebar({
  lineCount,
  activeLineDisplay,
  routingStrategy,
  className,
}: {
  lineCount: number
  // Formatted active business number (e.g. "(502) 555-1219") — null when no lines exist yet.
  activeLineDisplay: string | null
  // Drives the "Routing to Pool" status + the violet accent on the active-line card.
  routingStrategy: RoutingStrategy
  className?: string
}) {
  const { openBuyModal, openManageModal } = useDashboardNumbersModal()
  const activation = useDashboardActivationOptional()
  const subscriptionActive = activation?.subscriptionActive === true
  const lineCarrierLive = activation?.lineCarrierLive === true
  const poolRouting = routingStrategy === "lyncr_only"

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

      {activeLineDisplay ? (
        <div
          className={cn(
            "relative mt-4 rounded-xl border px-3 py-3 transition-colors",
            poolRouting
              ? "border-violet-500/45 bg-violet-500/5 ring-1 ring-violet-500/15"
              : "border-primary/40 bg-primary/5 ring-1 ring-primary/15"
          )}
        >
          <span
            className={cn(
              "text-[10px] font-bold uppercase tracking-wider",
              poolRouting ? "text-violet-300/85" : "text-primary/80"
            )}
          >
            Active line
          </span>
          <p className="mt-0.5 truncate text-sm font-semibold text-foreground">{activeLineDisplay}</p>
          <LineRoutingStatus
            routingStrategy={routingStrategy}
            subscriptionActive={subscriptionActive}
            lineCarrierLive={lineCarrierLive}
            className="mt-1"
          />

          {/* Connector → Call flow: tells the owner this line drives the rule chain on the right. */}
          <div
            aria-hidden
            className="pointer-events-none absolute right-0 top-1/2 hidden -translate-y-1/2 translate-x-full items-center pl-1 lg:flex"
          >
            <div
              className={cn(
                "h-[2px] w-9 rounded-full xl:w-12",
                poolRouting
                  ? "bg-gradient-to-r from-violet-500/20 via-violet-400 to-violet-300"
                  : "bg-gradient-to-r from-primary/20 via-primary to-primary"
              )}
              style={{ boxShadow: "var(--electric-glow)" }}
            />
            <div
              className={cn(
                "h-2 w-2 -translate-x-1 rotate-45 border-r-2 border-t-2",
                poolRouting
                  ? "border-violet-300 shadow-[0_0_10px_rgb(167_139_250)]"
                  : "border-primary shadow-[0_0_10px_var(--primary)]"
              )}
            />
          </div>
        </div>
      ) : null}

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
