"use client"

// Step-by-step A2P 10DLC carrier compliance form (Settings → ?tab=sms-registration).

import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { WorkspacePanel, workspaceFieldClass } from "@/components/dashboard-workspace-ui"
import { SmsRegistrationStatusView } from "@/components/dashboard/sms-registration-status-view"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { readActiveOrganizationId } from "@/lib/workspace-organizations"
import { notifyCarrierRegistrationUpdated } from "@/lib/settings-modals-events"
import {
  requiresSmsRegistrationEin,
  SMS_ENTITY_TYPE_OPTIONS,
  validateSmsRegistrationInput,
} from "@/lib/sms-registration-constants"
import { resolveSmsNoticeState } from "@/lib/sms-registration-notice"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import type { SmsRegistrationSubmissionSummary } from "@/lib/sms-registration-submission-summary-types"
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
  const { activeOrganizationId } = useDashboardWorkspace()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [existing, setExisting] = useState<SmsRegistration | null>(null)
  const [pending, setPending] = useState(false)
  const [submissionSummary, setSubmissionSummary] = useState<SmsRegistrationSubmissionSummary | null>(null)
  const [forceForm, setForceForm] = useState(false)

  const [legalName, setLegalName] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [website, setWebsite] = useState("")
  const [entityType, setEntityType] = useState("")
  const [taxId, setTaxId] = useState("")
  const [street, setStreet] = useState("")
  const [city, setCity] = useState("")
  const [stateCode, setStateCode] = useState("")
  const [postal, setPostal] = useState("")
  const [useCase, setUseCase] = useState(DEFAULT_USE_CASE)

  /** Prefer React workspace context; fall back to localStorage for legacy callers. */
  const resolveOrganizationId = useCallback((): string | null => {
    return activeOrganizationId ?? readActiveOrganizationId()
  }, [activeOrganizationId])

  const load = useCallback(async () => {
    const orgId = resolveOrganizationId()
    const qs = orgId ? `?organization_id=${encodeURIComponent(orgId)}` : ""
    const res = await fetch(`/api/settings/10dlc${qs}`, { credentials: "include" })
    const json = (await res.json().catch(() => ({}))) as {
      data?: {
        registration?: SmsRegistration | null
        pending_approval?: boolean
        organization_status?: string
        sms_ready?: boolean
        legacy_registration?: { status?: string; status_detail?: string | null } | null
        submission_summary?: SmsRegistrationSubmissionSummary | null
      }
    }
    const data = json.data
    const reg = data?.registration ?? null
    setExisting(reg)
    setSubmissionSummary(data?.submission_summary ?? null)
    const noticeState = resolveSmsNoticeState({
      sms_ready: data?.sms_ready,
      pending_approval: data?.pending_approval,
      organization_status: data?.organization_status,
      registration: reg,
      legacy_registration: data?.legacy_registration,
      submission_summary: data?.submission_summary,
    })
    setPending(noticeState === "pending")
    if (reg) {
      setLegalName(reg.legal_business_name)
      setDisplayName(reg.legal_business_name)
      setEntityType(reg.entity_type)
      setTaxId(reg.tax_id_ein ?? "")
      setStreet(reg.street)
      setCity(reg.city)
      setStateCode(reg.state)
      setPostal(reg.postal_code)
      setUseCase(reg.use_case_description || DEFAULT_USE_CASE)
    }
    const legacy = data?.legacy_registration as
      | { website?: string | null; display_name?: string | null; legal_company_name?: string | null }
      | null
      | undefined
    if (legacy?.website?.trim()) setWebsite(legacy.website.trim())
    if (legacy?.display_name?.trim()) setDisplayName(legacy.display_name.trim())
    else if (legacy?.legal_company_name?.trim() && !reg) setDisplayName(legacy.legal_company_name.trim())
    setLoading(false)
  }, [resolveOrganizationId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const onOrgChanged = () => {
      if (variant === "page") setLoading(true)
      setForceForm(false)
      setSubmitError(null)
      void load()
    }
    window.addEventListener("lyncr-organization-changed", onOrgChanged)
    return () => window.removeEventListener("lyncr-organization-changed", onOrgChanged)
  }, [load, variant])

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    if (busy) return
    if (pending) {
      const msg = "This workspace is already pending carrier review."
      setSubmitError(msg)
      toast({ title: "Already submitted", description: msg, variant: "destructive" })
      return
    }

    const payload = {
      organization_id: resolveOrganizationId(),
      legal_business_name: legalName,
      display_name: displayName || legalName,
      website,
      entity_type: entityType,
      tax_id_ein: taxId,
      street,
      city,
      state: stateCode,
      postal_code: postal,
      use_case_description: useCase,
    }
    const validationError = validateSmsRegistrationInput(payload)
    if (validationError) {
      setSubmitError(validationError)
      toast({ title: "Check the form", description: validationError, variant: "destructive" })
      return
    }

    setSubmitError(null)
    setBusy(true)
    try {
      const res = await fetch("/api/settings/10dlc", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        data?: {
          registration?: SmsRegistration
          submission_summary?: SmsRegistrationSubmissionSummary | null
          telnyx_brand_id?: string | null
          telnyx_campaign_id?: string | null
        }
      }
      if (!res.ok) throw new Error(json.error || "Could not submit registration")
      setPending(true)
      if (json.data?.registration) setExisting(json.data.registration)
      if (json.data?.submission_summary) setSubmissionSummary(json.data.submission_summary)
      const brandId = json.data?.telnyx_brand_id?.trim()
      const campaignId = json.data?.telnyx_campaign_id?.trim()
      const carrierRef = campaignId ? `Campaign ${campaignId}` : brandId ? `Brand ${brandId}` : null
      toast({
        title: "Registration submitted",
        description: carrierRef
          ? `Sent to Telnyx (${carrierRef}). Carriers usually review in 1–3 business days.`
          : "Carriers are reviewing your business profile. SMS alerts unlock after approval.",
      })
      notifyCarrierRegistrationUpdated()
      await load()
      if (variant === "modal") {
        try {
          await fetch("/api/messaging/10dlc/refresh", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ organization_id: resolveOrganizationId() ?? undefined }),
          })
          await load()
        } catch {
          /* load() already ran */
        }
      }
      onSubmitted?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : "Try again"
      setSubmitError(message)
      toast({
        title: "Submission failed",
        description: message,
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
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          Legal business name (IRS / EIN letter)
        </span>
        <input
          required
          value={legalName}
          onChange={(e) => setLegalName(e.target.value)}
          placeholder="Key Squad Locksmith LLC"
          className={workspaceFieldClass}
        />
        <span className="text-[10px] text-zinc-500">
          Must match the exact legal name on your EIN paperwork — not a nickname or software company.
        </span>
      </label>
      <label className="block space-y-1.5 sm:col-span-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          Customer-facing brand name (optional)
        </span>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Key Squad 502"
          className={workspaceFieldClass}
        />
      </label>
      <label className="block space-y-1.5 sm:col-span-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          Business website
        </span>
        <input
          required
          type="url"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          placeholder="https://yourbusiness.com"
          className={workspaceFieldClass}
        />
        <span className="text-[10px] text-zinc-500">
          Required. Use your brand site — carriers reject lyncr.app / agency URLs (error 710).
        </span>
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
          required={requiresSmsRegistrationEin(entityType)}
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
    <div className="space-y-3">
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
      {requiresSmsRegistrationEin(entityType) ? (
        <p className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          <span className="font-semibold text-violet-200/90">Carrier sub-usecase (added automatically):</span>{" "}
          Registered businesses like yours are sent to carriers as{" "}
          <span className="text-foreground">Low volume</span> with sub-usecase{" "}
          <span className="text-foreground">Account notifications</span> (lead alerts and appointment texts). You do
          not pick this — lyncr includes it when you click Submit.
        </p>
      ) : null}
    </div>
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
    <form onSubmit={(e) => void handleSubmit(e)} noValidate className={variant === "modal" ? "space-y-5" : "space-y-6"}>
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

      {submitError ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300" role="alert">
          {submitError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || loading}
          onClick={() => void handleSubmit()}
          className={cn(
            "inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-900/30 hover:bg-violet-500 disabled:opacity-50 sm:w-auto sm:px-5"
          )}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {busy ? "Submitting…" : "Submit Campaign Registration"}
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
      {existing && !pending ? (
        <p className="text-[11px] text-zinc-500">Last saved draft loaded — submit to send for carrier review.</p>
      ) : null}
    </form>
  )
}
