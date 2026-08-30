"use client"

// Admin Finance — Lyncr's own performance, every business's real balance (not blended
// together), and a filterable platform-wide transaction ledger for auditing.

import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
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
import { RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"

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

function ledgerTypeTone(entryType: LedgerRow["entryType"]): string {
  if (entryType === "CHARGE") return "text-success"
  if (entryType === "REVERSAL") return "text-warning"
  if (entryType === "PAYOUT") return "text-info"
  return "text-muted-foreground"
}

function PerfCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/60 px-4 py-3">
      <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-foreground">{value}</p>
      {note ? <p className="mt-1 text-2xs leading-snug text-muted-foreground">{note}</p> : null}
    </div>
  )
}

export function AdminFinanceBoard() {
  const { metrics, businessEconomics, loading, refreshing, fetchLatestAdminStats } =
    useLyncrAdminDashboardData()

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

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Finance</h1>
          <p className="text-xs text-muted-foreground">
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

      {/* --- Lyncr's own performance --- */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Lyncr performance</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <PerfCard
            label="Stripe available"
            value={finance?.stripe_platform_available_label ?? "—"}
            note="Lyncr's own cash, ready to pay out"
          />
          <PerfCard
            label="Stripe pending"
            value={finance?.stripe_platform_pending_label ?? "—"}
            note="Not yet available"
          />
          <PerfCard
            label={`Actual revenue · ${finance?.business_money_period_label ?? "All time"}`}
            value={finance?.actual_plan_revenue_period_label ?? "—"}
            note="Real Stripe-paid invoices, summed across every business"
          />
          <PerfCard
            label="Estimated MRR"
            value={finance?.estimated_mrr_label ?? "—"}
            note="List-price estimate, not real billing"
          />
          <PerfCard
            label="Card fees (MTD)"
            value={finance?.card_fee_revenue_mtd_label ?? "—"}
            note={finance?.card_fee_formula_label}
          />
          <PerfCard
            label={`Platform net · ${finance?.business_money_period_label ?? "All time"}`}
            value={finance?.platform_net_period_label ?? "—"}
            note="Revenue minus estimated phone cost, all businesses"
          />
        </div>
      </section>

      {/* --- Every business's own balance, never blended into one number --- */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Business balances</h2>
        <p className="text-xs text-muted-foreground">
          Each business's own job-payment wallet — sorted highest to lowest. Not a platform total.
        </p>
        <div className="overflow-x-auto rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Business</TableHead>
                <TableHead className="text-muted-foreground">Wallet balance</TableHead>
                <TableHead className="text-muted-foreground">Lifetime collected</TableHead>
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
                  <TableRow key={row.user_id} className="border-border">
                    <TableCell className="font-medium text-foreground">{row.business_name}</TableCell>
                    <TableCell className="tabular-nums text-foreground">
                      {row.collected_wallet_balance_label}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
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

      {/* --- Full ledger: every charge, fee, reversal, payout, filterable --- */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Transactions</h2>
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
                <TableHead className="text-muted-foreground">Amount</TableHead>
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
                  <TableRow key={row.id} className="border-border">
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(row.createdAt)}
                    </TableCell>
                    <TableCell className="text-foreground">{row.businessName}</TableCell>
                    <TableCell>
                      <span className={cn("text-xs font-semibold", ledgerTypeTone(row.entryType))}>
                        {row.entryType}
                        {row.reversalReason ? ` · ${row.reversalReason}` : ""}
                      </span>
                    </TableCell>
                    <TableCell
                      className={cn(
                        "tabular-nums font-medium",
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
      </section>
    </div>
  )
}
