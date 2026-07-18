// /track-location?jobId=…&c=… — customer SMS entry; secure token `c` powers the locate flow.

import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"

type Search = { c?: string; jobId?: string; token?: string }

export default async function TrackLocationPage({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  const q = await searchParams
  const token = (q.c || q.token || "").trim()
  if (!token) {
    return (
      <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center px-6 text-center">
        <h1 className="text-lg font-semibold text-zinc-100">Locate link incomplete</h1>
        <p className="mt-2 text-sm text-zinc-400">
          This GPS link is missing its secure code. Ask your locksmith to text a new Request Live GPS
          link.
        </p>
      </main>
    )
  }
  // Reuse the existing locate UI (token validation + geolocation post).
  redirect(`/locate?c=${encodeURIComponent(token)}`)
}
