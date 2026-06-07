"use client"

// Step-by-step A2P 10DLC carrier compliance form (Settings → ?tab=sms-registration).

import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { WorkspacePanel, workspaceFieldClass } from "@/components/dashboard-workspace-ui"
import { SmsRegistrationStatusView } from "@/components/dashboard/sms-registration-status-view"
import { readActiveOrganizationId } from "@/lib/workspace-organizations"
import { notifyCarrierRegistrationUpdated } from "@/lib/settings-modals-events"
import { SMS_ENTITY_TYPE_OPTIONS } from "@/lib/sms-registration-constants"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import type { SmsRegistrationSubmissionSummary } from "@/lib/sms-registration-submission-summary"
import type { SmsRegistration } from "@/lib/types"

const DEFAULT_USE_CASE =
  "Sending automated service notifications and technician dispatch links to customers who opt in via our platform."

type Props = {
  onSubmitted?: () => void
  /** When `modal`, hide page chrome and call onSubmitted after successful submit. */
  variant?: "page" | "modal"
}

export function SmsRegistrationForm({ onSubmitted, variant = "page" }: Props) {
  const { toast } = useToast()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [existing, setExisting] = useState<SmsRegistration | null>(null)
  const [pending, setPending] = useState(false)
  const [submissionSummary, setSubmissionSummary] = useState<SmsRegistrationSubmissionSummary | null>(null)
  const [forceForm, setForceForm] = useState(false)

  const [legalName, setLegalName] = useState("")
  const [entityType, setEntityType] = useState("")
  const [taxId, setTaxId] = useState("")
  const [street, setStreet] = useState("")
  const [city, setCity] = useState("")
  const [stateCode, setStateCode] = useState("")
  const [postal, setPostal] = useState("")
  const [useCase, setUseCase] = useState(DEFAULT_USE_CASE)

  const load = useCallback(async () => {
    const orgId = readActiveOrganizationId()
    const qs = orgId ? `?organization_id=${encodeURIComponent(orgId)}` : ""
    const res = await fetch(`/api/settings/10dlc${qs}`, { credentials: "include" })
    const json = (await res.json().catch(() => ({}))) as {
      data?: {
        registration?: SmsRegistration | null
        pending_approval?: boolean
        organization_status?: string
        submission_summary?: SmsRegistrationSubmissionSummary | null
      }
    }
    const reg = json.data?.registration ?? null
    setExisting(reg)
    setSubmissionSummary(json.data?.submission_summary ?? null)
    const isPending =
      json.data?.pending_approval === true ||
      json.data?.organization_status === "PENDING_APPROVAL" ||
      reg?.status === "PENDING_APPROVAL"
    setPending(isPending)
    if (reg) {
      setLegalName(reg.legal_business_name)
      setEntityType(reg.entity_type)
      setTaxId(reg.tax_id_ein ?? "")
      setStreet(reg.street)
      setCity(reg.city)
      setStateCode(reg.state)
      setPostal(reg.postal_code)
      setUseCase(reg.use_case_description || DEFAULT_USE_CASE)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const onOrgChanged = () => {
      if (variant === "page") setLoading(true)
      setForceForm(false)
      void load()
    }
    window.addEventListener("lyncr-organization-changed", onOrgChanged)
    return () => window.removeEventListener("lyncr-organization-changed", onOrgChanged)
  }, [load, variant])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy || pending) return
    setBusy(true)
    try {
      const res = await fetch("/api/settings/10dlc", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization_id: readActiveOrganizationId(),
          legal_business_name: legalName,
          entity_type: entityType,
          tax_id_ein: taxId,
          street,
          city,
          state: stateCode,
          postal_code: postal,
          use_case_description: useCase,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || "Could not submit registration")
      setPending(true)
      if (json.data?.registration) setExisting(json.data.registration as SmsRegistration)
      toast({
        title: "Registration submitted",
        description: "Carriers are reviewing your business profile. SMS alerts unlock after approval.",
      })
      notifyCarrierRegistrationUpdated()
      onSubmitted?.()
    } catch (err) {
      toast({
        title: "Submission failed",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      })
    } finally {
      setBusy(false)
    }
  }

  if (loading && variant === "page") {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading registration…
      </div>
    )
  }

  const identityFields = (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block space-y-1.5 sm:col-span-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Legal business name</span>
        <input
          required
          value={legalName}
          onChange={(e) => setLegalName(e.target.value)}
          placeholder="Key Squad Locksmith LLC"
          className={workspaceFieldClass}
        />
      </label>
      <label className="block space-y-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Business entity type</span>
        <select
          required
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          className={cn(workspaceFieldClass, "appearance-none")}
        >
          <option value="">Select type…</option>
          {SMS_ENTITY_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Tax ID / EIN</span>
        <input
          value={taxId}
          onChange={(e) => setTaxId(e.target.value)}
          inputMode="numeric"
          placeholder="12-3456789"
          className={workspaceFieldClass}
        />
        <span className="text-[10px] text-zinc-500">Required for LLC, Corp, and Partnership</span>
      </label>
    </div>
  )

  const addressFields = (
    <div className="space-y-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Business address</p>
      <label className="block space-y-1.5">
        <span className="text-xs text-zinc-400">Street</span>
        <input required value={street} onChange={(e) => setStreet(e.target.value)} className={workspaceFieldClass} />
      </label>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block space-y-1.5 sm:col-span-1">
          <span className="text-xs text-zinc-400">City</span>
          <input required value={city} onChange={(e) => setCity(e.target.value)} className={workspaceFieldClass} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs text-zinc-400">State</span>
          <input
            required
            maxLength={2}
            value={stateCode}
            onChange={(e) => setStateCode(e.target.value.toUpperCase())}
            placeholder="KY"
            className={workspaceFieldClass}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs text-zinc-400">ZIP</span>
          <input
            required
            value={postal}
            onChange={(e) => setPostal(e.target.value)}
            placeholder="40202"
            className={workspaceFieldClass}
          />
        </label>
      </div>
    </div>
  )

  const useCaseField = (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Brief use case description</span>
      <textarea
        required
        rows={4}
        value={useCase}
        onChange={(e) => setUseCase(e.target.value)}
        className={cn(workspaceFieldClass, "min-h-[6rem] resize-y")}
      />
    </label>
  )

  const showStatusView =
    !forceForm &&
    submissionSummary != null &&
    (pending ||
      submissionSummary.lifecycle_stage === "carrier_review" ||
      submissionSummary.lifecycle_stage === "rejected" ||
      submissionSummary.lifecycle_stage === "approved")

  if (showStatusView && submissionSummary) {
    const statusBody = (
      <SmsRegistrationStatusView
        summary={submissionSummary}
        variant={variant}
        onRefresh={() => void load()}
        onEdit={submissionSummary.lifecycle_stage === "rejected" ? () => setForceForm(true) : undefined}
      />
    )
    if (variant === "modal") return statusBody
    return (
      <WorkspacePanel className="space-y-4 p-6 sm:p-8">
        {statusBody}
        <Link
          href="/dashboard/settings"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to settings
        </Link>
      </WorkspacePanel>
    )
  }

  if (pending && !submissionSummary) {
    const pendingBody = (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading submission details…
      </div>
    )
    if (variant === "modal") return pendingBody
    return (
      <WorkspacePanel className="space-y-4 p-6 sm:p-8">
        {pendingBody}
        <Link
          href="/dashboard/settings"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to settings
        </Link>
      </WorkspacePanel>
    )
  }

  return (
    <form onSubmit={submit} className={variant === "modal" ? "space-y-5" : "space-y-6"}>
      {loading && variant === "modal" ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          Syncing saved details for this workspace…
        </p>
      ) : null}
      {variant === "page" ? (
        <ol className="grid gap-2 sm:grid-cols-3">
          {["Business identity", "Service address", "Campaign use case"].map((step, i) => (
            <li
              key={step}
              className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-xs font-medium text-zinc-400"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-500/15 text-[11px] font-bold text-violet-300">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      ) : null}

      <div className={variant === "modal" ? "space-y-5" : ""}>
        {variant === "page" ? (
          <WorkspacePanel className="space-y-5 p-6 sm:p-8">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-violet-400" aria-hidden />
              <div>
                <h2 className="text-base font-semibold text-foreground">A2P 10DLC carrier registration</h2>
                <p className="text-xs text-muted-foreground">
                  US carriers require this one-time business profile before lead-alert texts can deliver.
                </p>
              </div>
            </div>
            {identityFields}
          </WorkspacePanel>
        ) : (
          <>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Business identity</p>
            {identityFields}
          </>
        )}

        {variant === "page" ? (
          <WorkspacePanel className="space-y-4 p-6 sm:p-8">{addressFields}</WorkspacePanel>
        ) : (
          addressFields
        )}

        {variant === "page" ? (
          <WorkspacePanel className="space-y-4 p-6 sm:p-8">{useCaseField}</WorkspacePanel>
        ) : (
          useCaseField
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className={cn(
            "inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-900/30 hover:bg-violet-500 disabled:opacity-50 sm:w-auto sm:px-5"
          )}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Submit Campaign Registration
        </button>
        {variant === "page" ? (
          <button
            type="button"
            onClick={() => router.push("/dashboard/settings")}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        ) : null}
      </div>
      {existing ? (
        <p className="text-[11px] text-zinc-500">Last saved draft loaded — submit to send for carrier review.</p>
      ) : null}
    </form>
  )
}
