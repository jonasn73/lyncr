import { Suspense } from "react"
import BookPageClient from "@/components/book-page-client"

export const dynamic = "force-dynamic"

export default function BookPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh items-center justify-center bg-background text-sm text-muted-foreground">
          Loading your booking…
        </main>
      }
    >
      <BookPageClient />
    </Suspense>
  )
}
