"use client"

// Lyncr platform operator dashboard — KPIs, user directory, credit + subscription overrides.

import { useMemo, useState } from "react"
import {
  Activity,
  CreditCard,
  Database,
  Phone,
  RefreshCw,
  Search,
  Shield,
  Users,
  Wallet,
} from "lucide-react"
import { toast } from "sonner"
import type { LyncrAdminDirectoryRow, LyncrAdminMetrics } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { Spinner } from "@/components/ui/spinner"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { accountStatusLabel } from "@/lib/account-status"

function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount)
}

function HealthDot({ status }: { status: "ok" | "error" | "unconfigured" }) {
  const color =
    status === "ok"
      ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"
      : status === "unconfigured"
        ? "bg-amber-400"
        : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.7)]"
  const label = status === "ok" ? "Connected" : status === "unconfigured" ? "Not configured" : "Error"
  return (
    <span className="inline-flex items-center gap-2">
      <span className={cn("h-2.5 w-2.5 rounded-full", color)} aria-hidden />
      <span className="text-sm text-slate-300">{label}</span>
    </span>
  )
}

function MetricCard({
  title,
  value,
  icon: Icon,
  subtitle,
}: {
  title: string
  value: string
  icon: typeof Users
  subtitle?: string
}) {
  return (
    <Card className="border-slate-800 bg-slate-900/60 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.6)] backdrop-blur-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-slate-400">{title}</CardTitle>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-600/20 ring-1 ring-violet-500/30">
          <Icon className="h-4 w-4 text-violet-300" aria-hidden />
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold tracking-tight text-slate-50">{value}</p>
        {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
      </CardContent>
    </Card>
  )
}

function formatMinutes(minutes: number): string {
  return Number(minutes).toFixed(2)
}

function AccountStatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase()
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-0 capitalize",
        normalized === "active" && "bg-emerald-500/15 text-emerald-300",
        normalized === "suspended" && "bg-red-500/15 text-red-300",
        normalized === "flagged" && "bg-amber-500/15 text-amber-300",
        normalized !== "active" && normalized !== "suspended" && normalized !== "flagged" && "bg-slate-700/50 text-slate-400"
      )}
    >
      {accountStatusLabel(status)}
    </Badge>
  )
}

function UserRowActions({
  row,
  creditAmount,
  onCreditAmountChange,
  fetchLatestAdminStats,
  onManageUser,
}: {
  row: LyncrAdminDirectoryRow
  creditAmount: string
  onCreditAmountChange: (value: string) => void
  fetchLatestAdminStats: (silent?: boolean) => Promise<void>
  onManageUser: () => void
}) {
  const [creditBusy, setCreditBusy] = useState(false)
  const [toggleBusy, setToggleBusy] = useState(false)

  async function handleAdjustCreditClick() {
    const amount = Number(creditAmount)
    if (!Number.isFinite(amount) || amount === 0) {
      toast.error("Enter a non-zero dollar amount (e.g. 10 or -5)")
      return
    }
    setCreditBusy(true)
    try {
      const res = await fetch("/api/admin/adjust-credit", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: row.user_id, amount }),
      })
      const json = (await res.json()) as { error?: string; data?: { carrier_credit_after?: number } }
      if (!res.ok) throw new Error(json.error ?? "Adjust credit failed")
      toast.success(`Credit updated — new balance ${formatUsd(json.data?.carrier_credit_after ?? 0)}`)
      onCreditAmountChange("")
      await fetchLatestAdminStats(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Adjust credit failed")
    } finally {
      setCreditBusy(false)
    }
  }

  async function handleSubscriptionToggle(shouldActivate: boolean) {
    setToggleBusy(true)
    try {
      const res = await fetch("/api/admin/toggle-subscription", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: row.user_id, shouldActivate }),
      })
      const json = (await res.json()) as {
        error?: string
        data?: { has_active_subscription?: boolean; subscription_tier?: string }
      }
      if (!res.ok) throw new Error(json.error ?? "Subscription update failed")
      toast.success(
        shouldActivate
          ? `Subscription activated (${json.data?.subscription_tier ?? "business"})`
          : `Subscription deactivated (${json.data?.subscription_tier ?? "free_trial"})`
      )
      await fetchLatestAdminStats(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Subscription update failed")
    } finally {
      setToggleBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-2">
        <Input
          type="number"
          step="0.01"
          placeholder="± USD"
          value={creditAmount}
          onChange={(e) => onCreditAmountChange(e.target.value)}
          className="h-8 w-24 border-slate-700 bg-slate-950/80 text-slate-100"
          disabled={creditBusy}
          aria-label={`Credit adjustment for ${row.email}`}
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-8 bg-violet-600/80 text-white hover:bg-violet-600"
          disabled={creditBusy}
          onClick={() => void handleAdjustCreditClick()}
        >
          {creditBusy ? "Saving..." : "Adjust credit"}
        </Button>
      </div>
      {row.has_active_subscription ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 border-slate-600 text-amber-200 hover:bg-amber-950/40"
          disabled={toggleBusy}
          onClick={() => void handleSubscriptionToggle(false)}
        >
          {toggleBusy ? "Saving..." : "Deactivate subscription"}
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 border-slate-600 text-emerald-200 hover:bg-emerald-950/40"
          disabled={toggleBusy}
          onClick={() => void handleSubscriptionToggle(true)}
        >
          {toggleBusy ? "Saving..." : "Activate subscription"}
        </Button>
      )}
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 w-fit text-violet-300 hover:bg-violet-950/40 hover:text-violet-200"
        onClick={onManageUser}
      >
        Manage user
      </Button>
    </div>
  )
}

