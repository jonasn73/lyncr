"use client"

// Shared white “receipt” card for public /r/{token} and in-app invoice preview.
// Keeps customer SMS/email page and owner View sheet looking the same.

export type PublicInvoiceLine = { label: string; amountCents: number }

export type PublicInvoiceData = {
  invoiceNumber: string
  businessName: string
  businessPhone: string | null
  customerName: string | null
  paidAtLabel: string
  description: string
  lines: PublicInvoiceLine[]
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

/** Format cents as $1,234.56 (never double-dollar). */
export function formatInvoiceUsd(cents: number): string {
  return (Math.max(0, cents) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  })
}

/** Prefer “Paid via Venmo” note when present. */
export function paidHowLabel(invoice: PublicInvoiceData): string {
  const note = (invoice.paidNote || "").trim()
  if (note) return note
  return `Paid via ${invoice.paymentMethodLabel}`
}

/** White receipt article — used inside public page and owner preview sheet. */
export function PublicInvoiceBody({ invoice }: { invoice: PublicInvoiceData }) {
  const paidHow = paidHowLabel(invoice)

  return (
    <article className="relative mx-auto max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-resting">
      {/* Soft PAID stamp — visible but not covering content. */}
      <div
        aria-hidden
        className="pointer-events-none absolute right-4 top-28 rotate-[-12deg] select-none rounded-lg border-[3px] border-success/70 px-3 py-1 text-sm font-extrabold tracking-[0.2em] text-success/80"
      >
        PAID
      </div>

      <header className="border-b border-slate-200 bg-card px-6 py-6 text-white">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-2xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
              Invoice
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">{invoice.businessName}</h1>
            {invoice.businessPhone ? (
              <p className="mt-1 text-sm text-foreground">{invoice.businessPhone}</p>
            ) : null}
          </div>
          <span className="shrink-0 rounded-full bg-success px-3 py-2 text-2xs font-extrabold tracking-wide text-white">
            PAID
          </span>
        </div>
      </header>

      <div className="space-y-6 px-6 py-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Total paid
            </p>
            <p className="mt-0.5 text-2xl font-extrabold tabular-nums text-success">
              {formatInvoiceUsd(invoice.totalCents)}
            </p>
            <p className="mt-1 text-sm font-medium text-slate-700">{paidHow}</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Invoice #
            </p>
            <p className="mt-0.5 font-mono text-sm font-semibold">{invoice.invoiceNumber}</p>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Date paid
            </dt>
            <dd className="mt-0.5 text-slate-800">{invoice.paidAtLabel}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Payment
            </dt>
            <dd className="mt-0.5 text-slate-800">{invoice.paymentMethodLabel}</dd>
          </div>
          {invoice.customerName ? (
            <div className="col-span-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Bill to
              </dt>
              <dd className="mt-0.5 text-slate-800">{invoice.customerName}</dd>
            </div>
          ) : null}
          {invoice.vehicleLabel ? (
            <div className="col-span-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Vehicle
              </dt>
              <dd className="mt-0.5 text-slate-800">{invoice.vehicleLabel}</dd>
            </div>
          ) : null}
          {invoice.vehicleVin ? (
            <div className="col-span-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                VIN
              </dt>
              <dd className="mt-0.5 font-mono text-sm text-slate-800">{invoice.vehicleVin}</dd>
            </div>
          ) : null}
          {invoice.addressLine1 ? (
            <div className="col-span-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Address
              </dt>
              <dd className="mt-0.5 text-slate-800">{invoice.addressLine1}</dd>
            </div>
          ) : null}
        </dl>

        <table className="w-full border-t-2 border-border text-sm">
          <thead>
            <tr className="text-2xs font-bold uppercase tracking-wide text-muted-foreground">
              <th className="py-3 text-left">Description</th>
              <th className="py-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line) => (
              <tr key={`${line.label}-${line.amountCents}`} className="border-t border-slate-100">
                <td className="py-3 text-slate-700">{line.label}</td>
                <td className="py-3 text-right tabular-nums text-slate-900">
                  {formatInvoiceUsd(line.amountCents)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border">
              <td className="pt-4 text-base font-extrabold">Total paid</td>
              <td className="pt-4 text-right text-base font-extrabold tabular-nums text-success">
                {formatInvoiceUsd(invoice.totalCents)}
              </td>
            </tr>
          </tfoot>
        </table>

        {invoice.signaturePng ? (
          <div>
            <p className="text-2xs font-bold uppercase tracking-wide text-muted-foreground">
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

        <p className="text-2xs leading-relaxed text-muted-foreground">
          Keep this for your records.
        </p>
      </div>
    </article>
  )
}
