import Link from "next/link"

// Next.js 404 boundary. A server component: nothing here needs client state, and
// unlike the crash screens this is an ordinary page, so a client-side Link back
// into the app is the right thing rather than a full document reload.
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6">
      <p className="text-center text-lg font-medium text-foreground">Page not found</p>
      <p className="max-w-md text-center text-sm text-muted-foreground">
        That link may be out of date, or the page may have moved.
      </p>
      <div className="flex gap-2">
        <Link
          href="/dashboard"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Go to dashboard
        </Link>
        <Link
          href="/"
          className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
        >
          Go to login
        </Link>
      </div>
    </div>
  )
}
