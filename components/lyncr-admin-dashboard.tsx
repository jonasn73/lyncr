"use client"

// Lyncr platform operator dashboard — KPIs, user directory, credit + subscription overrides.

import { useMemo, useState, useTransition } from "react"
import {
  Activity,
  Check,
  Copy,
  Database,
  Loader2,
  MoreVertical,
  Pencil,
  Phone,
  RefreshCw,
  Search,
  Users,
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { accountStatusLabel } from "@/lib/account-status"
import { formatRoutingPoolSkillLabel } from "@/lib/routing-pool-skills"
import { LiveTrafficPulse } from "@/components/admin/live-traffic"
import { CallHistoryTable } from "@/components/admin/call-history"

type MoneySheetKey = "telnyx" | "saas" | "card_fees" | "credits" | "stripe" | "wallets" | "paying" | null

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

/** Compact tappable money cell — details open in a sheet instead of stacking tall cards. */
function MoneyStripCell({
  label,
  value,
  hint,
  onClick,
  emphasize,
}: {
  label: string
  value: string
  hint?: string
  onClick: () => void
  emphasize?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-w-0 flex-col gap-0.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
        "hover:border-violet-500/40 hover:bg-violet-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50",
        emphasize
          ? "border-violet-500/35 bg-violet-950/40"
          : "border-slate-800 bg-slate-900/60"
      )}
    >
      <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <span className="truncate text-lg font-bold tabular-nums tracking-tight text-slate-50 sm:text-xl">
        {value}
      </span>
      {hint ? <span className="truncate text-[11px] text-slate-500">{hint}</span> : null}
    </button>
  )
}

function MoneyDetailRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-800/80 py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-200">{label}</p>
        {note ? <p className="mt-0.5 text-xs leading-snug text-slate-500">{note}</p> : null}
      </div>
      <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-50">{value}</p>
    </div>
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

/** Subscription tier pill: dark-green/mint for paid tiers, muted steel-blue for free trial. */
function TierBadge({ tier }: { tier: string }) {
  const t = (tier || "").toLowerCase()
  const isPaid = t === "professional" || t === "business"
  const isTrial = t === "free_trial"
  const label = isTrial ? "Free trial" : tier || "—"
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-0 capitalize",
        isPaid && "bg-emerald-900/50 text-emerald-300",
        isTrial && "bg-sky-950/60 text-sky-300",
        !isPaid && !isTrial && "bg-slate-700/40 text-slate-300"
      )}
    >
      {label}
    </Badge>
  )
}

