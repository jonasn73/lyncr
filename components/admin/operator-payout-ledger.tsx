"use client"

// Receptionist audit + payout ledger. Tracks minutes used, average answer speed, and a live
// accrued payout balance (minutes × rate). "Mark Paid" logs a balance-reset transaction.

import { useCallback, useEffect, useState } from "react"
import { Loader2, RefreshCw, Wallet } from "lucide-react"
import { toast } from "sonner"
import type { OperatorPayoutRow } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount)
}

function answerSpeed(ms: number | null): string {
  if (ms == null) return "—"
  return `${(ms / 1000).toFixed(1)}s`
}

export function OperatorPayoutLedger() {
  const [rows, setRows] = useState<OperatorPayoutRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [payingId, setPayingId] = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true)
    try {
      const res = await fetch("/api/admin/operators", { credentials: "include", cache: "no-store" })
      const json = (await res.json().catch(() => ({}))) as { data?: { operators: OperatorPayoutRow[] }; error?: string }
      if (!res.ok) throw new Error(json.error ?? "Failed to load operators")
      setRows(json.data?.operators ?? [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load operators")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function markPaid(row: OperatorPayoutRow) {
    setPayingId(row.receptionist_id)
    try {
      const res = await fetch("/api/admin/operators/payout", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receptionistId: row.receptionist_id }),
      })
      const json = (await res.json().catch(() => ({}))) as { data?: { paid_usd: number }; error?: string }
      if (!res.ok) throw new Error(json.error ?? "Payout failed")
      toast.success(`Paid ${formatUsd(json.data?.paid_usd ?? row.accrued_usd)} to ${row.name} — balance reset`)
      await load(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Payout failed")
    } finally {
      setPayingId(null)
    }
  }

  const totalAccrued = rows.reduce((sum, r) => sum + r.accrued_usd, 0)

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Operator payouts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Talk-time, answer speed, and accrued balances across every network agent.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-border text-foreground"
          disabled={refreshing}
          onClick={() => void load(true)}
        >
          <RefreshCw className={refreshing ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} aria-hidden />
          Refresh
        </Button>
      </div>

      <Card className="border-operator/30 bg-gradient-to-br from-operator/40 via-card/70 to-background/80">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-operator">Total outstanding payout balance</CardTitle>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-operator/25 ring-1 ring-operator/40">
            <Wallet className="h-4 w-4 text-operator" aria-hidden />
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold tabular-nums tracking-tight text-foreground">{formatUsd(totalAccrued)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Sum of all unpaid accrued balances.</p>
        </CardContent>
      </Card>

      <Card className="border-border bg-card/40">
        <CardHeader className="border-b border-border/80 pb-4">
          <CardTitle className="text-lg text-foreground">Talk-time ledger</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {loading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-operator" aria-hidden /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No receptionists yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-muted-foreground">Agent</TableHead>
                  <TableHead className="text-right text-muted-foreground">Calls</TableHead>
                  <TableHead className="text-right text-muted-foreground">Minutes</TableHead>
                  <TableHead className="text-right text-muted-foreground">Avg answer</TableHead>
                  <TableHead className="text-right text-muted-foreground">Rate/min</TableHead>
                  <TableHead className="text-right text-muted-foreground">Earned</TableHead>
                  <TableHead className="text-right text-muted-foreground">Paid</TableHead>
                  <TableHead className="text-right text-muted-foreground">Accrued</TableHead>
                  <TableHead className="text-right text-muted-foreground">Payout</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.receptionist_id} className="border-border hover:bg-muted/30">
                    <TableCell>
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="font-medium text-foreground">{r.name}</span>
                        <div className="flex flex-wrap items-center gap-1">
                          {r.is_network_agent ? (
                            <Badge variant="outline" className="border-operator/40 bg-operator/15 text-2xs text-operator">
                              Network
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-border bg-muted/60 text-2xs text-foreground">
                              Business
                            </Badge>
                          )}
                          {!r.is_active && (
                            <Badge variant="outline" className="border-border bg-card text-2xs text-muted-foreground">
                              Inactive
                            </Badge>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-foreground">{r.total_calls}</TableCell>
                    <TableCell className="text-right tabular-nums text-foreground">{r.total_minutes.toFixed(1)}</TableCell>
                    <TableCell className="text-right tabular-nums text-foreground">{answerSpeed(r.avg_answer_ms)}</TableCell>
                    <TableCell className="text-right tabular-nums text-foreground">{formatUsd(r.rate_per_minute)}</TableCell>
                    <TableCell className="text-right tabular-nums text-foreground">{formatUsd(r.earned_usd)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatUsd(r.paid_usd)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-success">
                      {formatUsd(r.accrued_usd)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        size="sm"
                        className="bg-success text-success-foreground hover:bg-success disabled:opacity-40"
                        disabled={payingId === r.receptionist_id || r.accrued_usd <= 0}
                        onClick={() => void markPaid(r)}
                      >
                        {payingId === r.receptionist_id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : (
                          "Mark Paid"
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
