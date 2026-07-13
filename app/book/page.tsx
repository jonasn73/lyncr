import { Suspense } from "react"
import BookPageClient from "@/components/book-page-client"

export const dynamic = "force-dynamic"

export default function BookPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh items-center justify-center bg-zinc-950 text-sm text-zinc-400">
          Loading booking…
        </main>
      }
    >
      <BookPageClient />
    </Suspense>
  )
}
