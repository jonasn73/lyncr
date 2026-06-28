"use client"

// Client state for the answered-call intake sheet (CRM + vehicle + job dispatch).

import { useCallback, useEffect, useRef, useState } from "react"
import type { Customer } from "@/lib/types"

export type ActiveCallRow = {
  id: string
  from_number: string
  to_number: string
  caller_name: string | null
  answered_at: string | null
}

export type ActiveCallFormState = {
  displayName: string
  companyName: string
  addressLine1: string
  addressLine2: string
  city: string
  region: string
  postalCode: string
  country: string
  notes: string
  vehicleYear: string
  vehicleMake: string
  vehicleModel: string
}

const EMPTY_FORM: ActiveCallFormState = {
  displayName: "",
  companyName: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  region: "",
  postalCode: "",
  country: "US",
  notes: "",
  vehicleYear: "",
  vehicleMake: "",
  vehicleModel: "",
}

export function useActiveCallForm(current: ActiveCallRow | null) {
  const [moreOpen, setMoreOpen] = useState(false)
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [jobState, setJobState] = useState<"idle" | "creating" | "created" | "error">("idle")
  const [jobError, setJobError] = useState<string | null>(null)
  const [form, setForm] = useState<ActiveCallFormState>(EMPTY_FORM)
  const currentRef = useRef(current)
  currentRef.current = current

  const patchForm = useCallback((patch: Partial<ActiveCallFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }))
  }, [])

  const setVehicle = useCallback((vehicle: { vehicle_year: string; vehicle_make: string; vehicle_model: string }) => {
    setForm((prev) => ({
      ...prev,
      vehicleYear: vehicle.vehicle_year,
      vehicleMake: vehicle.vehicle_make,
      vehicleModel: vehicle.vehicle_model,
    }))
  }, [])

  useEffect(() => {
    if (!current) {
      setForm(EMPTY_FORM)
      setMoreOpen(false)
      setSaveState("idle")
      setJobState("idle")
      setJobError(null)
      return
    }

    setMoreOpen(false)
    setSaveState("idle")
    setJobState("idle")
    setJobError(null)
    setForm({
      ...EMPTY_FORM,
      displayName: current.caller_name?.trim() || "",
    })

    let cancel = false
    const q = encodeURIComponent(current.from_number)
    fetch(`/api/customers?phone=${q}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { customers: [] }))
      .then((data: { customers?: Customer[] }) => {
        if (cancel || currentRef.current?.id !== current.id) return
        const c = data.customers?.[0]
        if (!c) return
        setForm((prev) => ({
          ...prev,
          displayName: c.display_name || prev.displayName,
          companyName: c.company_name || "",
          addressLine1: c.address_line1 || "",
          addressLine2: c.address_line2 || "",
          city: c.city || "",
          region: c.region || "",
          postalCode: c.postal_code || "",
          country: c.country || "US",
          notes: c.notes || "",
        }))
      })
      .catch(() => {})
    return () => {
      cancel = true
    }
  }, [current])

  useEffect(() => {
    if (!current) return
    setSaveState("idle")
    const t = window.setTimeout(() => {
      setSaveState("saving")
      fetch("/api/customers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          phone_e164: current.from_number,
          display_name: form.displayName,
          company_name: form.companyName,
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
  }, [current, form])

  const createJob = useCallback(
    async (organizationId?: string | null): Promise<boolean> => {
      if (!current) return false
      setJobState("creating")
      setJobError(null)
      try {
        const res = await fetch("/api/jobs/create", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            call_log_id: current.id,
            caller_e164: current.from_number,
            customer_name: form.displayName,
            company_name: form.companyName,
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

  return {
    form,
    patchForm,
    setVehicle,
    moreOpen,
    setMoreOpen,
    saveState,
    jobState,
    jobError,
    createJob,
  }
}
