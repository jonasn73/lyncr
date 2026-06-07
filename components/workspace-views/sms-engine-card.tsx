"use client"

import { MessageSquare } from "lucide-react"
import { WorkspacePanel } from "@/components/dashboard-workspace-ui"

/** Legacy embedded card — settings now opens SMS automation via modal. */
export function SmsEngineCard() {
  return (
    <WorkspacePanel className="p-6 sm:p-8">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10">
          <MessageSquare className="h-5 w-5 text-emerald-300" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Lyncr Automated SMS Engine</p>
          <p className="mt-1 text-xs text-zinc-500">Open Settings → SMS automation engine to configure templates.</p>
        </div>
      </div>
    </WorkspacePanel>
  )
}
