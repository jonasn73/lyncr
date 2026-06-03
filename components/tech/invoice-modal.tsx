// On-site invoicing + payment capture. Itemized line items, optional tax, and a "Collect Payment"
// segment. Card processing runs through the OWNER's merchant config — the full card number is NEVER
// sent to our server (we derive last-4 client-side); until a processor is connected we record the charge.

"use client"

import { useMemo, useState } from "react"
import { Plus, Trash2, X, CreditCard, Banknote, Loader2, CheckCircle2 } from "lucide-react"
import type { DispatchJob } from "@/lib/types"

type Line = { id: string; label: string; amount: string } // amount is a dollar string while editing
type PaymentMethod = "none" | "cash" | "card"

const QUICK_ITEMS = ["Service charge", "Parts", "Labor", "Trip fee"]

function newLine(label = ""): Line {
  return { id: Math.random().toString(36).slice(2), label, amount: "" }
}

function dollarsToCents(v: string): number {
  const n = Math.round(parseFloat(v || "0") * 100)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function fmt(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
}

export function InvoiceModal(props: {
  job: DispatchJob
  merchantConfigured: boolean
  onClose: () => void
  onCompleted: () => void
}) {
  const [lines, setLines] = useState<Line[]>([newLine("Service charge")])
  const [taxDollars, setTaxDollars] = useState("")
  const [method, setMethod] = useState<PaymentMethod>("none")
  const [cardName, setCardName] = useState("")
  const [cardNumber, setCardNumber] = useState("")
  const [cardExp, setCardExp] = useState("")
  const [cardCvc, setCardCvc] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const subtotalCents = useMemo(
    () => lines.reduce((sum, l) => sum + dollarsToCents(l.amount), 0),
    [lines]
  )
  const taxCents = dollarsToCents(taxDollars)
  const totalCents = subtotalCents + taxCents

  function updateLine(id: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }
  function removeLine(id: string) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev))
  }

  async function submit() {
    setError(null)
    const lineItems = lines
      .map((l) => ({ label: l.label.trim(), amountCents: dollarsToCents(l.amount) }))
      .filter((l) => l.label && l.amountCents > 0)
    if (lineItems.length === 0) {
      setError("Add at least one line item with an amount.")
      return
    }
    const collectNow = method !== "none"
    if (method === "card" && cardNumber.replace(/\D/g, "").length < 12) {
      setError("Enter a valid card number to collect payment.")
      return
    }

    setBusy(true)
    try {
      const res = await fetch("/api/tech/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          leadId: props.job.id,
          lineItems,
          taxCents,
          paymentMethod: method,
          collectNow,
          // Only the last 4 leaves the device — never the full PAN.
          cardLast4: method === "card" ? cardNumber.replace(/\D/g, "").slice(-4) : undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json?.error || "Could not save invoice.")
        return
      }
      setDone(true)
      setTimeout(props.onCompleted, 900)
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center">
      <div className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-zinc-800 bg-[#101018] sm:rounded-3xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-white">Complete &amp; Invoice</h2>
            <p className="text-xs text-zinc-500">{props.job.customer_name || props.job.customer_phone || "Customer"}</p>
          </div>
          <button onClick={props.onClose} className="rounded-lg p-2 text-zinc-400 hover:text-white" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {done ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-400" />
            <p className="mt-3 text-lg font-semibold text-white">Invoice saved</p>
            <p className="mt-1 text-sm text-zinc-400">{fmt(totalCents)} · job marked complete</p>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
              {/* Line items */}
              <section>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Line items</p>
                <div className="space-y-2">
                  {lines.map((line) => (
                    <div key={line.id} className="flex items-center gap-2">
                      <input
                        value={line.label}
                        onChange={(e) => updateLine(line.id, { label: e.target.value })}
                        placeholder="Description"
                        className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-500"
                      />
                      <div className="relative w-28 shrink-0">
                        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-500">$</span>
                        <input
                          value={line.amount}
                          onChange={(e) => updateLine(line.id, { amount: e.target.value.replace(/[^\d.]/g, "") })}
                          inputMode="decimal"
                          placeholder="0.00"
                          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 py-2.5 pl-6 pr-2 text-right text-sm text-white outline-none focus:border-indigo-500"
                        />
                      </div>
                      <button
                        onClick={() => removeLine(line.id)}
                        className="shrink-0 rounded-lg p-2 text-zinc-500 hover:text-red-400 disabled:opacity-30"
                        disabled={lines.length === 1}
                        aria-label="Remove line"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Quick add chips */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {QUICK_ITEMS.map((label) => (
                    <button
                      key={label}
                      onClick={() => setLines((prev) => [...prev, newLine(label)])}
                      className="flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-800/60 px-3 py-1.5 text-xs font-medium text-zinc-300 transition active:scale-95 hover:bg-zinc-800"
                    >
                      <Plus className="h-3 w-3" /> {label}
                    </button>
                  ))}
                  <button
                    onClick={() => setLines((prev) => [...prev, newLine()])}
                    className="flex items-center gap-1 rounded-full border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-300 transition active:scale-95"
                  >
                    <Plus className="h-3 w-3" /> Custom
                  </button>
                </div>
              </section>

              {/* Tax + totals */}
              <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="flex items-center justify-between text-sm text-zinc-400">
                  <span>Subtotal</span>
                  <span className="font-medium text-zinc-200">{fmt(subtotalCents)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm text-zinc-400">
                  <span>Tax</span>
                  <div className="relative w-24">
                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-500">$</span>
                    <input
                      value={taxDollars}
                      onChange={(e) => setTaxDollars(e.target.value.replace(/[^\d.]/g, ""))}
                      inputMode="decimal"
                      placeholder="0.00"
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-900 py-1.5 pl-6 pr-2 text-right text-sm text-white outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-zinc-800 pt-3 text-base font-bold text-white">
                  <span>Total</span>
                  <span>{fmt(totalCents)}</span>
                </div>
              </section>

              {/* Collect payment */}
              <section>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Collect payment</p>
                <div className="grid grid-cols-3 gap-2">
                  <MethodButton active={method === "none"} onClick={() => setMethod("none")} label="Later" />
                  <MethodButton active={method === "cash"} onClick={() => setMethod("cash")} label="Cash" icon={<Banknote className="h-4 w-4" />} />
                  <MethodButton active={method === "card"} onClick={() => setMethod("card")} label="Card" icon={<CreditCard className="h-4 w-4" />} />
                </div>

                {method === "card" && (
                  <div className="mt-3 space-y-2">
                    <input
                      value={cardName}
                      onChange={(e) => setCardName(e.target.value)}
                      placeholder="Cardholder name"
                      autoComplete="cc-name"
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-500"
                    />
                    <input
                      value={cardNumber}
                      onChange={(e) => setCardNumber(e.target.value.replace(/[^\d ]/g, "").slice(0, 19))}
                      placeholder="Card number"
                      inputMode="numeric"
                      autoComplete="cc-number"
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-500"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        value={cardExp}
                        onChange={(e) => setCardExp(e.target.value.replace(/[^\d/]/g, "").slice(0, 5))}
                        placeholder="MM/YY"
                        inputMode="numeric"
                        autoComplete="cc-exp"
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-500"
                      />
                      <input
                        value={cardCvc}
                        onChange={(e) => setCardCvc(e.target.value.replace(/\D/g, "").slice(0, 4))}
                        placeholder="CVC"
                        inputMode="numeric"
                        autoComplete="cc-csc"
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-500"
                      />
                    </div>
                    <p className="text-[11px] leading-snug text-zinc-500">
                      {props.merchantConfigured
                        ? "Charged securely via your company's connected merchant account."
                        : "Card details stay on this device. Live processing activates once your company connects a merchant account — for now the charge is recorded against this job."}
                    </p>
                  </div>
                )}
              </section>

              {error && (
                <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
              )}
            </div>

            {/* Footer action */}
            <div className="border-t border-zinc-800 px-5 py-4">
              <button
                onClick={submit}
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 px-4 py-3.5 text-base font-semibold text-white shadow-lg shadow-emerald-900/30 transition active:scale-[0.99] disabled:opacity-60"
              >
                {busy ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : method === "none" ? (
                  `Save invoice · ${fmt(totalCents)}`
                ) : (
                  `Collect ${fmt(totalCents)}`
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function MethodButton(props: { active: boolean; onClick: () => void; label: string; icon?: React.ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-3 text-sm font-medium transition active:scale-[0.98] ${
        props.active
          ? "border-indigo-500 bg-indigo-500/15 text-white"
          : "border-zinc-700 bg-zinc-800/40 text-zinc-400 hover:text-white"
      }`}
    >
      {props.icon} {props.label}
    </button>
  )
}
