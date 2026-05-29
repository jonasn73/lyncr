"use client"

// Self-contained settings card: lets a business register its own 10DLC SMS brand +
// campaign (so lead-alert texts deliver on US carriers) without ever touching Telnyx.

import { useCallback, useEffect, useState } from "react"
import { CheckCircle2, Clock, Loader2, MessageSquareWarning, ShieldCheck, XCircle } from "lucide-react"
import { WorkspacePanel, workspaceFieldClass } from "@/components/dashboard-workspace-ui"
import { useToast } from "@/hooks/use-toast"

type UseCaseOption = {
  key: string
  label: string
  description: string
  requiresEin: boolean
  fee_label: string
}

type Registration = {
  status: string
  status_detail: string | null
  use_case: string | null
  display_name: string | null
  brand_id: string | null
  campaign_id: string | null
  assigned_number: string | null
  fee_paid: boolean
}

type View = {
  registration: Registration | null
  use_cases: UseCaseOption[]
  verticals: { value: string; label: string }[]
  sms_ready: boolean
}

const PENDING_STATUSES = ["paid", "submitted", "pending_review"]

export function Messaging10DlcCard() {
  const { toast } = useToast()
  const [view, setView] = useState<View | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  // Form state
  const [useCase, setUseCase] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [legalName, setLegalName] = useState("")
  const [ein, setEin] = useState("")
  const [vertical, setVertical] = useState("")
  const [website, setWebsite] = useState("")
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [street, setStreet] = useState("")
  const [city, setCity] = useState("")
  const [stateCode, setStateCode] = useState("")
  const [postal, setPostal] = useState("")
  const [acknowledged, setAcknowledged] = useState(false)

  const selectedUseCase = view?.use_cases.find((u) => u.key === useCase) ?? null

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/messaging/10dlc", { credentials: "include" })
      const json = (await res.json().catch(() => ({}))) as { data?: View; error?: string }
      if (json.data) {
        setView(json.data)
        if (json.data.registration?.use_case) setUseCase(json.data.registration.use_case)
        if (json.data.registration?.display_name) setDisplayName(json.data.registration.display_name)
      }
    } catch {
      // non-fatal
    } finally {
      setLoading(false)
    }
  }, [])

  const refresh = useCallback(
    async (sessionId?: string) => {
      setBusy(true)
      try {
        const res = await fetch("/api/messaging/10dlc/refresh", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sessionId ? { session_id: sessionId } : {}),
        })
        const json = (await res.json().catch(() => ({}))) as { data?: View; error?: string }
        if (json.data) setView(json.data)
        if (json.error) toast({ title: "Could not refresh", description: json.error, variant: "destructive" })
      } catch (e) {
        toast({ title: "Refresh failed", description: e instanceof Error ? e.message : "Try again", variant: "destructive" })
      } finally {
        setBusy(false)
      }
    },
    [toast]
  )

  useEffect(() => {
    void load()
  }, [load])

  // Handle return from Stripe checkout.
  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    if (params.get("tendlc_checkout") === "success") {
      const sessionId = params.get("session_id") ?? undefined
      toast({ title: "Payment received", description: "Submitting your registration to carriers…" })
      void refresh(sessionId)
      params.delete("tendlc_checkout")
      params.delete("session_id")
      const qs = params.toString()
      window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`)
    } else if (params.get("tendlc_checkout") === "cancelled") {
      toast({ title: "Checkout cancelled", variant: "destructive" })
    }
  }, [refresh, toast])

  async function handleSubmit() {
    if (!useCase) {
      toast({ title: "Pick a registration type", variant: "destructive" })
      return
    }
    if (!acknowledged) {
      toast({ title: "Please acknowledge the one-time fee", variant: "destructive" })
      return
    }
    setBusy(true)
    try {
      const res = await fetch("/api/messaging/10dlc/register", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          use_case: useCase,
          display_name: displayName,
          legal_company_name: legalName,
          ein,
          vertical,
          website,
          contact_first_name: firstName,
          contact_last_name: lastName,
          email,
          phone,
          street,
          city,
          state: stateCode,
          postal_code: postal,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        data?: { checkout_url: string }
        error?: string
      }
      if (!res.ok || !json.data?.checkout_url) {
        toast({ title: "Could not start registration", description: json.error || "Try again", variant: "destructive" })
        return
      }
      window.location.href = json.data.checkout_url
    } catch (e) {
      toast({ title: "Registration failed", description: e instanceof Error ? e.message : "Try again", variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <WorkspacePanel className="p-6 sm:p-8">
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading SMS registration…
        </div>
      </WorkspacePanel>
    )
  }

  const reg = view?.registration ?? null
  const status = reg?.status ?? "draft"
  const showForm = !reg || status === "draft" || status === "pending_payment" || status === "rejected" || status === "failed"
  const isPending = PENDING_STATUSES.includes(status)
  const isApproved = status === "approved"

  return (
    <WorkspacePanel className="p-6 sm:p-8">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10">
          <ShieldCheck className="h-5 w-5 text-emerald-300" aria-hidden />
        </div>
        <div className="min-w-0 flex-1 space-y-5">
          <div>
            <p className="text-sm font-semibold text-foreground">SMS lead-alert registration (10DLC)</p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              US carriers require every business to register before sending text alerts. Complete this once and
              your lead-alert texts will start delivering. Calls are unaffected.
            </p>
          </div>

          {/* Status banner */}
          {isApproved ? (
            <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-300" aria-hidden />
              <div>
                <p className="text-sm font-medium text-emerald-100">Approved — SMS lead alerts are live</p>
                <p className="text-xs text-emerald-100/80">
                  {reg?.assigned_number
                    ? `Sending from ${reg.assigned_number}.`
                    : reg?.status_detail || "Your campaign is approved."}
                </p>
              </div>
            </div>
          ) : null}

          {isPending ? (
            <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
              <Clock className="mt-0.5 h-5 w-5 text-amber-300" aria-hidden />
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-100">Under carrier review</p>
                <p className="text-xs text-amber-100/80">
                  {reg?.status_detail || "Submitted to The Campaign Registry. Review typically takes 5–10 business days."}
                </p>
                <button
                  type="button"
                  onClick={() => void refresh()}
                  disabled={busy}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-500/10 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                  Check status
                </button>
              </div>
            </div>
          ) : null}

          {status === "rejected" || status === "failed" ? (
            <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
              <XCircle className="mt-0.5 h-5 w-5 text-red-300" aria-hidden />
              <div>
                <p className="text-sm font-medium text-red-100">
                  {status === "rejected" ? "Registration was rejected" : "Submission failed"}
                </p>
                <p className="text-xs text-red-100/80">{reg?.status_detail || "Review your details and try again."}</p>
              </div>
            </div>
          ) : null}

          {/* Registration form */}
          {showForm ? (
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Registration type
                </label>
                <div className="grid gap-2">
                  {view?.use_cases.map((u) => (
                    <button
                      key={u.key}
                      type="button"
                      onClick={() => setUseCase(u.key)}
                      className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                        useCase === u.key
                          ? "border-primary bg-primary/10"
                          : "border-border/70 bg-muted/20 hover:border-primary/40"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-foreground">{u.label}</span>
                        <span className="text-xs font-semibold text-primary">{u.fee_label} one-time</span>
                      </div>
                      <p className="mt-1 text-xs text-zinc-500">{u.description}</p>
                    </button>
                  ))}
                </div>
              </div>

              <Field label="Business display name (DBA)">
                <input className={workspaceFieldClass} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Acme Locksmith" />
              </Field>

              {selectedUseCase?.requiresEin ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Legal company name">
                    <input className={workspaceFieldClass} value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Acme Locksmith LLC" />
                  </Field>
                  <Field label="EIN / Tax ID (9 digits)">
                    <input className={workspaceFieldClass} value={ein} onChange={(e) => setEin(e.target.value)} placeholder="12-3456789" inputMode="numeric" />
                  </Field>
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Business vertical">
                  <select className={workspaceFieldClass} value={vertical} onChange={(e) => setVertical(e.target.value)}>
                    <option value="">Choose…</option>
                    {view?.verticals.map((v) => (
                      <option key={v.value} value={v.value}>{v.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Website (optional)">
                  <input className={workspaceFieldClass} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Contact first name">
                  <input className={workspaceFieldClass} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </Field>
                <Field label="Contact last name">
                  <input className={workspaceFieldClass} value={lastName} onChange={(e) => setLastName(e.target.value)} />
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Contact email">
                  <input className={workspaceFieldClass} value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="owner@business.com" />
                </Field>
                <Field label="Business phone (optional)">
                  <input className={workspaceFieldClass} value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" placeholder="(555) 123-4567" />
                </Field>
              </div>

              <Field label="Street address">
                <input className={workspaceFieldClass} value={street} onChange={(e) => setStreet(e.target.value)} placeholder="123 Main St" />
              </Field>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="City">
                  <input className={workspaceFieldClass} value={city} onChange={(e) => setCity(e.target.value)} />
                </Field>
                <Field label="State (2-letter)">
                  <input className={workspaceFieldClass} value={stateCode} onChange={(e) => setStateCode(e.target.value)} maxLength={2} placeholder="CA" />
                </Field>
                <Field label="ZIP">
                  <input className={workspaceFieldClass} value={postal} onChange={(e) => setPostal(e.target.value)} inputMode="numeric" />
                </Field>
              </div>

              <label className="flex items-start gap-2.5 rounded-xl border border-border/70 bg-muted/20 px-4 py-3">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="text-xs leading-relaxed text-zinc-400">
                  I understand a <strong className="text-zinc-200">one-time, non-refundable carrier fee
                  {selectedUseCase ? ` of ${selectedUseCase.fee_label}` : ""}</strong> applies for registering my
                  business with The Campaign Registry, and that carrier review can take 5–10 business days.
                </span>
              </label>

              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={busy || !useCase || !acknowledged}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {selectedUseCase ? `Pay ${selectedUseCase.fee_label} & register` : "Pay & register"}
              </button>

              {!view?.use_cases.length ? (
                <p className="flex items-center gap-1.5 text-xs text-amber-300">
                  <MessageSquareWarning className="h-3.5 w-3.5" aria-hidden />
                  Run scripts/047-messaging-10dlc.sql in Neon to enable registration storage.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </WorkspacePanel>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</span>
      {children}
    </label>
  )
}
