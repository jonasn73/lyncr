"use client"

// Owner queue for tech-flagged out-of-stock keys (Team → tech Key Lookup → "Add to order
// list"). No ordering API exists for Transponder Island (scripts/scrape-ti.js scrapes their
// public catalog — there's no live integration), so this tracks the manual purchase rather
// than placing it: approve/deny, one tap to the exact product page, mark ordered, mark
// received (which restocks key_inventory and logs it to the usage ledger).

import { useEffect, useState } from "react"
import { Check, ExternalLink, Loader2, PackageCheck, PackageOpen, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { KeyReorderRequest, KeyReorderRequestStatus } from "@/lib/key-reorder-requests"

const RECEIVE_LOCATIONS: { value: "van1" | "van2" | "shop"; label: string }[] = [
  { value: "shop", label: "Shop" },
  { value: "van1", label: "Van 1" },
  { value: "van2", label: "Van 2" },
]

function vehicleLabel(r: KeyReorderRequest): string {
  return [r.vehicleYear, r.vehicleMake, r.vehicleModel].filter(Boolean).join(" ") || "Vehicle not noted"
}

export function KeyReorderRequestsPanel() {
  const [requests, setRequests] = useState<KeyReorderRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const res = await fetch("/api/inventory/reorder-requests", { credentials: "include", cache: "no-store" })
      const json = (await res.json()) as { data?: { requests: KeyReorderRequest[] } }
      setRequests(json.data?.requests ?? [])
    } catch {
      /* keep last list on transient error */
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function act(id: string, body: Record<string, unknown>) {
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/inventory/reorder-requests/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = (await res.json()) as { error?: string; data?: { request: KeyReorderRequest } }
      if (!res.ok) throw new Error(json.error ?? "Could not update request")
      if (json.data?.request) {
        setRequests((prev) => prev.map((r) => (r.id === id ? json.data!.request : r)))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update request")
    } finally {
      setBusyId(null)
    }
  }

  const pending = requests.filter((r) => r.status === "pending")
  const inProgress = requests.filter((r) => r.status === "approved" || r.status === "ordered")

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-border bg-card/40 py-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      </div>
    )
  }

  if (pending.length === 0 && inProgress.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
        No open reorder requests. Techs can flag an out-of-stock key from their Key Lookup.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {pending.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Pending approval ({pending.length})
          </p>
          {pending.map((r) => (
            <div key={r.id} className="rounded-xl border border-border bg-card/60 p-3">
              <RequestSummary request={r} />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => void act(r.id, { action: "deny" })}
                  className="flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background text-xs font-semibold text-muted-foreground disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" aria-hidden /> Deny
                </button>
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => void act(r.id, { action: "approve" })}
                  className="flex h-9 items-center justify-center gap-2 rounded-lg bg-success text-xs font-semibold text-success-foreground disabled:opacity-50"
                >
                  {busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
                  Approve
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {inProgress.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            In progress ({inProgress.length})
          </p>
          {inProgress.map((r) => (
            <div key={r.id} className="rounded-xl border border-border bg-card/60 p-3">
              <RequestSummary request={r} />
              <div className="mt-3 space-y-2">
                {r.productUrl ? (
                  <a
                    href={r.productUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-9 items-center justify-center gap-2 rounded-lg border border-operator/40 bg-operator/10 text-xs font-semibold text-operator"
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Order on Transponder Island
                  </a>
                ) : null}

                {r.status === "approved" ? (
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => void act(r.id, { action: "mark_ordered" })}
                    className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-border bg-background text-xs font-semibold text-foreground disabled:opacity-50"
                  >
                    {busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <PackageOpen className="h-3.5 w-3.5" aria-hidden />}
                    Mark ordered
                  </button>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {RECEIVE_LOCATIONS.map((loc) => (
                      <button
                        key={loc.value}
                        type="button"
                        disabled={busyId === r.id}
                        onClick={() => void act(r.id, { action: "receive", location: loc.value })}
                        className={cn(
                          "flex h-9 flex-col items-center justify-center gap-0.5 rounded-lg border border-success/40 bg-success/10 text-2xs font-semibold text-success disabled:opacity-50"
                        )}
                      >
                        <PackageCheck className="h-3.5 w-3.5" aria-hidden />
                        {loc.label}
                      </button>
                    ))}
                  </div>
                )}
                {r.status === "ordered" ? (
                  <p className="text-center text-2xs text-muted-foreground">Received into — tap the location it landed in</p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function RequestSummary({ request: r }: { request: KeyReorderRequest }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate font-mono text-sm font-semibold text-foreground">{r.tiSku}</p>
        {r.title ? <p className="truncate text-xs text-muted-foreground">{r.title}</p> : null}
        <p className="mt-0.5 text-2xs text-muted-foreground">{vehicleLabel(r)}</p>
        <p className="mt-0.5 text-2xs text-muted-foreground">
          Requested by {r.requestedByLabel || "a technician"} · Qty {r.quantity}
        </p>
      </div>
      <StatusPill status={r.status} />
    </div>
  )
}

function StatusPill({ status }: { status: KeyReorderRequestStatus }) {
  const styles: Record<KeyReorderRequestStatus, string> = {
    pending: "bg-warning/20 text-warning",
    approved: "bg-info/20 text-info",
    ordered: "bg-operator/20 text-operator",
    received: "bg-success/20 text-success",
    denied: "bg-destructive/20 text-destructive",
    cancelled: "bg-muted text-muted-foreground",
  }
  return (
    <span className={cn("shrink-0 rounded-full px-3 py-0.5 text-2xs font-bold uppercase tracking-wide", styles[status])}>
      {status}
    </span>
  )
}
