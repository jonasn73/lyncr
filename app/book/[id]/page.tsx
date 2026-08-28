import { Suspense } from "react"
import { notFound } from "next/navigation"
import BookPageClient from "@/components/book-page-client"
import { getBookingInviteById } from "@/lib/booking-invite"
import { isMissedCallBookingCallbackMode } from "@/lib/missed-call-rescue"

export const dynamic = "force-dynamic"

export default async function BookInvitePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const invite = await getBookingInviteById(id)
  if (!invite) notFound()

  // Missed-call → soft request (no deposit). IVR/on_call can still collect a deposit on a window.
  // Both modes share the same Details → ASAP|Window step UI (no hour-slot wall).
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
        initialLine={invite.businessLine}
        initialPhone={invite.callerPhone || ""}
        initialFormMode={initialFormMode}
        inviteSource={invite.source}
      />
    </Suspense>
  )
}
