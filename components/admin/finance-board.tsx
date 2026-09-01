"use client"

// Admin Finance — Lyncr's own performance, every business's real balance (not blended
// together), a revenue-over-time chart, and a filterable platform-wide transaction ledger.

import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts"
import { useLyncrAdminDashboardData } from "@/hooks/use-lyncr-admin-dashboard"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Database, MessageCircle, Phone, RefreshCw, ShieldAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AdminBusinessEconomics, LyncrAdminDirectoryRow } from "@/lib/types"
import type { AdminSupportAlert } from "@/lib/admin-support-alerts"
import { AdminUserManageDrawer } from "@/components/admin-user-manage-drawer"
import { AccountStatusBadge, isShopOwnerRow } from "@/components/lyncr-admin-dashboard"
import { CallHealthBoard } from "@/components/admin/call-health-board"

// Static values (not CSS var()) — SVG fill attributes set by recharts don't resolve custom
// properties reliably. Pulled from app/globals.css, except the bar fill: the app's --success
// (L 0.72, tuned for small text) sits outside the dark-mode chart lightness band (0.48–0.67,
// dataviz skill), so the bar uses a deeper shade of the same hue — validated with
// validate_palette.js against this card's actual surface (#0c101a): all checks pass.
const CHART_SUCCESS = "oklch(0.60 0.19 145)"
const CHART_MUTED = "oklch(0.62 0.02 275)"
const CHART_BORDER = "oklch(0.30 0.022 268)"
const CHART_TOOLTIP_BG = "oklch(0.175 0.022 268)"
const CHART_TOOLTIP_FG = "oklch(0.96 0.01 275)"

type LedgerRow = {
  id: string
  ownerUserId: string | null
  businessName: string
  amountCents: number
  amountLabel: string
  status: "PENDING" | "COMPLETED" | "FAILED"
  entryType: "CHARGE" | "REVERSAL" | "PAYOUT" | "FEE"
  paymentMethod: string
  stripePaymentIntentId: string | null
  customerName: string | null
  reversalReason: string | null
  createdAt: string
}

type LedgerPage = { rows: LedgerRow[]; totalCount: number; limit: number; offset: number }

type BillingLedgerRow = {
  id: string
  ownerUserId: string | null
  businessName: string
  deltaCents: number
  deltaLabel: string
  balanceAfterCents: number
  balanceAfterLabel: string
  reason: string
  reference: string | null
  createdAt: string
}

type BillingLedgerPage = {
  rows: BillingLedgerRow[]
  totalCount: number
  limit: number
  offset: number
}

type InvoiceRow = {
  id: string
  amountLabel: string
  amountCents: number
  status: string
  createdLabel: string
  paidLabel: string | null
  hostedInvoiceUrl: string | null
}

type DailyPoint = {
  day: string
  chargeCents: number
  reversalCents: number
  feeCents: number
  payoutCents: number
}

function formatUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success("Copied")
  } catch {
    toast.error("Could not copy — select the text and copy it manually.")
  }
}

function formatChartDay(day: string): string {
  // day is YYYY-MM-DD (US Eastern) — parse as local calendar date, not UTC midnight.
  const [y, m, d] = day.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function ledgerTypeTone(entryType: LedgerRow["entryType"]): string {
  if (entryType === "CHARGE") return "text-success"
  if (entryType === "REVERSAL") return "text-warning"
  if (entryType === "PAYOUT") return "text-info"
  return "text-muted-foreground"
}

type CardKey = "stripe_available" | "stripe_pending" | "actual_revenue" | "estimated_mrr" | "card_fees" | "platform_net"

function PerfCard({
  label,
  value,
  note,
  onClick,
}: {
  label: string
  value: string
  note?: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "rounded-xl border border-border bg-card/60 px-3.5 py-3 text-left transition-colors",
        onClick && "hover:border-operator/40 hover:bg-operator/10 cursor-pointer",
        !onClick && "cursor-default"
      )}
    >
      <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums text-foreground">{value}</p>
      {note ? <p className="mt-0.5 text-2xs leading-snug text-muted-foreground">{note}</p> : null}
    </button>
  )
}

/**
 * The one number this page leads with: is Lyncr profitable right now. Everything else
 * (Stripe balance, revenue, fees) supports this but isn't what you check first.
 */
function HeroStat({
  label,
  value,
  ahead,
  note,
  onClick,
}: {
  label: string
  value: string
  ahead: boolean
  note?: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-2xl border px-5 py-4 text-left transition-colors sm:px-6 sm:py-5",
        ahead
          ? "border-success/35 bg-success/10 hover:bg-success/15"
          : "border-warning/35 bg-warning/10 hover:bg-warning/15"
      )}
    >
      <p
        className={cn(
          "text-2xs font-semibold uppercase tracking-wide",
          ahead ? "text-success/80" : "text-warning/80"
        )}
      >
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-4xl font-bold tabular-nums sm:text-5xl",
          ahead ? "text-success" : "text-warning"
        )}
      >
        {value}
      </p>
      {note ? <p className="mt-1.5 text-xs leading-snug text-muted-foreground">{note}</p> : null}
    </button>
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

function roleLabel(role: AdminSupportAlert["lastSenderRole"]): string | null {
  if (role === "field_tech") return "Tech"
  if (role === "receptionist") return "Receptionist"
  if (role === "owner") return "Owner"
  return null
}

/**
 * Small red dot + count beside a business name — the "individual business alert" the whole
 * point of folding Support into Finance was to surface. When the last message came from a
 * specific tech/receptionist rather than the owner, the title shows "Business / Tech" so the
 * hierarchy is visible without a click.
 */
