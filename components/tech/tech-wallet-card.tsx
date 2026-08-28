// Field-tech "My Wallet" / earnings dashboard card for the profile console.

"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, Wallet } from "lucide-react"
import { cn } from "@/lib/utils"

type WalletTx = {
  id: string
  jobId: string | null
  amount: number
  status: "PENDING" | "COMPLETED" | "FAILED"
  paymentMethod: "TAP_TO_PAY" | "MANUAL_CARD" | "CASH"
  createdAt: string
}

type WalletPayload = {
  availableBalance: number
  pendingClearance: number
  recentTransactions: WalletTx[]
}

function formatUsd(amount: number): string {
  return amount.toLocaleString(undefined, { style: "currency", currency: "USD" })
}

function shortJobId(jobId: string | null): string {
  if (!jobId) return "—"
  return jobId.length > 8 ? `${jobId.slice(0, 8)}…` : jobId
}

function formatTxDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function statusStyle(status: WalletTx["status"]): string {
  if (status === "COMPLETED") return "bg-success/15 text-success"
  if (status === "FAILED") return "bg-destructive/15 text-destructive"
  return "bg-warning/15 text-warning"
}

function methodLabel(method: WalletTx["paymentMethod"]): string {
  if (method === "TAP_TO_PAY") return "Tap to Pay"
  if (method === "MANUAL_CARD") return "Card"
  return "Cash"
}

export function TechWalletCard({ refreshToken = 0 }: { refreshToken?: number }) {
  const [data, setData] = useState<WalletPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    setError(false)
    try {
      const res = await fetch("/api/tech/wallet", { credentials: "include", cache: "no-store" })
      if (!res.ok) throw new Error("wallet")
      const json = (await res.json()) as { data?: WalletPayload }
      if (json.data) setData(json.data)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load, refreshToken])

  return (
    <section
      className="overflow-hidden rounded-2xl border border-operator/25 bg-gradient-to-br from-operator/80 via-background to-background shadow-[0_0_40px_-20px_rgba(99,102,241,0.45)]"
      aria-label="My Wallet"
    >
      <div className="flex items-start justify-between gap-3 border-b border-white/5 px-4 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-operator/20 text-operator">
              <Wallet className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-white">My Wallet</h2>
              <p className="text-2xs text-muted-foreground">Earnings dashboard</p>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setLoading(true)
            void load()
          }}
          className="rounded-lg px-2 py-1 text-2xs font-medium text-operator/90 transition hover:bg-operator/10 hover:text-operator"
        >
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 px-4 py-3">
        <div className="rounded-xl border border-success/20 bg-success/10 px-3 py-3">
          <p className="text-micro font-medium uppercase tracking-wider text-success/80">
            Available Balance
          </p>
          <p className="mt-1 text-xl font-bold tracking-tight text-success">
            {loading && !data ? "—" : formatUsd(data?.availableBalance ?? 0)}
          </p>
        </div>
        <div className="rounded-xl border border-warning/20 bg-warning/10 px-3 py-3">
          <p className="text-micro font-medium uppercase tracking-wider text-warning/80">
            Pending Clearance
          </p>
          <p className="mt-1 text-xl font-bold tracking-tight text-warning">
            {loading && !data ? "—" : formatUsd(data?.pendingClearance ?? 0)}
          </p>
        </div>
      </div>

      <div className="px-4 pb-4">
        <p className="mb-2 text-micro font-semibold uppercase tracking-wider text-muted-foreground">
          Recent Transactions
        </p>

        {loading && !data ? (
          <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            <span className="text-xs">Loading wallet…</span>
          </div>
        ) : error ? (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Could not load wallet. Pull to refresh or try again.
          </p>
        ) : !data?.recentTransactions.length ? (
          <p className="rounded-lg border border-border bg-card/50 px-3 py-3 text-center text-xs text-muted-foreground">
            No transactions yet — collect payment on a job to see earnings here.
          </p>
        ) : (
          <ul className="divide-y divide-border/80 overflow-hidden rounded-xl border border-border/80 bg-background/60">
            {data.recentTransactions.map((tx) => (
              <li key={tx.id} className="flex items-center gap-3 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-2xs text-foreground">
                      Job {shortJobId(tx.jobId)}
                    </span>
                    <span
                      className={cn(
                        "rounded-md px-2 py-0.5 text-micro font-semibold uppercase tracking-wide",
                        statusStyle(tx.status)
                      )}
                    >
                      {tx.status}
                    </span>
                  </div>
                  <p className="mt-0.5 text-2xs text-muted-foreground">
                    {formatTxDate(tx.createdAt)} · {methodLabel(tx.paymentMethod)}
                  </p>
                </div>
                <p
                  className={cn(
                    "shrink-0 text-sm font-semibold tabular-nums",
                    tx.status === "FAILED" ? "text-destructive" : "text-white"
                  )}
                >
                  {formatUsd(tx.amount)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
