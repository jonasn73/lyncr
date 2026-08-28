import { Suspense } from "react"
import { HelpPage } from "@/components/help-page"

function HelpPageFallback() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-8">
      <div className="h-9 w-48 animate-pulse rounded-md bg-muted" />
      <div className="h-32 animate-pulse rounded-xl bg-muted/80" />
    </div>
  )
}

export default function HelpRoute() {
  return (
    <Suspense fallback={<HelpPageFallback />}>
      <HelpPage />
    </Suspense>
  )
}