function SupportAlertDot({
  alert,
  businessName,
  onClick,
}: {
  alert: AdminSupportAlert | undefined
  businessName: string
  onClick?: () => void
}) {
  if (!alert || alert.unreadCount <= 0) return null
  const who = roleLabel(alert.lastSenderRole)
  const title =
    (who && who !== "Owner" ? `${businessName} / ${who}` : businessName) +
    ` — ${alert.unreadCount} unread` +
    (alert.lastMessagePreview ? `: "${alert.lastMessagePreview}"` : "")
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      title={title}
      className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-destructive/20 px-1.5 py-0.5 align-middle text-2xs font-semibold text-destructive hover:bg-destructive/30"
    >
      <MessageCircle className="h-2.5 w-2.5" aria-hidden />
      {alert.unreadCount}
    </button>
  )
}

function RevenueChart() {
  const [points, setPoints] = useState<DailyPoint[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/admin/finance/daily?days=30", {
          credentials: "include",
          cache: "no-store",
        })
        const json = (await res.json()) as { data?: { points?: DailyPoint[] } }
        if (!cancelled) setPoints(json.data?.points ?? [])
      } catch {
        if (!cancelled) setPoints([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const chartData = useMemo(
    () =>
      (points ?? []).map((p) => ({
        day: formatChartDay(p.day),
        dollars: p.chargeCents / 100,
      })),
    [points]
  )

  const total = useMemo(() => (points ?? []).reduce((s, p) => s + p.chargeCents, 0), [points])
  // Explicit domain — recharts' "auto" max was compressing bars to a fraction of the chart
  // height for reasons that didn't trace to any value in chartData; computing it ourselves
  // is unambiguous and removes the dependency on recharts' internal domain inference.
  const yDomainMax = useMemo(() => {
    const max = chartData.reduce((m, d) => Math.max(m, d.dollars), 0)
    return max <= 0 ? 100 : Math.ceil((max * 1.15) / 50) * 50
  }, [chartData])

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Collected, last 30 days</h2>
        <p className="text-xs text-muted-foreground">
          Real charges across every business · {formatUsd(total)} total
        </p>
      </div>
      <div className="rounded-xl border border-border bg-card/60 px-2 py-3">
        {loading ? (
          <div className="flex h-52 items-center justify-center text-xs text-muted-foreground">
            Loading…
          </div>
        ) : chartData.every((d) => d.dollars === 0) ? (
          <div className="flex h-52 items-center justify-center text-xs text-muted-foreground">
            No charges in the last 30 days.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={CHART_BORDER} strokeWidth={1} />
              <XAxis
                dataKey="day"
                tick={{ fill: CHART_MUTED, fontSize: 11 }}
                axisLine={{ stroke: CHART_BORDER }}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis
                domain={[0, yDomainMax]}
                tick={{ fill: CHART_MUTED, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={56}
                tickFormatter={(v: number) => `$${v.toLocaleString("en-US")}`}
              />
              <RechartsTooltip
                cursor={{ fill: CHART_BORDER, opacity: 0.3 }}
                contentStyle={{
                  background: CHART_TOOLTIP_BG,
                  border: `1px solid ${CHART_BORDER}`,
                  borderRadius: 8,
                  color: CHART_TOOLTIP_FG,
                  fontSize: 12,
                }}
                labelStyle={{ color: CHART_TOOLTIP_FG, fontWeight: 600 }}
                formatter={(value: number) => [
                  value.toLocaleString("en-US", { style: "currency", currency: "USD" }),
                  "Collected",
                ]}
              />
              <Bar
                dataKey="dollars"
                fill={CHART_SUCCESS}
                radius={[4, 4, 0, 0]}
                maxBarSize={24}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  )
}

function CardDetailContent({
  cardKey,
  finance,
  businessEconomics,
  onJumpToLedger,
  onOpenBusiness,
  onJumpToBillingLedger,
  onOpenInvoices,
}: {
  cardKey: CardKey
  finance: NonNullable<ReturnType<typeof useLyncrAdminDashboardData>["metrics"]>["finance"]
  businessEconomics: AdminBusinessEconomics[]
  /** Backed by real wallet_transactions rows — jumps straight to them, filtered. */
  onJumpToLedger: (filters: { entryType?: string; ownerUserId?: string }) => void
  /** Not in the wallet ledger (Stripe subscriptions) — opens the business's own detail instead. */
  onOpenBusiness: (userId: string) => void
  /** Backed by real billing_ledger rows (prepaid phone credit) — jumps straight to them, filtered. */
  onJumpToBillingLedger: (filters: { reason?: string; ownerUserId?: string }) => void
  /** Live Stripe invoices for one business — what its Plan cash is actually made of. */
  onOpenInvoices: (userId: string, businessName: string) => void
}) {
  if (cardKey === "stripe_available" || cardKey === "stripe_pending") {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-border bg-card/40 px-4 py-3">
          <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Available</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-foreground">
            {finance?.stripe_platform_available_label ?? "—"}
          </p>
          <p className="mt-1 text-2xs text-muted-foreground">Ready to pay out from Lyncr's Stripe account.</p>
        </div>
        <div className="rounded-xl border border-border bg-card/40 px-4 py-3">
          <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Pending</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-foreground">
            {finance?.stripe_platform_pending_label ?? "—"}
          </p>
          <p className="mt-1 text-2xs text-muted-foreground">Not yet available — still clearing.</p>
        </div>
        <p className="text-2xs leading-snug text-muted-foreground">
          This is Lyncr's own platform Stripe balance — the application fee Lyncr keeps from card
          charges, plus subscription revenue. It is separate from any business's own Connect
          wallet balance, shown below under Business balances.
        </p>
      </div>
    )
  }

  if (cardKey === "estimated_mrr") {
    const tiers = finance?.active_paid_by_tier
    return (
      <div className="space-y-1">
        <p className="mb-2 text-2xs leading-snug text-muted-foreground">
          Not real billing data — active paid subscriptions × list price (Starter $19 · Professional
          $49 · Business $99). See Actual revenue for real Stripe-collected cash.
        </p>
        {[
          { label: "Starter", n: tiers?.starter ?? 0, price: 1900 },
          { label: "Professional", n: tiers?.professional ?? 0, price: 4900 },
          { label: "Business", n: tiers?.business ?? 0, price: 9900 },
        ].map((t) => (
          <div key={t.label} className="flex items-center justify-between border-b border-border/60 py-2 text-sm">
            <span className="text-foreground">
              {t.label} <span className="text-muted-foreground">× {t.n}</span>
            </span>
            <span className="tabular-nums text-foreground">{formatUsd(t.n * t.price)}</span>
          </div>
        ))}
      </div>
    )
  }

  if (cardKey === "actual_revenue") {
    const rows = businessEconomics.filter((b) => b.plan_cash_source === "stripe" && b.plan_revenue_cents !== 0)
    return (
      <div className="space-y-1">
        <p className="mb-2 text-2xs leading-snug text-muted-foreground">
          Real Stripe-paid invoices, {finance?.business_money_period_label ?? "all time"}. Businesses
          with no Stripe customer on file, or no payment this period, aren't listed. Tap a business
          to see its real Stripe invoices.
        </p>
        {rows.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">No Stripe subscription revenue in this window.</p>
        ) : (
          rows.map((b) => (
            <button
              type="button"
              key={b.user_id}
              onClick={() => onOpenInvoices(b.user_id, b.business_name)}
              className="block w-full border-b border-border/60 py-2 text-left hover:bg-muted/30"
            >
              <div className="flex items-center justify-between text-sm">
                <span className="text-foreground">{b.business_name}</span>
                <span className="tabular-nums text-foreground">{b.plan_revenue_label}</span>
              </div>
              <p className="mt-0.5 text-2xs text-muted-foreground">{b.plan_status_label}</p>
            </button>
          ))
        )}
      </div>
    )
  }

  if (cardKey === "card_fees") {
    const rows = businessEconomics.filter((b) => b.card_fee_mtd_cents !== 0)
    return (
      <div className="space-y-1">
        <p className="mb-2 text-2xs leading-snug text-muted-foreground">
          Lyncr's Connect application fee, {finance?.business_money_period_label ?? "all time"}. Tagged
          Actual when read directly from Stripe, Est. when estimated from a completed charge.
        </p>
        <button
          type="button"
          onClick={() => onJumpToLedger({ entryType: "FEE" })}
          className="mb-2 text-2xs font-semibold text-operator hover:underline"
        >
          See every fee transaction →
        </button>
        {rows.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">No card fees in this window.</p>
        ) : (
          rows.map((b) => (
            <button
              type="button"
              key={b.user_id}
              onClick={() => onJumpToLedger({ entryType: "FEE", ownerUserId: b.user_id })}
              className="flex w-full items-center justify-between border-b border-border/60 py-2 text-left text-sm hover:bg-muted/30"
            >
              <span className="flex items-center gap-2 text-foreground">
                {b.business_name}
                <span className="rounded bg-muted px-1.5 py-0.5 text-2xs font-semibold uppercase text-muted-foreground">
                  {b.card_fee_source === "stripe" ? "Actual" : "Est."}
                </span>
              </span>
              <span className="tabular-nums text-foreground">{b.card_fee_mtd_label}</span>
            </button>
          ))
        )}
      </div>
    )
  }

  // platform_net — show what it's actually made of first (same four lines the per-business
  // drawer shows, just summed platform-wide), then which businesses contributed.
  const sorted = businessEconomics
    .filter((b) => b.net_cents !== 0)
    .slice()
    .sort((a, b) => b.net_cents - a.net_cents)
  const netAhead = (finance?.platform_net_period_cents ?? 0) >= 0
  return (
    <div className="space-y-1">
      <div
        className={cn(
          "mb-3 rounded-xl border px-3 py-3",
          netAhead ? "border-success/35 bg-success/10" : "border-warning/35 bg-warning/10"
        )}
      >
        <p
          className={cn(
            "text-2xs font-semibold uppercase tracking-wide",
            netAhead ? "text-success/80" : "text-warning/80"
          )}
        >
          {netAhead ? "We're ahead" : "We're behind"}
        </p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
          {finance?.platform_net_period_label ?? "—"}
        </p>
        <p className="mt-1 text-2xs text-muted-foreground">
          Net for Lyncr · {finance?.business_money_period_label ?? "All time"}, every business
        </p>
      </div>

      <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
        What it's made of
      </p>
      <div className="flex items-center justify-between border-b border-border/60 py-2 text-sm">
        <span className="text-foreground">Plan cash (Stripe)</span>
        <span className="tabular-nums font-medium text-success">
          {finance?.actual_plan_revenue_period_label ?? "$0"}
        </span>
      </div>
      <button
        type="button"
        onClick={() => onJumpToLedger({ entryType: "FEE" })}
        className="flex w-full items-center justify-between border-b border-border/60 py-2 text-left text-sm hover:bg-muted/30"
      >
        <span className="text-foreground">Card fees to Lyncr →</span>
        <span className="tabular-nums font-medium text-success">
          {finance?.net_breakdown_card_fees_label ?? "$0"}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onJumpToBillingLedger({ reason: "stripe_credit_pack" })}
        className="flex w-full items-center justify-between border-b border-border/60 py-2 text-left text-sm hover:bg-muted/30"
      >
        <span className="text-foreground">Credit packs sold →</span>
        <span className="tabular-nums font-medium text-success">
          {finance?.net_breakdown_credit_packs_label ?? "$0"}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onJumpToBillingLedger({ reason: "carrier_number_purchase" })}
        className="flex w-full items-center justify-between border-b border-border/60 py-2 text-left text-sm hover:bg-muted/30"
      >
        <span className="text-foreground">Phone cost (est.) →</span>
        <span className="tabular-nums font-medium text-warning">
          −{finance?.net_breakdown_phone_cost_label ?? "$0"}
        </span>
      </button>
      <div className="flex items-center justify-between border-b border-border py-2 text-sm">
        <span className="font-semibold text-foreground">Net for Lyncr</span>
        <span className="tabular-nums font-semibold text-foreground">
          {finance?.platform_net_period_label ?? "—"}
        </span>
      </div>
      <p className="mt-2 text-2xs leading-snug text-muted-foreground">
        Plan cash, credit packs, and phone cost aren't in the wallet ledger — Plan cash is real
        Stripe invoices (tap a business below), Credit packs and Phone cost are the billing
        ledger, tappable above.
      </p>

      <p className="mb-1 mt-4 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
        Which businesses
      </p>
      {sorted.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">No activity in this window.</p>
      ) : (
        sorted.map((b) => (
          <button
            type="button"
            key={b.user_id}
            onClick={() => onOpenBusiness(b.user_id)}
            className="flex w-full items-center justify-between border-b border-border/60 py-2 text-left text-sm hover:bg-muted/30"
          >
            <span className="text-foreground">{b.business_name}</span>
            <span className={cn("tabular-nums font-medium", b.ahead ? "text-success" : "text-warning")}>
              {b.net_label}
            </span>
          </button>
        ))
      )}
    </div>
  )
}

