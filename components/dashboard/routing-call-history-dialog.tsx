"use client"

import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, PhoneIncoming, PhoneMissed, PhoneOutgoing, Voicemail } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { businessNumbersMatch } from "@/lib/dashboard-routing-utils"
import type { DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"

export type CallHistoryFilter = "daily" | "missed"

type CallHistoryRow = {
  id: string
  call_type: string
  from_number: string
  to_number: string
  created_at: string
  duration_seconds: number
  recording_url: string | null
  status: string
}

function formatPhoneDisplay(num: string): string {
  const d = num.replace(/\D/g, "")
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return num || "Unknown"
}

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m === 0) return `${r}s`
  return `${m}m ${r.toString().padStart(2, "0")}s`
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  if (sameDay) return `Today, ${time}`
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`
}

function isToday(iso: string): boolean {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

function isMissedRow(row: CallHistoryRow): boolean {
  const type = row.call_type.toLowerCase()
  const status = row.status.toLowerCase()
  return (
    type === "missed" ||
    type === "voicemail" ||
    status.includes("no-answer") ||
    status.includes("busy") ||
    status.includes("missed") ||
    status.includes("canceled") ||
    status.includes("cancelled")
  )
}

function DirectionIcon({ callType }: { callType: string }) {
  const t = callType.toLowerCase()
  if (t === "outgoing") return <PhoneOutgoing className="h-4 w-4 shrink-0 text-teal-400" aria-hidden />
  if (t === "missed") return <PhoneMissed className="h-4 w-4 shrink-0 text-amber-400" aria-hidden />
  if (t === "voicemail") return <Voicemail className="h-4 w-4 shrink-0 text-violet-400" aria-hidden />
  return <PhoneIncoming className="h-4 w-4 shrink-0 text-cyan-400" aria-hidden />
}

export const RoutingCallHistoryDialog = memo(function RoutingCallHistoryDialog({
  open,
  onOpenChange,
  filter,
  businessNumbers,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  filter: CallHistoryFilter
  businessNumbers: DashboardBusinessNumber[]
}) {
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<CallHistoryRow[]>([])
  const [error, setError] = useState<string | null>(null)

  const loadCalls = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/calls?limit=120", { credentials: "include", cache: "no-store" })
      if (!res.ok) throw new Error("Could not load call history")
      const json = (await res.json()) as { calls?: CallHistoryRow[] }
      setRows(Array.isArray(json.calls) ? json.calls : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load calls")
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) void loadCalls()
  }, [open, loadCalls])

  const filtered = useMemo(() => {
    return rows
      .filter((row) => {
        if (!isToday(row.created_at)) return false
        if (businessNumbers.length > 0) {
          const matchesWorkspaceLine = businessNumbers.some((line) =>
            businessNumbersMatch(row.to_number, line.number)
          )
          if (!matchesWorkspaceLine) return false
        }
        if (filter === "missed") return isMissedRow(row)
        return true
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }, [rows, filter, businessNumbers])

  const title = filter === "missed" ? "Missed calls today" : "Call history today"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(85vh,720px)] overflow-hidden border-zinc-800 bg-zinc-950 p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-zinc-800 px-5 py-4">
          <DialogTitle className="text-base text-zinc-50">{title}</DialogTitle>
          <DialogDescription className="text-zinc-400">
            {filter === "missed"
              ? "Inbound calls you missed today on this workspace."
              : "Every call logged today for this workspace."}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[min(60vh,520px)] overflow-y-auto px-3 py-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Loading calls…
            </div>
          ) : error ? (
            <p className="py-8 text-center text-sm text-red-400">{error}</p>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500">No calls to show for today.</p>
          ) : (
            <ul className="space-y-2">
              {filtered.map((call) => (
                <li
                  key={call.id}
                  className="rounded-xl border border-zinc-800/80 bg-zinc-900/50 px-3 py-3"
                >
                  <div className="flex items-start gap-3">
                    <DirectionIcon callType={call.call_type} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                        <p className="truncate text-sm font-medium text-zinc-100">
                          {formatPhoneDisplay(call.from_number)}
                        </p>
                        <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                          {formatDuration(call.duration_seconds)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-zinc-500">{formatTimestamp(call.created_at)}</p>
                      {call.recording_url ? (
                        <audio
                          src={call.recording_url}
                          controls
                          preload="none"
                          className="mt-2 h-8 w-full accent-cyan-400 opacity-80"
                        />
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-zinc-800 px-5 py-2 text-center text-[11px] text-zinc-600">
          {filtered.length} call{filtered.length === 1 ? "" : "s"} · refreshes when opened
        </div>
      </DialogContent>
    </Dialog>
  )
})
