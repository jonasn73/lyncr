"use client"

import { Network } from "lucide-react"
import { WorkspacePanel } from "@/components/dashboard-workspace-ui"
import { RoutingStrategyForm } from "@/components/routing-strategy-form"

/** Embedded card — prefer the settings menu row + modal in the dashboard. */
export function RoutingStrategyCard() {
  return (
    <WorkspacePanel className="p-6 sm:p-8">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-violet-500/30 bg-violet-500/10">
          <Network className="h-5 w-5 text-violet-300" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Call routing strategy</p>
          <p className="mt-1 text-xs text-zinc-500">Open Settings → Call routing strategy to edit.</p>
        </div>
      </div>
    </WorkspacePanel>
  )
}
