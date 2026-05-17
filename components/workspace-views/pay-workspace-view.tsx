"use client"

import { memo, useEffect, useMemo, useState } from "react"
import { Download } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  WorkspacePage,
  WorkspacePageHeader,
  WorkspacePanel,
  WorkspaceStatCard,
  WorkspaceTableWrap,
  WorkspaceTh,
  WorkspaceTd,
  WorkspaceTokenStatCard,
  WorkspaceUsageStatCard,
  WORKSPACE_TABLE_ROW_CLASS,
} from "@/components/dashboard-workspace-ui"

type BillingSummary = {
  current_plan: string
  credit_balance_cents: number
  credit_balance_label: string
  metered_voice_cents_per_minute: number
  plans?: { key: string; included_minutes_per_month: number }[]
}

const DEMO_MINUTES_USED = 1420
const DEMO_MINUTES_INCLUDED = 5000
const DEMO_AI_TOKENS = 142_310

const INVOICES = [
  { id: "inv_04", date: "Apr 1, 2026", amount: "$49.00" },
  { id: "inv_03", date: "Mar 1, 2026", amount: "$49.00" },
  { id: "inv_02", date: "Feb 1, 2026", amount: "$29.00" },
  { id: "inv_01", date: "Jan 15, 2026", amount: "$15.00" },
]

export const PayWorkspaceView = memo(function PayWorkspaceView() {
  const [billing, setBilling] = useState<BillingSummary | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
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

    return () => {
      cancelled = true
    }
  }, [])

  const balanceLabel = billing?.credit_balance_label ?? "$0.00"
  const planKey = billing?.current_plan ?? "enterprise"
  const includedMinutes = useMemo(() => {
    const fromPlan = billing?.plans?.find((p) => p.key === planKey)?.included_minutes_per_month
    return fromPlan && fromPlan > 0 ? fromPlan : DEMO_MINUTES_INCLUDED
  }, [billing?.plans, planKey])

  const usageHint = billing ? `${billing.current_plan} plan · metered overage applies` : "Sample usage · billing cycle"
  const tokenHint = "Consumed this billing cycle"

  return (
    <WorkspacePage className="min-h-[32rem]">
      <WorkspacePageHeader eyebrow="Billing" title="Pay" />

      {loadError ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {loadError}
        </p>
      ) : null}

      <div className="flex flex-col gap-8">
        <div className="grid min-h-[5.75rem] gap-4 sm:grid-cols-3">
          <WorkspaceStatCard label="Account balance" value={balanceLabel} accent="primary" />
          <WorkspaceUsageStatCard
            label="Current month usage"
            used={DEMO_MINUTES_USED}
            included={includedMinutes}
            hint={usageHint}
          />
          <WorkspaceTokenStatCard
            label="AI processing tokens"
            tokens={DEMO_AI_TOKENS}
            hint={tokenHint}
          />
        </div>

        <WorkspacePanel className="min-h-[300px]">
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
            <tbody className="min-h-[208px]">
              {INVOICES.map((row) => (
                <tr key={row.id} className={cn("hover:bg-zinc-900/40", WORKSPACE_TABLE_ROW_CLASS)}>
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
      </div>
    </WorkspacePage>
  )
})
