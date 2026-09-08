// Shared health-status dot — was duplicated in finance-board.tsx and lyncr-admin-dashboard.tsx.

import { cn } from "@/lib/utils"

export type AdminHealthDotStatus = "ok" | "error" | "unconfigured"

export function HealthDot({ status }: { status: AdminHealthDotStatus }) {
  const color =
    status === "ok"
      ? "bg-success shadow-[0_0_8px_rgba(52,211,153,0.8)]"
      : status === "unconfigured"
        ? "bg-warning"
        : "bg-destructive shadow-[0_0_8px_rgba(239,68,68,0.7)]"
  const label = status === "ok" ? "Connected" : status === "unconfigured" ? "Not configured" : "Error"
  return (
    <span className="inline-flex items-center gap-2">
      <span className={cn("h-2.5 w-2.5 rounded-full", color)} aria-hidden />
      <span className="text-sm text-foreground">{label}</span>
    </span>
  )
}
