// Public page after the customer pays via a branded Collect Payment link.

"use client"

import { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { SITE_NAME } from "@/lib/brand"

function PayThanksInner() {
  const searchParams = useSearchParams()
  const sessionId = (searchParams.get("session_id") || "").trim()
  const [note, setNote] = useState<string | null>(null)

  // Backup: tell Lyncr the Checkout session finished (in case the Stripe webhook was late).
  useEffect(() => {
    if (!sessionId.startsWith("cs_")) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch("/api/pay/confirm-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        })
        const json = (await res.json().catch(() => ({}))) as {
          data?: { paymentStatus?: string; walletSettled?: boolean }
          error?: string
        }
        if (cancelled) return
        if (!res.ok) {
          setNote("Payment may still be processing — the business will see it shortly.")
          return
        }
        if (json.data?.walletSettled || json.data?.paymentStatus === "paid") {
          setNote("Payment confirmed.")
        }
      } catch {
        if (!cancelled) {
          setNote("Payment may still be processing — the business will see it shortly.")
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-[#0b1220] px-6 text-center text-slate-100">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">
        {SITE_NAME}
      </p>
      <h1 className="mt-3 text-2xl font-bold">Payment received</h1>
      <p className="mt-2 max-w-sm text-sm text-slate-400">
        Thanks — your payment went through. You can close this window.
      </p>
      {note ? <p className="mt-3 text-xs text-emerald-300/90">{note}</p> : null}
      <Link
        href="/"
        className="mt-8 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
      >
        Done
      </Link>
    </main>
  )
}

export default function PayThanksPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh items-center justify-center bg-[#0b1220] text-slate-400">
          Confirming payment…
        </main>
      }
    >
      <PayThanksInner />
    </Suspense>
  )
}
