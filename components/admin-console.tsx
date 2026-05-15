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
  Sheet,
  SheetContent,
  SheetFooter,
} from "@/components/ui/sheet"
import { StorySheetHeader } from "@/components/story-sheet-header"
import { StoryPopoverInfo } from "@/components/story-popover-info"
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
import type { AdminUserDetail, AdminUserSummary, FeedbackSubmission, FeedbackStatus } from "@/lib/types"

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
  const [userSheetId, setUserSheetId] = useState<string | null>(null)
  const [userDetail, setUserDetail] = useState<AdminUserDetail | null>(null)
  const [userDetailLoading, setUserDetailLoading] = useState(false)
  const [feedbackSheet, setFeedbackSheet] = useState<FeedbackSubmission | null>(null)
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

  useEffect(() => {
    if (!userSheetId) {
      setUserDetail(null)
      return
    }
    let cancelled = false
    setUserDetailLoading(true)
    void fetch(`/api/admin/users/${encodeURIComponent(userSheetId)}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.resolve(null)))
      .then((j) => {
        if (!cancelled && j?.data) setUserDetail(j.data as AdminUserDetail)
      })
      .finally(() => {
        if (!cancelled) setUserDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [userSheetId])

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
      setCreditUsd("")
      setCreditReason("")
      await reload()
      if (userSheetId === targetId) {
        const res = await fetch(`/api/admin/users/${encodeURIComponent(targetId)}`, { credentials: "include" })
        const d = await res.json().catch(() => ({}))
        if (res.ok && d?.data) setUserDetail(d.data as AdminUserDetail)
      }
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
      setUserDetail((d) =>
        d && d.user.id === targetId ? { ...d, user: { ...d.user, is_platform_admin: next } } : d
      )
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
    setFeedbackSheet((prev) => (prev && prev.id === id ? { ...prev, status } : prev))
    await reload()
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6">
      {section === "overview" && (
        <>
          <header className="flex items-start justify-between gap-2">
            <div>
              <h1 className="text-xl font-semibold text-slate-100">Fleet overview</h1>
              <p className="mt-1 text-sm text-slate-400">
                High-level counts from the database. Use Users for per-account balances and operator flags.
              </p>
            </div>
            <StoryPopoverInfo
              storyKey="admin-overview-fleet"
              variant="operator"
              label="About fleet overview"
              triggerClassName="h-9 w-9"
            />
          </header>
          {overview && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card className={opCard}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm font-medium text-slate-400">Accounts</CardTitle>
                    <StoryPopoverInfo
                      storyKey="admin-metric-accounts"
                      variant="operator"
                      label="About accounts metric"
                      triggerClassName="h-7 w-7"
                    />
                  </div>
                </CardHeader>
                <CardContent className="text-2xl font-semibold tabular-nums text-slate-50">{overview.user_count}</CardContent>
              </Card>
              <Card className={opCard}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm font-medium text-slate-400">Total prepaid balance</CardTitle>
                    <StoryPopoverInfo
                      storyKey="admin-metric-prepaid-balance"
                      variant="operator"
                      label="About prepaid balance metric"
                      triggerClassName="h-7 w-7"
                    />
                  </div>
                </CardHeader>
                <CardContent className="text-2xl font-semibold tabular-nums text-violet-200">
                  {overview.total_credit_balance_label}
                </CardContent>
              </Card>
              <Card className={opCard}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm font-medium text-slate-400">Calls (30d, all users)</CardTitle>
                    <StoryPopoverInfo
                      storyKey="admin-metric-calls-30d"
                      variant="operator"
                      label="About 30-day calls metric"
                      triggerClassName="h-7 w-7"
                    />
                  </div>
                </CardHeader>
                <CardContent className="text-2xl font-semibold tabular-nums text-slate-50">{usageTotals.calls}</CardContent>
              </Card>
              <Card className={opCard}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm font-medium text-slate-400">Talk seconds (30d)</CardTitle>
                    <StoryPopoverInfo
                      storyKey="admin-metric-talk-seconds"
                      variant="operator"
                      label="About talk seconds metric"
                      triggerClassName="h-7 w-7"
                    />
                  </div>
                </CardHeader>
                <CardContent className="text-2xl font-semibold tabular-nums text-slate-50">{usageTotals.secs}</CardContent>
              </Card>
            </div>
          )}
          <Card className={opCard}>
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base text-slate-100">Open feedback</CardTitle>
                  <CardDescription className="text-slate-400">
                    {overview != null ? `${overview.open_feedback_count} open items.` : "Loading…"} Switch to Support for triage.
                  </CardDescription>
                </div>
                <StoryPopoverInfo
                  storyKey="admin-open-feedback-queue"
                  variant="operator"
                  label="About open feedback"
                  triggerClassName="h-8 w-8"
                />
              </div>
            </CardHeader>
          </Card>
        </>
      )}

      {section === "users" && (
        <>
          <header className="flex items-start justify-between gap-2">
            <div>
              <h1 className="text-xl font-semibold text-slate-100">Users &amp; usage</h1>
              <p className="mt-1 text-sm text-slate-400">
                Last 30 days call count and talk time from call_logs. Credit adjusts the prepaid ledger; Operator toggles
                platform admin (this console).
              </p>
            </div>
            <StoryPopoverInfo
              storyKey="admin-users-directory"
              variant="operator"
              label="About users table"
              triggerClassName="h-9 w-9"
            />
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
                    <TableHead className="w-[160px] text-slate-300">Actions</TableHead>
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
                          onClick={() => setUserSheetId(u.id)}
                        >
                          Manage
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

        </>
      )}

      <Sheet open={userSheetId != null} onOpenChange={(o) => !o && setUserSheetId(null)} modal>
        <SheetContent
          side="bottom"
          className="gap-0 border-slate-700 bg-slate-950 p-0 text-slate-200 sm:mx-auto sm:max-w-2xl [&>button]:top-3 [&>button]:text-slate-300 [&>button]:hover:bg-slate-800"
        >
          <StorySheetHeader
            variant="operator"
            eyebrow="Fleet pulse"
            storyline="One business account — routing volume, recent calls, and ledger tools in one place."
            title={userDetail?.user.email ?? "Account"}
            description={
              userDetailLoading
                ? "Loading account snapshot…"
                : userDetail
                  ? `${userDetail.user.name || "—"} · ${userDetail.user.business_name || "No business name"} · plan ${userDetail.user.billing_plan}`
                  : "Open an account from the table."
            }
          />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4 pt-3">
              {userDetailLoading && <p className="text-sm text-slate-400">Loading…</p>}
              {!userDetailLoading && userDetail && (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Account snapshot</p>
                    <StoryPopoverInfo
                      storyKey="admin-user-sheet-snapshot"
                      variant="operator"
                      label="About snapshot tiles"
                      triggerClassName="h-7 w-7"
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="rounded-xl border border-slate-700/80 bg-slate-900/60 px-3 py-2">
                      <p className="text-[10px] font-medium uppercase text-slate-500">Balance</p>
                      <p className="text-lg font-semibold tabular-nums text-violet-200">
                        {(userDetail.user.credit_balance_cents / 100).toLocaleString(undefined, {
                          style: "currency",
                          currency: "USD",
                        })}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-700/80 bg-slate-900/60 px-3 py-2">
                      <p className="text-[10px] font-medium uppercase text-slate-500">30d calls / talk</p>
                      <p className="text-lg font-semibold tabular-nums text-slate-100">
                        {userDetail.user.calls_last_30_days}{" "}
                        <span className="text-sm font-normal text-slate-400">/ {userDetail.user.talk_seconds_last_30_days}s</span>
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-700/80 bg-slate-900/60 px-3 py-2">
                      <p className="text-[10px] font-medium uppercase text-slate-500">Team / numbers</p>
                      <p className="text-lg font-semibold text-slate-100">
                        {userDetail.receptionist_count}{" "}
                        <span className="text-sm font-normal text-slate-400">/ {userDetail.phone_number_count} lines</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-700/80 bg-slate-900/40 px-3 py-2">
                    <span className="text-xs text-slate-400">Operator (this console)</span>
                    <div className="flex shrink-0 items-center gap-1">
                      <StoryPopoverInfo
                        storyKey="admin-user-sheet-operator"
                        variant="operator"
                        label="About operator switch"
                        triggerClassName="h-7 w-7"
                      />
                      <Switch
                        checked={userDetail.user.is_platform_admin}
                        disabled={operatorBusyId === userDetail.user.id}
                        onCheckedChange={(v) => void patchOperatorFlag(userDetail.user.id, v)}
                        className="data-[state=checked]:bg-violet-600"
                        aria-label="Platform admin"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recent calls (newest)</p>
                      <StoryPopoverInfo
                        storyKey="admin-user-sheet-call-log"
                        variant="operator"
                        label="About recent calls table"
                        triggerClassName="h-7 w-7"
                      />
                    </div>
                    {userDetail.recent_calls.length === 0 ? (
                      <p className="text-sm text-slate-500">No call_logs rows yet.</p>
                    ) : (
                      <div className="max-h-56 overflow-auto rounded-lg border border-slate-800">
                        <table className="w-full text-left text-xs">
                          <thead className="sticky top-0 bg-slate-900 text-[10px] uppercase text-slate-500">
                            <tr>
                              <th className="px-2 py-1.5">When</th>
                              <th className="px-2 py-1.5">Type</th>
                              <th className="px-2 py-1.5">From / to</th>
                              <th className="px-2 py-1.5 text-right">Sec</th>
                            </tr>
                          </thead>
                          <tbody>
                            {userDetail.recent_calls.map((c) => (
                              <tr key={c.id} className="border-t border-slate-800/80 text-slate-300">
                                <td className="whitespace-nowrap px-2 py-1.5 text-[10px] text-slate-400">
                                  {new Date(c.created_at).toLocaleString()}
                                </td>
                                <td className="px-2 py-1.5 capitalize">{c.call_type}</td>
                                <td className="max-w-[140px] truncate px-2 py-1.5 text-[10px]" title={`${c.from_number} → ${c.to_number}`}>
                                  {c.from_number} → {c.to_number}
                                </td>
                                <td className="px-2 py-1.5 text-right tabular-nums">{c.duration_seconds}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-violet-500/30 bg-violet-950/20 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-violet-200">Adjust prepaid balance</p>
                        <p className="mt-1 text-[11px] text-slate-400">Positive adds credit; negative debits. Reason is stored on the ledger.</p>
                      </div>
                      <StoryPopoverInfo
                        storyKey="admin-user-sheet-credit"
                        variant="operator"
                        label="About credit adjustment"
                        triggerClassName="h-7 w-7 shrink-0"
                      />
                    </div>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                      <div className="flex-1 space-y-1">
                        <Label htmlFor="op-credit-usd" className="text-slate-400">
                          Amount (USD)
                        </Label>
                        <Input
                          id="op-credit-usd"
                          inputMode="decimal"
                          value={creditUsd}
                          onChange={(e) => setCreditUsd(e.target.value)}
                          placeholder="10.00"
                          className="border-slate-600 bg-slate-950/80 text-slate-100"
                        />
                      </div>
                      <div className="flex-[2] space-y-1">
                        <Label htmlFor="op-credit-why" className="text-slate-400">
                          Reason
                        </Label>
                        <Input
                          id="op-credit-why"
                          value={creditReason}
                          onChange={(e) => setCreditReason(e.target.value)}
                          placeholder="Goodwill credit — ticket #123"
                          className="border-slate-600 bg-slate-950/80 text-slate-100"
                        />
                      </div>
                      <Button
                        type="button"
                        disabled={busy || !userSheetId}
                        className="bg-violet-600 text-white hover:bg-violet-500"
                        onClick={() => userSheetId && void applyCredit(userSheetId)}
                      >
                        Apply
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
            <SheetFooter className="border-t border-slate-800 bg-slate-900/80 px-4 py-3">
              <Button type="button" variant="ghost" className="text-slate-300 hover:bg-slate-800" onClick={() => setUserSheetId(null)}>
                Close
              </Button>
            </SheetFooter>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={feedbackSheet != null} onOpenChange={(o) => !o && setFeedbackSheet(null)} modal>
        <SheetContent
          side="bottom"
          className="gap-0 border-slate-700 bg-slate-950 p-0 text-slate-200 sm:mx-auto sm:max-w-lg [&>button]:top-3 [&>button]:text-slate-300"
        >
          {feedbackSheet && (
            <>
              <StorySheetHeader
                variant="operator"
                eyebrow="Voice of the customer"
                storyline="What members are asking — triage without leaving the story."
                title={feedbackSheet.subject}
                description={
                  <>
                    <span className="font-medium text-slate-300">{feedbackSheet.category}</span> ·{" "}
                    {new Date(feedbackSheet.created_at).toLocaleString()} · id {feedbackSheet.id}
                  </>
                }
              />
              <div className="max-h-[min(70vh,520px)] space-y-3 overflow-y-auto px-4 pb-4 pt-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-medium uppercase text-slate-500">Status</span>
                  <StoryPopoverInfo
                    storyKey="admin-feedback-triage"
                    variant="operator"
                    label="About feedback status"
                    triggerClassName="h-7 w-7"
                  />
                  <Select
                    value={feedbackSheet.status}
                    onValueChange={(v) => void setFeedbackStatus(feedbackSheet.id, v as FeedbackStatus)}
                  >
                    <SelectTrigger className="h-8 w-[140px] border-slate-600 bg-slate-900 text-xs text-slate-200">
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
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{feedbackSheet.body}</p>
              </div>
              <SheetFooter className="border-t border-slate-800 bg-slate-900/80 px-4 py-3">
                <Button type="button" variant="ghost" className="text-slate-300 hover:bg-slate-800" onClick={() => setFeedbackSheet(null)}>
                  Close
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      {section === "support" && (
        <>
          <header className="flex items-start justify-between gap-2">
            <div>
              <h1 className="text-xl font-semibold text-slate-100">Support queue</h1>
              <p className="mt-1 text-sm text-slate-400">Newest first. Status is stored on feedback_submissions.</p>
            </div>
            <StoryPopoverInfo
              storyKey="admin-support-queue-intro"
              variant="operator"
              label="About support queue"
              triggerClassName="h-9 w-9"
            />
          </header>
          <Card className={opCard}>
            <CardHeader>
              <CardTitle className="text-base text-slate-100">Feedback</CardTitle>
              <CardDescription className="text-slate-400">Requires billing migration 019 if the table is empty after submissions.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {feedback.length === 0 && <p className="text-sm text-slate-400">No rows (or table not migrated yet).</p>}
              {feedback.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setFeedbackSheet(row)}
                  className="w-full rounded-xl border border-slate-700/80 bg-slate-950/40 p-4 text-left transition-colors hover:border-violet-500/40 hover:bg-slate-900/60"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-medium uppercase text-slate-500">{row.category}</span>
                    <span className="rounded-full border border-slate-600 px-2 py-0.5 text-[10px] font-medium capitalize text-slate-300">
                      {row.status}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-medium text-slate-100">{row.subject}</p>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-400">{row.body}</p>
                  <p className="mt-2 text-xs text-slate-500">
                    {new Date(row.created_at).toLocaleString()} · id {row.id} · tap for full view
                  </p>
                </button>
              ))}
            </CardContent>
          </Card>
        </>
      )}

      {section === "advanced" && (
        <>
          <header className="flex items-start justify-between gap-2">
            <div>
              <h1 className="text-xl font-semibold text-slate-100">Advanced</h1>
              <p className="mt-1 text-sm text-slate-400">
                Environment-driven access and database operations live outside this UI.
              </p>
            </div>
            <StoryPopoverInfo
              storyKey="admin-advanced-console"
              variant="operator"
              label="About advanced operator notes"
              triggerClassName="h-9 w-9"
            />
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
