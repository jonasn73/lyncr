import { Suspense } from "react"
import { notFound } from "next/navigation"
import BookPageClient from "@/components/book-page-client"
import { getBookingInviteById } from "@/lib/booking-invite"
import { isMissedCallBookingCallbackMode } from "@/lib/missed-call-rescue"

export const dynamic = "force-dynamic"

/** Short SMS links: lyncr.app/b/XXXX — same form as /book/[uuid]. */
export default async function BookShortInvitePage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  const invite = await getBookingInviteById(code)
  if (!invite) notFound()

  const initialFormMode = isMissedCallBookingCallbackMode(invite.source)
    ? "callback"
    : "book"

  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh items-center justify-center bg-zinc-950 text-sm text-zinc-400">
          Loading your booking…
        </main>
      }
    >
      <BookPageClient
        initialLine={invite.businessLine}
        initialPhone={invite.callerPhone || ""}
        initialFormMode={initialFormMode}
        inviteSource={invite.source}
      />
    </Suspense>
  )
}
