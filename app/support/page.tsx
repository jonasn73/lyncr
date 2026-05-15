import Link from "next/link"
import { HelpCircle, ArrowLeft, Mail } from "lucide-react"
import type { Metadata } from "next"
import { SITE_NAME } from "@/lib/brand"

export const metadata: Metadata = {
  title: "Support",
  description: `Get help with ${SITE_NAME} call routing, numbers, receptionists, and account setup.`,
}

export default function SupportPage() {
  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@getzingapp.com"

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back home
        </Link>
      </header>
      <main className="mx-auto max-w-prose px-4 py-8">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <HelpCircle className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Help & Support</h1>
            <p className="text-sm text-muted-foreground">Get help or get in touch</p>
          </div>
        </div>
        <div className="space-y-6 text-sm text-foreground">
          <section>
            <h2 className="mb-2 font-semibold text-foreground">Contact us</h2>
            <p className="mb-3 text-muted-foreground">
              For billing, account, or technical help, email us and we’ll get back to you as soon as we can.
            </p>
            <a
              href={`mailto:${supportEmail}`}
              className="inline-flex items-center gap-2 rounded-lg bg-primary/10 px-4 py-2 text-primary hover:bg-primary/20"
            >
              <Mail className="h-4 w-4" />
              {supportEmail}
            </a>
          </section>
          <section>
            <h2 className="mb-2 font-semibold text-foreground">Common questions</h2>
            <ul className="list-inside list-disc space-y-1 text-muted-foreground">
              <li>Changing your main line (cell): Settings → tap your profile → Edit next to “Main line”.</li>
              <li>Adding a business number: Settings → Business numbers → Add business number (buy or port).</li>
              <li>Routing calls to a receptionist: Dashboard → Route calls to → pick a receptionist.</li>
              <li>Staying logged in: Use the same browser and avoid clearing cookies; session lasts 30 days.</li>
            </ul>
          </section>
          <p className="pt-4 text-xs text-muted-foreground">
            To use your own support URL (e.g. help center), set <code className="rounded bg-muted px-1">NEXT_PUBLIC_SUPPORT_URL</code> in your deployment. Then Help &amp; Support in Settings will open that URL in a new tab.
          </p>
        </div>
      </main>
    </div>
  )
}
