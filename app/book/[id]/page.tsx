import { Suspense } from "react"
import { notFound } from "next/navigation"
import BookPageClient from "@/components/book-page-client"
import { getBookingInviteById } from "@/lib/booking-invite"

export const dynamic = "force-dynamic"

export default async function BookInvitePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const invite = await getBookingInviteById(id)
  if (!invite) notFound()

  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh items-center justify-center bg-zinc-950 text-sm text-zinc-400">
          Loading booking…
        </main>
      }
    >
      <BookPageClient
        initialLine={invite.businessLine}
        initialPhone={invite.callerPhone || ""}
      />
    </Suspense>
  )
}
