"use client"

// Client state for the answered-call intake sheet (CRM + vehicle + job dispatch).

import { useCallback, useEffect, useMemo, useState } from "react"
import type { Customer } from "@/lib/types"
import {
  isCompleteStructuredAddress,
  type StructuredAddress,
} from "@/lib/structured-address"
import {
  buildFlatAddressQuery,
  isIntakeAddressReady,
  listIntakeDispatchBlockers,
  parseLooseAddressQuery,
  resolveStructuredAddressFromQuery,
} from "@/lib/intake-address-helpers"
import type { VehicleClarificationOption } from "@/lib/vehicle-intake-clarifications"
import {
  calculateServiceQuote,
  type ServiceQuoteTypeId,
} from "@/lib/service-quote-calculator"
import type { ServiceRateCard } from "@/lib/service-rate-card"
import { formatIntakeJobTypeForDispatch } from "@/lib/intake-job-types"
import { notifyWorkspaceDataChanged } from "@/lib/workspace-organizations"
import { travelDistanceMiles } from "@/lib/geo"
import { useDispatcherLocation } from "@/lib/hooks/use-dispatcher-location"

/** Manual-only call lifecycle shown in the intake sheet header. */
export type ManualCallStatus = "ringing" | "answered" | "on_hold" | "completed"

export type ActiveCallRow = {
  id: string
  from_number: string
  to_number: string
  caller_name: string | null
  answered_at: string | null
  /** Telnyx recording URL when the carrier callback has landed in call_logs. */
  recording_url?: string | null
  /** True when opened via openManualCallPanel (not a Telnyx webhook row). */
  isManual?: boolean
  manualCallStatus?: ManualCallStatus
  /** Optional vehicle seed for manual calls. */
  vehicleYear?: string
  vehicleMake?: string
  vehicleModel?: string
}

export type ActiveCallFormState = {
  phoneNumber: string
  displayName: string
  /** Map-ready address from autocomplete (geocoded when picked). */
  serviceAddress: StructuredAddress | null
  addressLine1: string
  addressLine2: string
  city: string
  region: string
  postalCode: string
  country: string
  notes: string
  jobType: string
  /** Origination or Duplication when jobType is Key replacement. */
  keyReplacementMode: string
  vehicleYear: string
  vehicleMake: string
  vehicleModel: string
  keyFccId: string
  keyFrequency: string
  keyChipset: string
  keyStyle: string
  /** Which photo variant the user tapped in the key panel. */
  keyVariantId: string
  /** Row id from the FCC reference CSV for the selected profile. */
  keyProfileId: string
  /** Intake clarification prompts already answered for this vehicle. */
  vehicleClarificationAnswers: string[]
  /** Service quote calculator selection id (see lib/service-quote-calculator). */
  serviceQuoteTypeId: string
  /** Last computed quote total in cents (stored on booked jobs + lost leads). */
  quotedPriceCents: number
  /** When true, auto-quote changes do not overwrite quotedPriceCents. */
  quotedPriceOverridden: boolean
}

const EMPTY_FORM: ActiveCallFormState = {
  phoneNumber: "",
  displayName: "",
  serviceAddress: null,
  addressLine1: "",
  addressLine2: "",
  city: "",
  region: "",
  postalCode: "",
  country: "US",
  notes: "",
  jobType: "",
  keyReplacementMode: "",
  vehicleYear: "",
  vehicleMake: "",
  vehicleModel: "",
  keyFccId: "",
  keyFrequency: "",
  keyChipset: "",
  keyStyle: "",
  keyVariantId: "",
  keyProfileId: "",
  vehicleClarificationAnswers: [],
  serviceQuoteTypeId: "lockout",
  quotedPriceCents: 0,
  quotedPriceOverridden: false,
}

function flatAddressFromStructured(addr: StructuredAddress): Pick<
  ActiveCallFormState,
  "addressLine1" | "addressLine2" | "city" | "region" | "postalCode" | "country"
> {
  return {
    addressLine1: [addr.street_number, addr.route].filter(Boolean).join(" ").trim(),
    addressLine2: "",
    city: addr.locality,
    region: addr.admin_area,
    postalCode: addr.postal_code,
    country: "US",
  }
}

function formFromCustomer(c: Customer, prev: ActiveCallFormState): ActiveCallFormState {
  return {
    ...prev,
    displayName: c.display_name || prev.displayName,
    addressLine1: c.address_line1 || "",
    addressLine2: c.address_line2 || "",
    city: c.city || "",
    region: c.region || "",
    postalCode: c.postal_code || "",
    country: c.country || "US",
    notes: c.notes || "",
    serviceAddress: null,
  }
}

