"use client"

// Lyncr platform operator dashboard — KPIs, user directory, credit + subscription overrides.

import Link from "next/link"
import { useMemo, useState, useTransition } from "react"
import {
  Database,
  Loader2,
  MoreVertical,
  Phone,
  ShieldAlert,
  RefreshCw,
  Search,
} from "lucide-react"
import { toast } from "sonner"
import { adjustUserCredit } from "@/app/actions/admin-actions"
import { startImpersonation } from "@/app/actions/admin-impersonation"
import { CallHealthBoard } from "@/components/admin/call-health-board"
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

type MoneySheetKey =
  | "telnyx"
  | "saas"
  | "card_fees"
  | "credits"
  | "stripe"
  | "wallets"
  | "business_wallets"
  | "paying"
  | null

const ROUTING_POOL_LOW_BALANCE_USD = 15

function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount)
}

/** True for a real shop login — not techs, receptionists, or the Lyncr admin account. */
export function isShopOwnerRow(row: LyncrAdminDirectoryRow): boolean {
  const email = row.email.trim().toLowerCase()
  if (row.account_role === "field_tech" || row.account_role === "receptionist") return false
  if (email.endsWith("@tech.lyncr.app")) return false
  if (email === "admin@lyncr.app") return false
  return row.role === "OWNER"
}

function RoutingPoolLowBalanceBanner({ balanceUsd, balanceLabel }: { balanceUsd: number; balanceLabel: string }) {
  if (!Number.isFinite(balanceUsd) || balanceUsd >= ROUTING_POOL_LOW_BALANCE_USD) return null
  const display = balanceLabel || formatUsd(balanceUsd)
  return (
    <div
      role="alert"
      className="rounded-xl border border-warning/50 bg-gradient-to-r from-warning/70 via-destructive/50 to-warning/70 px-4 py-3 text-sm leading-relaxed text-warning shadow-[0_0_24px_-8px_rgba(245,158,11,0.45)] ring-1 ring-warning/30"
    >
      ⚠️ CRITICAL: Platform wholesale routing pool is running low ({display}). Top up via Telnyx immediately to
      prevent call drops.
    </div>
  )
}

function HealthDot({ status }: { status: "ok" | "error" | "unconfigured" }) {
  const color =
    status === "ok"
      ? "bg-success shadow-[0_0_8px_rgba(52,211,153,0.8)]"
      : status === "unconfigured"
        ? "bg-warning"
        : "bg-destructive shadow-[0_0_8px_rgba(239,68,68,0.7)]"
  const label = status === "ok" ? "Connected" : status === "unconfigured" ? "Not configured" : "Error"
  return (
    <span className="inline-flex items-center gap-2">
      <span className={cn("h-2.5 w-2.5 rounded-full", color)} aria-hidden />
      <span className="text-sm text-foreground">{label}</span>
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
        "flex min-w-0 flex-col gap-0.5 rounded-xl border px-3 py-3 text-left transition-colors",
        "hover:border-operator/40 hover:bg-operator/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-operator/50",
        emphasize
          ? "border-operator/35 bg-operator/40"
          : "border-border bg-card/60"
      )}
    >
      <span className="truncate text-micro font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="truncate text-lg font-bold tabular-nums tracking-tight text-foreground sm:text-xl">
        {value}
      </span>
      {hint ? <span className="truncate text-2xs text-muted-foreground">{hint}</span> : null}
    </button>
  )
}

function MoneyDetailRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/80 py-3 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {note ? <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{note}</p> : null}
      </div>
      <p className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  )
}