/** Subscription status pill: vibrant emerald when active, soft dark-red/crimson when inactive. */
function SubscriptionStatusBadge({ active }: { active: boolean }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-0",
        active ? "bg-emerald-500/20 text-emerald-300" : "bg-red-950/50 text-red-400"
      )}
    >
      {active ? "Active" : "Inactive"}
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
  /** home = KPIs + live traffic; businesses = tenant directory + Manage */
  view = "home",
}: {
  metrics: LyncrAdminMetrics | null
  users: LyncrAdminDirectoryRow[]
  loading: boolean
  refreshing: boolean
  fetchLatestAdminStats: (silent?: boolean) => Promise<void>
  onManageUser: (row: LyncrAdminDirectoryRow) => void
  view?: "home" | "businesses"
}) {
  const [filter, setFilter] = useState("")
  const [tierFilter, setTierFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  // Role tab: "all" | "owner" | "receptionist".
  const [roleTab, setRoleTab] = useState("all")
  // Optimistic phone edits keyed by user_id so saves render instantly without a refetch.
  const [phoneOverrides, setPhoneOverrides] = useState<Record<string, string>>({})
  const [moneySheet, setMoneySheet] = useState<MoneySheetKey>(null)

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

  const pageTitle = view === "home" ? "Ops home" : "Manage businesses"
  const pageSubtitle =
    view === "home"
      ? "Phone balance, fees, and live traffic"
      : "Find a business, then tap Manage"

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-3 sm:space-y-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-50 sm:text-2xl">{pageTitle}</h1>
          <p className="mt-0.5 text-sm text-slate-500">{pageSubtitle}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 border-slate-700 text-slate-200"
          disabled={refreshing}
          onClick={() => void fetchLatestAdminStats(true)}
          aria-label="Refresh"
        >
          <RefreshCw className={cn("h-4 w-4 sm:mr-2", refreshing && "animate-spin")} aria-hidden />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>

      {view === "home" ? (
        <>
          <RoutingPoolLowBalanceBanner balanceUsd={routingPoolAvailableUsd} balanceLabel={routingPoolAvailableLabel} />

          {/* Compact money strip — tap a cell for the full explanation sheet */}
          <section className="space-y-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Platform money</h2>
              <p className="hidden text-xs text-slate-500 md:block">
                Tap a total for the breakdown. Telnyx = phone spend · Stripe = Lyncr fees + SaaS.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MoneyStripCell
                emphasize
                label="Telnyx balance"
                value={routingPoolAvailableLabel || "—"}
                hint="Phone API ready"
                onClick={() => setMoneySheet("telnyx")}
              />
              <MoneyStripCell
                label="SaaS / mo"
                value={metrics?.finance?.estimated_mrr_label ?? formatUsd(0)}
                hint="Est. paid plans"
                onClick={() => setMoneySheet("saas")}
              />
              <MoneyStripCell
                label="Card fees MTD"
                value={metrics?.finance?.card_fee_revenue_mtd_label ?? "—"}
                hint={
                  metrics?.finance?.card_fee_revenue_mtd_cents === 0
                    ? metrics?.finance?.card_fee_month_label
                      ? `None in ${metrics.finance.card_fee_month_label.replace(" (US Eastern)", "")}`
                      : "None yet"
                    : metrics?.finance?.card_fee_count_mtd
                      ? `${metrics.finance.card_fee_count_mtd} charges`
                      : "Connect take"
                }
                onClick={() => setMoneySheet("card_fees")}
              />
              <MoneyStripCell
                label="Stripe (Lyncr)"
                value={metrics?.finance?.stripe_platform_available_label ?? "—"}
                hint="Available now"
                onClick={() => setMoneySheet("stripe")}
              />
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
              <button
                type="button"
                className="rounded-md px-1.5 py-0.5 underline-offset-2 hover:text-slate-300 hover:underline"
                onClick={() => setMoneySheet("credits")}
              >
                Credit packs {metrics?.finance?.credit_pack_revenue_mtd_label ?? formatUsd(0)}
              </button>
              <span aria-hidden>·</span>
              <button
                type="button"
                className="rounded-md px-1.5 py-0.5 underline-offset-2 hover:text-slate-300 hover:underline"
                onClick={() => setMoneySheet("wallets")}
              >
                Prepaid wallets {formatUsd(metrics?.total_carrier_credit ?? 0)}
              </button>
              <span aria-hidden>·</span>
              <button
                type="button"
                className="rounded-md px-1.5 py-0.5 underline-offset-2 hover:text-slate-300 hover:underline"
                onClick={() => setMoneySheet("paying")}
              >
                Paying businesses {metrics?.active_subscriptions ?? 0}
              </button>
            </div>
          </section>

          <Sheet open={moneySheet != null} onOpenChange={(open) => !open && setMoneySheet(null)}>
            <SheetContent
              side="right"
              className="w-full border-slate-800 bg-slate-950 text-slate-100 sm:max-w-md"
            >
              <SheetHeader>
                <SheetTitle className="text-slate-50">
                  {moneySheet === "telnyx"
                    ? "Telnyx phone balance"
                    : moneySheet === "saas"
                      ? "Estimated SaaS revenue"
                      : moneySheet === "card_fees"
                        ? "Card fees this month"
                        : moneySheet === "credits"
                          ? "Credit packs sold"
                          : moneySheet === "stripe"
                            ? "Stripe balance (Lyncr)"
                            : moneySheet === "wallets"
                              ? "Prepaid phone wallets"
                              : moneySheet === "paying"
                                ? "Paying businesses"
                                : "Platform money"}
                </SheetTitle>
                <SheetDescription className="text-slate-400">
                  {moneySheet === "telnyx"
                    ? "Money sitting in Telnyx to pay for inbound/outbound calls, SMS, and numbers."
                    : moneySheet === "saas"
                      ? "List-price estimate from active paid subscription tiers (not Stripe invoice cash)."
                      : moneySheet === "card_fees"
                        ? "Lyncr’s Connect application fee when shops run Collect / Tap / pay links. Charged only when Stripe creates an application_fee on the Connect charge."
                        : moneySheet === "credits"
                          ? "What businesses paid Lyncr for prepaid phone minutes this calendar month."
                          : moneySheet === "stripe"
                            ? "Lyncr’s platform Stripe account — not shop Connect wallets."
                            : moneySheet === "wallets"
                              ? "Sum of credit sitting in customer Pay wallets — liability until they burn minutes."
                              : moneySheet === "paying"
                                ? "Accounts marked with an active subscription in onboarding."
                                : ""}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-1 px-1">
                {moneySheet === "telnyx" ? (
                  <>
                    <MoneyDetailRow
                      label="Ready to spend"
                      value={routingPoolAvailableLabel || "—"}
                      note="Available credit for calls, SMS, and numbers. Top up in Telnyx Mission Control under ~$15."
                    />
                    <MoneyDetailRow
                      label="Account balance"
                      value={metrics?.telnyx_routing_pool?.balance_label ?? "—"}
                      note="Full Telnyx balance line (may include pending)."
                    />
                  </>
                ) : null}
                {moneySheet === "saas" ? (
                  <>
                    <MoneyDetailRow
                      label="Estimated MRR"
                      value={metrics?.finance?.estimated_mrr_label ?? formatUsd(0)}
                      note="Starter $19 · Pro $49 · Business $99 list prices × active paid counts."
                    />
                    <MoneyDetailRow
                      label="Starter"
                      value={String(metrics?.finance?.active_paid_by_tier.starter ?? 0)}
                    />
                    <MoneyDetailRow
                      label="Professional"
                      value={String(metrics?.finance?.active_paid_by_tier.professional ?? 0)}
                    />
                    <MoneyDetailRow
                      label="Business"
                      value={String(metrics?.finance?.active_paid_by_tier.business ?? 0)}
                    />
                  </>
                ) : null}
                {moneySheet === "card_fees" ? (
                  <>
                    <MoneyDetailRow
                      label="Month window"
                      value={metrics?.finance?.card_fee_month_label ?? "US Eastern"}
                      note="Counted in US Eastern time so late evenings don’t jump to next month early."
                    />
                    <MoneyDetailRow
                      label="Collected this month"
                      value={metrics?.finance?.card_fee_revenue_mtd_label ?? "—"}
                      note={
                        metrics?.finance?.card_fee_revenue_mtd_detail ||
                        (metrics?.finance?.card_fee_formula_label
                          ? `Formula: ${metrics.finance.card_fee_formula_label}`
                          : undefined)
                      }
                    />
                    <MoneyDetailRow
                      label="Fee formula"
                      value={metrics?.finance?.card_fee_formula_label ?? "—"}
                      note="Lyncr’s Connect take (2.9% + $0.30 by default). Stripe’s own processing fee is separate."
                    />
                    <MoneyDetailRow
                      label="Charges this month"
                      value={
                        metrics?.finance?.card_fee_count_mtd != null
                          ? String(metrics.finance.card_fee_count_mtd)
                          : "—"
                      }
                      note="Only Connect charges with an application_fee count. Platform-only charges (no application_fee) = $0 for Lyncr."
                    />
                    <MoneyDetailRow
                      label="Last fee"
                      value={metrics?.finance?.card_fee_last_at_label ?? "—"}
                    />
                    <MoneyDetailRow
                      label="All-time (approx)"
                      value={metrics?.finance?.card_fee_all_time_label ?? "—"}
                      note="Sum of Lyncr application fees from Stripe."
                    />
                  </>
                ) : null}
                {moneySheet === "credits" ? (
                  <MoneyDetailRow
                    label="Credit packs MTD"
                    value={metrics?.finance?.credit_pack_revenue_mtd_label ?? formatUsd(0)}
                    note="From billing_ledger reason stripe_credit_pack this month."
                  />
                ) : null}
                {moneySheet === "stripe" ? (
                  <>
                    <MoneyDetailRow
                      label="Available"
                      value={metrics?.finance?.stripe_platform_available_label ?? "—"}
                      note="Ready to pay out from Lyncr’s Stripe account."
                    />
                    <MoneyDetailRow
                      label="Pending"
                      value={metrics?.finance?.stripe_platform_pending_label ?? "—"}
                      note="Not yet available (processing)."
                    />
                  </>
                ) : null}
                {moneySheet === "wallets" ? (
                  <MoneyDetailRow
                    label="Prepaid liability"
                    value={formatUsd(metrics?.total_carrier_credit ?? 0)}
                    note="Customer phone wallets — Lyncr owes this as minute credit."
                  />
                ) : null}
                {moneySheet === "paying" ? (
                  <>
                    <MoneyDetailRow
                      label="Paying businesses"
                      value={String(metrics?.active_subscriptions ?? 0)}
                    />
                    <MoneyDetailRow
                      label="Total accounts"
                      value={String(metrics?.total_users ?? 0)}
                      note="Owners + invites with an onboarding profile."
                    />
                  </>
                ) : null}
              </div>
            </SheetContent>
          </Sheet>

          <div className="grid gap-3 sm:grid-cols-1">
            <Card className="border-slate-800 bg-slate-900/60">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div>
                  <CardTitle className="text-sm font-medium text-slate-200">System health</CardTitle>
                  <p className="mt-0.5 text-xs text-slate-500">Can Lyncr reach the database and phone network?</p>
                </div>
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600/15 ring-1 ring-emerald-500/25">
                  <Activity className="h-4 w-4 text-emerald-300" aria-hidden />
                </div>
              </CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2">
                <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
                  <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                    <Database className="h-3.5 w-3.5" aria-hidden /> Database (Neon)
                  </span>
                  <HealthDot status={metrics?.health.neon ?? "error"} />
                </div>
                <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
                  <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                    <Phone className="h-3.5 w-3.5" aria-hidden /> Phone API (Telnyx)
                  </span>
                  <HealthDot status={metrics?.health.telnyx ?? "error"} />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <LiveTrafficPulse />
            <CallHistoryTable />
          </div>
        </>
      ) : null}

      {view === "businesses" ? (
          <Card className="border-slate-800 bg-slate-900/40">
            <CardHeader className="space-y-3 border-b border-slate-800/80 pb-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
            <div className="relative max-w-md flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
              <Input
                type="search"
                placeholder="Search by email or phone…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="border-slate-700 bg-slate-950/60 pl-9 text-slate-100 placeholder:text-slate-500"
              />
            </div>
            <Select value={tierFilter} onValueChange={setTierFilter}>
              <SelectTrigger className="h-9 w-full border-slate-700 bg-slate-950 text-slate-100 sm:w-[160px]">
                <SelectValue placeholder="Plan" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All plans</SelectItem>
                <SelectItem value="starter">Starter</SelectItem>
                <SelectItem value="professional">Professional</SelectItem>
                <SelectItem value="business">Business</SelectItem>
                <SelectItem value="free_trial">Free trial</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-full border-slate-700 bg-slate-950 text-slate-100 sm:w-[160px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
                <SelectItem value="flagged">Flagged</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Tabs value={roleTab} onValueChange={setRoleTab}>
            <TabsList className="h-auto w-full flex-wrap justify-start bg-slate-800/60 sm:w-auto">
              <TabsTrigger
                value="all"
                className="text-slate-300 data-[state=active]:bg-slate-950 data-[state=active]:text-slate-50"
              >
                All
                <span className="ml-1.5 rounded bg-slate-700/70 px-1.5 text-[11px] tabular-nums text-slate-300">
                  {roleCounts.all}
                </span>
              </TabsTrigger>
              <TabsTrigger
                value="OWNER"
                className="text-slate-300 data-[state=active]:bg-slate-950 data-[state=active]:text-slate-50"
              >
                Owners
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
        </CardHeader>
        <CardContent className="p-0">
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
                  filteredUsers.map((row) => {
                    const isOwner = row.role === "OWNER"
                    return (
                    <TableRow
                      key={row.user_id}
                      className="cursor-pointer border-slate-800 transition-colors hover:bg-slate-800/40"
                      onClick={
                        isOwner
                          ? (e) => {
                              // Ignore clicks that land on interactive cells (buttons, inputs, links).
                              if ((e.target as HTMLElement).closest("button, input, a, [role='menuitem']")) return
                              onManageUser(row)
                            }
                          : undefined
                      }
                      title={isOwner ? "Open tenant management" : undefined}
                    >
                      <TableCell>
                        <UserIdCell userId={row.user_id} />
                      </TableCell>
                      <TableCell className="text-slate-200">{row.email}</TableCell>
                      <TableCell>
                        <RoleBadge row={row} />
                      </TableCell>
                      <TableCell>
                        <SubscriptionStatusBadge active={row.has_active_subscription} />
                      </TableCell>
                      <TableCell>
                        <TierBadge tier={row.subscription_tier} />
                      </TableCell>
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
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
          </Card>
      ) : null}
    </div>
  )
}
