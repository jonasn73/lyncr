"use client"

import { memo, useEffect, useState } from "react"
import { Download } from "lucide-react"
import {
  WorkspacePage,
  WorkspacePageHeader,
  WorkspacePanel,
  WorkspaceStatCard,
  WorkspaceTableWrap,
  WorkspaceTh,
  WorkspaceTd,
} from "@/components/dashboard-workspace-ui"

type BillingSummary = {
  current_plan: string
  credit_balance_cents: number
  credit_balance_label: string
  metered_voice_cents_per_minute: number
}

const INVOICES = [
  { id: "inv_04", date: "Apr 1, 2026", amount: "$49.00" },
  { id: "inv_03", date: "Mar 1, 2026", amount: "$49.00" },
  { id: "inv_02", date: "Feb 1, 2026", amount: "$29.00" },
  { id: "inv_01", date: "Jan 15, 2026", amount: "$15.00" },
]

function formatUsd(cents: number): string {
  return (Math.round(cents) / 100).toLocaleString(undefined, { style: "currency", currency: "USD" })
}

export const PayWorkspaceView = memo(function PayWorkspaceView() {
  const [billing, setBilling] = useState<BillingSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)

    fetch("/api/billing/summary", { credentials: "include" })
      .then(async (res) => {
        if (res.status === 401) throw new Error("Sign in again to view billing.")
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(j.error || "Billing unavailable")
        }
        const json = (await res.json()) as { data?: BillingSummary }
        return json.data ?? null
      })
      .then((data) => {
        if (cancelled) return
        setBilling(data)
      })
      .catch((e) => {
        if (cancelled) return
        setBilling(null)
        setLoadError(e instanceof Error ? e.message : "Could not load billing")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const balanceLabel = loading ? "—" : billing?.credit_balance_label ?? "$0.00"
  const usageLabel = loading ? "—" : "$0.00"
  const aiLabel = loading ? "—" : "—"

  return (
    <WorkspacePage>
      <WorkspacePageHeader eyebrow="Billing" title="Pay" />

      {loadError ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {loadError}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <WorkspaceStatCard label="Account balance" value={balanceLabel} accent="primary" />
        <WorkspaceStatCard
          label="Current month usage"
          value={usageLabel}
          hint={billing ? `${billing.current_plan} plan` : undefined}
          accent="warning"
        />
        <WorkspaceStatCard label="AI processing tokens" value={aiLabel} accent="success" />
      </div>

      <WorkspacePanel>
        <div className="border-b border-zinc-800 px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Invoice ledger</h2>
        </div>
        <WorkspaceTableWrap>
          <colgroup>
            <col className="w-[40%]" />
            <col className="w-[35%]" />
            <col className="w-[25%]" />
          </colgroup>
          <thead>
            <tr>
              <WorkspaceTh>Date</WorkspaceTh>
              <WorkspaceTh>Amount</WorkspaceTh>
              <WorkspaceTh> </WorkspaceTh>
            </tr>
          </thead>
          <tbody>
            {INVOICES.map((row) => (
              <tr key={row.id} className="hover:bg-zinc-900/40">
                <WorkspaceTd className="text-zinc-400">{row.date}</WorkspaceTd>
                <WorkspaceTd className="font-medium tabular-nums">{row.amount}</WorkspaceTd>
                <WorkspaceTd className="text-right">
                  <button
                    type="button"
                    aria-label={`Download ${row.id}`}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-700 text-zinc-500 transition-colors hover:border-primary/40 hover:text-primary"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                </WorkspaceTd>
              </tr>
            ))}
          </tbody>
        </WorkspaceTableWrap>
      </WorkspacePanel>
    </WorkspacePage>
  )
})
