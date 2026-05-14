"use client"

// ============================================
// Operator console (client)
// ============================================

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import type { AdminUserSummary, FeedbackSubmission, FeedbackStatus } from "@/lib/types"

type Overview = {
  user_count: number
  total_credit_balance_cents: number
  total_credit_balance_label: string
  open_feedback_count: number
}

const FEEDBACK_STATUSES: FeedbackStatus[] = ["open", "triaged", "closed"]

export function AdminConsole() {
  const { toast } = useToast()
  const [overview, setOverview] = useState<Overview | null>(null)
  const [users, setUsers] = useState<AdminUserSummary[]>([])
  const [feedback, setFeedback] = useState<FeedbackSubmission[]>([])
  const [creditUserId, setCreditUserId] = useState<string | null>(null)
  const [creditUsd, setCreditUsd] = useState("")
  const [creditReason, setCreditReason] = useState("")
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    const [o, u, f] = await Promise.all([
      fetch("/api/admin/overview", { credentials: "include" }).then((r) => r.json()),
      fetch("/api/admin/users?limit=200", { credentials: "include" }).then((r) => r.json()),
      fetch("/api/admin/feedback?limit=100", { credentials: "include" }).then((r) => r.json()),
    ])
    if (o?.data) setOverview(o.data as Overview)
    if (u?.data?.users) setUsers(u.data.users as AdminUserSummary[])
    if (f?.data?.items) setFeedback(f.data.items as FeedbackSubmission[])
  }, [])

  useEffect(() => {
    reload().catch(() => {})
  }, [reload])

  async function applyCredit(targetId: string) {
    const dollars = Number(creditUsd)
    if (!Number.isFinite(dollars) || dollars === 0) {
      toast({ title: "Enter a non-zero dollar amount", variant: "destructive" })
      return
    }
    const deltaCents = Math.round(dollars * 100)
    const reason = creditReason.trim()
    if (reason.length < 3) {
      toast({ title: "Reason required (min 3 characters)", variant: "destructive" })
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(targetId)}/credit`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delta_cents: deltaCents, reason }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: "Credit failed", description: j?.error ?? res.statusText, variant: "destructive" })
        return
      }
      toast({ title: "Balance updated", description: `New balance (cents): ${j?.data?.balance_after_cents}` })
      setCreditUserId(null)
      setCreditUsd("")
      setCreditReason("")
      await reload()
    } finally {
      setBusy(false)
    }
  }

  async function setFeedbackStatus(id: string, status: FeedbackStatus) {
    const res = await fetch(`/api/admin/feedback/${encodeURIComponent(id)}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    if (!res.ok) {
      toast({ title: "Update failed", variant: "destructive" })
      return
    }
    await reload()
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Usage & billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Account list, prepaid balances, and feedback triage. Credit adjustments are written to the ledger.
        </p>
      </div>

      {overview && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Accounts</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold tabular-nums">{overview.user_count}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total prepaid balance</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold tabular-nums">{overview.total_credit_balance_label}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Open feedback</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold tabular-nums">{overview.open_feedback_count}</CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Accounts</CardTitle>
          <CardDescription>Last 30 days call count and talk seconds from `call_logs`.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-right">Calls 30d</TableHead>
                <TableHead className="text-right">Talk sec 30d</TableHead>
                <TableHead className="w-[120px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="max-w-[200px] truncate text-sm">{u.email}</TableCell>
                  <TableCell className="text-sm capitalize">{u.billing_plan}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {(u.credit_balance_cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" })}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{u.calls_last_30_days}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{u.talk_seconds_last_30_days}</TableCell>
                  <TableCell>
                    <Button type="button" variant="outline" size="sm" onClick={() => setCreditUserId(u.id)}>
                      Credit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {creditUserId && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-base">Adjust balance</CardTitle>
            <CardDescription>Use positive dollars to add credit, negative to subtract (e.g. -5 for a $5 debit).</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="usd">Amount (USD)</Label>
              <Input
                id="usd"
                inputMode="decimal"
                value={creditUsd}
                onChange={(e) => setCreditUsd(e.target.value)}
                placeholder="10.00"
              />
            </div>
            <div className="flex-[2] space-y-2">
              <Label htmlFor="why">Reason (shown in ledger)</Label>
              <Input
                id="why"
                value={creditReason}
                onChange={(e) => setCreditReason(e.target.value)}
                placeholder="Manual goodwill credit — ticket #123"
              />
            </div>
            <Button type="button" disabled={busy} onClick={() => applyCredit(creditUserId)}>
              Apply
            </Button>
            <Button type="button" variant="ghost" onClick={() => setCreditUserId(null)}>
              Cancel
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Feedback queue</CardTitle>
          <CardDescription>Newest first. Status helps your team track triage.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {feedback.length === 0 && <p className="text-sm text-muted-foreground">No rows (or table not migrated yet).</p>}
          {feedback.map((row) => (
            <div key={row.id} className="rounded-xl border border-border/70 bg-card/80 p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium uppercase text-muted-foreground">{row.category}</span>
                <Select value={row.status} onValueChange={(v) => setFeedbackStatus(row.id, v as FeedbackStatus)}>
                  <SelectTrigger className="h-8 w-[130px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FEEDBACK_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="mt-2 text-sm font-medium text-foreground">{row.subject}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{row.body}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {new Date(row.created_at).toLocaleString()} · id {row.id}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Button type="button" variant="secondary" onClick={() => reload()}>
        Refresh
      </Button>
    </div>
  )
}
