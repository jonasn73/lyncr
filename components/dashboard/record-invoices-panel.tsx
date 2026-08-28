"use client"

// Shared list + detail for paid-outside invoices (Venmo/cash).
// Used on CRM customer sheet and Money → Invoices.

import { useCallback, useEffect, useState } from "react"
import {
  Download,
  Eye,
  Loader2,
  Mail,
  MessageSquare,
  Pencil,
  Receipt,
  RefreshCw,
  Search,
} from "lucide-react"
import type { JobRecordInvoiceApi } from "@/lib/job-record-invoice"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { InvoicePreviewSheet } from "@/components/dashboard/invoice-preview-sheet"

function formatMoney(cents: number): string {
  return (Math.max(0, cents) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  })
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

/** Email/SMS delivery line — empty when it would just repeat the status badge. */
function deliveryBits(inv: JobRecordInvoiceApi): string {
  const bits: string[] = []
  const ch = (inv.channelsRequested || "").toLowerCase()
  const wantEmail = ch === "email" || ch === "both" || inv.emailOk || Boolean(inv.emailError)
  const wantSms = ch === "sms" || ch === "both" || inv.smsOk || Boolean(inv.smsError)
  if (wantEmail) {
    bits.push(inv.emailOk ? "Email ✓" : inv.emailError ? "Email ✗" : "Email —")
  }
  if (wantSms) {
    bits.push(inv.smsOk ? "Text ✓" : inv.smsError ? "Text ✗" : "Text —")
  }
  return bits.join(" · ")
}

function invoiceStatusClass(status: string): string {
  if (status === "sent") return "border-success/35 bg-success/10 text-success"
  if (status === "failed") return "border-destructive/35 bg-destructive/10 text-destructive"
  if (status === "partial") return "border-warning/35 bg-warning/10 text-warning"
  return "border-border/50 bg-muted/60 text-foreground"
}

