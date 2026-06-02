"use client"

// Lyncr platform operator dashboard — KPIs, user directory, credit + subscription overrides.

import { useMemo, useState, useTransition } from "react"
import {
  Activity,
  Check,
  Copy,
  CreditCard,
  Database,
  Loader2,
  MoreVertical,
  Pencil,
  Phone,
  RefreshCw,
  Search,
  Shield,
  Users,
  Wallet,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { adjustUserCredit } from "@/app/actions/admin-actions"
import { startImpersonation } from "@/app/actions/admin-impersonation"
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { accountStatusLabel } from "@/lib/account-status"
import { formatRoutingPoolSkillLabel } from "@/lib/routing-pool-skills"
import { AdminInviteReceptionistDialog } from "@/components/admin-invite-receptionist-dialog"

const ROUTING_POOL_LOW_BALANCE_USD = 15

function SpecialtySkillsBadges({ skills, accountRole }: { skills: string[]; accountRole: LyncrAdminDirectoryRow["account_role"] }) {
  if (accountRole !== "receptionist") {
    return <span className="text-slate-600">—</span>
  }
  if (!skills.length) {
    return <span className="text-xs text-slate-500">No skills assigned</span>
  }
  return (
    <div className="flex max-w-[220px] flex-wrap gap-1">
      {skills.map((skill) => (
        <Badge
          key={skill}
          variant="outline"
          className="border-violet-500/35 bg-violet-500/10 text-[11px] font-medium text-violet-200"
        >
          {formatRoutingPoolSkillLabel(skill)}
        </Badge>
      ))}
    </div>
  )
}

function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount)
}

/** Shorten UUIDs for dense table cells — e.g. 18cf...c5af */
function truncateUuid(id: string): string {
  const s = id.trim()
  if (s.length <= 12) return s
  return `${s.slice(0, 4)}...${s.slice(-4)}`
}

function UserIdCell({ userId }: { userId: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(userId)
      setCopied(true)
      toast.success("User ID copied")
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Could not copy to clipboard")
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <code
        className="truncate font-mono text-xs text-slate-400"
        title={userId}
      >
        {truncateUuid(userId)}
      </code>
      <button
        type="button"
        onClick={() => void handleCopy()}
        className={cn(
          "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-700/80 bg-slate-950/60 text-slate-400 transition-colors",
          "hover:border-violet-500/40 hover:bg-violet-950/40 hover:text-violet-200",
          copied && "border-emerald-500/40 text-emerald-300"
        )}
        aria-label={`Copy user ID ${userId}`}
        title="Copy full user ID"
      >
        <Copy className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  )
}

/**
 * Inline-editable "Phone" cell. Renders a clickable value (or a clickable "—" placeholder when
 * empty) that morphs into a compact input with save (✓) / cancel (✕) controls. On save it PATCHes
 * /api/admin/users/update-phone and calls onSaved so the table updates instantly — no page refresh.
 */
function EditablePhoneCell({
  userId,
  value,
  onSaved,
}: {
  userId: string
  value: string | null
  onSaved: (userId: string, phone: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)

  function startEdit() {
    setDraft(value ?? "")
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
    setDraft("")
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch("/api/admin/users/update-phone", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, newPhone: draft }),
      })
      const json = (await res.json().catch(() => ({}))) as { data?: { phone?: string }; error?: string }
      if (!res.ok || !json.data?.phone) {
        toast.error(json.error ?? "Couldn't update phone")
        return
      }
      onSaved(userId, json.data.phone)
      toast.success("Phone updated")
      setEditing(false)
      setDraft("")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error — please try again")
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          type="tel"
          inputMode="tel"
          value={draft}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !saving) void save()
            if (e.key === "Escape") cancelEdit()
          }}
          placeholder="(555) 123-4567"
          className="w-36 rounded-md border border-slate-600 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          aria-label="Save phone"
          className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-violet-600 text-white transition-colors hover:bg-violet-500 disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
        </button>
        <button
          type="button"
          onClick={cancelEdit}
          disabled={saving}
          aria-label="Cancel"
          className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-600 text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-60"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={startEdit}
      aria-label={`Edit phone for user ${userId}`}
      className="group inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 font-mono text-sm transition-colors hover:bg-slate-800"
    >
      <span className={value ? "text-slate-300" : "text-slate-500"}>{value ?? "—"}</span>
      <Pencil className="h-3 w-3 text-slate-500 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
    </button>
  )
}

