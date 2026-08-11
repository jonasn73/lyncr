"use client"

// Public customer invoice page — opened from SMS / email “View invoice” link.

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { Download } from "lucide-react"

type InvoiceLine = { label: string; amountCents: number }

type InvoiceData = {
  invoiceNumber: string
  businessName: string
  businessPhone: string | null
  customerName: string | null
  paidAtLabel: string
  description: string
  lines: InvoiceLine[]
  totalCents: number
  paymentMethodLabel: string
  signaturePng: string | null
  paymentIntentId: string
  vehicleLabel?: string | null
  vehicleVin?: string | null
  addressLine1?: string | null
  paidNote?: string | null
  pdfUrl?: string | null
}

function fmtUsd(cents: number): string {
  return (Math.max(0, cents) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  })
}

/** Prefer “Paid via Venmo” note when present. */
function paidHowLabel(invoice: InvoiceData): string {
  const note = (invoice.paidNote || "").trim()
  if (note) return note
  return `Paid via ${invoice.paymentMethodLabel}`
}

export default function PublicReceiptPage() {
  const params = useParams()
  const token = String(params?.token ?? "")
  const [invoice, setInvoice] = useState<InvoiceData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) {
      setError("Missing invoice link")
      setLoading(false)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/receipt/${encodeURIComponent(token)}`, {
          cache: "no-store",
        })
        const json = (await res.json().catch(() => ({}))) as {
          data?: InvoiceData
          error?: string
        }
        if (cancelled) return
        if (!res.ok || !json.data) {
          setError(json.error || "Invoice not found")
          return
        }
        setInvoice(json.data)
      } catch {
        if (!cancelled) setError("Could not load invoice")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  if (loading) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-slate-100 px-4 text-slate-500">
        Loading invoice…
      </main>
    )
  }

  if (error || !invoice) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-slate-100 px-4 text-center">
        <p className="text-lg font-semibold text-slate-800">Invoice unavailable</p>
        <p className="mt-2 max-w-sm text-sm text-slate-500">
          {error || "This link may be invalid or expired."}
        </p>
      </main>
    )
  }

  const paidHow = paidHowLabel(invoice)
  const pdfHref =
    invoice.pdfUrl || `/api/receipt/${encodeURIComponent(token)}/pdf`

  return (
    <main className="min-h-dvh bg-gradient-to-b from-slate-100 to-slate-200/80 px-4 py-8 pb-[calc(env(safe-area-inset-bottom)+6rem)] text-slate-900">
      <article className="relative mx-auto max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {/* Soft PAID stamp — visible but not covering content. */}
        <div
          aria-hidden
          className="pointer-events-none absolute right-4 top-28 rotate-[-12deg] select-none rounded-lg border-[3px] border-emerald-500/70 px-3 py-1 text-sm font-extrabold tracking-[0.2em] text-emerald-600/80"
        >
          PAID
        </div>

        <header className="border-b border-slate-200 bg-slate-900 px-5 py-5 text-white">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                Invoice / receipt
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight">
                {invoice.businessName}
              </h1>
              {invoice.businessPhone ? (
                <p className="mt-1 text-sm text-slate-300">{invoice.businessPhone}</p>
              ) : null}
            </div>
            <span className="shrink-0 rounded-full bg-emerald-500 px-3 py-1.5 text-[11px] font-extrabold tracking-wide text-white">
              PAID
            </span>
          </div>
        </header>

        <div className="space-y-5 px-5 py-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Total paid
              </p>
              <p className="mt-0.5 text-2xl font-extrabold tabular-nums text-emerald-600">
                {fmtUsd(invoice.totalCents)}
              </p>
              <p className="mt-1 text-sm font-medium text-slate-700">{paidHow}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Invoice #
              </p>
              <p className="mt-0.5 font-mono text-sm font-semibold">
                {invoice.invoiceNumber}
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Date paid
              </dt>
              <dd className="mt-0.5 text-slate-800">{invoice.paidAtLabel}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Payment
              </dt>
              <dd className="mt-0.5 text-slate-800">{invoice.paymentMethodLabel}</dd>
            </div>
            {invoice.customerName ? (
              <div className="col-span-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Bill to
                </dt>
                <dd className="mt-0.5 text-slate-800">{invoice.customerName}</dd>
              </div>
            ) : null}
            {invoice.vehicleLabel ? (
              <div className="col-span-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Vehicle
                </dt>
                <dd className="mt-0.5 text-slate-800">{invoice.vehicleLabel}</dd>
              </div>
            ) : null}
            {invoice.vehicleVin ? (
              <div className="col-span-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  VIN
                </dt>
                <dd className="mt-0.5 font-mono text-sm text-slate-800">
                  {invoice.vehicleVin}
                </dd>
              </div>
            ) : null}
            {invoice.addressLine1 ? (
              <div className="col-span-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Address
                </dt>
                <dd className="mt-0.5 text-slate-800">{invoice.addressLine1}</dd>
              </div>
            ) : null}
          </dl>

          <table className="w-full border-t-2 border-slate-900 text-sm">
            <thead>
              <tr className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                <th className="py-3 text-left">Description</th>
                <th className="py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line) => (
                <tr
                  key={`${line.label}-${line.amountCents}`}
                  className="border-t border-slate-100"
                >
                  <td className="py-3 text-slate-700">{line.label}</td>
                  <td className="py-3 text-right tabular-nums text-slate-900">
                    {fmtUsd(line.amountCents)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-900">
                <td className="pt-4 text-base font-extrabold">Total paid</td>
                <td className="pt-4 text-right text-base font-extrabold tabular-nums text-emerald-600">
                  {fmtUsd(invoice.totalCents)}
                </td>
              </tr>
            </tfoot>
          </table>

          {invoice.signaturePng ? (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                Customer signature
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={invoice.signaturePng}
                alt="Customer signature"
                className="mt-2 max-h-28 w-full max-w-xs rounded-lg border border-slate-200 bg-white object-contain p-2"
              />
            </div>
          ) : null}

          <p className="text-[11px] leading-relaxed text-slate-400">
            Keep this for your records or insurance reimbursement.
          </p>
        </div>
      </article>

      {/* Sticky download — works on phones (opens/saves the PDF). */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200/80 bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur">
        <div className="mx-auto flex max-w-lg flex-col gap-2">
          <a
            href={pdfHref}
            download
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500"
          >
            <Download className="h-4 w-4" aria-hidden />
            Download PDF
          </a>
          <p className="text-center text-[11px] text-slate-400">
            Sent by {invoice.businessName} · Powered by Lyncr
          </p>
        </div>
      </div>
    </main>
  )
}
