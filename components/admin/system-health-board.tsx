"use client"

// Admin "System Health" — Neon/Telnyx up-down status, plus whether each Telnyx webhook
// route's signature verification is enforced or still warn-only, and its recent failure
// history. Was previously alert-only: an SMS/email at the moment something went wrong, with
// no visible record afterward. This is that record.

import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  useAdminSystemHealth,
  type PlatformCheckStatus,
  type WebhookRouteHealth,
} from "@/hooks/use-admin-system-health"

/** True when `iso` is within the last 24 hours. Named function, not inlined — Date.now() is
 * impure, and calling it directly in a component body trips react-hooks/purity. */
function isWithinLast24Hours(iso: string | null): boolean {
  if (!iso) return false
  return Date.now() - new Date(iso).getTime() < 24 * 60 * 60 * 1000
}

function relativeTime(iso: string | null): string {
  if (!iso) return "never"
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diffMs / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function StatusBadge({ status }: { status: PlatformCheckStatus["status"] }) {
  if (status === "ok") return <Badge className="bg-success text-success-foreground border-transparent">OK</Badge>
  if (status === "error") return <Badge variant="destructive">Error</Badge>
  if (status === "unconfigured") return <Badge variant="outline">Unconfigured</Badge>
  return <Badge variant="outline">Unknown</Badge>
}

function PlatformCheckCard({ title, check }: { title: string; check: PlatformCheckStatus }) {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <StatusBadge status={check.status} />
      </div>
      <p className="mt-2 text-2xs text-muted-foreground">
        {check.status === "error"
          ? `Down since ${relativeTime(check.last_error_at)}`
          : `Last checked ${relativeTime(check.last_ok_at ?? check.last_error_at)}`}
      </p>
    </div>
  )
}

function WebhookRouteRow({ route }: { route: WebhookRouteHealth }) {
  const neverFailed = !route.last_event_at
  const recentFailure = isWithinLast24Hours(route.last_event_at)

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/40 px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{route.route_label}</p>
        <p className="text-2xs text-muted-foreground">
          {neverFailed
            ? "No signature failures recorded."
            : `Last failure ${relativeTime(route.last_event_at)}${
                route.event_count_since_last_alert > 0
                  ? ` — ${route.event_count_since_last_alert}x since last page`
                  : ""
              }`}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {recentFailure ? <Badge variant="destructive">Recent failure</Badge> : null}
        <Badge variant={route.enforced ? "default" : "outline"}>{route.enforced ? "Enforced" : "Warn-only"}</Badge>
      </div>
    </div>
  )
}

export function SystemHealthBoard() {
  const { data, loading, refreshing, refetch } = useAdminSystemHealth()

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">System Health</h2>
          <p className="text-sm text-muted-foreground">
            Database + carrier API status, and Telnyx webhook signature verification.
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void refetch()}>
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {loading || !data ? (
        <div className="rounded-xl border border-border bg-card/40 p-8 text-center text-sm text-muted-foreground">
          Loading system health…
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <PlatformCheckCard title="Neon (database)" check={data.neon} />
            <PlatformCheckCard title="Telnyx (carrier API)" check={data.telnyx} />
          </div>
          <div className="space-y-2">
            <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              Telnyx webhook signatures
            </p>
            {data.webhook_routes.map((route) => (
              <WebhookRouteRow key={route.route_label} route={route} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