export function useActiveCallForm(
  current: ActiveCallRow | null,
  options?: {
    /** Replace synthetic manual-{uuid} row id with real call_logs.id after POST /api/calls/manual. */
    linkManualCallLog?: (patch: Partial<ActiveCallRow>) => void
  }
) {
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [jobState, setJobState] = useState<"idle" | "creating" | "created" | "error">("idle")
  const [jobError, setJobError] = useState<string | null>(null)
  const [form, setForm] = useState<ActiveCallFormState>(EMPTY_FORM)
  const [rateCard, setRateCard] = useState<ServiceRateCard | null>(null)
  const [rateCardSource, setRateCardSource] = useState<"onboarding_profiles.service_rules" | "default">("default")
  const callLogId = current?.id ?? null
  const dispatcherLocation = useDispatcherLocation(Boolean(callLogId))

  const travelDistanceMilesValue = useMemo(() => {
    const jobLat = form.serviceAddress?.lat
    const jobLng = form.serviceAddress?.lng
    if (jobLat == null || jobLng == null) return null
    if (dispatcherLocation.lat == null || dispatcherLocation.lng == null) return null
    return travelDistanceMiles(
      { lat: dispatcherLocation.lat, lng: dispatcherLocation.lng },
      { lat: jobLat, lng: jobLng }
    )
  }, [form.serviceAddress?.lat, form.serviceAddress?.lng, dispatcherLocation.lat, dispatcherLocation.lng])

  const patchForm = useCallback((patch: Partial<ActiveCallFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }))
  }, [])

  const setVehicle = useCallback((vehicle: { vehicle_year: string; vehicle_make: string; vehicle_model: string }) => {
    setForm((prev) => ({
      ...prev,
      vehicleYear: vehicle.vehicle_year,
      vehicleMake: vehicle.vehicle_make,
      vehicleModel: vehicle.vehicle_model,
      keyFccId: "",
      keyFrequency: "",
      keyChipset: "",
      keyStyle: "",
      keyVariantId: "",
      keyProfileId: "",
      vehicleClarificationAnswers: [],
    }))
  }, [])

  const applyVehicleClarification = useCallback((promptId: string, option: VehicleClarificationOption) => {
    setForm((prev) => {
      const nextAnswers = prev.vehicleClarificationAnswers.includes(promptId)
        ? prev.vehicleClarificationAnswers
        : [...prev.vehicleClarificationAnswers, promptId]
      const noteLine = option.note?.trim()
      const notes =
        noteLine && !prev.notes.includes(noteLine)
          ? prev.notes.trim()
            ? `${prev.notes.trim()} · ${noteLine}`
            : noteLine
          : prev.notes
      return {
        ...prev,
        vehicleClarificationAnswers: nextAnswers,
        vehicleMake: option.make?.trim() || prev.vehicleMake,
        vehicleModel: option.model?.trim() || prev.vehicleModel,
        notes,
        ...(option.model || option.make
          ? {
              keyFccId: "",
              keyFrequency: "",
              keyChipset: "",
              keyStyle: "",
              keyVariantId: "",
              keyProfileId: "",
            }
          : {}),
      }
    })
  }, [])

  const setVehicleKeySelection = useCallback(
    (
      sel: {
        profileId: string
        fccId: string
        frequency: string | null
        chipset: string | null
        keyStyle: string
        variantId?: string | null
      } | null
    ) => {
      setForm((prev) => ({
        ...prev,
        keyProfileId: sel?.profileId ?? "",
        keyFccId: sel?.fccId ?? "",
        keyFrequency: sel?.frequency ?? "",
        keyChipset: sel?.chipset ?? "",
        keyStyle: sel?.keyStyle ?? "",
        keyVariantId: sel?.variantId ?? "",
      }))
    },
    []
  )

  const setServiceAddress = useCallback((addr: StructuredAddress | null) => {
    setForm((prev) => ({
      ...prev,
      serviceAddress: addr,
      ...(addr ? flatAddressFromStructured(addr) : {}),
    }))
  }, [])

  const commitAddressQuery = useCallback((raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) return
    const parsed = parseLooseAddressQuery(trimmed)
    setForm((prev) => ({
      ...prev,
      addressLine1: parsed.addressLine1 || prev.addressLine1,
      city: parsed.city || prev.city,
      region: parsed.region || prev.region,
      postalCode: parsed.postalCode || prev.postalCode,
    }))
  }, [])

  useEffect(() => {
    if (!callLogId || !current) {
      setForm(EMPTY_FORM)
      setSaveState("idle")
      setJobState("idle")
      setJobError(null)
      return
    }

    setSaveState("idle")
    setJobState("idle")
    setJobError(null)
    setForm({
      ...EMPTY_FORM,
      phoneNumber: current.from_number,
      displayName: current.caller_name?.trim() || "",
      vehicleYear: current.vehicleYear?.trim() || "",
      vehicleMake: current.vehicleMake?.trim() || "",
      vehicleModel: current.vehicleModel?.trim() || "",
    })
  }, [
    callLogId,
    current?.from_number,
    current?.caller_name,
    current?.vehicleYear,
    current?.vehicleMake,
    current?.vehicleModel,
  ])

  // Load owner rate profile from onboarding_profiles.service_rules (JSON rate_card block).
  useEffect(() => {
    if (!callLogId) {
      setRateCard(null)
      setRateCardSource("default")
      return
    }
    let cancel = false
    void fetch("/api/service-quote/rate-card", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { data: null }))
      .then((data: { data?: { rate_card?: ServiceRateCard; source?: string } }) => {
        if (cancel) return
        if (data.data?.rate_card) {
          setRateCard(data.data.rate_card)
          setRateCardSource(
            data.data.source === "onboarding_profiles.service_rules"
              ? "onboarding_profiles.service_rules"
              : "default"
          )
        }
      })
      .catch(() => {})
    return () => {
      cancel = true
    }
  }, [callLogId])

  // Keep job type + quote total in sync with YMM + service quote selection.
  useEffect(() => {
    if (!callLogId) return
    const quote = calculateServiceQuote({
      serviceTypeId: (form.serviceQuoteTypeId || "lockout") as ServiceQuoteTypeId,
      vehicleYear: form.vehicleYear,
      vehicleMake: form.vehicleMake,
      vehicleModel: form.vehicleModel,
      rateCard,
      rateCardSource,
      distanceMiles: travelDistanceMilesValue,
      keyStyle: form.keyStyle,
      keyChipset: form.keyChipset,
      keyVariantId: form.keyVariantId,
    })
    setForm((prev) => {
      const nextJobType = quote.jobType
      const nextKeyMode = quote.keyReplacementMode
      const nextQuoted = quote.totalCents
      if (
        prev.jobType === nextJobType &&
        prev.keyReplacementMode === nextKeyMode &&
        (prev.quotedPriceOverridden || prev.quotedPriceCents === nextQuoted)
      ) {
        return prev
      }
      return {
        ...prev,
        jobType: nextJobType,
        keyReplacementMode: nextKeyMode,
        ...(prev.quotedPriceOverridden
          ? {}
          : {
              quotedPriceCents: nextQuoted,
            }),
      }
    })
  }, [
    callLogId,
    form.serviceQuoteTypeId,
    form.vehicleYear,
    form.vehicleMake,
    form.vehicleModel,
    form.keyStyle,
    form.keyChipset,
    form.keyVariantId,
    rateCard,
    rateCardSource,
    travelDistanceMilesValue,
  ])

  useEffect(() => {
    if (!callLogId) return
    const phone = form.phoneNumber.trim()
    if (phone.replace(/\D/g, "").length < 10) return

    let cancel = false
    const t = window.setTimeout(() => {
      const q = encodeURIComponent(phone)
      void fetch(`/api/customers?phone=${q}`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : { customers: [] }))
        .then((data: { customers?: Customer[] }) => {
          if (cancel) return
          const c = data.customers?.[0]
          if (!c) return
          setForm((prev) => formFromCustomer(c, prev))
        })
        .catch(() => {})
    }, 350)

    return () => {
      cancel = true
      window.clearTimeout(t)
    }
  }, [callLogId, form.phoneNumber])

  // When a repeat customer has a saved street/city/ZIP, verify it for the map pin automatically.
  useEffect(() => {
    if (!callLogId) return
    if (form.serviceAddress && isCompleteStructuredAddress(form.serviceAddress)) return

    const query = buildFlatAddressQuery({
      addressLine1: form.addressLine1,
      addressLine2: form.addressLine2,
      city: form.city,
      region: form.region,
      postalCode: form.postalCode,
    })
    if (!query) return

    let cancel = false
    const t = window.setTimeout(() => {
      void resolveStructuredAddressFromQuery(query).then((addr) => {
        if (cancel || !addr) return
        setForm((prev) => {
          if (prev.serviceAddress && isCompleteStructuredAddress(prev.serviceAddress)) return prev
          return {
            ...prev,
            serviceAddress: addr,
            ...flatAddressFromStructured(addr),
          }
        })
      })
    }, 400)

    return () => {
      cancel = true
      window.clearTimeout(t)
    }
  }, [
    callLogId,
    form.addressLine1,
    form.addressLine2,
    form.city,
    form.region,
    form.postalCode,
    form.serviceAddress,
  ])

  useEffect(() => {
    if (!callLogId || !current) return
    const phone = form.phoneNumber.trim()
    if (phone.replace(/\D/g, "").length < 10) return

    setSaveState("idle")
    const t = window.setTimeout(() => {
      setSaveState("saving")
      fetch("/api/customers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          phone_e164: phone,
          display_name: form.displayName,
          company_name: "",
          address_line1: form.addressLine1,
          address_line2: form.addressLine2,
          city: form.city,
          region: form.region,
          postal_code: form.postalCode,
          country: form.country,
          notes: form.notes,
          source_last_call_log_id:
            current.isManual && current.id.startsWith("manual-") ? null : current.id,
        }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error("save")
        })
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("error"))
    }, 1000)
    return () => window.clearTimeout(t)
  }, [callLogId, current, form])

  const createJob = useCallback(
    async (
      organizationId?: string | null,
      options?: { pendingCallback?: boolean; quotedPriceCents?: number }
    ): Promise<{ ok: true; leadId: string } | { ok: false }> => {
      if (!current) return { ok: false }
      const phone = form.phoneNumber.trim() || current.from_number
      const name = form.displayName.trim()
      if (!name) {
        setJobState("error")
        setJobError("Enter the caller name before sending to dispatch.")
        return { ok: false }
      }
      const pendingCallback = Boolean(options?.pendingCallback)
      const quotedPriceCents =
        options?.quotedPriceCents != null && options.quotedPriceCents > 0
          ? Math.round(options.quotedPriceCents)
          : form.quotedPriceCents > 0
            ? form.quotedPriceCents
            : 0
      if (!pendingCallback && !isIntakeAddressReady(form)) {
        setJobState("error")
        setJobError("Enter a service street address and city (pick a suggestion if you can).")
        return { ok: false }
      }
      if (pendingCallback && phone.replace(/\D/g, "").length < 10) {
        setJobState("error")
        setJobError("Enter a valid phone number before saving a pending callback lead.")
        return { ok: false }
      }

      setJobState("creating")
      setJobError(null)
      try {
        const dispatchJobType = formatIntakeJobTypeForDispatch(form.jobType, form.keyReplacementMode)
        let callLogIdForJob = current.id
        const addressLine1 = form.addressLine1.trim()
        const city = form.city.trim()

        // Manual walk-in rows start as manual-{uuid}; provision a real call_logs stub first.
        if (current.isManual && current.id.startsWith("manual-")) {
          const manualRes = await fetch("/api/calls/manual", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              phone_number: phone,
              caller_name: name,
              to_number: current.to_number?.trim() || null,
              metadata: {
                direction: "manual_intake",
                source: pendingCallback ? "pending_callback" : "walk_in",
                manual_call_status: current.manualCallStatus ?? "answered",
                organization_id: organizationId ?? null,
                vehicle_year: form.vehicleYear,
                vehicle_make: form.vehicleMake,
                vehicle_model: form.vehicleModel,
                job_type: dispatchJobType,
                quoted_price_cents: quotedPriceCents > 0 ? quotedPriceCents : null,
                service_address_line1: addressLine1 || null,
                city: city || null,
                region: form.region,
                postal_code: form.postalCode,
                notes: form.notes,
              },
            }),
          })
          const manualJson = (await manualRes.json()) as {
            data?: { call_log_id?: string }
            error?: string
          }
          if (!manualRes.ok) {
            throw new Error(manualJson.error ?? "Could not create manual call log.")
          }
          const provisionedId = String(manualJson.data?.call_log_id ?? "").trim()
          if (!provisionedId) throw new Error("Manual call log created but no id returned.")
          callLogIdForJob = provisionedId
          options?.linkManualCallLog?.({ id: provisionedId, isManual: true })
        }

        const res = await fetch("/api/jobs/create", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            call_log_id: callLogIdForJob,
            caller_e164: phone,
            customer_name: name,
            address_line1: form.addressLine1,
            address_line2: form.addressLine2,
            city: form.city,
            region: form.region,
            postal_code: form.postalCode,
            country: form.country,
            notes: form.notes,
            vehicle_year: form.vehicleYear,
            vehicle_make: form.vehicleMake,
            vehicle_model: form.vehicleModel,
            job_type: dispatchJobType || null,
            quoted_price_cents: quotedPriceCents > 0 ? quotedPriceCents : null,
            service_quote_type_id: form.serviceQuoteTypeId || "lockout",
            distance_miles: travelDistanceMilesValue,
            key_fcc_id: form.keyFccId || null,
            key_frequency: form.keyFrequency || null,
            key_chipset: form.keyChipset || null,
            key_style: form.keyStyle || null,
            key_variant_id: form.keyVariantId || null,
            customer_lat: form.serviceAddress?.lat ?? null,
            customer_lng: form.serviceAddress?.lng ?? null,
            organization_id: organizationId ?? null,
            pending_callback: pendingCallback,
          }),
        })
        const json = (await res.json()) as {
          data?: { lead_id?: string; customer_sms_sent?: boolean }
          error?: string
        }
        if (!res.ok) throw new Error(json.error ?? "Job create failed")
        const leadId = String(json.data?.lead_id ?? "").trim()
        if (!leadId) throw new Error("Job created but no lead id returned.")
        setJobState("created")
        notifyWorkspaceDataChanged({ reason: "job-created", organizationId: organizationId ?? null })
        return { ok: true, leadId }
      } catch (e) {
        setJobState("error")
        setJobError(e instanceof Error ? e.message : "Job create failed")
        return { ok: false }
      }
    },
    [current, form, options?.linkManualCallLog, travelDistanceMilesValue]
  )

  const addressReady = isIntakeAddressReady(form)
  const canDispatch = Boolean(form.displayName.trim() && addressReady)
  const canSavePendingLead = Boolean(
    form.displayName.trim() &&
      (form.phoneNumber.trim() || current?.from_number || "").replace(/\D/g, "").length >= 10
  )
  const dispatchBlockers = listIntakeDispatchBlockers(form)
  const addressSeedQuery =
    buildFlatAddressQuery({
      addressLine1: form.addressLine1,
      addressLine2: form.addressLine2,
      city: form.city,
      region: form.region,
      postalCode: form.postalCode,
    }) ?? ""

  const setServiceQuoteTypeId = useCallback((serviceQuoteTypeId: ServiceQuoteTypeId) => {
    setForm((prev) => ({ ...prev, serviceQuoteTypeId, quotedPriceOverridden: false }))
  }, [])

  const setQuotedPriceDollars = useCallback((dollars: number) => {
    const cents = Number.isFinite(dollars) && dollars >= 0 ? Math.round(dollars * 100) : 0
    setForm((prev) => ({ ...prev, quotedPriceCents: cents, quotedPriceOverridden: true }))
  }, [])

  const syncQuotedPriceToAuto = useCallback(() => {
    setForm((prev) => ({ ...prev, quotedPriceOverridden: false }))
  }, [])

  const liveQuote = calculateServiceQuote({
    serviceTypeId: (form.serviceQuoteTypeId || "lockout") as ServiceQuoteTypeId,
    vehicleYear: form.vehicleYear,
    vehicleMake: form.vehicleMake,
    vehicleModel: form.vehicleModel,
    rateCard,
    rateCardSource,
    distanceMiles: travelDistanceMilesValue,
    keyStyle: form.keyStyle,
    keyChipset: form.keyChipset,
    keyVariantId: form.keyVariantId,
  })

  return {
    form,
    patchForm,
    setServiceQuoteTypeId,
    setQuotedPriceDollars,
    syncQuotedPriceToAuto,
    liveQuote,
    rateCardSource,
    travelDistanceMiles: travelDistanceMilesValue,
    dispatcherLocation,
    setVehicle,
    applyVehicleClarification,
    setVehicleKeySelection,
    setServiceAddress,
    commitAddressQuery,
    saveState,
    jobState,
    jobError,
    createJob,
    canDispatch,
    canSavePendingLead,
    addressReady,
    dispatchBlockers,
    addressSeedQuery,
    answeredClarificationIds: form.vehicleClarificationAnswers,
  }
}
