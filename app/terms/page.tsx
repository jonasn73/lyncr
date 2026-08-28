import Link from "next/link" // Next.js client-side navigation link.
import { FileText, ArrowLeft } from "lucide-react" // Header + back-link icons.
import type { Metadata } from "next" // Type for the page's SEO metadata.
import { SITE_NAME } from "@/lib/brand" // Product name so copy stays in sync with the brand.
import { IpUsageRestrictions } from "@/components/legal/ip-usage-restrictions" // The reusable IP block.

// SEO metadata for the /terms route (shows in the browser tab + share cards).
export const metadata: Metadata = {
  title: "Terms of Service",
  description: `${SITE_NAME} Terms of Service, including intellectual property and usage restrictions.`,
}

// The Terms of Service page rendered at /terms.
export default function TermsPage() {
  return (
    // Full-height page on the app's standard background.
    <div className="min-h-dvh bg-background">
      {/* Sticky header with a back link to Settings (mirrors the Privacy page pattern). */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <Link
          href="/dashboard/settings"
          className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Settings
        </Link>
      </header>

      {/* Centered, readable column for legal copy. */}
      <main className="mx-auto max-w-prose px-4 py-8">
        {/* Page title block. */}
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
            <FileText className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Terms of Service</h1>
            <p className="text-sm text-muted-foreground">Your agreement for using {SITE_NAME}</p>
          </div>
        </div>

        {/* The full Intellectual Property & Usage Restrictions section. */}
        <IpUsageRestrictions governingState="Kentucky" />

        {/* Footer note: this is a starting template and should be reviewed by counsel. */}
        <p className="mt-8 border-t border-border pt-4 text-xs text-muted-foreground">
          This document is a starting template and does not constitute legal advice. Have it reviewed by
          qualified counsel before relying on it in production.
        </p>
      </main>
    </div>
  )
}
