// Public page when the customer cancels Stripe Checkout pay link.

import Link from "next/link"
import { SITE_NAME } from "@/lib/brand"

export default function PayCancelledPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-zinc-950 px-6 text-center text-slate-100">
      <p className="text-sm font-semibold uppercase tracking-wider text-slate-500">{SITE_NAME}</p>
      <h1 className="mt-3 text-2xl font-bold">Payment cancelled</h1>
      <p className="mt-2 max-w-sm text-sm text-slate-400">
        No charge was made. Ask the business to send a new link if you still need to pay.
      </p>
      <Link
        href="/"
        className="mt-8 rounded-xl border border-zinc-700 px-5 py-2.5 text-sm font-semibold text-slate-200 hover:bg-zinc-900"
      >
        Close
      </Link>
    </main>
  )
}