export function AccountStatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase()
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-0 capitalize",
        normalized === "active" && "bg-success/15 text-success",
        normalized === "pending" && "bg-warning/20 text-warning",
        normalized === "denied" && "bg-muted-foreground/20 text-foreground",
        normalized === "suspended" && "bg-destructive/15 text-destructive",
        normalized === "flagged" && "bg-warning/15 text-warning",
        normalized !== "active" &&
          normalized !== "suspended" &&
          normalized !== "flagged" &&
          normalized !== "pending" &&
          normalized !== "denied" &&
          "bg-accent/50 text-muted-foreground"
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
        isPaid && "bg-success/50 text-success",
        isTrial && "bg-info/60 text-info",
        !isPaid && !isTrial && "bg-accent/40 text-foreground"
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
        active ? "bg-success/20 text-success" : "bg-destructive/50 text-destructive"
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
            className="h-9 w-9 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={`Actions for ${row.email}`}
          >
            <MoreVertical className="h-4 w-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-56 border-border bg-card text-foreground"
        >
          <DropdownMenuItem
            className="focus:bg-muted focus:text-foreground"
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
            className="focus:bg-muted focus:text-foreground"
            onSelect={(e) => {
              e.preventDefault()
              setMenuOpen(false)
              setCreditDialogOpen(true)
            }}
          >
            Adjust credit balance
          </DropdownMenuItem>
          <DropdownMenuItem
            className="focus:bg-muted focus:text-foreground"
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
                className="focus:bg-success/40 focus:text-success"
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
                className="focus:bg-destructive/40 focus:text-destructive"
                onSelect={(e) => {
                  e.preventDefault()
                  void handleStatusChange("denied")
                }}
              >
                Deny shop
              </DropdownMenuItem>
            </>
          ) : null}
          <DropdownMenuSeparator className="bg-accent" />
          {row.has_active_subscription ? (
            <DropdownMenuItem
              variant="destructive"
              disabled={toggleBusy}
              className="focus:bg-destructive/40 focus:text-destructive"
              onSelect={(e) => {
                e.preventDefault()
                void handleSubscriptionToggle(false)
              }}
            >
              {toggleBusy ? "Saving…" : "Deactivate subscription (emergency lock)"}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              className="focus:bg-muted focus:text-foreground"
              onSelect={() => {
                setMenuOpen(false)
                onManageUser()
              }}
            >
              Set subscription tier…
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={creditDialogOpen} onOpenChange={setCreditDialogOpen}>
        <DialogContent className="border-border bg-card text-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Adjust credit balance</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Apply a positive or negative USD adjustment for {row.email}. Current balance:{" "}
              {formatUsd(row.carrier_credit)}.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <label className="mb-2 block text-xs font-medium text-muted-foreground" htmlFor={`credit-${row.user_id}`}>
              Amount (± USD)
            </label>
            <Input
              id={`credit-${row.user_id}`}
              type="number"
              step="0.01"
              placeholder="e.g. 10 or -5"
              value={creditAmount}
              onChange={(e) => setCreditAmount(e.target.value)}
              className="border-border bg-background/80 text-foreground"
              disabled={creditBusy}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              className="border-border text-foreground hover:bg-muted"
              disabled={creditBusy}
              onClick={() => setCreditDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-operator text-operator-foreground hover:bg-operator"
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
  businessEconomics = [],
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
      const matchesRole =
        roleTab === "all"
          ? true
          : roleTab === "OWNER"
            ? isShopOwnerRow(u)
            : u.role === roleTab
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
      else if (isShopOwnerRow(u)) owners += 1
    }
    return { all: users.length, owner: owners, receptionist: receptionists }
  }, [users])

  const routingPoolAvailableUsd = metrics?.telnyx_routing_pool?.available_credit_usd ?? NaN
  const routingPoolAvailableLabel = metrics?.telnyx_routing_pool?.available_credit_label ?? ""

  // Shops waiting for you to Approve or Deny.
  const pendingOwners = useMemo(
    () => users.filter((u) => isShopOwnerRow(u) && u.account_status === "pending"),
    [users]
  )

  // Short “find a shop” list on Home (real owner shops only).
  const homeShopMatches = useMemo(() => {
    const q = homeShopQuery.trim().toLowerCase()
    const owners = users.filter((u) => isShopOwnerRow(u))
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

  const pageTitle = view === "home" ? "Home" : "Businesses"
  const pageSubtitle =
    view === "home"
      ? "Phone balance, Stripe cash, paying shops — then pending signups"
      : "Name, status, plan. Tap a row to manage."

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-3 sm:space-y-6 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">{pageTitle}</h1>
          <p className="mt-0.5 hidden text-sm text-muted-foreground md:block">{pageSubtitle}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 border-border text-foreground"
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
              <h2 className="text-sm font-semibold text-foreground">At a glance</h2>
              <p className="hidden text-xs text-muted-foreground md:block">
                Tap a number for the breakdown.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
                label="Business wallets"
                value={metrics?.finance?.total_business_wallet_balance_label ?? "—"}
                hint="What shops have collected"
                onClick={() => setMoneySheet("business_wallets")}
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
                <h2 className="text-sm font-semibold text-foreground">Find a shop</h2>
                <p className="hidden text-xs text-muted-foreground md:block">Tap a name to open Manage.</p>
              </div>
              <Link
                href="/admin/businesses"
                className="shrink-0 rounded-lg bg-operator px-3 py-2 text-sm font-semibold text-operator-foreground hover:bg-operator"
              >
                All businesses
              </Link>
            </div>
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                type="search"
                placeholder="Shop name or email…"
                value={homeShopQuery}
                onChange={(e) => setHomeShopQuery(e.target.value)}
                className="border-border bg-background/60 pl-9 text-foreground placeholder:text-muted-foreground"
              />
            </div>
            {loading && users.length === 0 ? (
              <div className="h-48 rounded-xl border border-border bg-background/40" aria-hidden />
            ) : homeShopMatches.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                No shops match.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {homeShopMatches.map((row) => (
                  <li key={row.user_id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-muted/40"
                      onClick={() => onManageUser(row)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-foreground">
                          {row.business_name.trim() || row.email}
                        </span>
                        <span className="block truncate text-2xs text-muted-foreground">{row.email}</span>
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
              className="w-full border-border bg-background text-foreground sm:max-w-md"
            >
              <SheetHeader>
                <SheetTitle className="text-foreground">
                  {moneySheet === "telnyx"
                    ? "Telnyx phone balance"
                    : moneySheet === "saas"
                      ? "SaaS revenue"
                      : moneySheet === "card_fees"
                        ? "Card fees this month"
                        : moneySheet === "credits"
                          ? "Credit packs sold"
                          : moneySheet === "stripe"
                            ? "Stripe balance (Lyncr)"
                            : moneySheet === "wallets"
                              ? "Prepaid phone wallets"
                              : moneySheet === "business_wallets"
                                ? "Business wallet balances"
                                : moneySheet === "paying"
                                  ? "Paying businesses"
                                  : "Platform money"}
                </SheetTitle>
                <SheetDescription className="text-muted-foreground">
                  {moneySheet === "telnyx"
                    ? "Money sitting in Telnyx to pay for inbound/outbound calls, SMS, and numbers."
                    : moneySheet === "saas"
                      ? "Two numbers, on purpose: a list-price estimate, and the real Stripe cash collected this period."
                      : moneySheet === "card_fees"
                        ? "Lyncr’s Connect application fee when shops run Collect / Tap / pay links. Charged only when Stripe creates an application_fee on the Connect charge."
                        : moneySheet === "credits"
                          ? "What businesses paid Lyncr for prepaid phone minutes this calendar month."
                          : moneySheet === "stripe"
                            ? "Lyncr’s platform Stripe account — not shop Connect wallets."
                            : moneySheet === "wallets"
                              ? "Sum of credit sitting in customer Pay wallets — liability until they burn minutes."
                              : moneySheet === "business_wallets"
                                ? "What every business currently has sitting in their own job-payment wallet — updates the instant they collect a charge or send money to their bank."
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
                      label={`Actual revenue · ${metrics?.finance?.business_money_period_label ?? "All time"}`}
                      value={metrics?.finance?.actual_plan_revenue_period_label ?? formatUsd(0)}
                      note="Real Stripe paid invoices, summed across every business for the selected Business money period. Businesses with no Stripe customer on file contribute $0 here, same as their own row."
                    />
                    <MoneyDetailRow
                      label="Platform net · same period"
                      value={metrics?.finance?.platform_net_period_label ?? formatUsd(0)}
                      note="Sum of every business's (plan cash + card fees + credit packs − est. phone cost). Phone cost is a wholesale estimate unless a shop's prepaid wallet burn is higher — see each business's breakdown for Actual vs. Est."
                    />
                    <MoneyDetailRow
                      label="Estimated MRR"
                      value={metrics?.finance?.estimated_mrr_label ?? formatUsd(0)}
                      note="Not real billing data — Starter $19 · Pro $49 · Business $99 list prices × active paid counts. Use Actual revenue above for real cash."
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
                {moneySheet === "business_wallets" ? (
                  <>
                    <MoneyDetailRow
                      label="All businesses, combined"
                      value={metrics?.finance?.total_business_wallet_balance_label ?? formatUsd(0)}
                      note="Right now — not a period total. Moves the instant any business collects a charge, gets refunded/disputed, or sends money to their bank."
                    />
                    {businessEconomics
                      .slice()
                      .sort((a, b) => b.collected_wallet_balance_cents - a.collected_wallet_balance_cents)
                      .filter((row) => row.collected_wallet_balance_cents !== 0)
                      .slice(0, 20)
                      .map((row) => (
                        <MoneyDetailRow
                          key={row.user_id}
                          label={row.business_name}
                          value={row.collected_wallet_balance_label}
                        />
                      ))}
                    {businessEconomics.every((row) => row.collected_wallet_balance_cents === 0) ? (
                      <p className="py-3 text-xs text-muted-foreground">
                        No business has a non-zero wallet balance yet.
                      </p>
                    ) : null}
                  </>
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

          {metrics ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border/80 bg-background/40 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">System</span>
            <span className="inline-flex items-center gap-2">
              <Database className="h-3.5 w-3.5" aria-hidden /> Neon
              <HealthDot status={metrics.health.neon} />
            </span>
            <span className="inline-flex items-center gap-2">
              <Phone className="h-3.5 w-3.5" aria-hidden /> Telnyx
              <HealthDot status={metrics.health.telnyx} />
            </span>
            <span className="inline-flex items-center gap-2">
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> Sentry
              <HealthDot status={metrics.health.sentry} />
            </span>
          </div>
          ) : null}

          <CallHealthBoard />

          {pendingOwners.length > 0 ? (
          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Pending shops</h2>
              <p className="hidden text-xs text-muted-foreground md:block">
                New signups waiting for Approve or Deny.
              </p>
            </div>
              <ul className="divide-y divide-border rounded-xl border border-border">
                {pendingOwners.map((row) => (
                  <li key={row.user_id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-muted/40"
                      onClick={() => onManageUser(row)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-foreground">
                          {row.business_name.trim() || row.email}
                        </span>
                        <span className="block truncate text-2xs text-muted-foreground">{row.email}</span>
                      </span>
                      <AccountStatusBadge status={row.account_status} />
                    </button>
                  </li>
                ))}
              </ul>
          </section>
          ) : null}
        </>
      ) : null}

      {view === "businesses" ? (
          <Card className="border-border bg-card/40">
            <CardHeader className="space-y-3 border-b border-border/80 pb-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
            <div className="relative max-w-md flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                type="search"
                placeholder="Search shop name, email, or phone…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="border-border bg-background/60 pl-9 text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <Select value={tierFilter} onValueChange={setTierFilter}>
              <SelectTrigger className="h-9 w-full border-border bg-background text-foreground sm:w-[160px]">
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
              <SelectTrigger className="h-9 w-full border-border bg-background text-foreground sm:w-[160px]">
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
            <TabsList className="h-auto w-full flex-wrap justify-start bg-muted/60 sm:w-auto">
              <TabsTrigger
                value="all"
                className="text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground"
              >
                All
                <span className="ml-1.5 rounded bg-accent/70 px-2 text-2xs tabular-nums text-foreground">
                  {roleCounts.all}
                </span>
              </TabsTrigger>
              <TabsTrigger
                value="OWNER"
                className="text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground"
              >
                Owners
                <span className="ml-1.5 rounded bg-accent/70 px-2 text-2xs tabular-nums text-foreground">
                  {roleCounts.owner}
                </span>
              </TabsTrigger>
              <TabsTrigger
                value="RECEPTIONIST"
                className="text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground"
              >
                Receptionists
                <span className="ml-1.5 rounded bg-accent/70 px-2 text-2xs tabular-nums text-foreground">
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
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="sticky left-0 z-10 min-w-[11rem] bg-card text-muted-foreground">
                    Business
                  </TableHead>
                  <TableHead className="text-muted-foreground">Status</TableHead>
                  <TableHead className="text-muted-foreground">Plan</TableHead>
                  <TableHead className="w-[4.5rem] text-muted-foreground">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.length === 0 ? (
                  <TableRow className="border-border">
                    <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                      No users match your filter.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredUsers.map((row) => {
                    const isOwner = row.role === "OWNER"
                    return (
                    <TableRow
                      key={row.user_id}
                      className="cursor-pointer border-border transition-colors hover:bg-muted/40"
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
                      <TableCell className="sticky left-0 z-10 min-w-[11rem] bg-card/95">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground" title={row.business_name || row.email}>
                            {row.business_name.trim() || "—"}
                          </p>
                          <p className="truncate text-2xs text-muted-foreground">{row.email}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <AccountStatusBadge status={row.account_status} />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
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
