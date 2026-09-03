// Shared sticky header for tech console pages beyond the hub (which has its own greeting
// header). Same classes, so every page reads as one console.

import Link from "next/link"
import { ChevronLeft } from "lucide-react"

export function TechPageHeader({
  businessName,
  title,
  backHref,
}: {
  businessName: string
  title: string
  /** Renders a back-to-hub affordance next to the title. */
  backHref?: string
}) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border/80 bg-[#0b0b12]/95 px-4 py-4 backdrop-blur">
      {backHref ? (
        <Link
          href={backHref}
          aria-label="Back to home"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition active:scale-95 hover:text-white"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
      ) : null}
      <div className="min-w-0">
        <p className="text-2xs font-medium uppercase tracking-wider text-foreground opacity-50">{businessName}</p>
        <h1 className="truncate text-lg font-bold leading-tight font-[family-name:var(--font-tech-heading)]">
          {title}
        </h1>
      </div>
    </header>
  )
}