export function LyncrAdminDashboard({
  metrics,
  users,
  loading,
  refreshing,
  fetchLatestAdminStats,
  creditInputs,
  setCreditInputForUser,
  onManageUser,
}: {
  metrics: LyncrAdminMetrics | null
  users: LyncrAdminDirectoryRow[]
  loading: boolean
  refreshing: boolean
  fetchLatestAdminStats: (silent?: boolean) => Promise<void>
  creditInputs: Record<string, string>
  setCreditInputForUser: (userId: string, value: string) => void
  onManageUser: (row: LyncrAdminDirectoryRow) => void
}) {
  const [filter, setFilter] = useState("")
  const [tierFilter, setTierFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")

  const filteredUsers = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return users.filter((u) => {
      const matchesText =
        !q ||
        u.email.toLowerCase().includes(q) ||
        (u.phone_number != null && u.phone_number.toLowerCase().includes(q))
      const matchesTier = tierFilter === "all" || u.subscription_tier === tierFilter
      const matchesStatus = statusFilter === "all" || u.account_status === statusFilter
      return matchesText && matchesTier && matchesStatus
    })
  }, [users, filter, tierFilter, statusFilter])

  if (loading && !metrics) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner className="h-10 w-10 text-violet-400" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-violet-300">
            <Shield className="h-5 w-5" aria-hidden />
            <span className="text-xs font-bold uppercase tracking-[0.2em]">Platform admin</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-slate-50">Operator dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">Exclusive access for admin@lyncr.app</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-slate-700 text-slate-200"
          disabled={refreshing}
          onClick={() => void fetchLatestAdminStats(true)}
        >
          <RefreshCw className={cn("mr-2 h-4 w-4", refreshing && "animate-spin")} aria-hidden />
          Refresh
        </Button>
      </div>

      <Card className="border-violet-500/35 bg-gradient-to-br from-violet-950/50 via-slate-900/80 to-slate-950/90 shadow-[0_12px_40px_-16px_rgba(139,92,246,0.45)]">
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-2">
          <div>
            <CardTitle className="text-base font-semibold text-violet-100">Lyncr routing pool</CardTitle>
            <p className="mt-1 text-xs text-slate-500">Master Telnyx developer balance — platform monitoring only</p>
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600/25 ring-1 ring-violet-400/40">
            <Wallet className="h-5 w-5 text-violet-200" aria-hidden />
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Available credit</p>
            <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight text-slate-50">
              {metrics?.telnyx_routing_pool?.available_credit_label ?? "—"}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Account balance</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-slate-300">
              {metrics?.telnyx_routing_pool?.balance_label ?? "—"}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Total users" value={String(metrics?.total_users ?? 0)} icon={Users} subtitle="onboarding_profiles rows" />
        <MetricCard
          title="Active subscriptions"
          value={String(metrics?.active_subscriptions ?? 0)}
          icon={CreditCard}
          subtitle="has_active_subscription = true"
        />
        <MetricCard
          title="Platform carrier credit"
          value={formatUsd(metrics?.total_carrier_credit ?? 0)}
          icon={Wallet}
          subtitle="Sum of all user balances"
        />
        <Card className="border-slate-800 bg-slate-900/60 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.6)] backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">System health</CardTitle>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600/15 ring-1 ring-emerald-500/25">
              <Activity className="h-4 w-4 text-emerald-300" aria-hidden />
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <Database className="h-3.5 w-3.5" aria-hidden /> Neon DB
              </span>
              <HealthDot status={metrics?.health.neon ?? "error"} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <Phone className="h-3.5 w-3.5" aria-hidden /> Telnyx API
              </span>
              <HealthDot status={metrics?.health.telnyx ?? "error"} />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-800 bg-slate-900/40">
        <CardHeader className="border-b border-slate-800/80 pb-4">
          <CardTitle className="text-lg text-slate-100">User directory</CardTitle>
          <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
            <div className="relative max-w-md flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
              <Input
                type="search"
                placeholder="Filter by email or phone number…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="border-slate-700 bg-slate-950/60 pl-9 text-slate-100 placeholder:text-slate-500"
              />
            </div>
            <Select value={tierFilter} onValueChange={setTierFilter}>
              <SelectTrigger className="h-9 w-full border-slate-700 bg-slate-950 text-slate-100 sm:w-[180px]">
                <SelectValue placeholder="Subscription tier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tiers</SelectItem>
                <SelectItem value="starter">Starter</SelectItem>
                <SelectItem value="professional">Professional</SelectItem>
                <SelectItem value="business">Business</SelectItem>
                <SelectItem value="free_trial">Free trial</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-full border-slate-700 bg-slate-950 text-slate-100 sm:w-[180px]">
                <SelectValue placeholder="Account status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
                <SelectItem value="flagged">Flagged</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableHead className="text-slate-400">User ID</TableHead>
                  <TableHead className="text-slate-400">Email</TableHead>
                  <TableHead className="text-slate-400">Subscription</TableHead>
                  <TableHead className="text-slate-400">Tier</TableHead>
                  <TableHead className="text-slate-400">Total calls</TableHead>
                  <TableHead className="text-slate-400">Minutes used</TableHead>
                  <TableHead className="text-slate-400">Account status</TableHead>
                  <TableHead className="text-slate-400">Phone</TableHead>
                  <TableHead className="text-slate-400">Carrier credit</TableHead>
                  <TableHead className="min-w-[320px] text-slate-400">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.length === 0 ? (
                  <TableRow className="border-slate-800">
                    <TableCell colSpan={10} className="py-10 text-center text-slate-500">
                      No users match your filter.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredUsers.map((row) => (
                    <TableRow key={row.user_id} className="border-slate-800 hover:bg-slate-800/30">
                      <TableCell className="max-w-[8rem] truncate font-mono text-xs text-slate-400" title={row.user_id}>
                        {row.user_id}
                      </TableCell>
                      <TableCell className="text-slate-200">{row.email}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "border-0",
                            row.has_active_subscription
                              ? "bg-emerald-500/15 text-emerald-300"
                              : "bg-slate-700/50 text-slate-400"
                          )}
                        >
                          {row.has_active_subscription ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-300">{row.subscription_tier}</TableCell>
                      <TableCell className="text-slate-200">{row.total_calls_routed}</TableCell>
                      <TableCell className="text-slate-200">{formatMinutes(row.total_minutes_used)}</TableCell>
                      <TableCell>
                        <AccountStatusBadge status={row.account_status} />
                      </TableCell>
                      <TableCell className="font-mono text-sm text-slate-300">{row.phone_number ?? "—"}</TableCell>
                      <TableCell className="font-medium text-slate-100">{formatUsd(row.carrier_credit)}</TableCell>
                      <TableCell>
                        <UserRowActions
                          row={row}
                          creditAmount={creditInputs[row.user_id] ?? ""}
                          onCreditAmountChange={(value) => setCreditInputForUser(row.user_id, value)}
                          fetchLatestAdminStats={fetchLatestAdminStats}
                          onManageUser={() => onManageUser(row)}
                        />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
