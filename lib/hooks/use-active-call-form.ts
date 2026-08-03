"use client"

// Client state for the answered-call intake sheet (CRM + vehicle + job dispatch).

import { useCallback, useEffect, useMemo, useState } from "react"
import type { CrmServiceHistoryItem, Customer, CustomerVehicle } from "@/lib/types"
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
import { DEFAULT_SERVICE_RATE_CARD } from "@/lib/service-rate-card"
import { serviceQuoteTypeIdFromCrmHistory, type CallbackContinueStep } from "@/lib/callback-intake-chooser"
import { formatIntakeJobTypeForDispatch } from "@/lib/intake-job-types"
import { notifyWorkspaceDataChanged } from "@/lib/workspace-organizations"
import { revalidateSchedulerJobPoolCaches } from "@/lib/hooks/use-job-pool-query"
import { travelDistanceMiles } from "@/lib/geo"
import { useDispatcherLocation } from "@/lib/hooks/use-dispatcher-location"
import { hasCompleteIntakePhone, resolveIntakePhone } from "@/lib/intake-phone"
import { keyStyleRequiresFieldVerification } from "@/lib/vehicle-trim-features"
import type { VehicleFactoryOption } from "@/lib/vehicle-trim-features"
import type { PlateLookupResult } from "@/lib/vehicle-plate-lookup"
import {
  defaultIntakeScheduleDate,
  defaultIntakeScheduleTime,
} from "@/lib/intake-schedule-helpers"
import { combineScheduledDateTimeLocal } from "@/lib/scheduler-utils"

/** Manual-only call lifecycle shown in the intake sheet header. */
export type ManualCallStatus = "ringing" | "answered" | "on_hold" | "completed"

export type ActiveCallRow = {
  id: string
  from_number: string
  to_number: string
  caller_name: string | null
  answered_at: string | null
  /** Carrier hangup time — drives Call ended chrome without closing intake. */
  ended_at?: string | null
  /** Telnyx recording URL when the carrier callback has landed in call_logs. */
  recording_url?: string | null
  /** call_logs.call_type — used to label Missed / Voicemail vs Answered. */
  call_type?: string | null
  /** Carrier / dial status (completed, no-answer, …). */
  status?: string | null
  /** Who handled the leg (Owner, Voicemail, AI Receptionist, …). */
  routed_to_name?: string | null
  /** Talk seconds when known from call-completed. */
  duration_seconds?: number | null
  /** True when opened via openManualCallPanel (not a Telnyx webhook row). */
  isManual?: boolean
  manualCallStatus?: ManualCallStatus
  /** Optional vehicle seed for manual calls. */
  vehicleYear?: string
  vehicleMake?: string
  vehicleModel?: string
  /** Pre-filled quote from CRM convert handoff. */
  quotedPriceCents?: number
  /**
   * Real call_logs.id when reopening intake from Activities.
   * Distinct from `id` when `id` is an existing ai_leads row (CRM convert).
   */
  sourceCallLogId?: string
  /** Existing ai_leads id when converting / completing a CRM lead. */
  existingLeadId?: string
  /**
   * `quick` = missed-call one-screen note (no YMM wizard).
   * `full` = normal answered booking intake.
   */
  intakeMode?: "full" | "quick"
  /** Prefill calculator id (CRM Book Continue-quote — avoids false Lockout). */
  serviceQuoteTypeId?: string
  /** When true, CallAnsweredModal auto-runs Continue open quote (skip Service). */
  continueOpenQuote?: boolean
  /** Landing step after Continue-quote auto-start. */
  intakeStartStep?: CallbackContinueStep
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
  /** Trim label from VIN decode or dispatcher (e.g. Base, SLT). */
  vehicleTrim: string
  /** Confirmed factory options on this vehicle. */
  factoryOptions: VehicleFactoryOption[]
  /** License plate used for rapid registration lookup. */
  plateNumber: string
  plateState: string
  /** VIN from plate decode or manual entry (stored on job, not shown to caller). */
  vehicleVin: string
  keyFccId: string
  keyFrequency: string
  keyChipset: string
  keyStyle: string
  /** Which photo variant the user tapped in the key panel. */
  keyVariantId: string
  /** Row id from the FCC reference CSV for the selected profile. */
  keyProfileId: string
  /** How the selected key is programmed (from key panel variant card). */
  programmingMethod: string
  /** Transponder Island ordering SKU (e.g. TIK-SUB-37A) for the selected key. */
  tiSku: string
  /** Appointment date (YYYY-MM-DD) used when booking from intake. */
  scheduledDate: string
  /** Appointment time (HH:mm) used when booking from intake. */
  scheduledTime: string
  /** Intake clarification prompts already answered for this vehicle. */
  vehicleClarificationAnswers: string[]
  /** Service quote calculator selection id (see lib/service-quote-calculator). */
  serviceQuoteTypeId: string
  /** Last computed quote total in cents (stored on booked jobs + lost leads). */
  quotedPriceCents: number
  /** When true, auto-quote changes do not overwrite quotedPriceCents. */
  quotedPriceOverridden: boolean
  /**
   * Where the work happens:
   * - mobile = tech goes to customer
   * - shop = customer comes to your shop
   */
  serviceVenue: "" | "mobile" | "shop"
  /** Customer already bought/has the key — cut & program only (common shop walk-in). */
  customerOwnsKey: boolean
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
  vehicleTrim: "",
  factoryOptions: [],
  plateNumber: "",
  plateState: "",
  vehicleVin: "",
  keyFccId: "",
  keyFrequency: "",
  keyChipset: "",
  keyStyle: "",
  keyVariantId: "",
  keyProfileId: "",
  programmingMethod: "",
  tiSku: "",
  scheduledDate: "",
  scheduledTime: "",
  vehicleClarificationAnswers: [],
  // Empty until the operator picks — "lockout" here auto-fills jobType/price and
  // falsely triggers Restore draft ("Returning caller") on brand-new numbers.
  serviceQuoteTypeId: "",
  quotedPriceCents: 0,
  quotedPriceOverridden: false,
  serviceVenue: "",
  customerOwnsKey: false,
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
  const keepTypedName = Boolean(prev.displayName.trim())
  return {
    ...prev,
    displayName: keepTypedName ? prev.displayName : c.display_name?.trim() || prev.displayName,
    addressLine1: prev.addressLine1.trim() ? prev.addressLine1 : c.address_line1 || "",
    addressLine2: prev.addressLine2.trim() ? prev.addressLine2 : c.address_line2 || "",
    city: prev.city.trim() ? prev.city : c.city || "",
    region: prev.region.trim() ? prev.region : c.region || "",
    postalCode: prev.postalCode.trim() ? prev.postalCode : c.postal_code || "",
    country: prev.country.trim() ? prev.country : c.country || "US",
    notes: prev.notes.trim() ? prev.notes : c.notes || "",
    serviceAddress: prev.serviceAddress,
  }
}

