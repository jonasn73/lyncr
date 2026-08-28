// Mobile onboarding for an invited field technician. Validates the SMS token, lets them pick a
// password, then signs them straight into their console at /tech/dashboard.

"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"

export default function TechSetupPage() {
  // useSearchParams() requires a Suspense boundary during static prerender.
  return (
    <Suspense fallback={null}>
      <TechSetupForm />
    </Suspense>
  )
}

type ValidationState =
  | { phase: "checking" }
  | { phase: "invalid" }
  | { phase: "valid"; name: string; businessName: string }

function TechSetupForm() {
  const router = useRouter()
  const search = useSearchParams()
  const token = search.get("token")?.trim() || ""

  const [state, setState] = useState<ValidationState>({ phase: "checking" })
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // On load, ask the server whether this token is still valid (and not expired).
  useEffect(() => {
    if (!token) {
      setState({ phase: "invalid" })
      return
    }
    let active = true
    fetch(`/api/tech/setup?token=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { data?: { valid?: boolean; name?: string; businessName?: string } }) => {
        if (!active) return
        if (j.data?.valid) {
          setState({ phase: "valid", name: j.data.name || "Technician", businessName: j.data.businessName || "Lyncr" })
        } else {
          setState({ phase: "invalid" })
        }
      })
      .catch(() => active && setState({ phase: "invalid" }))
    return () => {
      active = false
    }
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError("Password must be at least 8 characters.")
      return
    }
    if (password !== confirm) {
      setError("Passwords don't match.")
      return
    }
    setBusy(true)
    try {
      const res = await fetch("/api/tech/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include", // store the session cookie the API sets
        body: JSON.stringify({ token, password }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json?.error || "Could not complete setup.")
        return
      }
      router.replace(json?.data?.redirect || "/tech/dashboard")
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-[100dvh] flex-col justify-center bg-background px-6 py-12">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-2xl font-black text-white shadow-lg shadow-indigo-900/40">
            L
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Set up your console</h1>
          {state.phase === "valid" ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Welcome{state.name ? `, ${state.name.split(" ")[0]}` : ""}! {state.businessName} invited you to Lyncr.
              Choose a password to access your jobs.
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">Lyncr Field Console</p>
          )}
        </div>

        {state.phase === "checking" && (
          <p className="text-center text-sm text-muted-foreground">Checking your invite link…</p>
        )}

        {state.phase === "invalid" && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-center">
            <p className="text-sm font-semibold text-destructive">This invite link is invalid or has expired.</p>
            <p className="mt-1 text-xs text-destructive/80">
              Ask your dispatcher to resend your Lyncr setup link, then tap the newest text.
            </p>
          </div>
        )}

        {state.phase === "valid" && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Create password</label>
              <input
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-border bg-card/80 px-4 py-4 text-base text-white outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                placeholder="At least 8 characters"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Confirm password</label>
              <input
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-xl border border-border bg-card/80 px-4 py-4 text-base text-white outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                placeholder="Re-enter password"
              />
            </div>

            {error && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 px-4 py-4 text-base font-semibold text-white shadow-lg shadow-indigo-900/40 transition active:scale-[0.99] disabled:opacity-60"
            >
              {busy ? "Setting up…" : "Complete setup"}
            </button>
          </form>
        )}

        <p className="mt-8 text-center text-xs text-muted-foreground">Powered by Lyncr</p>
      </div>
    </main>
  )
}
