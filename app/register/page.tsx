"use client"

// /register?token=… — invited receptionist completes their profile.
// 1. Reads the token from the URL and validates it against /api/auth/validate-token.
// 2. If valid, shows Full Name, Cell Phone (pre-filled + locked for SMS invites), and Password.
// 3. POSTs to /api/auth/register-invited, then redirects to /receptionist (owner team_invites)
//    or /login (admin stub / invitations table flows).

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react"

type InviteType = "EMAIL" | "SMS"

/** Terms the owner attached to this invite — absent when they sent a bare invite. */
type InviteAgreement = {
  id: string
  employment_type: "W2_EMPLOYEE" | "CONTRACTOR_1099"
  pay_summary: string
  body: string
  business_name: string
}
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
  // The agreement this invite carries, if the owner attached pay terms to it.
  const [agreement, setAgreement] = useState<InviteAgreement | null>(null)
  const [consent, setConsent] = useState(false)
  const [signerName, setSignerName] = useState("")

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

        // Terms, when there are any. A bare invite still registers normally.
        const agreementRes = await fetch(
          `/api/agreements/for-invite?token=${encodeURIComponent(token)}`,
          { cache: "no-store" }
        )
        if (!cancelled && agreementRes.ok) {
          const agreementJson = (await agreementRes.json().catch(() => ({}))) as {
            data?: { agreement?: InviteAgreement | null }
          }
          if (agreementJson.data?.agreement) setAgreement(agreementJson.data.agreement)
        }
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
    if (agreement) {
      if (!consent) return setError("Tick the box to agree and sign electronically.")
      if (signerName.trim().length < 2) return setError("Type your full name to sign.")
    }

    setSubmitting(true)
    try {
      const res = await fetch("/api/auth/register-invited", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          name: fullName,
          password,
          phone,
          ...(agreement
            ? { consent_electronic: consent, signer_name: signerName.trim() }
            : {}),
        }),
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
    "w-full rounded-lg border border-slate-600 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 placeholder:text-muted-foreground focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-700/80 bg-slate-900 p-6 shadow-2xl">
        <h1 className="text-xl font-semibold text-slate-100">Set up your receptionist account</h1>
        <p className="mt-1 text-sm text-muted-foreground">Complete your profile to start answering calls on Lyncr.</p>

        {validation.status === "loading" && (
          <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
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
                <p className="mt-1 text-xs text-muted-foreground">You&apos;ll sign in with this email.</p>
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
              {isSms && <p className="mt-1 text-xs text-muted-foreground">This is the number your invite was sent to.</p>}
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

            {agreement && (
              <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-950/60 p-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">
                    {agreement.employment_type === "W2_EMPLOYEE"
                      ? "Your employment terms"
                      : "Your contractor agreement"}
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    From {agreement.business_name}. Read this before you finish signing up.
                  </p>
                </div>

                <div className="rounded-lg border border-primary/30 bg-violet-950/30 px-3 py-2">
                  <p className="text-micro font-semibold uppercase tracking-wide text-violet-300">
                    You will be paid
                  </p>
                  <p className="mt-0.5 text-sm text-slate-100">{agreement.pay_summary}</p>
                </div>

                {/* Scrollable rather than collapsed: nobody should have to expand a
                    disclosure to find the terms they are about to sign. */}
                <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs leading-relaxed text-slate-300">
                  {agreement.body}
                </div>

                <div>
                  <label htmlFor="reg-signature" className="mb-1 block text-sm font-medium text-slate-300">
                    Sign by typing your full name
                  </label>
                  <input
                    id="reg-signature"
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                    placeholder={fullName || "Your full name"}
                    className={`${inputClass} font-serif italic`}
                  />
                </div>

                <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-600 bg-slate-950 accent-violet-600"
                  />
                  <span>
                    I have read these terms and agree to sign them electronically, with the same
                    intent as signing on paper. I can save a copy from my account afterwards.
                  </span>
                </label>
              </div>
            )}

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
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {submitting
                ? "Creating your account…"
                : agreement
                  ? "Sign and create my account"
                  : "Create my account"}
            </button>
          </div>
        )}

        {done && (
          <div className="mt-6 flex items-center gap-3 rounded-lg border border-emerald-600/40 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-100">
            <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-400" aria-hidden />
            Account created — taking you in…
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
        <div className="flex min-h-screen items-center justify-center bg-slate-950 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        </div>
      }
    >
      <RegisterForm />
    </Suspense>
  )
}