export function useActiveCallForm(
  current: ActiveCallRow | null,
  hookOptions?: {
    /** Replace synthetic manual-{uuid} row id with real call_logs.id after POST /api/calls/manual. */
    linkManualCallLog?: (patch: Partial<ActiveCallRow>) => void
  }
) {
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [jobState, setJobState] = useState<"idle" | "creating" | "created" | "error">("idle")
  const [jobError, setJobError] = useState<string | null>(null)
  const [form, setForm] = useState<ActiveCallFormState>(EMPTY_FORM)
  const [matchedCustomer, setMatchedCustomer] = useState<Customer | null>(null)
  /** Garage vehicles from CRM profile — compact picker chips on repeat callers. */
  const [garageVehicles, setGarageVehicles] = useState<CustomerVehicle[]>([])
  /**
   * Open quote/callback lead id from CRM — booking / Save Quote upgrades this row
   * instead of inserting a duplicate (same idea as CRM Convert handoff).
   */
  const [crmOpenLeadId, setCrmOpenLeadId] = useState<string | null>(null)
  /** Last quoted cents from that open lead — shown as a light chip in the header. */
  const [crmOpenLeadQuoteCents, setCrmOpenLeadQuoteCents] = useState<number | null>(null)
  /** Service type from the open quote lead — used by Continue quote / Lockout clear. */
  const [crmOpenLeadServiceTypeId, setCrmOpenLeadServiceTypeId] = useState<ServiceQuoteTypeId | null>(
    null
  )
  const [rateCard, setRateCard] = useState<ServiceRateCard | null>(null)
  const [rateCardSource, setRateCardSource] = useState<"onboarding_profiles.service_rules" | "default">("default")
  const callLogId = current?.id ?? null
  const dispatcherLocation = useDispatcherLocation(Boolean(callLogId))

  const resolvedPhoneNumber = useMemo(
    () => resolveIntakePhone(form.phoneNumber, current?.from_number),
    [form.phoneNumber, current?.from_number]
  )

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
      programmingMethod: "",
      tiSku: "",
      vehicleClarificationAnswers: [],
    }))
  }, [])

  /** Apply plate lookup payload — Y/M/M plus hidden VIN, trim, and factory options. */
  const applyPlateLookupResult = useCallback((result: PlateLookupResult) => {
    setForm((prev) => ({
      ...prev,
      plateNumber: result.plate || prev.plateNumber,
      plateState: result.state || prev.plateState,
      vehicleYear: result.vehicle_year?.trim() || prev.vehicleYear,
      vehicleMake: result.vehicle_make?.trim() || prev.vehicleMake,
      vehicleModel: result.vehicle_model?.trim() || prev.vehicleModel,
      vehicleTrim: result.trim?.trim() || prev.vehicleTrim,
      vehicleVin: result.vin?.trim() || prev.vehicleVin,
      factoryOptions:
        result.factory_options && result.factory_options.length > 0
          ? result.factory_options
          : prev.factoryOptions,
      keyFccId: "",
      keyFrequency: "",
      keyChipset: "",
      keyStyle: "",
      keyVariantId: "",
      keyProfileId: "",
      programmingMethod: "",
      tiSku: "",
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
      const fccId = option.fccId?.trim() || ""
      const tiSku = option.tiSku?.trim() || ""
      const keyStyle = option.keyStyle?.trim() || ""
      // Model/make change clears key selection so YMM reloads; FCC / style answers pin the key.
      const clearsKey = Boolean(option.model || option.make) && !fccId && !keyStyle
      const pinsKey = Boolean(fccId || keyStyle || tiSku)
      return {
        ...prev,
        vehicleClarificationAnswers: nextAnswers,
        vehicleMake: option.make?.trim() || prev.vehicleMake,
        vehicleModel: option.model?.trim() || prev.vehicleModel,
        notes,
        ...(clearsKey
          ? {
              keyFccId: "",
              keyFrequency: "",
              keyChipset: "",
              keyStyle: "",
              keyVariantId: "",
              keyProfileId: "",
              programmingMethod: "",
              tiSku: "",
            }
          : {}),
        ...(pinsKey
          ? {
              keyFccId: fccId || prev.keyFccId,
              keyFrequency: option.frequency?.trim() || prev.keyFrequency,
              keyStyle: keyStyle || prev.keyStyle,
              // Clear prior blank so Key Details re-picks from the filtered catalog.
              keyProfileId: tiSku ? "ti-catalog" : "",
              keyVariantId: tiSku ? `ti-catalog-${tiSku}` : "",
              tiSku: tiSku || "",
              programmingMethod: tiSku ? "OBD2 Programming Required" : "",
            }
          : {}),
      }
    })
  }, [])

  /**
   * Pin a server-resolved FCC without adding an Ask-the-customer answer id.
   * Used when HO03-style variants are equivalent and we skip the banner.
   */
  const applyFccAutoResolved = useCallback((option: VehicleClarificationOption) => {
    const fccId = option.fccId?.trim() || ""
    if (!fccId) return
    setForm((prev) => {
      // Do not overwrite a dispatcher who already chose a different FCC.
      if (prev.keyFccId.trim() && prev.keyFccId.trim().toUpperCase() !== fccId.toUpperCase()) {
        return prev
      }
      const tiSku = option.tiSku?.trim() || ""
      const noteLine = option.note?.trim()
      const notes =
        noteLine && !prev.notes.includes(noteLine)
          ? prev.notes.trim()
            ? `${prev.notes.trim()} · ${noteLine}`
            : noteLine
          : prev.notes
      return {
        ...prev,
        notes,
        keyFccId: fccId,
        keyFrequency: option.frequency?.trim() || prev.keyFrequency,
        keyStyle: option.keyStyle?.trim() || prev.keyStyle,
        keyProfileId: tiSku ? "ti-catalog" : prev.keyProfileId,
        keyVariantId: tiSku ? `ti-catalog-${tiSku}` : prev.keyVariantId,
        tiSku: tiSku || prev.tiSku,
        programmingMethod: tiSku
          ? prev.programmingMethod || "OBD2 Programming Required"
          : prev.programmingMethod,
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
        programmingMethod?: string | null
        tiSku?: string | null
      } | null
    ) => {
      setForm((prev) => {
        const next = {
          keyProfileId: sel?.profileId ?? "",
          keyFccId: sel?.fccId ?? "",
          keyFrequency: sel?.frequency ?? "",
          keyChipset: sel?.chipset ?? "",
          keyStyle: sel?.keyStyle ?? "",
          keyVariantId: sel?.variantId ?? "",
          programmingMethod: sel?.programmingMethod?.trim() ?? "",
          tiSku: sel?.tiSku?.trim() ?? "",
        }
        // Bail out when nothing changed — avoids parent↔child update loops.
        if (
          prev.keyProfileId === next.keyProfileId &&
          prev.keyFccId === next.keyFccId &&
          prev.keyFrequency === next.keyFrequency &&
          prev.keyChipset === next.keyChipset &&
          prev.keyStyle === next.keyStyle &&
          prev.keyVariantId === next.keyVariantId &&
          prev.programmingMethod === next.programmingMethod &&
          prev.tiSku === next.tiSku
        ) {
          return prev
        }
        return { ...prev, ...next }
      })
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
    const seededQuote =
      typeof current.quotedPriceCents === "number" && current.quotedPriceCents > 0
        ? Math.round(current.quotedPriceCents)
        : 0
    const seededService = current.serviceQuoteTypeId?.trim() || ""
    setForm({
      ...EMPTY_FORM,
      scheduledDate: defaultIntakeScheduleDate(),
      scheduledTime: defaultIntakeScheduleTime(),
      phoneNumber: current.from_number,
      displayName: current.caller_name?.trim() || "",
      vehicleYear: current.vehicleYear?.trim() || "",
      vehicleMake: current.vehicleMake?.trim() || "",
      vehicleModel: current.vehicleModel?.trim() || "",
      // CRM Book / Continue-quote seed — never leave blank form as Lockout default.
      serviceQuoteTypeId: seededService,
      ...(seededQuote > 0
        ? { quotedPriceCents: seededQuote, quotedPriceOverridden: true }
        : {}),
    })
  }, [
    callLogId,
    current?.from_number,
    current?.caller_name,
    current?.vehicleYear,
    current?.vehicleMake,
    current?.vehicleModel,
    current?.quotedPriceCents,
    current?.serviceQuoteTypeId,
  ])

  // Keep phone state synced with the active Telnyx caller ID when the field is still empty.
  useEffect(() => {
    if (!callLogId || !current) return
    const inbound = current.from_number?.trim()
    if (!inbound) return
    setForm((prev) => {
      if (prev.phoneNumber.trim()) return prev
      return { ...prev, phoneNumber: inbound }
    })
  }, [callLogId, current?.from_number])

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
    // Empty id = open-quote cleared Lockout default — wait for an explicit pick.
    if (!form.serviceQuoteTypeId.trim()) return
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
      // Stale effect after call switch may still see prior lockout — never write
      // Lockout jobType/price onto a form that already cleared service selection.
      if (!prev.serviceQuoteTypeId.trim()) return prev
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
    if (!callLogId) {
      setMatchedCustomer(null)
      setGarageVehicles([])
      setCrmOpenLeadId(null)
      setCrmOpenLeadQuoteCents(null)
      setCrmOpenLeadServiceTypeId(null)
      return
    }
    if (!hasCompleteIntakePhone(resolvedPhoneNumber)) {
      setMatchedCustomer(null)
      setGarageVehicles([])
      setCrmOpenLeadId(null)
      setCrmOpenLeadQuoteCents(null)
      setCrmOpenLeadServiceTypeId(null)
      return
    }

    let cancel = false
    // Drop prior caller CRM immediately so a new number never looks "known"
    // while the next profile is still loading.
    setMatchedCustomer(null)
    setGarageVehicles([])
    setCrmOpenLeadId(current?.existingLeadId?.trim() || null)
    setCrmOpenLeadQuoteCents(null)
    setCrmOpenLeadServiceTypeId(null)
    const t = window.setTimeout(() => {
      const q = encodeURIComponent(resolvedPhoneNumber)
      void fetch(`/api/customers?phone=${q}`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : { customers: [] }))
        .then((data: { customers?: Customer[] }) => {
          if (cancel) return
          const c = data.customers?.[0] ?? null
          setMatchedCustomer(c)
          if (!c) {
            setGarageVehicles([])
            if (!current?.existingLeadId?.trim()) {
              setCrmOpenLeadId(null)
              setCrmOpenLeadQuoteCents(null)
              setCrmOpenLeadServiceTypeId(null)
            }
            return
          }
          setForm((prev) => formFromCustomer(c, prev))
          // Load garage + open quote so returning callers skip re-entry / duplicate leads.
          void fetch(`/api/crm/customers/${encodeURIComponent(c.id)}`, {
            credentials: "include",
          })
            .then((r) => (r.ok ? r.json() : null))
            .then(
              (json: {
                data?: {
                  vehicles?: CustomerVehicle[]
                  history?: CrmServiceHistoryItem[]
                }
              } | null) => {
                if (cancel || !json?.data) return
                const vehicles = json.data.vehicles ?? []
                const history = json.data.history ?? []
                setGarageVehicles(vehicles)
                const openLead = history.find((h) => h.is_open_lead) ?? null
                const openLeadId = openLead?.id?.trim() || null
                // Row handoff (CRM Convert) wins; else bind the open quote for upgrade-on-book.
                setCrmOpenLeadId(current?.existingLeadId?.trim() || openLeadId)
                const quoteCents =
                  openLead?.amount_cents != null && openLead.amount_cents > 0
                    ? Math.round(openLead.amount_cents)
                    : null
                setCrmOpenLeadQuoteCents(quoteCents)
                const resolvedServiceType = serviceQuoteTypeIdFromCrmHistory(openLead)
                setCrmOpenLeadServiceTypeId(resolvedServiceType)
                setForm((prev) => {
                  const hasYmm =
                    Boolean(prev.vehicleYear.trim()) ||
                    Boolean(prev.vehicleMake.trim()) ||
                    Boolean(prev.vehicleModel.trim())
                  // Prefer open-lead YMM, else most recent garage vehicle.
                  const leadYmm = {
                    year: openLead?.vehicle_year?.trim() || "",
                    make: openLead?.vehicle_make?.trim() || "",
                    model: openLead?.vehicle_model?.trim() || "",
                  }
                  const garage = vehicles[0]
                  const nextYmm = leadYmm.year || leadYmm.make || leadYmm.model
                    ? leadYmm
                    : garage
                      ? {
                          year: garage.year?.trim() || "",
                          make: garage.make?.trim() || "",
                          model: garage.model?.trim() || "",
                        }
                      : null
                  const patch: Partial<ActiveCallFormState> = {}
                  if (!hasYmm && nextYmm) {
                    patch.vehicleYear = nextYmm.year
                    patch.vehicleMake = nextYmm.make
                    patch.vehicleModel = nextYmm.model
                  }
                  // Don't clobber a CRM-convert / manual seed quote.
                  if (
                    !prev.quotedPriceOverridden &&
                    prev.quotedPriceCents <= 0 &&
                    quoteCents != null &&
                    quoteCents > 0
                  ) {
                    patch.quotedPriceCents = quoteCents
                    patch.quotedPriceOverridden = true
                  }
                  // Stop false "new Lockout" when an open quote is loaded.
                  // Only rewrite the blank-form default — never fight a user/draft pick.
                  const stillDefaultLockout = prev.serviceQuoteTypeId === "lockout"
                  if (stillDefaultLockout && (resolvedServiceType || (quoteCents != null && quoteCents > 0))) {
                    if (resolvedServiceType && resolvedServiceType !== "lockout") {
                      patch.serviceQuoteTypeId = resolvedServiceType
                    } else if (!resolvedServiceType && quoteCents != null && quoteCents > 0) {
                      // Known quote, unknown type — clear selection until Continue / user picks.
                      patch.serviceQuoteTypeId = ""
                    }
                  }
                  return Object.keys(patch).length ? { ...prev, ...patch } : prev
                })
              }
            )
            .catch(() => {
              /* CRM profile optional — phone match alone still works */
            })
        })
        .catch(() => {
          if (!cancel) {
            setMatchedCustomer(null)
            setGarageVehicles([])
            if (!current?.existingLeadId?.trim()) {
              setCrmOpenLeadId(null)
              setCrmOpenLeadQuoteCents(null)
              setCrmOpenLeadServiceTypeId(null)
            }
          }
        })
    }, 350)

    return () => {
      cancel = true
      window.clearTimeout(t)
    }
  }, [callLogId, resolvedPhoneNumber, current?.existingLeadId])

  // Keep row handoff lead id in sync if Convert opened after the phone match.
  useEffect(() => {
    const fromRow = current?.existingLeadId?.trim() || null
    if (fromRow) setCrmOpenLeadId(fromRow)
  }, [current?.existingLeadId])

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

  const createJob = useCallback(
    async (
      organizationId?: string | null,
      jobOptions?: {
        pendingCallback?: boolean
        /** Hang-up after quoting — skip name/address/schedule; tag lead for phone match. */
        quoteLead?: boolean
        quotedPriceCents?: number
        discountApplied?: string | null
        baselineQuotedPriceCents?: number | null
        calculatedTotalCents?: number | null
        finalBookedTotalCents?: number | null
        isPriceOverridden?: boolean
        recoveredViaRouteDiscount?: boolean
        existingLeadId?: string | null
        /** Explicit New job — server skips open-quote auto-upgrade. */
        forceNewJob?: boolean
      }
    ): Promise<
      | {
          ok: true
          leadId: string
          customerSmsSent?: boolean
          customerSmsError?: string | null
          customerSmsDraft?: string | null
        }
      | { ok: false }
    > => {
      if (!current) return { ok: false }
      const phone = resolvedPhoneNumber || current.from_number
      const pendingCallback = Boolean(jobOptions?.pendingCallback)
      const quoteLead = Boolean(jobOptions?.quoteLead)
      // Quote / callback leads may skip the name step — phone + quote are enough to match later.
      const name =
        form.displayName.trim() ||
        (pendingCallback || quoteLead ? "Quote lead" : "")
      if (!name) {
        setJobState("error")
        setJobError("Enter the caller name before sending to dispatch.")
        return { ok: false }
      }
      // Stamp quote / shop / own-key tags so Leads + call-back matching stay clear.
      const noteTags: string[] = []
      if (quoteLead) noteTags.push("Price Quoted / Lead Only")
      if (form.serviceVenue === "shop") noteTags.push("Shop visit — customer comes to us")
      if (form.serviceVenue === "mobile") noteTags.push("Mobile service — we go to customer")
      if (form.customerOwnsKey) noteTags.push("Customer-supplied key — cut & program only")
      let notesForJob = form.notes.trim()
      for (const tag of noteTags) {
        if (!notesForJob.includes(tag)) {
          notesForJob = notesForJob ? `${notesForJob} · ${tag}` : tag
        }
      }
      const quotedPriceCents =
        jobOptions?.quotedPriceCents != null && jobOptions.quotedPriceCents > 0
          ? Math.round(jobOptions.quotedPriceCents)
          : form.quotedPriceCents > 0
            ? form.quotedPriceCents
            : 0
      if (!pendingCallback && quotedPriceCents <= 0) {
        setJobState("error")
        setJobError("Enter the quoted job price before booking. The saved balance cannot be blank.")
        return { ok: false }
      }
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
        // Prefer explicit CRM lead id; never treat a call_logs id as a lead id.
        // Continue quote / CRM bind upgrades; New job clears crmOpenLeadId + sets forceNewJob.
        const forceNewJob = jobOptions?.forceNewJob === true
        const existingLeadId = forceNewJob
          ? null
          : jobOptions?.existingLeadId?.trim() ||
            current.existingLeadId?.trim() ||
            crmOpenLeadId?.trim() ||
            null
        // Activities → sourceCallLogId; live rows → id; CRM-only convert → id (legacy); manuals provision below.
        let callLogIdForJob = current.sourceCallLogId?.trim() || current.id
        const addressLine1 = form.addressLine1.trim()
        const city = form.city.trim()

        if (hasCompleteIntakePhone(phone)) {
          setSaveState("saving")
          const customerRes = await fetch("/api/customers", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              phone_e164: phone,
              display_name: name,
              company_name: "",
              address_line1: form.addressLine1,
              address_line2: form.addressLine2,
              city: form.city,
              region: form.region,
              postal_code: form.postalCode,
              country: form.country,
              notes: form.notes,
              source_last_call_log_id:
                current.id.startsWith("manual-") && !current.sourceCallLogId
                  ? null
                  : callLogIdForJob,
            }),
          })
          if (!customerRes.ok) throw new Error("Could not save customer record.")
          // Keep CRM vehicle garage in sync when intake has YMM (needs migration 120).
          const customerJson = (await customerRes.json().catch(() => null)) as {
            data?: { id?: string }
          } | null
          const customerId = customerJson?.data?.id
          if (
            customerId &&
            (form.vehicleYear.trim() || form.vehicleMake.trim() || form.vehicleModel.trim())
          ) {
            void fetch(`/api/crm/customers/${encodeURIComponent(customerId)}/vehicles`, {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                year: form.vehicleYear,
                make: form.vehicleMake,
                model: form.vehicleModel,
                vin: form.vehicleVin || "",
                fcc_id: form.keyFccId || "",
              }),
            }).catch(() => {
              /* garage optional until migration 120 */
            })
          }
          setSaveState("saved")
        }

        // Only brand-new walk-ins need a synthetic call_logs row — Activities already has one.
        if (current.isManual && current.id.startsWith("manual-") && !current.sourceCallLogId) {
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
          hookOptions?.linkManualCallLog?.({ id: provisionedId, isManual: true })
        }

        const scheduledAtIso = pendingCallback
          ? null
          : combineScheduledDateTimeLocal(form.scheduledDate, form.scheduledTime)

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
            notes: notesForJob,
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
            programming_method: form.programmingMethod.trim() || null,
            ti_sku: form.tiSku.trim() || null,
            field_verification_required: keyStyleRequiresFieldVerification(form.keyStyle),
            vehicle_trim: form.vehicleTrim.trim() || null,
            factory_options: form.factoryOptions.length > 0 ? form.factoryOptions : null,
            vehicle_vin: form.vehicleVin.trim() || null,
            plate_number: form.plateNumber.trim() || null,
            plate_state: form.plateState.trim() || null,
            customer_lat: form.serviceAddress?.lat ?? null,
            customer_lng: form.serviceAddress?.lng ?? null,
            organization_id: organizationId ?? null,
            pending_callback: pendingCallback,
            scheduled_at: scheduledAtIso,
            service_venue: form.serviceVenue === "shop" || form.serviceVenue === "mobile"
              ? form.serviceVenue
              : null,
            customer_owns_key: form.customerOwnsKey === true,
            discount_applied: jobOptions?.discountApplied?.trim() || null,
            baseline_quote_cents:
              jobOptions?.baselineQuotedPriceCents != null && jobOptions.baselineQuotedPriceCents > 0
                ? Math.round(jobOptions.baselineQuotedPriceCents)
                : null,
            calculated_total_cents:
              jobOptions?.calculatedTotalCents != null && jobOptions.calculatedTotalCents > 0
                ? Math.round(jobOptions.calculatedTotalCents)
                : null,
            final_booked_total_cents:
              jobOptions?.finalBookedTotalCents != null && jobOptions.finalBookedTotalCents > 0
                ? Math.round(jobOptions.finalBookedTotalCents)
                : null,
            is_price_overridden: jobOptions?.isPriceOverridden === true,
            // CamelCase aliases for negotiation metrics / analytics consumers.
            calculatedTotal:
              jobOptions?.calculatedTotalCents != null && jobOptions.calculatedTotalCents > 0
                ? Math.round(jobOptions.calculatedTotalCents) / 100
                : null,
            finalBookedTotal:
              jobOptions?.finalBookedTotalCents != null && jobOptions.finalBookedTotalCents > 0
                ? Math.round(jobOptions.finalBookedTotalCents) / 100
                : null,
            isPriceOverridden: jobOptions?.isPriceOverridden === true,
            recovered_via_route_discount: jobOptions?.recoveredViaRouteDiscount === true,
            existing_lead_id: existingLeadId,
            force_new_job: forceNewJob,
          }),
        })
        const json = (await res.json()) as {
          data?: {
            lead_id?: string
            customer_sms_sent?: boolean
            customer_sms_error?: string | null
            customer_sms_draft?: string | null
          }
          error?: string
        }
        if (!res.ok) throw new Error(json.error ?? "Job create failed")
        const leadId = String(json.data?.lead_id ?? "").trim()
        if (!leadId) throw new Error("Job created but no lead id returned.")
        setJobState("created")
        notifyWorkspaceDataChanged({ reason: "job-created", organizationId: organizationId ?? null })
        void revalidateSchedulerJobPoolCaches(organizationId ?? null)
        return {
          ok: true,
          leadId,
          customerSmsSent: json.data?.customer_sms_sent === true,
          customerSmsError: json.data?.customer_sms_error ?? null,
          customerSmsDraft: json.data?.customer_sms_draft ?? null,
        }
      } catch (e) {
        setJobState("error")
        setJobError(e instanceof Error ? e.message : "Job create failed")
        return { ok: false }
      }
    },
    [current, form, hookOptions?.linkManualCallLog, travelDistanceMilesValue, resolvedPhoneNumber, crmOpenLeadId]
  )

  const addressReady = isIntakeAddressReady(form)
  const canDispatch = Boolean(form.displayName.trim() && addressReady)
  const canSavePendingLead = Boolean(
    form.displayName.trim() && hasCompleteIntakePhone(resolvedPhoneNumber || current?.from_number || "")
  )
  /** Quote lead only needs a dialable phone — name / address / schedule are optional. */
  const canSaveQuoteLead = hasCompleteIntakePhone(
    resolvedPhoneNumber || current?.from_number || ""
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

  /** Rapid-tap locksmith template — sets job type + baseline fee from the rate card. */
  const applyRapidLocksmithTemplate = useCallback(
    (template: "vehicle_lockout" | "home_lockout" | "rekey") => {
      const card = rateCard ?? DEFAULT_SERVICE_RATE_CARD
      if (template === "vehicle_lockout") {
        const cents = card.services.lockout ?? 8500
        setForm((prev) => ({
          ...prev,
          jobType: "Lockout",
          keyReplacementMode: "",
          serviceQuoteTypeId: "lockout",
          notes: prev.notes.trim() ? prev.notes : "Vehicle lockout",
          quotedPriceCents: cents,
          quotedPriceOverridden: true,
        }))
        return
      }
      if (template === "home_lockout") {
        const cents = card.services.lockout ?? 8500
        setForm((prev) => ({
          ...prev,
          jobType: "Lockout",
          keyReplacementMode: "",
          serviceQuoteTypeId: "lockout",
          notes: prev.notes.trim() ? prev.notes : "Home lockout",
          quotedPriceCents: cents,
          quotedPriceOverridden: true,
        }))
        return
      }
      const cents = card.services.rekey ?? 14000
      setForm((prev) => ({
        ...prev,
        jobType: "Other",
        keyReplacementMode: "",
        serviceQuoteTypeId: "rekey",
        notes: prev.notes.trim() ? prev.notes : "Re-key / fresh install",
        quotedPriceCents: cents,
        quotedPriceOverridden: true,
      }))
    },
    [rateCard]
  )

  const setQuotedPriceDollars = useCallback((dollars: number) => {
    const cents = Number.isFinite(dollars) && dollars >= 0 ? Math.round(dollars * 100) : 0
    setForm((prev) => ({ ...prev, quotedPriceCents: cents, quotedPriceOverridden: true }))
  }, [])

  const syncQuotedPriceToAuto = useCallback(() => {
    setForm((prev) => ({ ...prev, quotedPriceOverridden: false }))
  }, [])

  /** Reset every intake field — used when clearing a local draft on dismiss. */
  const resetForm = useCallback(() => {
    setForm(EMPTY_FORM)
    setMatchedCustomer(null)
    setGarageVehicles([])
    setCrmOpenLeadId(null)
    setCrmOpenLeadQuoteCents(null)
    setCrmOpenLeadServiceTypeId(null)
    setSaveState("idle")
  }, [])

  /**
   * Explicit "New job" on a known callback — keep customer + garage, drop open-quote bind
   * so booking inserts a fresh lead instead of upgrading the wrong quote.
   */
  const startFreshJobForReturningCaller = useCallback(() => {
    setCrmOpenLeadId(null)
    setCrmOpenLeadQuoteCents(null)
    setCrmOpenLeadServiceTypeId(null)
    setForm((prev) => ({
      ...prev,
      // Clear Lockout default + quote dollars that belonged to the prior open lead.
      serviceQuoteTypeId: "",
      quotedPriceCents: 0,
      quotedPriceOverridden: false,
      jobType: "",
      keyReplacementMode: "",
    }))
  }, [])

  /** Apply open-quote service + YMM + price for the Continue-quote path (keeps crmOpenLeadId). */
  const applyOpenQuoteContinuePrefill = useCallback(() => {
    setForm((prev) => {
      const patch: Partial<ActiveCallFormState> = {}
      if (crmOpenLeadServiceTypeId) {
        patch.serviceQuoteTypeId = crmOpenLeadServiceTypeId
      } else if (!prev.serviceQuoteTypeId.trim() || prev.serviceQuoteTypeId === "lockout") {
        // Still unknown — leave empty so Service isn't forced Lockout mid-continue.
        patch.serviceQuoteTypeId = prev.serviceQuoteTypeId === "lockout" ? "" : prev.serviceQuoteTypeId
      }
      if (
        crmOpenLeadQuoteCents != null &&
        crmOpenLeadQuoteCents > 0 &&
        (!prev.quotedPriceOverridden || prev.quotedPriceCents <= 0)
      ) {
        patch.quotedPriceCents = crmOpenLeadQuoteCents
        patch.quotedPriceOverridden = true
      }
      return Object.keys(patch).length ? { ...prev, ...patch } : prev
    })
  }, [crmOpenLeadQuoteCents, crmOpenLeadServiceTypeId])

  /** Tap a garage chip to fill YMM without fighting plate/VIN decode later. */
  const applyGarageVehicle = useCallback((vehicle: CustomerVehicle) => {
    setForm((prev) => ({
      ...prev,
      vehicleYear: vehicle.year?.trim() || "",
      vehicleMake: vehicle.make?.trim() || "",
      vehicleModel: vehicle.model?.trim() || "",
      vehicleVin: vehicle.vin?.trim() || prev.vehicleVin,
      keyFccId: vehicle.fcc_id?.trim() || prev.keyFccId,
      // Clear trim/key picks that belonged to a different car.
      vehicleTrim: "",
      factoryOptions: [],
      keyStyle: "",
      keyVariantId: "",
      keyProfileId: "",
      keyFrequency: "",
      keyChipset: "",
      programmingMethod: "",
      tiSku: "",
      vehicleClarificationAnswers: [],
    }))
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
    matchedCustomer,
    garageVehicles,
    crmOpenLeadId,
    crmOpenLeadQuoteCents,
    crmOpenLeadServiceTypeId,
    applyGarageVehicle,
    applyOpenQuoteContinuePrefill,
    startFreshJobForReturningCaller,
    resolvedPhoneNumber,
    patchForm,
    resetForm,
    setServiceQuoteTypeId,
    applyRapidLocksmithTemplate,
    setQuotedPriceDollars,
    syncQuotedPriceToAuto,
    liveQuote,
    rateCardSource,
    travelDistanceMiles: travelDistanceMilesValue,
    dispatcherLocation,
    setVehicle,
    applyPlateLookupResult,
    applyVehicleClarification,
    applyFccAutoResolved,
    setVehicleKeySelection,
    setServiceAddress,
    commitAddressQuery,
    saveState,
    jobState,
    jobError,
    setJobError,
    setJobState,
    createJob,
    canDispatch,
    canSavePendingLead,
    canSaveQuoteLead,
    addressReady,
    dispatchBlockers,
    addressSeedQuery,
    answeredClarificationIds: form.vehicleClarificationAnswers,
  }
}
