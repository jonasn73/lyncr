"use client"

import { useState } from "react"
import Link from "next/link"
import { BrandMark } from "@/components/brand-mark"
import { BrandWordmark } from "@/components/brand-wordmark"
import { Loader2 } from "lucide-react"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [resetUrl, setResetUrl] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setMessage("")
    setResetUrl(null)
    setLoading(true)
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Could not start reset")
        return
      }
      setMessage(data.message || "Use the link below to set a new password.")
      if (typeof data.resetUrl === "string" && data.resetUrl.length > 0) {
        setResetUrl(data.resetUrl)
      }
    } catch {
      setError("Something went wrong. Try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-center px-6 py-5">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <BrandMark className="h-4 w-4 text-primary-foreground" />
          </div>
          <BrandWordmark size="md" />
        </Link>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-6 pb-16">
        <ForgotPasswordForm
          email={email}
          setEmail={setEmail}
          loading={loading}
          error={error}
          message={message}
          resetUrl={resetUrl}
          onSubmit={handleSubmit}
        />
      </main>
    </div>
  )
}

function ForgotPasswordForm({
  email,
  setEmail,
  loading,
  error,
  message,
  resetUrl,
  onSubmit,
}: {
  email: string
  setEmail: (v: string) => void
  loading: boolean
  error: string
  message: string
  resetUrl: string | null
  onSubmit: (e: React.FormEvent) => void
}) {
  return (
    <div className="w-full max-w-sm animate-sigo-page-enter">
      <h1 className="text-center text-2xl font-bold text-foreground">Reset your password</h1>
      <p className="mt-2 text-center text-sm text-muted-foreground">
        Enter your account email. We&apos;ll show a one-time link to choose a new password (expires in about one hour).
      </p>

      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-xs font-semibold text-muted-foreground">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            autoComplete="email"
            required
            className="rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
          />
        </div>

        {error ? <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p> : null}
        {message ? <p className="rounded-lg bg-primary/10 px-3 py-2 text-xs text-foreground">{message}</p> : null}

        {resetUrl ? (
          <div className="rounded-xl border border-border/70 bg-card p-4 text-sm">
            <p className="font-semibold text-foreground">Your reset link</p>
            <p className="mt-1 text-xs text-muted-foreground">Open in this browser. Expires in about one hour.</p>
            <a
              href={resetUrl}
              className="mt-3 inline-flex w-full items-center justify-center rounded-lg border border-primary/40 bg-primary/10 py-2.5 text-xs font-semibold text-primary hover:bg-primary/15"
            >
              Open reset page
            </a>
          </div>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Get reset link"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link href="/login" className="font-medium text-primary hover:underline">
          Back to log in
        </Link>
      </p>
    </div>
  )
}
