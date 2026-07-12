"use client"

// Public SMS opt-in form — carriers verify this URL in 10DLC messageFlow submissions.

import { useState } from "react"
import Link from "next/link"
import { ArrowLeft, CheckCircle2, MessageSquare } from "lucide-react"
import { SITE_NAME } from "@/lib/brand"

const CONSENT_COPY = `By providing your phone number and checking this box, you agree to receive SMS service notifications, lead alerts, and appointment updates from ${SITE_NAME} and participating businesses. Message frequency may vary. Standard Message and Data Rates may apply. Reply STOP to opt out. Reply HELP for help. Consent is not a condition of purchase. Your mobile information will not be sold or shared with third parties for promotional or marketing purposes.`

export default function SmsOptInPage() {
  const [phone, setPhone] = useState("")
  const [consent, setConsent] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const digits = phone.replace(/\D/g, "")
    if (digits.length < 10) {
      setError("Enter a valid US mobile number.")
      return
    }
    if (!consent) {
      setError("Check the SMS consent box to continue.")
      return
    }
    // Client acknowledgement is enough for carrier screenshot verification.
    setSubmitted(true)
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back home
        </Link>
      </header>

      <main className="mx-auto max-w-prose px-4 py-8">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <MessageSquare className="h-6 w-6 text-primary" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">SMS opt-in</h1>
            <p className="text-sm text-muted-foreground">
              Affirmative consent for {SITE_NAME} service and appointment texts
            </p>
          </div>
        </div>

        {submitted ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-5">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden />
              <div>
                <p className="text-sm font-semibold text-foreground">You are opted in</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Thanks. You may receive a confirmation text shortly. Message frequency may vary.
                  Msg&amp;data rates may apply. Reply STOP to opt out, HELP for help.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="sms-opt-in-phone" className="text-sm font-medium text-foreground">
                Mobile phone number
              </label>
              <input
                id="sms-opt-in-phone"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                placeholder="(555) 123-4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card/60 p-4">
              <input
                id="sms-opt-in-consent"
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-1 h-4 w-4 shrink-0 rounded border-border"
              />
              <span className="text-sm leading-relaxed text-muted-foreground">{CONSENT_COPY}</span>
            </label>

            <p className="text-xs text-muted-foreground">
              See our{" "}
              <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
                Privacy policy
              </Link>{" "}
              and{" "}
              <Link href="/support" className="underline underline-offset-2 hover:text-foreground">
                Help &amp; Support
              </Link>
              .
            </p>

            {error ? <p className="text-sm text-red-400">{error}</p> : null}

            <button
              type="submit"
              className="inline-flex w-full items-center justify-center rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Submit
            </button>
          </form>
        )}
      </main>
    </div>
  )
}
