"use client"

// Owner-facing "what do I owe this person, and did I pay them" drawer. Techs and
// receptionists have no Stripe Connect account of their own — every card/Tap charge on a
// job goes into the OWNER's Connect balance, so a real self-serve payout isn't possible
// today. This records that the owner paid the worker outside the app (cash/Venmo/check/
// payroll) so the ledger stops saying money is owed that's already changed hands, and
// texts the worker a confirmation.

import { useCallback, useEffect, useState } from "react"
import { Banknote, Loader2 } from "lucide-react"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

export interface WorkerPayoutTarget {
  kind: "receptionist" | "field_tech"
  id: string
  name: string
}

type PayoutHistoryRow = {
  id: string
  amountCents: number
  method: string
  note: string | null
  paidAt: string
}

const METHODS: { value: string; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "VENMO", label: "Venmo" },
  { value: "ZELLE", label: "Zelle" },
  { value: "CHECK", label: "Check" },
  { value: "PAYROLL", label: "Payroll" },
  { value: "OTHER", label: "Other" },
]

function formatUsd(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" })
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

export function WorkerPayoutDrawer({
  target,
  onClose,
}: {
  target: WorkerPayoutTarget | null
  onClose: () => void
}) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [owedCents, setOwedCents] = useState(0)
  const [payouts, setPayouts] = useState<PayoutHistoryRow[]>([])
  const [amount, setAmount] = useState("")
  const [method, setMethod] = useState("CASH")
  const [note, setNote] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const idParam = target
    ? target.kind === "receptionist"
      ? `receptionist_id=${target.id}`
      : `field_technician_id=${target.id}`
    : ""

  const load = useCallback(() => {
    if (!idParam) return
    setLoading(true)
    fetch(`/api/compensation/payouts?${idParam}`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("payouts"))))
      .then((json: { data?: { owedCents: number; payouts: PayoutHistoryRow[] } }) => {
        setOwedCents(json.data?.owedCents ?? 0)
        setPayouts(json.data?.payouts ?? [])
        setAmount(json.data?.owedCents ? (json.data.owedCents / 100).toFixed(2) : "")
      })
      .catch(() => {
        toast({ title: "Could not load payouts", description: "Please try again." })
      })
      .finally(() => setLoading(false))
  }, [idParam, toast])

  useEffect(() => {
    if (target) load()
  }, [target, load])

  const recordPayout = useCallback(async () => {
    if (!target) return
    const cents = Math.round(Number(amount) * 100)
    if (!Number.isFinite(cents) || cents <= 0) {
      toast({ title: "Enter an amount greater than $0" })
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch("/api/compensation/payouts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [target.kind === "receptionist" ? "receptionist_id" : "field_technician_id"]: target.id,
          amountCents: cents,
          method,
          note: note.trim() || undefined,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        data?: { owedCents: number; smsSent: boolean }
        error?: string
      }
      if (!res.ok) {
        toast({ title: "Could not record payout", description: json.error })
        return
      }
      toast({
        title: "Payout recorded",
        description: json.data?.smsSent
          ? `${target.name} was texted a confirmation.`
          : `${target.name} has no phone on file — no text was sent.`,
      })
      setNote("")
      load()
    } catch {
      toast({ title: "Network error", description: "Please try again." })
    } finally {
      setSubmitting(false)
    }
  }, [target, amount, method, note, toast, load])

  return (
    <Sheet open={target != null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {target ? (
          <>
            <SheetHeader className="text-left">
              <SheetTitle className="flex items-center gap-2 text-base">
                <Banknote className="h-4 w-4 text-primary" aria-hidden />
                Earnings &amp; payouts
              </SheetTitle>
              <SheetDescription>{target.name}</SheetDescription>
            </SheetHeader>

            <div className="mt-5 space-y-4">
              <div className="rounded-xl border border-border bg-background/60 px-4 py-4">
                <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">
                  Owed now
                </p>
                <p className="mt-0.5 text-2xl font-bold tabular-nums text-foreground">
                  {loading ? "—" : formatUsd(owedCents)}
                </p>
                <p className="mt-1 text-2xs text-muted-foreground">
                  From their pay plan, minus payouts already recorded below.
                </p>
              </div>

              <div className="space-y-3 rounded-xl border border-border bg-background/40 px-4 py-4">
                <p className="text-sm font-medium text-foreground">Record a payout</p>
                <p className="text-2xs text-muted-foreground">
                  Pay them outside the app (cash, Venmo, check, payroll), then log it here — they&rsquo;ll
                  get a text confirming the amount.
                </p>

                <label className="block space-y-1.5">
                  <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Amount
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="h-11 w-full rounded-xl border border-border bg-background/70 px-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/40"
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Method
                  </span>
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                    className="h-11 w-full rounded-xl border border-border bg-background/70 px-3 text-sm text-foreground outline-none focus:border-primary/40"
                  >
                    {METHODS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1.5">
                  <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Note (optional)
                  </span>
                  <input
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. Weeks of Sep 1–7"
                    className="h-11 w-full rounded-xl border border-border bg-background/70 px-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/40"
                  />
                </label>

                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void recordPayout()}
                  className={cn(
                    "flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-success text-sm font-semibold text-success-foreground hover:bg-success disabled:opacity-50"
                  )}
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                  Record payout
                </button>
              </div>

              <div>
                <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Payout history
                </p>
                {loading ? (
                  <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    <span className="text-xs">Loading…</span>
                  </div>
                ) : payouts.length === 0 ? (
                  <p className="rounded-lg border border-border bg-card/50 px-3 py-3 text-center text-xs text-muted-foreground">
                    No payouts recorded yet.
                  </p>
                ) : (
                  <ul className="divide-y divide-border/80 overflow-hidden rounded-xl border border-border/80 bg-background/60">
                    {payouts.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground">{formatUsd(p.amountCents)}</p>
                          <p className="mt-0.5 truncate text-2xs text-muted-foreground">
                            {formatDate(p.paidAt)} ·{" "}
                            {METHODS.find((m) => m.value === p.method)?.label ?? p.method}
                            {p.note ? ` · ${p.note}` : ""}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