const CARD_TITLES: Record<CardKey, string> = {
  stripe_available: "Lyncr's Stripe balance",
  stripe_pending: "Lyncr's Stripe balance",
  actual_revenue: "Actual revenue breakdown",
  estimated_mrr: "Estimated MRR breakdown",
  card_fees: "Card fees breakdown",
  platform_net: "Platform net breakdown",
}

export function AdminFinanceBoard() {
  const { metrics, users, businessEconomics, supportAlerts, loading, refreshing, fetchLatestAdminStats } =
    useLyncrAdminDashboardData()
  const [openCard, setOpenCard] = useState<CardKey | null>(null)

  // Business drill-down — reuses the same rich Manage drawer the old Businesses page used,
  // just reachable directly from a business's row here instead of a separate page trip.
  const [manageUser, setManageUser] = useState<LyncrAdminDirectoryRow | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const openBusiness = useCallback(
    (userId: string) => {
      const row = users.find((u) => u.user_id === userId)
      if (!row) return
      // The business drawer is a Sheet (z-6010) — close any open Transactions/Billing ledger
      // Dialog (z-7010) first, or the drawer opens visually behind it.
      setLedgerDialogOpen(false)
      setBillingDialogOpen(false)
      setManageUser(row)
      setDrawerOpen(true)
    },
    [users]
  )

  const pendingOwners = useMemo(
    () => users.filter((u) => isShopOwnerRow(u) && u.account_status === "pending"),
    [users]
  )

  const sortedBusinesses = useMemo(
    () =>
      businessEconomics
        .slice()
        .sort((a, b) => b.collected_wallet_balance_cents - a.collected_wallet_balance_cents),
    [businessEconomics]
  )

  // --- Transaction ledger: filters + pagination, fetched independently of the shared hook. ---
  const [ownerFilter, setOwnerFilter] = useState<string>("all")
  const [typeFilter, setTypeFilter] = useState<string>("all")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [search, setSearch] = useState("")
  const [offset, setOffset] = useState(0)
  const limit = 50
  const [ledgerDialogOpen, setLedgerDialogOpen] = useState(false)

  /**
   * "All the way to the source" — every card breakdown that's backed by wallet_transactions
   * (fees, business balances) jumps here instead of just naming a number. Closes whatever sheet
   * is open, sets the ledger filters, and pops the real rows open in their own window.
   */
  const jumpToLedger = useCallback((filters: { entryType?: string; ownerUserId?: string }) => {
    setOpenCard(null)
    setTypeFilter(filters.entryType ?? "all")
    setOwnerFilter(filters.ownerUserId ?? "all")
    setOffset(0)
    setLedgerDialogOpen(true)
  }, [])

  // --- Billing ledger: separate table from a separate source table (billing_ledger, prepaid
  // phone credit) — Credit packs sold and the wallet-burn part of Phone cost live here, not in
  // wallet_transactions. Same pattern as the transaction ledger above, deliberately kept as its
  // own section rather than merged, since the two tables have different shapes and meanings.
  const [billingOwnerFilter, setBillingOwnerFilter] = useState<string>("all")
  const [billingReasonFilter, setBillingReasonFilter] = useState<string>("all")
  const [billingOffset, setBillingOffset] = useState(0)
  const billingLimit = 50
  const [billingDialogOpen, setBillingDialogOpen] = useState(false)

  const [billingLedger, setBillingLedger] = useState<BillingLedgerPage | null>(null)
  const [billingLedgerLoading, setBillingLedgerLoading] = useState(true)

  const fetchBillingLedger = useCallback(async () => {
    setBillingLedgerLoading(true)
    try {
      const params = new URLSearchParams()
      if (billingOwnerFilter !== "all") params.set("ownerUserId", billingOwnerFilter)
      if (billingReasonFilter !== "all") params.set("reason", billingReasonFilter)
      params.set("limit", String(billingLimit))
      params.set("offset", String(billingOffset))
      const res = await fetch(`/api/admin/finance/billing-ledger?${params.toString()}`, {
        credentials: "include",
        cache: "no-store",
      })
      const json = (await res.json()) as { data?: BillingLedgerPage; error?: string }
      if (!res.ok) throw new Error(json.error ?? "Failed to load billing ledger")
      setBillingLedger(json.data ?? null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load billing ledger")
    } finally {
      setBillingLedgerLoading(false)
    }
  }, [billingOwnerFilter, billingReasonFilter, billingOffset])

  useEffect(() => {
    void fetchBillingLedger()
  }, [fetchBillingLedger])

  useEffect(() => {
    setBillingOffset(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billingOwnerFilter, billingReasonFilter])

  const jumpToBillingLedger = useCallback((filters: { reason?: string; ownerUserId?: string }) => {
    setOpenCard(null)
    setBillingReasonFilter(filters.reason ?? "all")
    setBillingOwnerFilter(filters.ownerUserId ?? "all")
    setBillingOffset(0)
    setBillingDialogOpen(true)
  }, [])

  // --- Stripe invoices: live per-business fetch (not in either DB ledger) — what "Plan cash"
  // is actually made of. Opened as its own sheet since it needs a network call, not local state.
  const [invoicesFor, setInvoicesFor] = useState<{ userId: string; businessName: string } | null>(null)
  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null)
  const [invoicesLoading, setInvoicesLoading] = useState(false)

  const openInvoices = useCallback(async (userId: string, businessName: string) => {
    setOpenCard(null)
    setInvoicesFor({ userId, businessName })
    setInvoices(null)
    setInvoicesLoading(true)
    try {
      const res = await fetch(`/api/admin/finance/invoices?ownerUserId=${encodeURIComponent(userId)}`, {
        credentials: "include",
        cache: "no-store",
      })
      const json = (await res.json()) as {
        data?: { invoices?: InvoiceRow[] }
        error?: string
      }
      if (!res.ok) throw new Error(json.error ?? "Failed to load invoices")
      setInvoices(json.data?.invoices ?? [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load invoices")
      setInvoices([])
    } finally {
      setInvoicesLoading(false)
    }
  }, [])

  // Tapping a row shows that one transaction's own detail, not the whole business — "View
  // business" inside the detail is the deliberate way to jump further.
  const [selectedTxn, setSelectedTxn] = useState<LedgerRow | null>(null)
  const [selectedBillingEntry, setSelectedBillingEntry] = useState<BillingLedgerRow | null>(null)

  const [ledger, setLedger] = useState<LedgerPage | null>(null)
  const [ledgerLoading, setLedgerLoading] = useState(true)

  const fetchLedger = useCallback(async () => {
    setLedgerLoading(true)
    try {
      const params = new URLSearchParams()
      if (ownerFilter !== "all") params.set("ownerUserId", ownerFilter)
      if (typeFilter !== "all") params.set("entryType", typeFilter)
      if (statusFilter !== "all") params.set("status", statusFilter)
      if (search.trim()) params.set("q", search.trim())
      params.set("limit", String(limit))
      params.set("offset", String(offset))
      const res = await fetch(`/api/admin/finance/transactions?${params.toString()}`, {
        credentials: "include",
        cache: "no-store",
      })
      const json = (await res.json()) as { data?: LedgerPage; error?: string }
      if (!res.ok) throw new Error(json.error ?? "Failed to load transactions")
      setLedger(json.data ?? null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load transactions")
    } finally {
      setLedgerLoading(false)
    }
  }, [ownerFilter, typeFilter, statusFilter, search, offset])

  useEffect(() => {
    void fetchLedger()
  }, [fetchLedger])

  // Any filter change resets to page 1.
  useEffect(() => {
    setOffset(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerFilter, typeFilter, statusFilter, search])

  const finance = metrics?.finance

  const platformNetAhead = (finance?.platform_net_period_cents ?? 0) >= 0

  return (
    <div className="mx-auto max-w-7xl space-y-10 p-3 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Finance</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Lyncr's own performance, every business's real balance, and the full transaction ledger.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void fetchLatestAdminStats(true)
            void fetchLedger()
          }}
          disabled={refreshing}
        >
          <RefreshCw className={cn("h-4 w-4 sm:mr-2", refreshing && "animate-spin")} aria-hidden />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>

      {/* --- Lyncr's own performance: one hero number, five supporting ones below it. --- */}
      <section className="space-y-4">
        <HeroStat
          label={`Platform net · ${finance?.business_money_period_label ?? "All time"}`}
          value={finance?.platform_net_period_label ?? "—"}
          ahead={platformNetAhead}
          note="Revenue minus estimated phone cost, across every business. Tap for the per-business breakdown."
          onClick={() => setOpenCard("platform_net")}
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <PerfCard
            label="Stripe available"
            value={finance?.stripe_platform_available_label ?? "—"}
            note="Lyncr's own cash, ready to pay out"
            onClick={() => setOpenCard("stripe_available")}
          />
          <PerfCard
            label="Stripe pending"
            value={finance?.stripe_platform_pending_label ?? "—"}
            note="Not yet available"
            onClick={() => setOpenCard("stripe_pending")}
          />
          <PerfCard
            label={`Actual revenue · ${finance?.business_money_period_label ?? "All time"}`}
            value={finance?.actual_plan_revenue_period_label ?? "—"}
            note="Real Stripe-paid invoices, all businesses"
            onClick={() => setOpenCard("actual_revenue")}
          />
          <PerfCard
            label="Estimated MRR"
            value={finance?.estimated_mrr_label ?? "—"}
            note="List-price estimate, not real billing"
            onClick={() => setOpenCard("estimated_mrr")}
          />
          <PerfCard
            label="Card fees (MTD)"
            value={finance?.card_fee_revenue_mtd_label ?? "—"}
            note={finance?.card_fee_formula_label}
            onClick={() => setOpenCard("card_fees")}
          />
        </div>
      </section>

      <RevenueChart />

      {/* --- Every business's own balance, never blended into one number --- */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Business balances</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Each business's own job-payment wallet — sorted highest to lowest, not a platform
            total. Tap a row for account, money, staff, and support.
          </p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Business</TableHead>
                <TableHead className="text-right text-muted-foreground">Wallet balance</TableHead>
                <TableHead className="text-right text-muted-foreground">Lifetime collected</TableHead>
                <TableHead className="text-muted-foreground">Plan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && sortedBusinesses.length === 0 ? (
                <TableRow className="border-border">
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : sortedBusinesses.length === 0 ? (
                <TableRow className="border-border">
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                    No businesses yet.
                  </TableCell>
                </TableRow>
              ) : (
                sortedBusinesses.map((row) => (
                  <TableRow
                    key={row.user_id}
                    className="cursor-pointer border-border hover:bg-muted/30"
                    onClick={() => openBusiness(row.user_id)}
                  >
                    <TableCell className="font-medium text-foreground">
                      {row.business_name}
                      <SupportAlertDot
                        alert={supportAlerts[row.user_id]}
                        businessName={row.business_name}
                        onClick={() => openBusiness(row.user_id)}
                      />
                    </TableCell>
                    <TableCell
                      className="text-right font-semibold tabular-nums text-foreground underline decoration-dotted underline-offset-4 hover:text-operator"
                      onClick={(e) => {
                        e.stopPropagation()
                        jumpToLedger({ ownerUserId: row.user_id })
                      }}
                      title="See their transactions"
                    >
                      {row.collected_wallet_balance_label}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {row.plan_revenue_label}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{row.plan_tier_label}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* --- Needs attention: pending signups + platform health, so nothing that used to live
           on the old Home page is lost by making Finance the front door. --- */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Needs attention</h2>

        {metrics ? (
          <div className="rounded-xl border border-border/80 bg-card/40 px-3.5 py-2.5">
            <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              System
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
              <span className="inline-flex items-center gap-2">
                <Database className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /> Neon
                <HealthDot status={metrics.health.neon} />
              </span>
              <span className="inline-flex items-center gap-2">
                <Phone className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /> Telnyx
                <HealthDot status={metrics.health.telnyx} />
              </span>
              <span className="inline-flex items-center gap-2">
                <ShieldAlert className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /> Sentry
                <HealthDot status={metrics.health.sentry} />
              </span>
            </div>
          </div>
        ) : null}

        <CallHealthBoard />

        {pendingOwners.length > 0 ? (
          <div id="pending-shops" className="space-y-2 scroll-mt-4">
            <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              Pending shops — waiting for Approve or Deny
            </p>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {pendingOwners.map((row) => (
                <li key={row.user_id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-muted/40"
                    onClick={() => openBusiness(row.user_id)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {row.business_name.trim() || row.email}
                      </span>
                      <span className="block truncate text-2xs text-muted-foreground">{row.email}</span>
                    </span>
                    <AccountStatusBadge status={row.account_status} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {/* --- Full ledger + billing ledger: opened as their own pop-up windows instead of long
           inline sections, so getting to them never means scrolling the whole page. --- */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setLedgerDialogOpen(true)}
          className="flex items-center justify-between rounded-xl border border-border bg-card/40 px-4 py-3.5 text-left transition hover:border-operator/40 hover:bg-card/60"
        >
          <div>
            <h2 className="text-sm font-semibold text-foreground">Transactions</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Every charge, fee, reversal, and payout
              {ledger ? ` · ${ledger.totalCount} total` : ""}
            </p>
          </div>
          <span className="text-xs font-semibold text-operator">Open →</span>
        </button>
        <button
          type="button"
          onClick={() => setBillingDialogOpen(true)}
          className="flex items-center justify-between rounded-xl border border-border bg-card/40 px-4 py-3.5 text-left transition hover:border-operator/40 hover:bg-card/60"
        >
          <div>
            <h2 className="text-sm font-semibold text-foreground">Billing ledger (phone credit)</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Credit packs sold and phone cost
              {billingLedger ? ` · ${billingLedger.totalCount} total` : ""}
            </p>
          </div>
          <span className="text-xs font-semibold text-operator">Open →</span>
        </button>
      </section>

      <Dialog open={ledgerDialogOpen} onOpenChange={setLedgerDialogOpen}>
        <DialogContent className="flex max-h-[min(88vh,900px)] flex-col overflow-hidden border-border bg-background sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="text-foreground">Transactions</DialogTitle>
            <DialogDescription>
              Every charge, fee, reversal, and payout — search, filter, or tap a row's business.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 space-y-3 overflow-y-auto pr-1">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <Input
                placeholder="Search customer or business…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 border-border bg-background/60 sm:max-w-xs"
              />
              <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                <SelectTrigger className="h-9 w-full border-border bg-background text-foreground sm:w-[200px]">
                  <SelectValue placeholder="Business" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All businesses</SelectItem>
                  {businessEconomics.map((b) => (
                    <SelectItem key={b.user_id} value={b.user_id}>
                      {b.business_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="h-9 w-full border-border bg-background text-foreground sm:w-[150px]">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="CHARGE">Charge</SelectItem>
                  <SelectItem value="REVERSAL">Reversal</SelectItem>
                  <SelectItem value="PAYOUT">Payout</SelectItem>
                  <SelectItem value="FEE">Fee</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 w-full border-border bg-background text-foreground sm:w-[150px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="FAILED">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-muted-foreground">When</TableHead>
                    <TableHead className="text-muted-foreground">Business</TableHead>
                    <TableHead className="text-muted-foreground">Type</TableHead>
                    <TableHead className="text-right text-muted-foreground">Amount</TableHead>
                    <TableHead className="text-muted-foreground">Status</TableHead>
                    <TableHead className="text-muted-foreground">Customer</TableHead>
                    <TableHead className="text-muted-foreground">Stripe ref</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledgerLoading && !ledger ? (
                    <TableRow className="border-border">
                      <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : !ledger || ledger.rows.length === 0 ? (
                    <TableRow className="border-border">
                      <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                        No transactions match.
                      </TableCell>
                    </TableRow>
                  ) : (
                    ledger.rows.map((row) => (
                      <TableRow
                        key={row.id}
                        className="cursor-pointer border-border hover:bg-muted/30"
                        onClick={() => setSelectedTxn(row)}
                      >
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatDateTime(row.createdAt)}
                        </TableCell>
                        <TableCell className="text-foreground">
                          {row.businessName}
                          {row.ownerUserId ? (
                            <SupportAlertDot
                              alert={supportAlerts[row.ownerUserId]}
                              businessName={row.businessName}
                              onClick={() => openBusiness(row.ownerUserId!)}
                            />
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <span className={cn("text-xs font-semibold", ledgerTypeTone(row.entryType))}>
                            {row.entryType}
                            {row.reversalReason ? ` · ${row.reversalReason}` : ""}
                          </span>
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums font-medium",
                            row.amountCents < 0 ? "text-warning" : "text-foreground"
                          )}
                        >
                          {formatUsd(row.amountCents)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              "border-0 capitalize",
                              row.status === "COMPLETED" && "bg-success/15 text-success",
                              row.status === "PENDING" && "bg-warning/20 text-warning",
                              row.status === "FAILED" && "bg-destructive/15 text-destructive"
                            )}
                          >
                            {row.status.toLowerCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{row.customerName ?? "—"}</TableCell>
                        <TableCell className="max-w-[160px] truncate font-mono text-2xs text-muted-foreground">
                          {row.stripePaymentIntentId ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {ledger && ledger.totalCount > 0 ? (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {ledger.offset + 1}–{Math.min(ledger.offset + ledger.rows.length, ledger.totalCount)} of{" "}
                  {ledger.totalCount}
                </span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={offset === 0 || ledgerLoading}
                    onClick={() => setOffset(Math.max(0, offset - limit))}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={offset + limit >= ledger.totalCount || ledgerLoading}
                    onClick={() => setOffset(offset + limit)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={billingDialogOpen} onOpenChange={setBillingDialogOpen}>
        <DialogContent className="flex max-h-[min(88vh,900px)] flex-col overflow-hidden border-border bg-background sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-foreground">Billing ledger (phone credit)</DialogTitle>
            <DialogDescription>
              Every prepaid credit pack purchased and every dollar burned — a running balance, not
              wallet_transactions. Covers Credit packs sold and part of Phone cost.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 space-y-3 overflow-y-auto pr-1">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <Select value={billingOwnerFilter} onValueChange={setBillingOwnerFilter}>
                <SelectTrigger className="h-9 w-full border-border bg-background text-foreground sm:w-[200px]">
                  <SelectValue placeholder="Business" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All businesses</SelectItem>
                  {businessEconomics.map((b) => (
                    <SelectItem key={b.user_id} value={b.user_id}>
                      {b.business_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={billingReasonFilter} onValueChange={setBillingReasonFilter}>
                <SelectTrigger className="h-9 w-full border-border bg-background text-foreground sm:w-[220px]">
                  <SelectValue placeholder="Reason" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All reasons</SelectItem>
                  <SelectItem value="stripe_credit_pack">Credit pack purchased</SelectItem>
                  <SelectItem value="carrier_number_purchase">Phone number purchased</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-muted-foreground">When</TableHead>
                    <TableHead className="text-muted-foreground">Business</TableHead>
                    <TableHead className="text-muted-foreground">Reason</TableHead>
                    <TableHead className="text-right text-muted-foreground">Amount</TableHead>
                    <TableHead className="text-right text-muted-foreground">Balance after</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {billingLedgerLoading && !billingLedger ? (
                    <TableRow className="border-border">
                      <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : !billingLedger || billingLedger.rows.length === 0 ? (
                    <TableRow className="border-border">
                      <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                        No billing ledger activity matches.
                      </TableCell>
                    </TableRow>
                  ) : (
                    billingLedger.rows.map((row) => (
                      <TableRow
                        key={row.id}
                        className="cursor-pointer border-border hover:bg-muted/30"
                        onClick={() => setSelectedBillingEntry(row)}
                      >
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatDateTime(row.createdAt)}
                        </TableCell>
                        <TableCell className="text-foreground">{row.businessName}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.reason.replace(/_/g, " ")}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums font-medium",
                            row.deltaCents < 0 ? "text-warning" : "text-success"
                          )}
                        >
                          {row.deltaCents < 0 ? "" : "+"}
                          {row.deltaLabel}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {row.balanceAfterLabel}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {billingLedger && billingLedger.totalCount > 0 ? (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {billingLedger.offset + 1}–
                  {Math.min(billingLedger.offset + billingLedger.rows.length, billingLedger.totalCount)} of{" "}
                  {billingLedger.totalCount}
                </span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={billingOffset === 0 || billingLedgerLoading}
                    onClick={() => setBillingOffset(Math.max(0, billingOffset - billingLimit))}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={billingOffset + billingLimit >= billingLedger.totalCount || billingLedgerLoading}
                    onClick={() => setBillingOffset(billingOffset + billingLimit)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      {/* --- One transaction's own detail — tapping a row shows this, not the whole business. --- */}
      <Dialog open={selectedTxn != null} onOpenChange={(open) => !open && setSelectedTxn(null)}>
        <DialogContent className="border-border bg-background sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {selectedTxn ? formatUsd(selectedTxn.amountCents) : ""}
            </DialogTitle>
            <DialogDescription>{selectedTxn ? formatDateTime(selectedTxn.createdAt) : ""}</DialogDescription>
          </DialogHeader>
          {selectedTxn ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between border-b border-border/60 py-2 text-sm">
                <span className="text-muted-foreground">Business</span>
                <span className="text-foreground">{selectedTxn.businessName}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border/60 py-2 text-sm">
                <span className="text-muted-foreground">Type</span>
                <span className={cn("font-semibold", ledgerTypeTone(selectedTxn.entryType))}>
                  {selectedTxn.entryType}
                  {selectedTxn.reversalReason ? ` · ${selectedTxn.reversalReason}` : ""}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-border/60 py-2 text-sm">
                <span className="text-muted-foreground">Status</span>
                <Badge
                  variant="outline"
                  className={cn(
                    "border-0 capitalize",
                    selectedTxn.status === "COMPLETED" && "bg-success/15 text-success",
                    selectedTxn.status === "PENDING" && "bg-warning/20 text-warning",
                    selectedTxn.status === "FAILED" && "bg-destructive/15 text-destructive"
                  )}
                >
                  {selectedTxn.status.toLowerCase()}
                </Badge>
              </div>
              <div className="flex items-center justify-between border-b border-border/60 py-2 text-sm">
                <span className="text-muted-foreground">Customer</span>
                <span className="text-foreground">{selectedTxn.customerName ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border/60 py-2 text-sm">
                <span className="text-muted-foreground">Payment method</span>
                <span className="text-foreground">{selectedTxn.paymentMethod || "—"}</span>
              </div>
              <div className="py-2">
                <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Stripe ref</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-muted px-2 py-1.5 font-mono text-xs text-foreground">
                    {selectedTxn.stripePaymentIntentId ?? "—"}
                  </code>
                  {selectedTxn.stripePaymentIntentId ? (
                    <button
                      type="button"
                      onClick={() => copyToClipboard(selectedTxn.stripePaymentIntentId!)}
                      className="shrink-0 text-2xs font-semibold text-operator hover:underline"
                    >
                      Copy
                    </button>
                  ) : null}
                </div>
              </div>
              {selectedTxn.ownerUserId ? (
                <button
                  type="button"
                  onClick={() => {
                    const id = selectedTxn.ownerUserId!
                    setSelectedTxn(null)
                    openBusiness(id)
                  }}
                  className="mt-2 w-full rounded-lg border border-border py-2 text-center text-xs font-semibold text-operator hover:bg-muted/30"
                >
                  View business →
                </button>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* --- One billing ledger entry's own detail — same pattern as the transaction detail. --- */}
      <Dialog open={selectedBillingEntry != null} onOpenChange={(open) => !open && setSelectedBillingEntry(null)}>
        <DialogContent className="border-border bg-background sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {selectedBillingEntry ? selectedBillingEntry.deltaLabel : ""}
            </DialogTitle>
            <DialogDescription>
              {selectedBillingEntry ? formatDateTime(selectedBillingEntry.createdAt) : ""}
            </DialogDescription>
          </DialogHeader>
          {selectedBillingEntry ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between border-b border-border/60 py-2 text-sm">
                <span className="text-muted-foreground">Business</span>
                <span className="text-foreground">{selectedBillingEntry.businessName}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border/60 py-2 text-sm">
                <span className="text-muted-foreground">Reason</span>
                <span className="text-foreground">{selectedBillingEntry.reason.replace(/_/g, " ")}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border/60 py-2 text-sm">
                <span className="text-muted-foreground">Amount</span>
                <span
                  className={cn(
                    "font-semibold",
                    selectedBillingEntry.deltaCents < 0 ? "text-warning" : "text-success"
                  )}
                >
                  {selectedBillingEntry.deltaCents < 0 ? "" : "+"}
                  {selectedBillingEntry.deltaLabel}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-border/60 py-2 text-sm">
                <span className="text-muted-foreground">Balance after</span>
                <span className="text-foreground">{selectedBillingEntry.balanceAfterLabel}</span>
              </div>
              {selectedBillingEntry.reference ? (
                <div className="py-2">
                  <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Reference</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <code className="flex-1 truncate rounded bg-muted px-2 py-1.5 font-mono text-xs text-foreground">
                      {selectedBillingEntry.reference}
                    </code>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(selectedBillingEntry.reference!)}
                      className="shrink-0 text-2xs font-semibold text-operator hover:underline"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              ) : null}
              {selectedBillingEntry.ownerUserId ? (
                <button
                  type="button"
                  onClick={() => {
                    const id = selectedBillingEntry.ownerUserId!
                    setSelectedBillingEntry(null)
                    openBusiness(id)
                  }}
                  className="mt-2 w-full rounded-lg border border-border py-2 text-center text-xs font-semibold text-operator hover:bg-muted/30"
                >
                  View business →
                </button>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Sheet open={openCard != null} onOpenChange={(open) => !open && setOpenCard(null)}>
        <SheetContent side="right" className="w-full border-border bg-background text-foreground sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="text-foreground">{openCard ? CARD_TITLES[openCard] : ""}</SheetTitle>
            <SheetDescription className="sr-only">Breakdown detail</SheetDescription>
          </SheetHeader>
          <div className="mt-4 max-h-[calc(100vh-8rem)] overflow-y-auto px-1">
            {openCard ? (
              <CardDetailContent
                cardKey={openCard}
                finance={finance}
                businessEconomics={businessEconomics}
                onJumpToLedger={jumpToLedger}
                onOpenBusiness={openBusiness}
                onJumpToBillingLedger={jumpToBillingLedger}
                onOpenInvoices={openInvoices}
              />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={invoicesFor != null} onOpenChange={(open) => !open && setInvoicesFor(null)}>
        <SheetContent side="right" className="w-full border-border bg-background text-foreground sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="text-foreground">
              {invoicesFor ? `${invoicesFor.businessName} — Stripe invoices` : "Stripe invoices"}
            </SheetTitle>
            <SheetDescription className="sr-only">Real Stripe invoice history</SheetDescription>
          </SheetHeader>
          <div className="mt-4 max-h-[calc(100vh-8rem)] overflow-y-auto px-1">
            {invoicesLoading ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
            ) : !invoices || invoices.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No Stripe invoices found for this business.
              </p>
            ) : (
              <div className="space-y-1">
                {invoices.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between border-b border-border/60 py-2 text-sm"
                  >
                    <div>
                      <p className="text-foreground">{inv.createdLabel}</p>
                      <p className="mt-0.5 text-2xs text-muted-foreground">
                        {inv.status}
                        {inv.paidLabel ? ` · paid ${inv.paidLabel}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="tabular-nums font-medium text-foreground">{inv.amountLabel}</span>
                      {inv.hostedInvoiceUrl ? (
                        <a
                          href={inv.hostedInvoiceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-2xs font-semibold text-operator hover:underline"
                        >
                          View →
                        </a>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <AdminUserManageDrawer
        row={manageUser}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        fetchLatestAdminStats={fetchLatestAdminStats}
        businessEconomics={
          manageUser ? businessEconomics.find((b) => b.user_id === manageUser.user_id) ?? null : null
        }
      />
    </div>
  )
}
