import Link from "next/link"
import { Shield, ArrowLeft } from "lucide-react"
import type { Metadata } from "next"
import { SITE_NAME } from "@/lib/brand"

export const metadata: Metadata = {
  title: "Privacy",
  description: `Learn how ${SITE_NAME} protects account data, call routing settings, and call records.`,
}

export default function PrivacyPage() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <Link
          href="/dashboard/settings"
          className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Settings
        </Link>
      </header>
      <main className="mx-auto max-w-prose px-4 py-8">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Security & Privacy</h1>
            <p className="text-sm text-muted-foreground">How {SITE_NAME} handles your data</p>
          </div>
        </div>
        <div className="space-y-6 text-sm text-foreground">
          <section>
            <h2 className="mb-2 font-semibold text-foreground">Your data</h2>
            <p className="text-muted-foreground">
              {SITE_NAME} stores your account info (name, email, phone), call routing settings, and call logs so we can route calls and show you activity. We do not sell your data to third parties.
            </p>
          </section>
          <section>
            <h2 className="mb-2 font-semibold text-foreground">Calls and numbers</h2>
            <p className="text-muted-foreground">
              Call audio may be processed by our telephony provider to connect calls. Recordings, when enabled, are stored securely and used only for your account (e.g. playback in Activity).
            </p>
          </section>
          <section>
            <h2 className="mb-2 font-semibold text-foreground">Security</h2>
            <p className="text-muted-foreground">
              Passwords are hashed; we never store plain-text passwords. Session cookies are HTTP-only and secure in production. Use a strong password and sign out on shared devices.
            </p>
          </section>
          <p className="pt-4 text-xs text-muted-foreground">
            For a full privacy policy, set <code className="rounded bg-muted px-1">NEXT_PUBLIC_PRIVACY_POLICY_URL</code> in your deployment to point to your policy page. Then Security &amp; Privacy in Settings will open that URL.
          </p>
        </div>
      </main>
    </div>
  )
}
