"use client"

// Public customer invoice page — opened from SMS / email “View invoice” link.
// Standalone full page (not the in-app sheet). Body shared with InvoicePreviewSheet.

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { Download, X } from "lucide-react"
import {
  PublicInvoiceBody,
  type PublicInvoiceData,
} from "@/components/dashboard/public-invoice-body"

/** Leave the receipt: go back, close the tab, or fall back to lyncr.app. */
function exitReceiptPage() {
  if (typeof window === "undefined") return
  // SMS/email links often open in a new tab with no useful history.
  if (window.history.length > 1) {
    window.history.back()
    return
  }
  // Scripts can only close windows they opened; try anyway, then navigate away.
  window.close()
  window.setTimeout(() => {
    if (!window.closed) {
      window.location.href = "https://lyncr.app"
    }
  }, 150)
}

export default function PublicReceiptPage() {
  const params = useParams()
  const token = String(params?.token ?? "")
  const [invoice, setInvoice] = useState<PublicInvoiceData | null>(null)
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
  }, [token])

  if (loading) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-slate-100 px-4 text-muted-foreground">
        Loading invoice…
      </main>
    )
  }

  if (error || !invoice) {
    return (
      <main className="relative flex min-h-dvh flex-col items-center justify-center bg-slate-100 px-4 text-center">
        <button
          type="button"
          onClick={exitReceiptPage}
          className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-muted-foreground shadow-resting ring-1 ring-slate-200 hover:bg-slate-50"
          aria-label="Close"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
        <p className="text-lg font-semibold text-slate-800">Invoice unavailable</p>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          {error || "This link may be invalid or expired."}
        </p>
        <button
          type="button"
          onClick={exitReceiptPage}
          className="mt-6 inline-flex h-11 min-w-[8rem] items-center justify-center rounded-xl bg-card px-6 text-sm font-semibold text-white"
        >
          Done
        </button>
        <p className="mt-3 text-xs text-muted-foreground">You can close this tab</p>
      </main>
    )
  }

  const pdfHref = invoice.pdfUrl || `/api/receipt/${encodeURIComponent(token)}/pdf`

  return (
    <main className="relative min-h-dvh bg-gradient-to-b from-slate-100 to-slate-200/80 px-4 py-8 pb-[calc(env(safe-area-inset-bottom)+9rem)] text-slate-900">
      {/* Top-right close — stays visible while scrolling. */}
      <button
        type="button"
        onClick={exitReceiptPage}
        className="fixed right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-20 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-slate-700 shadow-resting ring-1 ring-slate-200 backdrop-blur hover:bg-white"
        aria-label="Close"
      >
        <X className="h-5 w-5" aria-hidden />
      </button>

      <PublicInvoiceBody invoice={invoice} />

      {/* Sticky actions — Download PDF + Done (exit). */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200/80 bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur">
        <div className="mx-auto flex max-w-lg flex-col gap-2">
          <a
            href={pdfHref}
            download
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-success text-sm font-semibold text-white shadow-resting hover:bg-success"
          >
            <Download className="h-4 w-4" aria-hidden />
            Download PDF
          </a>
          <button
            type="button"
            onClick={exitReceiptPage}
            className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-800 shadow-resting hover:bg-slate-50"
          >
            Done
          </button>
          <p className="text-center text-2xs text-muted-foreground">
            You can close this tab · Sent by {invoice.businessName} · Powered by Lyncr
          </p>
        </div>
      </div>
    </main>
  )
}
