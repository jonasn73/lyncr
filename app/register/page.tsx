"use client"

// /register?token=… — invited receptionist completes their profile.
// 1. Reads the token from the URL and validates it against /api/auth/validate-token.
// 2. If valid, shows Full Name, Cell Phone (pre-filled + locked for SMS invites), and Password.
// 3. POSTs to /api/auth/register-invited, then redirects to /receptionist.

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react"

type InviteType = "EMAIL" | "SMS"
type ValidResult = { valid: true; target: string; type: InviteType }
type ValidationState =
  | { status: "loading" }
  | { status: "invalid"; message: string }
  | { status: "valid"; invite: ValidResult }

function RegisterForm() {
  const params = useSearchParams()
  const token = params.get("token")?.trim() ?? ""

  const [validation, setValidation] = useState<ValidationState>({ status: "loading" })
  const [fullName, setFullName] = useState("")
  const [phone, setPhone] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // Validate the invite token on mount.
  useEffect(() => {
    if (!token) {
      setValidation({ status: "invalid", message: "No invitation token in the link." })
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/auth/validate-token?token=${encodeURIComponent(token)}`, { cache: "no-store" })
        const json = (await res.json().catch(() => ({}))) as { valid?: boolean; target?: string; type?: InviteType; error?: string }
        if (cancelled) return
        if (!res.ok || !json.valid || !json.target || !json.type) {
          setValidation({ status: "invalid", message: json.error ?? "This invitation is invalid or expired." })
          return
        }
        setValidation({ status: "valid", invite: { valid: true, target: json.target, type: json.type } })
        // Pre-fill (and lock) the cell number that an SMS invite was sent to.
        if (json.type === "SMS") setPhone(json.target)
      } catch {
        if (!cancelled) setValidation({ status: "invalid", message: "Could not reach the server. Try again." })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  const isSms = validation.status === "valid" && validation.invite.type === "SMS"

  async function submit() {
    setError(null)
    if (fullName.trim().length < 2) return setError("Enter your full name.")
    if (phone.replace(/\D/g, "").length < 10) return setError("Enter a valid cell phone number.")
    if (password.length < 8) return setError("Password must be at least 8 characters.")

    setSubmitting(true)
    try {
      const res = await fetch("/api/auth/register-invited", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name: fullName, password, phone }),
      })
      const json = (await res.json().catch(() => ({}))) as { data?: { redirect?: string }; error?: string }
      if (!res.ok) {
        setError(json.error ?? "Could not complete registration.")
        return
      }
      setDone(true)
      setTimeout(() => window.location.assign(json.data?.redirect ?? "/login"), 900)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error — please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass =
    "w-full rounded-lg border border-slate-600 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-700/80 bg-slate-900 p-6 shadow-2xl">
        <h1 className="text-xl font-semibold text-slate-100">Set up your receptionist account</h1>
        <p className="mt-1 text-sm text-slate-400">Complete your profile to start answering calls on Lyncr.</p>

        {validation.status === "loading" && (
          <div className="mt-6 flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Verifying your invitation…
          </div>
        )}

        {validation.status === "invalid" && (
          <div className="mt-6 flex items-start gap-2 rounded-lg border border-red-600/40 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{validation.message}</span>
          </div>
        )}

        {validation.status === "valid" && !done && (
          <div className="mt-6 space-y-4">
            {validation.invite.type === "EMAIL" && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">Email</label>
                <input value={validation.invite.target} readOnly className={`${inputClass} cursor-not-allowed opacity-70`} />
                <p className="mt-1 text-xs text-slate-500">You'll sign in with this email.</p>
              </div>
            )}

            <div>
              <label htmlFor="reg-name" className="mb-1 block text-sm font-medium text-slate-300">Full Name</label>
              <input
                id="reg-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jordan Pierce"
                autoFocus
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="reg-phone" className="mb-1 block text-sm font-medium text-slate-300">Cell Phone Number</label>
              <input
                id="reg-phone"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                readOnly={isSms}
                placeholder="(555) 123-4567"
                className={`${inputClass} ${isSms ? "cursor-not-allowed opacity-70" : ""}`}
              />
              {isSms && <p className="mt-1 text-xs text-slate-500">This is the number your invite was sent to.</p>}
            </div>

            <div>
              <label htmlFor="reg-password" className="mb-1 block text-sm font-medium text-slate-300">Password</label>
              <input
                id="reg-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !submitting) void submit()
                }}
                placeholder="At least 8 characters"
                className={inputClass}
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-red-600/40 bg-red-950/40 px-3 py-2 text-sm text-red-200">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {submitting ? "Creating your account…" : "Create my account"}
            </button>
          </div>
        )}

        {done && (
          <div className="mt-6 flex items-center gap-3 rounded-lg border border-emerald-600/40 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-100">
            <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-400" aria-hidden />
            Account created — taking you to sign in…
          </div>
        )}
      </div>
    </div>
  )
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        </div>
      }
    >
      <RegisterForm />
    </Suspense>
  )
}
