"use client"

// Compact “send available Stripe balance to bank” — used on Money (not a second wallet page).

import { useState } from "react"
import { Banknote, Loader2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

function fmtCents(cents: number): string {
  return (Math.max(0, cents) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  })
}

export function SendToBankPanel({
  availableCents,
  onSent,
}: {
  availableCents: number
  onSent?: () => void
}) {
  const { toast } = useToast()
  const [customDollars, setCustomDollars] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(opts?: { fullAvailable?: boolean }) {
    setBusy(true)
    setError(null)
    try {
      let amountCents: number | undefined
      if (!opts?.fullAvailable) {
        const dollars = parseFloat(customDollars)
        if (!Number.isFinite(dollars) || dollars < 1) {
          throw new Error("Enter at least $1.00, or tap Send all.")
        }
        amountCents = Math.round(dollars * 100)
      }
      const res = await fetch("/api/payments/connect/payouts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts?.fullAvailable ? { fullAvailable: true } : { amountCents }),
      })
      const json = (await res.json()) as {
        error?: string
        data?: { payout?: { amountCents: number; currency: string } }
      }
      if (!res.ok || !json.data?.payout) {
        throw new Error(json.error || "Could not send to bank")
      }
      toast({
        title: "On the way to your bank",
        description: `${fmtCents(json.data.payout.amountCents)} usually arrives in 1–2 business days.`,
      })
      setCustomDollars("")
      onSent?.()
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not send to bank"
      setError(message)
      toast({ title: "Could not send", description: message, variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  if (availableCents < 100) return null

  return (
    <div className="mt-3 space-y-2 border-t border-success/20 pt-3">
      <p className="text-micro font-semibold uppercase tracking-wide text-success/70">
        Send to bank
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void send({ fullAvailable: true })}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-success text-sm font-semibold text-white hover:bg-success disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Banknote className="h-4 w-4" aria-hidden />}
        Send all {fmtCents(availableCents)}
      </button>
      <div className="flex gap-2">
        <input
          type="text"
          inputMode="decimal"
          value={customDollars}
          onChange={(e) => setCustomDollars(e.target.value)}
          placeholder="Or enter amount"
          className="h-10 min-w-0 flex-1 rounded-xl border border-success/25 bg-success/40 px-3 text-sm text-success outline-none placeholder:text-success/40"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void send()}
          className="h-10 shrink-0 rounded-xl border border-success/35 px-3 text-xs font-semibold text-success hover:bg-success/15 disabled:opacity-50"
        >
          Send
        </button>
      </div>
      {error ? <p className="text-2xs text-rose-200">{error}</p> : null}
    </div>
  )
}