function RoutingPoolLowBalanceBanner({ balanceUsd, balanceLabel }: { balanceUsd: number; balanceLabel: string }) {
  if (!Number.isFinite(balanceUsd) || balanceUsd >= ROUTING_POOL_LOW_BALANCE_USD) return null
  const display = balanceLabel || formatUsd(balanceUsd)
  return (
    <div
      role="alert"
      className="rounded-xl border border-amber-500/50 bg-gradient-to-r from-amber-950/70 via-red-950/50 to-amber-950/70 px-4 py-3 text-sm leading-relaxed text-amber-100 shadow-[0_0_24px_-8px_rgba(245,158,11,0.45)] ring-1 ring-amber-500/30"
    >
      ⚠️ CRITICAL: Platform wholesale routing pool is running low ({display}). Top up via Telnyx immediately to
      prevent call drops.
    </div>
  )
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

/** Role classification badge: violet for receptionists, green (+ business name) for owners, slate for admins. */
function RoleBadge({ row }: { row: LyncrAdminDirectoryRow }) {
  if (row.role === "RECEPTIONIST") {
    return (
      <Badge variant="outline" className="border-violet-500/40 bg-violet-500/15 text-violet-200">
        Receptionist
      </Badge>
    )
  }
  if (row.role === "OWNER") {
    return (
      <div className="flex min-w-0 flex-col gap-0.5">
        <Badge variant="outline" className="w-fit border-emerald-500/40 bg-emerald-500/15 text-emerald-300">
          Business Owner
        </Badge>
        {row.business_name ? (
          <span className="truncate text-xs text-slate-400" title={row.business_name}>
            {row.business_name}
          </span>
        ) : null}
      </div>
    )
  }
  return (
    <Badge variant="outline" className="border-slate-500/40 bg-slate-500/15 text-slate-300">
      Admin
    </Badge>
  )
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
  fetchLatestAdminStats,
  onManageUser,
}: {
  row: LyncrAdminDirectoryRow
  fetchLatestAdminStats: (silent?: boolean) => Promise<void>
  onManageUser: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [creditDialogOpen, setCreditDialogOpen] = useState(false)
  const [creditAmount, setCreditAmount] = useState("")
  const [creditBusy, setCreditBusy] = useState(false)
  const [impersonatePending, startImpersonateTransition] = useTransition()
  const [toggleBusy, setToggleBusy] = useState(false)

  async function handleAdjustCreditClick() {
    const amount = Number(creditAmount)
    if (!Number.isFinite(amount) || amount === 0) {
      toast.error("Enter a non-zero dollar amount (e.g. 10 or -5)")
      return
    }
    setCreditBusy(true)
    try {
      const result = await adjustUserCredit(row.user_id, amount)
      if (!result.ok) throw new Error(result.error)
      toast.success(`Credit updated — new balance ${formatUsd(result.carrier_credit_after)}`)
      setCreditAmount("")
      setCreditDialogOpen(false)
      await fetchLatestAdminStats(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Adjust credit failed")
    } finally {
      setCreditBusy(false)
    }
  }

  function handleImpersonateClick() {
    setMenuOpen(false)
    startImpersonateTransition(async () => {
      const result = await startImpersonation(row.user_id)
      if (result?.ok === false) {
        toast.error(result.error)
      }
    })
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
      setMenuOpen(false)
      await fetchLatestAdminStats(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Subscription update failed")
    } finally {
      setToggleBusy(false)
    }
  }

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            aria-label={`Actions for ${row.email}`}
          >
            <MoreVertical className="h-4 w-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-56 border-slate-700 bg-slate-900 text-slate-100"
        >
          <DropdownMenuItem
            className="focus:bg-slate-800 focus:text-slate-50"
            disabled={impersonatePending}
            onSelect={(e) => {
              e.preventDefault()
              handleImpersonateClick()
            }}
          >
            {impersonatePending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Starting impersonation…
              </>
            ) : (
              "Impersonate workspace"
            )}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="focus:bg-slate-800 focus:text-slate-50"
            onSelect={(e) => {
              e.preventDefault()
              setMenuOpen(false)
              setCreditDialogOpen(true)
            }}
          >
            Adjust credit balance
          </DropdownMenuItem>
          <DropdownMenuItem
            className="focus:bg-slate-800 focus:text-slate-50"
            onSelect={() => {
              setMenuOpen(false)
              onManageUser()
            }}
          >
            Manage user
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-slate-700" />
          <DropdownMenuItem
            variant="destructive"
            disabled={toggleBusy}
            className="focus:bg-red-950/40 focus:text-red-300"
            onSelect={(e) => {
              e.preventDefault()
              void handleSubscriptionToggle(!row.has_active_subscription)
            }}
          >
            {toggleBusy
              ? "Saving…"
              : row.has_active_subscription
                ? "Deactivate subscription"
                : "Activate subscription"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={creditDialogOpen} onOpenChange={setCreditDialogOpen}>
        <DialogContent className="border-slate-700 bg-slate-900 text-slate-100 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Adjust credit balance</DialogTitle>
            <DialogDescription className="text-slate-400">
              Apply a positive or negative USD adjustment for {row.email}. Current balance:{" "}
              {formatUsd(row.carrier_credit)}.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <label className="mb-2 block text-xs font-medium text-slate-400" htmlFor={`credit-${row.user_id}`}>
              Amount (± USD)
            </label>
            <Input
              id={`credit-${row.user_id}`}
              type="number"
              step="0.01"
              placeholder="e.g. 10 or -5"
              value={creditAmount}
              onChange={(e) => setCreditAmount(e.target.value)}
              className="border-slate-700 bg-slate-950/80 text-slate-100"
              disabled={creditBusy}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              className="border-slate-600 text-slate-200 hover:bg-slate-800"
              disabled={creditBusy}
              onClick={() => setCreditDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-violet-600 text-white hover:bg-violet-500"
              disabled={creditBusy}
              onClick={() => void handleAdjustCreditClick()}
            >
              {creditBusy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  Saving…
                </>
              ) : (
                "Apply adjustment"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function LyncrAdminDashboard({
  metrics,
  users,
  loading,
  refreshing,
  fetchLatestAdminStats,
  onManageUser,
}: {
  metrics: LyncrAdminMetrics | null
  users: LyncrAdminDirectoryRow[]
  loading: boolean
  refreshing: boolean
  fetchLatestAdminStats: (silent?: boolean) => Promise<void>
  onManageUser: (row: LyncrAdminDirectoryRow) => void
}) {
  const [filter, setFilter] = useState("")
  const [tierFilter, setTierFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  // Role tab: "all" | "owner" | "receptionist".
  const [roleTab, setRoleTab] = useState("all")
  // Optimistic phone edits keyed by user_id so saves render instantly without a refetch.
  const [phoneOverrides, setPhoneOverrides] = useState<Record<string, string>>({})

  function handlePhoneSaved(userId: string, phone: string) {
    setPhoneOverrides((prev) => ({ ...prev, [userId]: phone }))
  }

  const filteredUsers = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return users.filter((u) => {
      const matchesText =
        !q ||
        u.email.toLowerCase().includes(q) ||
        (u.phone_number != null && u.phone_number.toLowerCase().includes(q))
      const matchesTier = tierFilter === "all" || u.subscription_tier === tierFilter
      const matchesStatus = statusFilter === "all" || u.account_status === statusFilter
      const matchesRole = roleTab === "all" || u.role === roleTab
      return matchesText && matchesTier && matchesStatus && matchesRole
    })
  }, [users, filter, tierFilter, statusFilter, roleTab])

  // Role tab counts (independent of text/tier/status filters) for the tab labels.
  const roleCounts = useMemo(() => {
    let owners = 0
    let receptionists = 0
    for (const u of users) {
      if (u.role === "RECEPTIONIST") receptionists += 1
      else if (u.role === "OWNER") owners += 1
    }
    return { all: users.length, owner: owners, receptionist: receptionists }
  }, [users])

  const routingPoolAvailableUsd = metrics?.telnyx_routing_pool?.available_credit_usd ?? NaN
  const routingPoolAvailableLabel = metrics?.telnyx_routing_pool?.available_credit_label ?? ""

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

      <RoutingPoolLowBalanceBanner balanceUsd={routingPoolAvailableUsd} balanceLabel={routingPoolAvailableLabel} />

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
              {routingPoolAvailableLabel || "—"}
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">Invite platform receptionists to the payout portal.</p>
        <AdminInviteReceptionistDialog />
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
          <div className="px-4 pt-4">
            <Tabs value={roleTab} onValueChange={setRoleTab}>
              <TabsList className="bg-slate-800/60">
                <TabsTrigger
                  value="all"
                  className="text-slate-300 data-[state=active]:bg-slate-950 data-[state=active]:text-slate-50"
                >
                  All Accounts
                  <span className="ml-1.5 rounded bg-slate-700/70 px-1.5 text-[11px] tabular-nums text-slate-300">
                    {roleCounts.all}
                  </span>
                </TabsTrigger>
                <TabsTrigger
                  value="OWNER"
                  className="text-slate-300 data-[state=active]:bg-slate-950 data-[state=active]:text-slate-50"
                >
                  Business Owners
                  <span className="ml-1.5 rounded bg-slate-700/70 px-1.5 text-[11px] tabular-nums text-slate-300">
                    {roleCounts.owner}
                  </span>
                </TabsTrigger>
                <TabsTrigger
                  value="RECEPTIONIST"
                  className="text-slate-300 data-[state=active]:bg-slate-950 data-[state=active]:text-slate-50"
                >
                  Receptionists
                  <span className="ml-1.5 rounded bg-slate-700/70 px-1.5 text-[11px] tabular-nums text-slate-300">
                    {roleCounts.receptionist}
                  </span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableHead className="text-slate-400">User ID</TableHead>
                  <TableHead className="text-slate-400">Email</TableHead>
                  <TableHead className="text-slate-400">Role</TableHead>
                  <TableHead className="text-slate-400">Subscription</TableHead>
                  <TableHead className="text-slate-400">Tier</TableHead>
                  <TableHead className="text-slate-400">Total calls</TableHead>
                  <TableHead className="text-slate-400">Minutes used</TableHead>
                  <TableHead className="text-slate-400">Account status</TableHead>
                  <TableHead className="text-slate-400">Phone</TableHead>
                  <TableHead className="text-slate-400">Carrier credit</TableHead>
                  <TableHead className="min-w-[180px] text-slate-400">Specialty skills</TableHead>
                  <TableHead className="w-[4.5rem] text-slate-400">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.length === 0 ? (
                  <TableRow className="border-slate-800">
                    <TableCell colSpan={12} className="py-10 text-center text-slate-500">
                      No users match your filter.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredUsers.map((row) => (
                    <TableRow key={row.user_id} className="border-slate-800 hover:bg-slate-800/30">
                      <TableCell>
                        <UserIdCell userId={row.user_id} />
                      </TableCell>
                      <TableCell className="text-slate-200">{row.email}</TableCell>
                      <TableCell>
                        <RoleBadge row={row} />
                      </TableCell>
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
                      <TableCell>
                        <EditablePhoneCell
                          userId={row.user_id}
                          value={phoneOverrides[row.user_id] ?? row.phone_number}
                          onSaved={handlePhoneSaved}
                        />
                      </TableCell>
                      <TableCell className="font-medium text-slate-100">{formatUsd(row.carrier_credit)}</TableCell>
                      <TableCell>
                        <SpecialtySkillsBadges skills={row.receptionist_skills} accountRole={row.account_role} />
                      </TableCell>
                      <TableCell className="text-right">
                        <UserRowActions
                          row={row}
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