export function RecordInvoicesPanel({
  customerId,
  jobId,
  /** When set, skip local search box (parent owns search). */
  externalSearch,
  showSearch = true,
  /** Hide count + Refresh when the parent sheet already has that chrome. */
  showToolbar = true,
  /** Same Today / Yesterday / Week / All filter as Card payments (Money sheet). */
  dayFilter = "all",
  /** Highlight this invoice id after a fresh send. */
  highlightId,
  compact = false,
  onCount,
}: {
  customerId?: string | null
  jobId?: string | null
  externalSearch?: string
  showSearch?: boolean
  showToolbar?: boolean
  dayFilter?: "today" | "yesterday" | "week" | "all"
  highlightId?: string | null
  compact?: boolean
  onCount?: (n: number) => void
}) {
  const { toast } = useToast()
  const [rows, setRows] = useState<JobRecordInvoiceApi[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [debouncedQ, setDebouncedQ] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [reviseId, setReviseId] = useState<string | null>(null)
  const [reviseAmount, setReviseAmount] = useState("")
  const [reviseNote, setReviseNote] = useState("")
  const [reviseVin, setReviseVin] = useState("")
  const [reviseChannel, setReviseChannel] = useState<"email" | "sms" | "both">("sms")
  const [reviseEmail, setReviseEmail] = useState("")
  const [revisePhone, setRevisePhone] = useState("")
  // In-app invoice preview (not a new browser tab).
  const [previewInv, setPreviewInv] = useState<JobRecordInvoiceApi | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(search.trim()), 280)
    return () => window.clearTimeout(t)
  }, [search])

  const q = externalSearch != null ? externalSearch.trim() : debouncedQ

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ limit: "50" })
      if (customerId) params.set("customerId", customerId)
      if (jobId) params.set("jobId", jobId)
      if (q) params.set("q", q)
      const res = await fetch(`/api/payments/record-invoices?${params}`, {
        credentials: "include",
        cache: "no-store",
      })
      const json = (await res.json()) as {
        data?: { invoices?: JobRecordInvoiceApi[] }
        error?: string
        migration?: string
      }
      if (!res.ok) {
        throw new Error(
          json.migration
            ? `Run ${json.migration} in Neon SQL Editor`
            : json.error || "Could not load invoices"
        )
      }
      let list = Array.isArray(json.data?.invoices) ? json.data!.invoices! : []
      if (dayFilter === "today" || dayFilter === "yesterday") {
        const start = new Date()
        start.setHours(0, 0, 0, 0)
        if (dayFilter === "yesterday") start.setDate(start.getDate() - 1)
        const end = new Date(start)
        end.setDate(end.getDate() + 1)
        list = list.filter((inv) => {
          const t = new Date(inv.createdAt).getTime()
          return t >= start.getTime() && t < end.getTime()
        })
      } else if (dayFilter === "week") {
        // Local Monday 00:00 — matches the "week-to-date" definition used by the Money tile.
        const start = new Date()
        start.setHours(0, 0, 0, 0)
        const dayIndex = (start.getDay() + 6) % 7 // Mon=0 .. Sun=6
        start.setDate(start.getDate() - dayIndex)
        list = list.filter((inv) => new Date(inv.createdAt).getTime() >= start.getTime())
      }
      setRows(list)
      onCount?.(list.length)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load invoices")
      setRows([])
      onCount?.(0)
    } finally {
      setLoading(false)
    }
  }, [customerId, jobId, q, dayFilter, onCount])

  useEffect(() => {
    void load()
  }, [load])

  const resend = async (inv: JobRecordInvoiceApi) => {
    setBusyId(inv.id)
    try {
      const channel =
        (inv.channelsRequested as "email" | "sms" | "both") ||
        (inv.customerEmail ? "email" : "sms")
      const res = await fetch(`/api/payments/record-invoices/${encodeURIComponent(inv.id)}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resend", channel }),
      })
      const json = (await res.json()) as {
        error?: string
        data?: { sent?: boolean; channels?: string[]; deliveryStatus?: string; error?: string }
      }
      if (!res.ok) throw new Error(json.error || json.data?.error || "Resend failed")
      const status = json.data?.deliveryStatus || "sent"
      toast({
        title: status === "sent" ? "Invoice resent" : status === "partial" ? "Partially sent" : "Send issue",
        description:
          status === "failed"
            ? json.data?.error || "Could not deliver — try again"
            : `Delivery: ${(json.data?.channels ?? []).join(" + ") || status}`,
      })
      await load()
    } catch (e) {
      toast({
        title: "Could not resend",
        description: e instanceof Error ? e.message : "Try again",
        variant: "destructive",
      })
    } finally {
      setBusyId(null)
    }
  }

  const openRevise = (inv: JobRecordInvoiceApi) => {
    setReviseId(inv.id)
    setReviseAmount(String(inv.amountCents / 100))
    setReviseNote(inv.paymentNote || "")
    setReviseVin(inv.vehicleVin || "")
    setReviseEmail(inv.customerEmail || "")
    setRevisePhone(inv.customerPhone || "")
    const ch = (inv.channelsRequested || "sms").toLowerCase()
    setReviseChannel(ch === "email" || ch === "both" ? ch : "sms")
  }

  const submitRevise = async () => {
    if (!reviseId) return
    setBusyId(reviseId)
    try {
      const dollars = Number(reviseAmount)
      const res = await fetch(`/api/payments/record-invoices/${encodeURIComponent(reviseId)}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "revise",
          channel: reviseChannel,
          amount: Number.isFinite(dollars) ? dollars : undefined,
          paymentNote: reviseNote.trim() || undefined,
          vehicleVin: reviseVin.trim() || undefined,
          email: reviseEmail.trim() || undefined,
          phone: revisePhone.trim() || undefined,
        }),
      })
      const json = (await res.json()) as {
        error?: string
        data?: {
          sent?: boolean
          invoice?: JobRecordInvoiceApi
          deliveryStatus?: string
          error?: string
        }
      }
      if (!res.ok) throw new Error(json.error || json.data?.error || "Revise failed")
      const rev = json.data?.invoice?.revision
      toast({
        title: "Revised invoice sent",
        description: rev
          ? `Saved as revision ${rev}. Old invoice kept in history.`
          : "New revision saved in history.",
      })
      setReviseId(null)
      await load()
    } catch (e) {
      toast({
        title: "Could not revise",
        description: e instanceof Error ? e.message : "Try again",
        variant: "destructive",
      })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className={cn("space-y-3", compact && "space-y-2")}>
      {showSearch && externalSearch == null ? (
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone, or invoice #"
            className="h-11 w-full rounded-xl border border-border bg-background/70 pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/40"
            autoComplete="off"
            enterKeyHint="search"
          />
        </div>
      ) : null}

      {showToolbar ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            {loading ? "Loading…" : `${rows.length} invoice${rows.length === 1 ? "" : "s"}`}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-2xs font-semibold text-primary/90 hover:bg-primary/10 disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {!loading && rows.length === 0 && !error ? (
        <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          No paid invoices yet. Use <span className="text-foreground">Send paid invoice</span> after
          Venmo/cash.
        </p>
      ) : null}

      <ul className="space-y-2">
        {rows.map((inv) => {
          const isHighlight = highlightId === inv.id
          const isRevise = reviseId === inv.id
          const busy = busyId === inv.id
          return (
            <li
              key={inv.id}
              className={cn(
                "rounded-xl border px-3 py-3",
                isHighlight
                  ? "border-success/50 bg-success/10"
                  : "border-border bg-card/50"
              )}
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <Receipt className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {inv.customerName ||
                        (inv.customerPhone ? formatPhoneDisplay(inv.customerPhone) : null) ||
                        inv.invoiceNumber}
                    </p>
                    <p className="shrink-0 text-sm font-bold tabular-nums text-success">
                      {formatMoney(inv.amountCents)}
                    </p>
                  </div>
                  <p className="mt-0.5 text-2xs text-muted-foreground">
                    {formatWhen(inv.createdAt)}
                    {" · "}
                    {inv.paymentMethodLabel}
                    {inv.revision > 1 ? ` · rev ${inv.revision}` : ""}
                    {" · "}
                    <span className="font-mono text-muted-foreground">{inv.invoiceNumber}</span>
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2 py-0.5 text-micro font-semibold uppercase tracking-wide",
                        invoiceStatusClass(inv.deliveryStatus)
                      )}
                    >
                      {inv.deliveryStatusLabel}
                    </span>
                    {deliveryBits(inv) ? (
                      <span className="text-2xs text-muted-foreground">{deliveryBits(inv)}</span>
                    ) : null}
                  </div>
                  {inv.deliveryStatus === "failed" || inv.deliveryStatus === "partial" ? (
                    <p className="mt-1 text-2xs text-destructive/90">
                      {[inv.emailError, inv.smsError].filter(Boolean).join(" · ")}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setPreviewInv(inv)}
                  className="inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-background/60 px-3 text-2xs font-semibold text-foreground hover:bg-card"
                >
                  <Eye className="h-3.5 w-3.5" />
                  View
                </button>
                <a
                  href={inv.pdfUrl}
                  download
                  className="inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-background/60 px-3 text-2xs font-semibold text-foreground hover:bg-card"
                >
                  <Download className="h-3.5 w-3.5" />
                  PDF
                </a>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void resend(inv)}
                  className="inline-flex h-9 items-center gap-1 rounded-lg border border-success/35 bg-success/10 px-3 text-2xs font-semibold text-success hover:bg-success/20 disabled:opacity-50"
                >
                  {busy && !isRevise ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : inv.deliveryStatus === "failed" ? (
                    <RefreshCw className="h-3.5 w-3.5" />
                  ) : (
                    <Mail className="h-3.5 w-3.5" />
                  )}
                  {inv.deliveryStatus === "failed" ? "Retry" : "Resend"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => (isRevise ? setReviseId(null) : openRevise(inv))}
                  className="inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-background/60 px-3 text-2xs font-semibold text-foreground hover:bg-card disabled:opacity-50"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  {isRevise ? "Cancel" : "Revise"}
                </button>
              </div>

              {isRevise ? (
                <div className="mt-3 space-y-2 border-t border-border pt-3">
                  <p className="text-2xs text-muted-foreground">
                    Edits create a <span className="text-foreground">new revision</span> — the old
                    invoice stays in history.
                  </p>
                  <label className="block space-y-1">
                    <span className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">
                      Amount ($)
                    </span>
                    <Input
                      type="number"
                      inputMode="decimal"
                      value={reviseAmount}
                      onChange={(e) => setReviseAmount(e.target.value)}
                      className="h-9 border-border bg-background"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">
                      Paid note
                    </span>
                    <Input
                      value={reviseNote}
                      onChange={(e) => setReviseNote(e.target.value)}
                      className="h-9 border-border bg-background"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">
                      VIN
                    </span>
                    <Input
                      value={reviseVin}
                      onChange={(e) => setReviseVin(e.target.value)}
                      className="h-9 border-border bg-background font-mono text-sm"
                    />
                  </label>
                  <div className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-background/60 p-1">
                    {(
                      [
                        ["email", "Email"],
                        ["sms", "Text"],
                        ["both", "Both"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setReviseChannel(id)}
                        className={cn(
                          "rounded-lg py-2 text-xs font-semibold",
                          reviseChannel === id
                            ? "bg-primary/20 text-primary"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {(reviseChannel === "email" || reviseChannel === "both") && (
                    <Input
                      type="email"
                      value={reviseEmail}
                      onChange={(e) => setReviseEmail(e.target.value)}
                      placeholder="Email"
                      className="h-9 border-border bg-background"
                    />
                  )}
                  {(reviseChannel === "sms" || reviseChannel === "both") && (
                    <Input
                      type="tel"
                      value={revisePhone}
                      onChange={(e) => setRevisePhone(e.target.value)}
                      placeholder="Phone"
                      className="h-9 border-border bg-background"
                    />
                  )}
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => void submitRevise()}
                    className="h-11 w-full gap-2 bg-success text-success-foreground hover:bg-success"
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : reviseChannel === "sms" ? (
                      <MessageSquare className="h-4 w-4" />
                    ) : (
                      <Mail className="h-4 w-4" />
                    )}
                    Save revision & resend
                  </Button>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>

      {/* Same receipt as /r/{token}, inside Lyncr — X / Done / PDF / open in browser. */}
      <InvoicePreviewSheet
        open={Boolean(previewInv)}
        onOpenChange={(next) => {
          if (!next) setPreviewInv(null)
        }}
        token={previewInv?.receiptToken ?? null}
        receiptUrl={previewInv?.receiptUrl ?? null}
        pdfUrl={previewInv?.pdfUrl ?? null}
      />
    </div>
  )
}
