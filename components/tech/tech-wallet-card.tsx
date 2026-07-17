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
  if (status === "COMPLETED") return "bg-emerald-500/15 text-emerald-300"
  if (status === "FAILED") return "bg-rose-500/15 text-rose-300"
  return "bg-amber-500/15 text-amber-200"
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
      className="overflow-hidden rounded-2xl border border-indigo-500/25 bg-gradient-to-br from-indigo-950/80 via-zinc-950 to-zinc-950 shadow-[0_0_40px_-20px_rgba(99,102,241,0.45)]"
      aria-label="My Wallet"
    >
      <div className="flex items-start justify-between gap-3 border-b border-white/5 px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-300">
              <Wallet className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-white">My Wallet</h2>
              <p className="text-[11px] text-zinc-500">Earnings dashboard</p>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setLoading(true)
            void load()
          }}
          className="rounded-lg px-2 py-1 text-[11px] font-medium text-indigo-300/90 transition hover:bg-indigo-500/10 hover:text-indigo-200"
        >
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 px-4 py-3">
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2.5">
          <p className="text-[10px] font-medium uppercase tracking-wider text-emerald-400/80">
            Available Balance
          </p>
          <p className="mt-1 text-xl font-bold tracking-tight text-emerald-100">
            {loading && !data ? "—" : formatUsd(data?.availableBalance ?? 0)}
          </p>
        </div>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2.5">
          <p className="text-[10px] font-medium uppercase tracking-wider text-amber-400/80">
            Pending Clearance
          </p>
          <p className="mt-1 text-xl font-bold tracking-tight text-amber-100">
            {loading && !data ? "—" : formatUsd(data?.pendingClearance ?? 0)}
          </p>
        </div>
      </div>

      <div className="px-4 pb-4">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Recent Transactions
        </p>

        {loading && !data ? (
          <div className="flex items-center justify-center gap-2 py-6 text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            <span className="text-xs">Loading wallet…</span>
          </div>
        ) : error ? (
          <p className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            Could not load wallet. Pull to refresh or try again.
          </p>
        ) : !data?.recentTransactions.length ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-3 text-center text-xs text-zinc-500">
            No transactions yet — collect payment on a job to see earnings here.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-800/80 overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/60">
            {data.recentTransactions.map((tx) => (
              <li key={tx.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-zinc-300">
                      Job {shortJobId(tx.jobId)}
                    </span>
                    <span
                      className={cn(
                        "rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                        statusStyle(tx.status)
                      )}
                    >
                      {tx.status}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-zinc-500">
                    {formatTxDate(tx.createdAt)} · {methodLabel(tx.paymentMethod)}
                  </p>
                </div>
                <p
                  className={cn(
                    "shrink-0 text-sm font-semibold tabular-nums",
                    tx.status === "FAILED" ? "text-rose-300" : "text-white"
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
