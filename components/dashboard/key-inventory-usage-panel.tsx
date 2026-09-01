"use client"

// Owner Usage view — what key_inventory couldn't answer before scripts/160's ledger existed:
// what actually moved, when, by whom, and which SKUs get pulled most.

import { useEffect, useState } from "react"
import { Loader2, TrendingDown } from "lucide-react"
import { cn } from "@/lib/utils"
import type { KeyInventoryLedgerEntry, TopConsumedSku } from "@/lib/key-inventory-ledger"

const REASON_LABEL: Record<KeyInventoryLedgerEntry["reason"], string> = {
  scan_adjust: "Scan adjust",
  new_sku_initial: "New SKU",
  reorder_received: "Order received",
}

const LOCATION_LABEL: Record<KeyInventoryLedgerEntry["location"], string> = {
  van1: "Van 1",
  van2: "Van 2",
  shop: "Shop",
}

export function KeyInventoryUsagePanel() {
  const [activity, setActivity] = useState<KeyInventoryLedgerEntry[]>([])
  const [topConsumed, setTopConsumed] = useState<TopConsumedSku[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    fetch("/api/inventory/ledger", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j: { data?: { activity: KeyInventoryLedgerEntry[]; topConsumed: TopConsumedSku[] } }) => {
        if (!active) return
        setActivity(j.data?.activity ?? [])
        setTopConsumed(j.data?.topConsumed ?? [])
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-border bg-card/40 py-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      </div>
    )
  }

  if (activity.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
        No inventory activity logged yet. Scans, new SKUs, and received orders will show up here.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {topConsumed.length > 0 ? (
        <div className="rounded-2xl border border-border bg-card/60 p-4">
          <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <TrendingDown className="h-3.5 w-3.5" aria-hidden /> Top consumed — last 30 days
          </p>
          <ul className="space-y-2">
            {topConsumed.map((row) => (
              <li key={row.keyInventoryId} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  <span className="font-mono font-semibold text-foreground">{row.tiSku || row.sku}</span>
                  {row.brand ? <span className="text-muted-foreground"> · {row.brand}</span> : null}
                </span>
                <span className="shrink-0 rounded-full bg-warning/20 px-3 py-0.5 text-2xs font-bold text-warning">
                  {row.totalConsumed} used
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-2xl border border-border bg-card/60 p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Recent activity
        </p>
        <ul className="space-y-2">
          {activity.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-3 border-b border-border/40 pb-2 text-sm last:border-0 last:pb-0">
              <div className="min-w-0">
                <p className="truncate">
                  <span className="font-mono font-semibold text-foreground">{entry.tiSku || entry.sku}</span>
                  <span className="text-muted-foreground"> · {LOCATION_LABEL[entry.location]}</span>
                </p>
                <p className="text-2xs text-muted-foreground">
                  {REASON_LABEL[entry.reason]} · {entry.actorLabel || (entry.actorRole === "owner" ? "Owner" : "Technician")}
                </p>
              </div>
              <span
                className={cn(
                  "shrink-0 font-mono text-sm font-bold",
                  entry.delta > 0 ? "text-success" : "text-warning"
                )}
              >
                {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
