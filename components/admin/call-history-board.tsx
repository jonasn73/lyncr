"use client"

// Admin "Calls" — searchable call history across every tenant. Search matches caller or
// business number digits, shop name, and workspace name, so a call can still be traced to
// its caller after the line moved workspaces or was detached from all of them.

import { useCallback, useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import type { AdminCallHistoryRow } from "@/lib/types"

const PAGE_SIZE = 200
const SEARCH_DEBOUNCE_MS = 300

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

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "—"
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

export function CallHistoryBoard() {
  const [search, setSearch] = useState("")
  const [calls, setCalls] = useState<AdminCallHistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [settled, setSettled] = useState(false)

  const fetchCalls = useCallback(async (term: string, silent = false) => {
    if (silent) setRefreshing(true)
    else setLoading(true)
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
      if (term.trim()) params.set("search", term.trim())
      const res = await fetch(`/api/admin/call-history?${params.toString()}`, {
        credentials: "include",
        cache: "no-store",
      })
      const json = (await res.json()) as { error?: string; data?: { calls?: AdminCallHistoryRow[] } }
      if (!res.ok) throw new Error(json.error ?? "Failed to load call history")
      setCalls(json.data?.calls ?? [])
      setSettled(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load call history")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    const id = setTimeout(() => void fetchCalls(search), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [search, fetchCalls])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Calls</h1>
          <p className="text-sm text-muted-foreground">
            Every call across all shops — search a shop, workspace, or phone number to find the
            caller, even after the line was moved or removed from a workspace.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={refreshing}
          onClick={() => void fetchCalls(search, true)}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <Input
        placeholder="Search shop, workspace, or phone number…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-9 w-full sm:w-96"
      />

      <div className="overflow-x-auto rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Caller</TableHead>
              <TableHead>Business line</TableHead>
              <TableHead>Shop</TableHead>
              <TableHead>Workspace</TableHead>
              <TableHead>Direction</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Talk time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading || !settled ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  Loading calls…
                </TableCell>
              </TableRow>
            ) : calls.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  No calls match this search.
                </TableCell>
              </TableRow>
            ) : (
              calls.map((call) => (
                <TableRow key={call.id}>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatTimestamp(call.created_at)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-sm text-foreground">
                    {call.from_number || "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-2xs text-muted-foreground">
                    {call.to_number || "—"}
                  </TableCell>
                  <TableCell className="max-w-[180px] truncate text-sm text-foreground">
                    {call.business_name || "—"}
                  </TableCell>
                  <TableCell className="max-w-[180px] truncate text-sm text-muted-foreground">
                    {call.workspace_name ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-2xs capitalize">
                      {call.direction.replace(/_/g, " ") || "—"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-2xs capitalize text-muted-foreground">
                    {call.status || "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-2xs text-muted-foreground">
                    {formatDuration(call.duration_seconds)}
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
