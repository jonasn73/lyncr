// Public page after the customer pays via a branded Collect Payment link.

import Link from "next/link"
import { SITE_NAME } from "@/lib/brand"

export default function PayThanksPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-[#0b1220] px-6 text-center text-slate-100">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">
        {SITE_NAME}
      </p>
      <h1 className="mt-3 text-2xl font-bold">Payment received</h1>
      <p className="mt-2 max-w-sm text-sm text-slate-400">
        Thanks — your payment went through. You can close this window.
      </p>
      <Link
        href="/"
        className="mt-8 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
      >
        Done
      </Link>
    </main>
  )
}
