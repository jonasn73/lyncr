"use client"

// Legacy /upload?t=… links redirect into the full Pending Info Intake page.

import { Suspense, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"

function UploadRedirectInner() {
  const router = useRouter()
  const search = useSearchParams()

  useEffect(() => {
    const t = (search.get("t") || search.get("token") || "").trim()
    const qs = t ? `?t=${encodeURIComponent(t)}` : ""
    router.replace(`/intake-rescue${qs}`)
  }, [router, search])

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md items-center justify-center px-6">
      <p className="text-sm text-zinc-600">Opening intake form…</p>
    </main>
  )
}

export default function UploadRedirectPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-[100dvh] max-w-md items-center justify-center px-6">
          <p className="text-sm text-zinc-600">Loading…</p>
        </main>
      }
    >
      <UploadRedirectInner />
    </Suspense>
  )
}
