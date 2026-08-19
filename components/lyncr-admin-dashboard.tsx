"use client"

// Lyncr platform operator dashboard — KPIs, user directory, credit + subscription overrides.

import Link from "next/link"
import { useMemo, useState, useTransition } from "react"
import {
  Database,
  Loader2,
  MoreVertical,
  Phone,
  RefreshCw,
  Search,
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
import type { AdminBusinessEconomics } from "@/lib/types"
import type { AdminMoneyPeriodUi } from "@/hooks/use-lyncr-admin-dashboard"

type MoneySheetKey = "telnyx" | "saas" | "card_fees" | "credits" | "stripe" | "wallets" | "paying" | null

const ROUTING_POOL_LOW_BALANCE_USD = 15

function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount)
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

function AccountStatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase()
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-0 capitalize",
        normalized === "active" && "bg-emerald-500/15 text-emerald-300",
        normalized === "pending" && "bg-amber-500/20 text-amber-200",
        normalized === "denied" && "bg-zinc-500/20 text-zinc-300",
        normalized === "suspended" && "bg-red-500/15 text-red-300",
        normalized === "flagged" && "bg-amber-500/15 text-amber-300",
        normalized !== "active" &&
          normalized !== "suspended" &&
          normalized !== "flagged" &&
          normalized !== "pending" &&
          normalized !== "denied" &&
          "bg-slate-700/50 text-slate-400"
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

  async function handleStatusChange(targetStatus: string) {
    setToggleBusy(true)
    try {
      const res = await fetch("/api/admin/user-override", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: row.user_id, targetStatus }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? "Status update failed")
      toast.success(targetStatus === "active" ? "Shop approved" : "Shop denied")
      setMenuOpen(false)
      await fetchLatestAdminStats(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Status update failed")
    } finally {
      setToggleBusy(false)
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
          {row.account_status === "pending" ? (
            <>
              <DropdownMenuItem
                className="focus:bg-emerald-950/40 focus:text-emerald-200"
                disabled={toggleBusy}
                onSelect={(e) => {
                  e.preventDefault()
                  void handleStatusChange("active")
                }}
              >
                Approve shop
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                disabled={toggleBusy}
                className="focus:bg-red-950/40 focus:text-red-300"
                onSelect={(e) => {
                  e.preventDefault()
                  void handleStatusChange("denied")
                }}
              >
                Deny shop
              </DropdownMenuItem>
            </>
          ) : null}
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
  businessEconomics: _businessEconomics = [],
  moneyPeriod: _moneyPeriod = "all_time",
  setMoneyPeriod: _setMoneyPeriod,
  loading,
  refreshing,
  fetchLatestAdminStats,
  onManageUser,
  /** home = platform money + per-business P&L; businesses = tenant directory + Manage */
  view = "home",
}: {
  metrics: LyncrAdminMetrics | null
  users: LyncrAdminDirectoryRow[]
  businessEconomics?: AdminBusinessEconomics[]
  moneyPeriod?: AdminMoneyPeriodUi
  setMoneyPeriod?: (period: AdminMoneyPeriodUi) => void
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
  const [roleTab, setRoleTab] = useState("OWNER")
  const [homeShopQuery, setHomeShopQuery] = useState("")
  const [moneySheet, setMoneySheet] = useState<MoneySheetKey>(null)

  const filteredUsers = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const rows = users.filter((u) => {
      const matchesText =
        !q ||
        u.business_name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.phone_number != null && u.phone_number.toLowerCase().includes(q)) ||
        u.user_id.toLowerCase().includes(q)
      const matchesTier = tierFilter === "all" || u.subscription_tier === tierFilter
      const matchesStatus = statusFilter === "all" || u.account_status === statusFilter
      const matchesRole = roleTab === "all" || u.role === roleTab
      return matchesText && matchesTier && matchesStatus && matchesRole
    })
    return [...rows].sort((a, b) => {
      const an = (a.business_name || a.email || "").toLowerCase()
      const bn = (b.business_name || b.email || "").toLowerCase()
      return an.localeCompare(bn)
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

  // Shops waiting for you to Approve or Deny.
  const pendingOwners = useMemo(
    () => users.filter((u) => u.role === "OWNER" && u.account_status === "pending"),
    [users]
  )

  // Short “find a shop” list on Home (owners only).
  const homeShopMatches = useMemo(() => {
    const q = homeShopQuery.trim().toLowerCase()
    const owners = users.filter((u) => u.role === "OWNER")
    const matched = !q
      ? owners
      : owners.filter(
          (u) =>
            u.business_name.toLowerCase().includes(q) ||
            u.email.toLowerCase().includes(q) ||
            (u.phone_number != null && u.phone_number.toLowerCase().includes(q))
        )
    return [...matched]
      .sort((a, b) => (a.business_name || a.email).localeCompare(b.business_name || b.email))
      .slice(0, 8)
  }, [users, homeShopQuery])

  if (loading && !metrics) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner className="h-10 w-10 text-violet-400" />
      </div>
    )
  }

  const pageTitle = view === "home" ? "Home" : "Businesses"
  const pageSubtitle =
    view === "home"
      ? "Phone balance, Stripe cash, paying shops — then pending signups"
      : "Name, status, plan. Tap a row to manage."

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
              <h2 className="text-sm font-semibold text-slate-100">At a glance</h2>
              <p className="hidden text-xs text-slate-500 md:block">
                Tap a number for the breakdown.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <MoneyStripCell
                emphasize
                label="Telnyx ready"
                value={routingPoolAvailableLabel || "—"}
                hint="Phone spend left"
                onClick={() => setMoneySheet("telnyx")}
              />
              <MoneyStripCell
                label="Stripe available"
                value={metrics?.finance?.stripe_platform_available_label ?? "—"}
                hint="Lyncr cash now"
                onClick={() => setMoneySheet("stripe")}
              />
              <MoneyStripCell
                label="Paying shops"
                value={String(metrics?.active_subscriptions ?? 0)}
                hint="Active plans"
                onClick={() => setMoneySheet("paying")}
              />
            </div>
          </section>

          {/* Shop list sits first so you don’t have to hunt under Pending or More. */}
          <section className="space-y-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Find a shop</h2>
                <p className="hidden text-xs text-slate-500 md:block">Tap a name to open Manage.</p>
              </div>
              <Link
                href="/admin/businesses"
                className="shrink-0 rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-500"
              >
                All businesses
              </Link>
            </div>
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
              <Input
                type="search"
                placeholder="Shop name or email…"
                value={homeShopQuery}
                onChange={(e) => setHomeShopQuery(e.target.value)}
                className="border-slate-700 bg-slate-950/60 pl-9 text-slate-100 placeholder:text-slate-500"
              />
            </div>
            {homeShopMatches.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-800 px-3 py-5 text-center text-sm text-slate-500">
                No shops match.
              </p>
            ) : (
              <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800">
                {homeShopMatches.map((row) => (
                  <li key={row.user_id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-slate-800/40"
                      onClick={() => onManageUser(row)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-50">
                          {row.business_name.trim() || row.email}
                        </span>
                        <span className="block truncate text-[11px] text-slate-500">{row.email}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <AccountStatusBadge status={row.account_status} />
                        <TierBadge tier={row.subscription_tier} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
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

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-800/80 bg-slate-950/40 px-3 py-2 text-xs text-slate-400">
            <span className="font-medium text-slate-300">System</span>
            <span className="inline-flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5" aria-hidden /> Neon
              <HealthDot status={metrics?.health.neon ?? "error"} />
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5" aria-hidden /> Telnyx
              <HealthDot status={metrics?.health.telnyx ?? "error"} />
            </span>
          </div>

          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Pending shops</h2>
              <p className="hidden text-xs text-slate-500 md:block">
                New signups waiting for Approve or Deny.
              </p>
            </div>
            {pendingOwners.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-800 px-3 py-5 text-center text-sm text-slate-500">
                No shops waiting.
              </p>
            ) : (
              <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800">
                {pendingOwners.map((row) => (
                  <li key={row.user_id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-slate-800/40"
                      onClick={() => onManageUser(row)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-50">
                          {row.business_name.trim() || row.email}
                        </span>
                        <span className="block truncate text-[11px] text-slate-500">{row.email}</span>
                      </span>
                      <AccountStatusBadge status={row.account_status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
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
                placeholder="Search shop name, email, or phone…"
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
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="flagged">Flagged</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
                <SelectItem value="denied">Denied</SelectItem>
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
                  <TableHead className="sticky left-0 z-10 min-w-[11rem] bg-slate-900 text-slate-400">
                    Business
                  </TableHead>
                  <TableHead className="text-slate-400">Status</TableHead>
                  <TableHead className="text-slate-400">Plan</TableHead>
                  <TableHead className="w-[4.5rem] text-slate-400">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.length === 0 ? (
                  <TableRow className="border-slate-800">
                    <TableCell colSpan={4} className="py-10 text-center text-slate-500">
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
                      <TableCell className="sticky left-0 z-10 min-w-[11rem] bg-slate-900/95">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-50" title={row.business_name || row.email}>
                            {row.business_name.trim() || "—"}
                          </p>
                          <p className="truncate text-[11px] text-slate-500">{row.email}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <AccountStatusBadge status={row.account_status} />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <SubscriptionStatusBadge active={row.has_active_subscription} />
                          <TierBadge tier={row.subscription_tier} />
                        </div>
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
