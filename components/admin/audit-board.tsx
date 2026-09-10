"use client"

// Admin "Audit" — the full signup-through-every-action event feed, filterable by
// account and event type, so a stuck flow can be traced end to end.

import { useMemo, useState } from "react"
import { RefreshCw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { useAdminAuditEvents } from "@/hooks/use-admin-audit-events"

const EVENT_TYPES = [
  "auth.signup",
  "auth.login",
  "account.industry_changed",
  "onboarding.completed",
  "intake.job_created",
  "scheduler.job_scheduled",
  "job.tech_assigned",
  "job.outcome_recorded",
  "payment.collected",
  "payment.failed",
  "payment.refunded",
  "payout.recorded",
  "admin.impersonate_start",
  "admin.impersonate_stop",
  "admin.credit_adjusted",
  "admin.subscription_tier_changed",
  "admin.account_status_changed",
] as const

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

export function AuditBoard() {
  const { events, directory, filters, setFilters, loading, refreshing, refetch } = useAdminAuditEvents()
  const [accountQuery, setAccountQuery] = useState("")

  const accountById = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of directory) map.set(row.user_id, row.business_name || row.email)
    return map
  }, [directory])

  const accountMatches = useMemo(() => {
    const q = accountQuery.trim().toLowerCase()
    if (!q) return []
    return directory
      .filter((row) => row.business_name.toLowerCase().includes(q) || row.email.toLowerCase().includes(q))
      .slice(0, 8)
  }, [directory, accountQuery])

  const selectedAccountLabel = filters.ownerUserId ? accountById.get(filters.ownerUserId) ?? filters.ownerUserId : null
  const [entityIdQuery, setEntityIdQuery] = useState("")

  function showEntityTimeline(entityId: string) {
    setEntityIdQuery("")
    setFilters({ ...filters, entityId, eventType: null })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Audit</h1>
          <p className="text-sm text-muted-foreground">
            Every signup, login, intake, schedule, payment, and admin action — filter by account
            or event type to trace exactly what happened when something gets stuck.
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void refetch()}>
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          {selectedAccountLabel ? (
            <div className="flex h-9 items-center justify-between rounded-md border border-border bg-card px-3 text-sm">
              <span className="truncate text-foreground">{selectedAccountLabel}</span>
              <button
                type="button"
                onClick={() => {
                  setAccountQuery("")
                  setFilters({ ...filters, ownerUserId: null })
                }}
                className="ml-2 shrink-0 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <>
              <Input
                placeholder="Filter by business or email…"
                value={accountQuery}
                onChange={(e) => setAccountQuery(e.target.value)}
                className="h-9"
              />
              {accountMatches.length > 0 ? (
                <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-popover shadow-md">
                  {accountMatches.map((row) => (
                    <button
                      key={row.user_id}
                      type="button"
                      onClick={() => {
                        setFilters({ ...filters, ownerUserId: row.user_id })
                        setAccountQuery("")
                      }}
                      className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      {row.business_name || row.email}
                      <span className="ml-1 text-2xs text-muted-foreground">{row.email}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>

        <Select
          value={filters.eventType ?? "all"}
          onValueChange={(v) => setFilters({ ...filters, eventType: v === "all" ? null : v })}
        >
          <SelectTrigger className="h-9 w-56">
            <SelectValue placeholder="All event types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All event types</SelectItem>
            {EVENT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {filters.entityId ? (
          <div className="flex h-9 items-center justify-between rounded-md border border-border bg-card px-3 text-sm">
            <span className="truncate font-mono text-2xs text-foreground">Timeline: {filters.entityId}</span>
            <button
              type="button"
              onClick={() => setFilters({ ...filters, entityId: null })}
              className="ml-2 shrink-0 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <Input
            placeholder="Jump to entity id…"
            value={entityIdQuery}
            onChange={(e) => setEntityIdQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && entityIdQuery.trim()) showEntityTimeline(entityIdQuery.trim())
            }}
            className="h-9 w-56"
          />
        )}
      </div>

      {filters.entityId ? (
        <p className="text-sm text-muted-foreground">
          Showing every event recorded against entity <span className="font-mono text-2xs">{filters.entityId}</span> —
          the full history for one job/account/entity, in order.
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  Loading events…
                </TableCell>
              </TableRow>
            ) : events.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  No events match these filters.
                </TableCell>
              </TableRow>
            ) : (
              events.map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatTimestamp(event.created_at)}
                  </TableCell>
                  <TableCell className="max-w-[180px] truncate text-sm text-foreground">
                    {event.owner_user_id ? accountById.get(event.owner_user_id) ?? event.owner_user_id : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-2xs capitalize">
                      {event.actor_role.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-2xs text-foreground">{event.event_type}</TableCell>
                  <TableCell className="text-2xs">
                    {event.entity_id ? (
                      <button
                        type="button"
                        onClick={() => showEntityTimeline(event.entity_id!)}
                        className="font-mono text-muted-foreground underline decoration-dotted hover:text-foreground"
                        title="Show full timeline for this entity"
                      >
                        {event.entity_type ? `${event.entity_type}:` : ""}
                        {event.entity_id.length > 12 ? `${event.entity_id.slice(0, 8)}…` : event.entity_id}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[320px] truncate text-2xs text-muted-foreground">
                    {Object.keys(event.detail ?? {}).length > 0 ? JSON.stringify(event.detail) : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
