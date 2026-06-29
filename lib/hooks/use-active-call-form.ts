"use client"

// Client state for the answered-call intake sheet (CRM + vehicle + job dispatch).

import { useCallback, useEffect, useState } from "react"
import type { Customer } from "@/lib/types"
import {
  isCompleteStructuredAddress,
  type StructuredAddress,
} from "@/lib/structured-address"
import { INTAKE_LOCKSMITH_JOB_TYPES, isIntakeLocksmithJobType } from "@/lib/intake-job-types"

export type ActiveCallRow = {
  id: string
  from_number: string
  to_number: string
  caller_name: string | null
  answered_at: string | null
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
  vehicleYear: string
  vehicleMake: string
  vehicleModel: string
  keyFccId: string
  keyFrequency: string
  keyChipset: string
  keyStyle: string
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
  vehicleYear: "",
  vehicleMake: "",
  vehicleModel: "",
  keyFccId: "",
  keyFrequency: "",
  keyChipset: "",
  keyStyle: "",
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

export function useActiveCallForm(current: ActiveCallRow | null) {
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [jobState, setJobState] = useState<"idle" | "creating" | "created" | "error">("idle")
  const [jobError, setJobError] = useState<string | null>(null)
  const [form, setForm] = useState<ActiveCallFormState>(EMPTY_FORM)
  const callLogId = current?.id ?? null

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
    }))
  }, [])

  const setVehicleKeySelection = useCallback(
    (sel: { fccId: string; frequency: string | null; chipset: string | null; keyStyle: string } | null) => {
      setForm((prev) => ({
        ...prev,
        keyFccId: sel?.fccId ?? "",
        keyFrequency: sel?.frequency ?? "",
        keyChipset: sel?.chipset ?? "",
        keyStyle: sel?.keyStyle ?? "",
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
    })
  }, [callLogId, current?.from_number, current?.caller_name])

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
          source_last_call_log_id: current.id,
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
    async (organizationId?: string | null): Promise<boolean> => {
      if (!current) return false
      const phone = form.phoneNumber.trim() || current.from_number
      const name = form.displayName.trim()
      if (!name) {
        setJobState("error")
        setJobError("Enter the caller name before sending to dispatch.")
        return false
      }
      if (!form.serviceAddress || !isCompleteStructuredAddress(form.serviceAddress)) {
        setJobState("error")
        setJobError("Pick a complete service address from the suggestions so we can place a map pin.")
        return false
      }
      if (!isIntakeLocksmithJobType(form.jobType)) {
        setJobState("error")
        setJobError("Select what the customer needs (lockout, copy, ignition, etc.).")
        return false
      }

      setJobState("creating")
      setJobError(null)
      try {
        const res = await fetch("/api/jobs/create", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            call_log_id: current.id,
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
            job_type: form.jobType,
            key_fcc_id: form.keyFccId || null,
            key_frequency: form.keyFrequency || null,
            key_chipset: form.keyChipset || null,
            key_style: form.keyStyle || null,
            customer_lat: form.serviceAddress.lat,
            customer_lng: form.serviceAddress.lng,
            organization_id: organizationId ?? null,
          }),
        })
        const json = (await res.json()) as { data?: { customer_sms_sent?: boolean }; error?: string }
        if (!res.ok) throw new Error(json.error ?? "Job create failed")
        setJobState("created")
        return true
      } catch (e) {
        setJobState("error")
        setJobError(e instanceof Error ? e.message : "Job create failed")
        return false
      }
    },
    [current, form]
  )

  const addressReady = Boolean(form.serviceAddress && isCompleteStructuredAddress(form.serviceAddress))
  const jobTypeReady = isIntakeLocksmithJobType(form.jobType)
  const canDispatch = Boolean(form.displayName.trim() && addressReady && jobTypeReady)

  return {
    form,
    patchForm,
    setVehicle,
    setVehicleKeySelection,
    setServiceAddress,
    saveState,
    jobState,
    jobError,
    createJob,
    canDispatch,
    addressReady,
  }
}
