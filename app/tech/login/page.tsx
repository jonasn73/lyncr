// Dedicated mobile login for field technicians. Uses the same /api/auth/login endpoint as everyone
// else, then routes to the console the API resolved (field_tech → /tech/dashboard).

"use client"

import { Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"

export default function TechLoginPage() {
  // useSearchParams() requires a Suspense boundary during static prerender.
  return (
    <Suspense fallback={null}>
      <TechLoginForm />
    </Suspense>
  )
}

function TechLoginForm() {
  const router = useRouter()
  const search = useSearchParams()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault() // keep the page from reloading on submit
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include", // store the session cookie
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json?.error || "Invalid email or password")
        return
      }
      // The API tells us where this account belongs; techs land on /tech/dashboard.
      const next = search.get("next")
      const dest = json?.data?.redirect || next || "/tech/dashboard"
      router.replace(dest)
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-[100dvh] flex-col justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-2xl font-black text-white shadow-lg shadow-indigo-900/40">
            L
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Lyncr Field Console</h1>
          <p className="mt-1 text-sm text-zinc-400">Sign in to see your assigned jobs.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Email</label>
            <input
              type="email"
              inputMode="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900/80 px-4 py-3.5 text-base text-white outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
              placeholder="you@email.com"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Password</label>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900/80 px-4 py-3.5 text-base text-white outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 px-4 py-3.5 text-base font-semibold text-white shadow-lg shadow-indigo-900/40 transition active:scale-[0.99] disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-8 text-center text-xs text-zinc-500">
          Powered by Lyncr · Ask your dispatcher for login details
        </p>
      </div>
    </main>
  )
}
