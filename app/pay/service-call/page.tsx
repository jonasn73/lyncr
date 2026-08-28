import { Suspense } from "react"
import { ServiceCallFormClient } from "@/components/pay/service-call-form-client"

export const dynamic = "force-dynamic"

export default function ServiceCallPayPage() {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <Suspense
        fallback={
          <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        }
      >
        <ServiceCallFormClient />
      </Suspense>
    </main>
  )
}
