"use client"

// Operator console: loads fleet stats, user rows, and feedback; only renders the sidebar-selected panel.

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
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
import { cn } from "@/lib/utils"
import { useAdminConsoleSection } from "@/components/admin-console-context"
import type { AdminUserSummary, FeedbackSubmission, FeedbackStatus } from "@/lib/types"

/** Numbers returned by GET /api/admin/overview (subset we display). */
type Overview = {
  user_count: number
  total_credit_balance_cents: number
  total_credit_balance_label: string
  open_feedback_count: number
}

/** Allowed feedback workflow states in the triage dropdown. */
const FEEDBACK_STATUSES: FeedbackStatus[] = ["open", "triaged", "closed"]

/** Shared card chrome so tables match the dark operator shell. */
const opCard = "border-slate-700/80 bg-slate-900/50 text-slate-200 shadow-sm"

export function AdminConsole() {
  const { toast } = useToast()
  const { section } = useAdminConsoleSection()
  const [overview, setOverview] = useState<Overview | null>(null)
  const [users, setUsers] = useState<AdminUserSummary[]>([])
  const [feedback, setFeedback] = useState<FeedbackSubmission[]>([])
  const [creditUserId, setCreditUserId] = useState<string | null>(null)
  const [creditUsd, setCreditUsd] = useState("")
  const [creditReason, setCreditReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [operatorBusyId, setOperatorBusyId] = useState<string | null>(null)

  /** Pulls all three admin endpoints in parallel and stores JSON bodies in state. */
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
    void reload()
  }, [reload])

  /** Sums 30-day call volume across the loaded user list for the overview strip. */
  const usageTotals = useMemo(() => {
    let calls = 0
    let secs = 0
    for (const u of users) {
      calls += u.calls_last_30_days
      secs += u.talk_seconds_last_30_days
    }
    return { calls, secs }
  }, [users])

  /** POSTs a ledger-backed credit delta for the selected account, then refreshes. */
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

  /** PATCHes is_platform_admin for another row and updates local state on success. */
  async function patchOperatorFlag(targetId: string, next: boolean) {
    setOperatorBusyId(targetId)
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(targetId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_platform_admin: next }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: "Operator flag failed", description: j?.error ?? res.statusText, variant: "destructive" })
        return
      }
      setUsers((prev) => prev.map((u) => (u.id === targetId ? { ...u, is_platform_admin: next } : u)))
      toast({ title: next ? "Granted operator access" : "Revoked operator access" })
    } finally {
      setOperatorBusyId(null)
    }
  }

  /** Updates a feedback row status via PATCH then reloads the queue. */
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
      {section === "overview" && (
        <>
          <header>
            <h1 className="text-xl font-semibold text-slate-100">Fleet overview</h1>
            <p className="mt-1 text-sm text-slate-400">
              High-level counts from the database. Use Users for per-account balances and operator flags.
            </p>
          </header>
          {overview && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card className={opCard}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-slate-400">Accounts</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-semibold tabular-nums text-slate-50">{overview.user_count}</CardContent>
              </Card>
              <Card className={opCard}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-slate-400">Total prepaid balance</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-semibold tabular-nums text-violet-200">
                  {overview.total_credit_balance_label}
                </CardContent>
              </Card>
              <Card className={opCard}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-slate-400">Calls (30d, all users)</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-semibold tabular-nums text-slate-50">{usageTotals.calls}</CardContent>
              </Card>
              <Card className={opCard}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-slate-400">Talk seconds (30d)</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-semibold tabular-nums text-slate-50">{usageTotals.secs}</CardContent>
              </Card>
            </div>
          )}
          <Card className={opCard}>
            <CardHeader>
              <CardTitle className="text-base text-slate-100">Open feedback</CardTitle>
              <CardDescription className="text-slate-400">
                {overview != null ? `${overview.open_feedback_count} open items.` : "Loading…"} Switch to Support for triage.
              </CardDescription>
            </CardHeader>
          </Card>
        </>
      )}

      {section === "users" && (
        <>
          <header>
            <h1 className="text-xl font-semibold text-slate-100">Users &amp; usage</h1>
            <p className="mt-1 text-sm text-slate-400">
              Last 30 days call count and talk time from call_logs. Credit adjusts the prepaid ledger; Operator toggles
              platform admin (this console).
            </p>
          </header>

          <Card className={opCard}>
            <CardHeader>
              <CardTitle className="text-base text-slate-100">Accounts</CardTitle>
              <CardDescription className="text-slate-400">Sorted by account creation (newest first).</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700 hover:bg-transparent">
                    <TableHead className="text-slate-300">Email</TableHead>
                    <TableHead className="text-slate-300">Plan</TableHead>
                    <TableHead className="text-right text-slate-300">Balance</TableHead>
                    <TableHead className="text-right text-slate-300">Calls 30d</TableHead>
                    <TableHead className="text-right text-slate-300">Talk sec</TableHead>
                    <TableHead className="text-slate-300">Operator</TableHead>
                    <TableHead className="w-[100px] text-slate-300" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id} className="border-slate-800">
                      <TableCell className="max-w-[200px] truncate text-sm text-slate-200">{u.email}</TableCell>
                      <TableCell className="text-sm capitalize text-slate-300">{u.billing_plan}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums text-slate-200">
                        {(u.credit_balance_cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" })}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums text-slate-300">{u.calls_last_30_days}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums text-slate-300">{u.talk_seconds_last_30_days}</TableCell>
                      <TableCell>
                        <Switch
                          checked={u.is_platform_admin}
                          disabled={operatorBusyId === u.id}
                          onCheckedChange={(v) => void patchOperatorFlag(u.id, v)}
                          aria-label={`Operator access for ${u.email}`}
                          className="data-[state=checked]:bg-violet-600"
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="border-slate-600 text-slate-200 hover:bg-slate-800"
                          onClick={() => setCreditUserId(u.id)}
                        >
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
            <Card className={cn(opCard, "border-violet-500/40 ring-1 ring-violet-500/20")}>
              <CardHeader>
                <CardTitle className="text-base text-slate-100">Adjust balance</CardTitle>
                <CardDescription className="text-slate-400">
                  Positive dollars add credit; negative subtracts (e.g. -5 debits five dollars). Reason is stored on the
                  ledger.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-2">
                  <Label htmlFor="usd" className="text-slate-300">
                    Amount (USD)
                  </Label>
                  <Input
                    id="usd"
                    inputMode="decimal"
                    value={creditUsd}
                    onChange={(e) => setCreditUsd(e.target.value)}
                    placeholder="10.00"
                    className="border-slate-600 bg-slate-950/80 text-slate-100"
                  />
                </div>
                <div className="flex-[2] space-y-2">
                  <Label htmlFor="why" className="text-slate-300">
                    Reason (shown in ledger)
                  </Label>
                  <Input
                    id="why"
                    value={creditReason}
                    onChange={(e) => setCreditReason(e.target.value)}
                    placeholder="Manual goodwill credit — ticket #123"
                    className="border-slate-600 bg-slate-950/80 text-slate-100"
                  />
                </div>
                <Button type="button" disabled={busy} onClick={() => void applyCredit(creditUserId)}>
                  Apply
                </Button>
                <Button type="button" variant="ghost" className="text-slate-300 hover:bg-slate-800" onClick={() => setCreditUserId(null)}>
                  Cancel
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {section === "support" && (
        <>
          <header>
            <h1 className="text-xl font-semibold text-slate-100">Support queue</h1>
            <p className="mt-1 text-sm text-slate-400">Newest first. Status is stored on feedback_submissions.</p>
          </header>
          <Card className={opCard}>
            <CardHeader>
              <CardTitle className="text-base text-slate-100">Feedback</CardTitle>
              <CardDescription className="text-slate-400">Requires billing migration 019 if the table is empty after submissions.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {feedback.length === 0 && <p className="text-sm text-slate-400">No rows (or table not migrated yet).</p>}
              {feedback.map((row) => (
                <div key={row.id} className="rounded-xl border border-slate-700/80 bg-slate-950/40 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-medium uppercase text-slate-500">{row.category}</span>
                    <Select value={row.status} onValueChange={(v) => void setFeedbackStatus(row.id, v as FeedbackStatus)}>
                      <SelectTrigger className="h-8 w-[130px] border-slate-600 bg-slate-900 text-xs text-slate-200">
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
                  <p className="mt-2 text-sm font-medium text-slate-100">{row.subject}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-400">{row.body}</p>
                  <p className="mt-2 text-xs text-slate-500">
                    {new Date(row.created_at).toLocaleString()} · id {row.id}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}

      {section === "advanced" && (
        <>
          <header>
            <h1 className="text-xl font-semibold text-slate-100">Advanced</h1>
            <p className="mt-1 text-sm text-slate-400">
              Environment-driven access and database operations live outside this UI.
            </p>
          </header>
          <Card className={opCard}>
            <CardHeader>
              <CardTitle className="text-base text-slate-100">Operator access</CardTitle>
              <CardDescription className="text-slate-400">
                Bootstrap: set <code className="rounded bg-slate-950 px-1 py-0.5 text-violet-200">ZING_ADMIN_EMAILS</code>{" "}
                (comma-separated) so matching users receive <code className="rounded bg-slate-950 px-1 text-violet-200">is_platform_admin</code>{" "}
                on sign-in. After that, use the Users tab to grant or revoke others.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-300">
              <p>
                Database repairs and new columns: follow the numbered scripts listed in{" "}
                <code className="rounded bg-slate-950 px-1 text-violet-200">scripts/MIGRATE-ALL.md</code> and run them in the Neon SQL Editor.
              </p>
              <p>
                Member-facing help and contact:{" "}
                <Link href="/support" className="font-medium text-violet-300 underline-offset-2 hover:underline">
                  /support
                </Link>
              </p>
            </CardContent>
          </Card>
        </>
      )}

      <Button type="button" variant="secondary" className="w-fit border-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700" onClick={() => void reload()}>
        Refresh data
      </Button>
    </div>
  )
}
