import { Suspense } from "react"
import Link from "next/link"
import BookPageClient from "@/components/book-page-client"
import { getBookingInviteById } from "@/lib/booking-invite"
import { isMissedCallBookingCallbackMode } from "@/lib/booking-sms-guards"

export const dynamic = "force-dynamic"

/** Soft landing when the short code is missing/expired — better than a bare 404. */
function BookingInviteMissing() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-foreground">
      <p className="text-center text-lg font-medium">This booking link isn’t available</p>
      <p className="max-w-md text-center text-sm text-muted-foreground">
        It may have expired, or the link got cut off in the text. Ask the shop to send a fresh
        link, or call them back.
      </p>
      <Link
        href="/"
        className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted"
      >
        Go home
      </Link>
    </main>
  )
}

/** Short SMS links: lyncr.app/b/XXXX — same form as /book/[uuid]. */
export default async function BookShortInvitePage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  const invite = await getBookingInviteById(code)
  if (!invite) return <BookingInviteMissing />

  const initialFormMode = isMissedCallBookingCallbackMode(invite.source)
    ? "callback"
    : "book"

  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh items-center justify-center bg-background text-sm text-muted-foreground">
          Loading your booking…
        </main>
      }
    >
      <BookPageClient
        inviteId={invite.id}
        initialLine={invite.businessLine}
        initialPhone={invite.callerPhone || ""}
        initialFormMode={initialFormMode}
        inviteSource={invite.source}
        initialPrefill={invite.prefill || null}
      />
    </Suspense>
  )
}
