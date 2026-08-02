import { Suspense } from "react"
import { ServiceCallFormClient } from "@/components/pay/service-call-form-client"

export const dynamic = "force-dynamic"

export default function ServiceCallPayPage() {
  return (
    <main className="min-h-dvh bg-slate-950 text-slate-100">
      <Suspense
        fallback={
          <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-400">
            Loading…
          </div>
        }
      >
        <ServiceCallFormClient />
      </Suspense>
    </main>
  )
}
