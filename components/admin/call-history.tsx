"use client"

// Historical call log — most recent 50 calls across every tenant. Lives directly below the Live
// Traffic Pulse on the platform-admin dashboard. Auto-refreshes and offers a manual "Refresh Logs".

import { useCallback, useEffect, useRef, useState } from "react"
import { Copy, History, Loader2, PhoneIncoming, PhoneForwarded, PhoneMissed, Voicemail, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import type { AdminCallHistoryRow } from "@/lib/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

const POLL_MS = 60_000 // slower than live traffic so Home doesn’t double-hammer Neon

/** Readable local timestamp, e.g. "Jun 4, 7:02 PM". */
function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

/** mm:ss for a duration in seconds. */
function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return "0:00"
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

function DirectionCell({ direction }: { direction: string }) {
  const d = direction.toLowerCase()
  const map: Record<string, { label: string; icon: typeof PhoneIncoming; className: string }> = {
    incoming: { label: "Inbound", icon: PhoneIncoming, className: "text-info" },
    outgoing: { label: "Outbound Forwarded", icon: PhoneForwarded, className: "text-operator" },
    missed: { label: "Missed", icon: PhoneMissed, className: "text-warning" },
    voicemail: { label: "Voicemail", icon: Voicemail, className: "text-foreground" },
  }
  const entry = map[d] ?? { label: direction || "—", icon: PhoneIncoming, className: "text-foreground" }
  const Icon = entry.icon
  return (
    <span className={cn("inline-flex items-center gap-2 text-xs font-medium", entry.className)}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {entry.label}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase().replace(/_/g, "-")
  const label =
    s === "completed"
      ? "Completed"
      : s === "no-answer"
        ? "No Answer"
        : s === "busy"
          ? "Busy"
          : s === "failed"
            ? "Failed"
            : s === "in-progress" || s === "answered"
              ? "In Progress"
              : s === "missed"
                ? "Missed"
                : s === "voicemail"
                  ? "Voicemail"
                  : status || "—"
  const className =
    s === "completed"
      ? "bg-success/15 text-success"
      : s === "no-answer" || s === "busy" || s === "missed"
        ? "bg-warning/15 text-warning"
        : s === "failed" || s === "canceled" || s === "cancelled"
          ? "bg-destructive/15 text-destructive"
          : s === "in-progress" || s === "answered"
            ? "bg-info/15 text-info"
            : "bg-accent/50 text-muted-foreground"
  return <span className={cn("rounded-full px-2 py-0.5 text-2xs font-medium", className)}>{label}</span>
}

function shortUuid(uuid: string): string {
  const s = uuid.trim()
  if (!s) return "—"
  if (s.length <= 12) return s
  return `${s.slice(0, 8)}…${s.slice(-4)}`
}

function UuidCell({ uuid }: { uuid: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    if (!uuid) return
    try {
      await navigator.clipboard.writeText(uuid)
      setCopied(true)
      toast.success("UUID Copied to Clipboard!")
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Could not copy to clipboard")
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <code className="truncate font-mono text-xs text-muted-foreground" title={uuid || undefined}>
        {shortUuid(uuid)}
      </code>
      {uuid ? (
        <button
          type="button"
          onClick={() => void handleCopy()}
          className={cn(
            "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/80 bg-background/60 text-muted-foreground transition-colors",
            "hover:border-operator/40 hover:bg-operator/40 hover:text-operator",
            copied && "border-success/40 text-success"
          )}
          aria-label="Copy call UUID"
          title="Copy full call UUID"
        >
          <Copy className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  )
}

export function CallHistoryTable() {
  const [calls, setCalls] = useState<AdminCallHistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const mounted = useRef(true)

  const fetchHistory = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true)
    try {
      const res = await fetch("/api/admin/call-history", { credentials: "include", cache: "no-store" })
      const json = (await res.json().catch(() => ({}))) as { data?: { calls?: AdminCallHistoryRow[] } }
      if (mounted.current && Array.isArray(json?.data?.calls)) setCalls(json.data!.calls!)
    } catch {
      /* keep last snapshot */
    } finally {
      if (mounted.current) {
        setLoading(false)
        if (manual) setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void fetchHistory()
    const poll = setInterval(() => void fetchHistory(), POLL_MS)
    return () => {
      mounted.current = false
      clearInterval(poll)
    }
  }, [fetchHistory])

  return (
    <Card className="border-border bg-card/60 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.6)] backdrop-blur-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-foreground">
          <History className="h-4 w-4 text-operator" aria-hidden />
          Call History
          <span className="text-xs font-normal text-muted-foreground">last {calls.length}</span>
        </CardTitle>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-border text-foreground hover:bg-muted"
          disabled={refreshing}
          onClick={() => void fetchHistory(true)}
        >
          <RefreshCw className={cn("mr-2 h-4 w-4", refreshing && "animate-spin")} aria-hidden />
          Refresh Logs
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-operator" aria-hidden /> Loading call logs…
          </div>
        ) : calls.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <History className="h-7 w-7 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">No call records yet.</p>
          </div>
        ) : (
          <div className="max-h-[460px] overflow-auto rounded-lg border border-border/60">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-muted-foreground">Timestamp</TableHead>
                  <TableHead className="text-muted-foreground">Direction</TableHead>
                  <TableHead className="text-muted-foreground">Phone Routing</TableHead>
                  <TableHead className="text-muted-foreground">Duration</TableHead>
                  <TableHead className="text-muted-foreground">Status</TableHead>
                  <TableHead className="text-muted-foreground">Call UUID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calls.map((c) => (
                  <TableRow key={c.id} className="border-border hover:bg-muted/30">
                    <TableCell className="whitespace-nowrap text-sm text-foreground">
                      {formatTimestamp(c.created_at)}
                    </TableCell>
                    <TableCell>
                      <DirectionCell direction={c.direction} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-foreground">
                      <span className="text-foreground">{c.from_number || "Unknown"}</span>
                      <span className="mx-1.5 text-muted-foreground">→</span>
                      <span className="text-muted-foreground">{c.to_number || "Forwarded Leg"}</span>
                    </TableCell>
                    <TableCell className="font-mono text-sm tabular-nums text-foreground">
                      {formatDuration(c.duration_seconds)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={c.status} />
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      <UuidCell uuid={c.call_uuid} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
