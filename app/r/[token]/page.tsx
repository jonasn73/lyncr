"use client"

// Public customer invoice page — opened from SMS / email “View invoice” link.

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"

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
}

function fmtUsd(cents: number): string {
  return (Math.max(0, cents) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  })
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

  return (
    <main className="min-h-dvh bg-slate-100 px-4 py-8 text-slate-900">
      <article className="mx-auto max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <header className="border-b border-slate-200 bg-slate-900 px-5 py-5 text-white">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
            Invoice
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{invoice.businessName}</h1>
          {invoice.businessPhone ? (
            <p className="mt-1 text-sm text-slate-300">{invoice.businessPhone}</p>
          ) : null}
        </header>

        <div className="space-y-5 px-5 py-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Status
              </p>
              <p className="mt-0.5 text-sm font-bold text-emerald-600">PAID</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Invoice #
              </p>
              <p className="mt-0.5 font-mono text-sm font-semibold">{invoice.invoiceNumber}</p>
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
            {invoice.paidNote ? (
              <div className="col-span-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Note
                </dt>
                <dd className="mt-0.5 text-slate-800">{invoice.paidNote}</dd>
              </div>
            ) : null}
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
                <dd className="mt-0.5 font-mono text-sm text-slate-800">{invoice.vehicleVin}</dd>
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
                <tr key={`${line.label}-${line.amountCents}`} className="border-t border-slate-100">
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
            Ref: {invoice.paymentIntentId}
          </p>
        </div>
      </article>
      <p className="mx-auto mt-4 max-w-lg text-center text-[11px] text-slate-400">
        Invoice powered by Lyncr
      </p>
    </main>
  )
}
