"use client"

// In-app invoice viewer for CRM / Money → Invoices “View”.
// Dark Lyncr chrome; white receipt body. Public /r/{token} stays standalone for customers.

import { useEffect, useState } from "react"
import { Download, ExternalLink, Loader2, X } from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import {
  PublicInvoiceBody,
  type PublicInvoiceData,
} from "@/components/dashboard/public-invoice-body"
import { cn } from "@/lib/utils"

export function InvoicePreviewSheet({
  open,
  onOpenChange,
  /** Short token from /r/{token} (also on JobRecordInvoiceApi.receiptToken). */
  token,
  /** Full public URL — for “Open in browser”. */
  receiptUrl,
  /** PDF download href (falls back to /api/receipt/{token}/pdf). */
  pdfUrl,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  token: string | null
  receiptUrl?: string | null
  pdfUrl?: string | null
}) {
  // Loaded invoice JSON from the same public API the customer page uses.
  const [invoice, setInvoice] = useState<PublicInvoiceData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Fetch whenever the sheet opens with a token.
  useEffect(() => {
    if (!open || !token) {
      // Clear stale data when closed so the next open does not flash old content.
      if (!open) {
        setInvoice(null)
        setError(null)
        setLoading(false)
      }
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    setInvoice(null)

    void (async () => {
      try {
        const res = await fetch(`/api/receipt/${encodeURIComponent(token)}`, {
          cache: "no-store",
        })
        const json = (await res.json().catch(() => ({}))) as {
          data?: PublicInvoiceData
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
  }, [open, token])

  // Prefer explicit pdfUrl, then API field, then route by token.
  const pdfHref =
    pdfUrl ||
    invoice?.pdfUrl ||
    (token ? `/api/receipt/${encodeURIComponent(token)}/pdf` : null)

  // Absolute (or app-relative) link customers already get via SMS/email.
  const browserHref =
    receiptUrl || (token ? `/r/${encodeURIComponent(token)}` : null)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        // Sit above CRM customer sheets (z~7200) and Money payments sheet.
        overlayClassName="z-[7400]"
        className={cn(
          "z-[7410] flex max-h-[94dvh] flex-col gap-0 overflow-hidden rounded-t-2xl border-border bg-[#101018] p-0 sm:max-w-lg"
        )}
      >
        <SheetHeader className="shrink-0 border-b border-border px-4 pb-3 pt-4 text-left">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle className="text-base font-bold text-foreground">Invoice</SheetTitle>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {invoice?.invoiceNumber
                  ? invoice.invoiceNumber
                  : loading
                    ? "Loading…"
                    : "Paid receipt"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-lg p-2 text-muted-foreground hover:text-white"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </SheetHeader>

        {/* Scrollable receipt area — light gray behind white card. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-slate-100 px-3 py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Loading invoice…
            </div>
          ) : error || !invoice ? (
            <div className="rounded-xl border border-rose-200 bg-white px-4 py-8 text-center">
              <p className="text-sm font-semibold text-slate-800">Invoice unavailable</p>
              <p className="mt-2 text-xs text-muted-foreground">{error || "Could not load this invoice."}</p>
            </div>
          ) : (
            <PublicInvoiceBody invoice={invoice} />
          )}
        </div>

        {/* Dark action bar — PDF, Done, optional open-in-browser. */}
        <div className="shrink-0 space-y-2 border-t border-border bg-[#101018] px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3">
          {pdfHref ? (
            <a
              href={pdfHref}
              download
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              <Download className="h-4 w-4" aria-hidden />
              Download PDF
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-border bg-background/60 text-sm font-semibold text-foreground hover:bg-card"
          >
            Done
          </button>
          {browserHref ? (
            <a
              href={browserHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 w-full items-center justify-center gap-2 text-2xs font-semibold text-muted-foreground hover:text-teal-300"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              Open in browser
            </a>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}
