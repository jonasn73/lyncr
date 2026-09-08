// Shared progress/gauge bar — was an inline, non-reusable pattern duplicated between
// infra-cost-board.tsx's budget bar and its balance-vs-floor bar. Works for either
// direction: pass the tone that means "at risk" for your metric (spend approaching a
// budget fills toward destructive; balance approaching a floor does too, just computed
// from the other end — see infra-cost-board.tsx for both usages).

import { cn } from "@/lib/utils"

export type GaugeTone = "success" | "warning" | "destructive"

export function GaugeBar({ percent, tone, className }: { percent: number; tone: GaugeTone; className?: string }) {
  const pct = Math.max(0, Math.min(100, percent))
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div
        className={cn(
          "h-full rounded-full transition-all",
          tone === "destructive" ? "bg-destructive" : tone === "warning" ? "bg-warning" : "bg-success"
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
