"use client"

import Link from "next/link"
import { useEffect } from "react"

export default function AdminSandboxError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[admin/sandbox]", error)
  }, [error])

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 p-8 text-slate-200">
      <h1 className="text-xl font-semibold text-slate-100">Sandbox board failed to load</h1>
      <p className="text-sm leading-relaxed text-slate-400">
        The dev sandbox hit a server error. Common fixes: run migrations{" "}
        <strong className="font-medium text-slate-300">042–045</strong> in Neon (see{" "}
        <code className="text-violet-300">scripts/MIGRATE-ALL.md</code>), then try seed again.
      </p>
      {error.digest ? (
        <p className="font-mono text-xs text-slate-500">Error digest: {error.digest}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
        >
          Try again
        </button>
        <Link
          href="/admin"
          className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
        >
          Back to admin
        </Link>
      </div>
    </div>
  )
}
