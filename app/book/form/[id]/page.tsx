import { Suspense } from "react"
import { IntakeBookFormClient } from "@/components/book/intake-book-form-client"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ id: string }> }

export default async function IntakeBookFormPage({ params }: PageProps) {
  const { id } = await params
  return (
    <main className="min-h-dvh bg-slate-950 text-slate-100">
      <Suspense
        fallback={
          <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-400">
            Loading…
          </div>
        }
      >
        <IntakeBookFormClient inviteId={id} />
      </Suspense>
    </main>
  )
}
