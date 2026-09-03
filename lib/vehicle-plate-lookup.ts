// License plate → YMM + hidden VIN/trim payload. Uses mock data locally; optional real API via env.

import { decodeVin } from "@/lib/nhtsa-vpic"
import type { VehicleFactoryOption } from "@/lib/vehicle-trim-features"

export type PlateLookupResult = {
  plate: string
  state: string
  vin: string | null
  vehicle_year: string | null
  vehicle_make: string | null
  vehicle_model: string | null
  trim: string | null
  factory_options: VehicleFactoryOption[] | null
  source: "mock" | "api" | "vin_decode"
  error?: string | null
}

function normalizePlate(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
}

function normalizeState(raw: string): string {
  return raw.trim().toUpperCase().slice(0, 2)
}

function mockKey(state: string, plate: string): string {
  return `${state}_${plate}`
}

/** Demo registrations for intake testing without a paid DMV API. */
const MOCK_PLATE_REGISTRY: Record<
  string,
  Omit<PlateLookupResult, "plate" | "state" | "source" | "error">
> = {
  KY_ABC2020: {
    vin: "3GKALTEV5LL123456",
    vehicle_year: "2020",
    vehicle_make: "GMC",
    vehicle_model: "Terrain",
    trim: "SLT",
    factory_options: ["remote_start", "power_liftgate"],
  },
  TN_HOND18: {
    vin: "2HGFC2F59JH501234",
    vehicle_year: "2018",
    vehicle_make: "Honda",
    vehicle_model: "Civic",
    trim: "EX-L",
    factory_options: ["proximity_entry", "push_button_start"],
  },
  TX_EQN19: {
    vin: "2GNAXUEV4K6123456",
    vehicle_year: "2019",
    vehicle_make: "Chevrolet",
    vehicle_model: "Equinox",
    trim: "Premier",
    factory_options: ["remote_start", "power_liftgate"],
  },
}

function resultFromMock(state: string, plate: string): PlateLookupResult | null {
  const row = MOCK_PLATE_REGISTRY[mockKey(state, plate)]
  if (!row) return null
  return {
    plate,
    state,
    source: "mock",
    error: null,
    ...row,
  }
}

async function lookupViaExternalApi(state: string, plate: string): Promise<PlateLookupResult | null> {
  const baseUrl = process.env.VEHICLE_PLATE_API_URL?.trim()
  if (!baseUrl) return null

  const apiKey = process.env.VEHICLE_PLATE_API_KEY?.trim()
  const url = new URL(baseUrl)
  url.searchParams.set("state", state)
  url.searchParams.set("plate", plate)

  const res = await fetch(url.toString(), {
    cache: "no-store",
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
  })
  if (!res.ok) return null

  const json = (await res.json()) as {
    vin?: string
    year?: string | number
    make?: string
    model?: string
    trim?: string
    factory_options?: string[]
  }

  const vin = json.vin?.trim() || null
  let vehicle_year = json.year != null ? String(json.year).trim() : null
  let vehicle_make = json.make?.trim() || null
  let vehicle_model = json.model?.trim() || null
  let trim = json.trim?.trim() || null
  let factory_options =
    Array.isArray(json.factory_options) && json.factory_options.length > 0
      ? (json.factory_options as VehicleFactoryOption[])
      : null

  if (vin && (!vehicle_year || !vehicle_make || !vehicle_model)) {
    const decoded = await decodeVin(vin)
    vehicle_year = vehicle_year || decoded.vehicle_year
    vehicle_make = vehicle_make || decoded.vehicle_make
    vehicle_model = vehicle_model || decoded.vehicle_model
  }

  if (!vehicle_year && !vehicle_make && !vehicle_model && !vin) return null

  return {
    plate,
    state,
    vin,
    vehicle_year,
    vehicle_make,
    vehicle_model,
    trim,
    factory_options,
    source: vin && !vehicle_year ? "vin_decode" : "api",
    error: null,
  }
}

/** Resolve a US plate to YMM + optional VIN/trim/factory options. */
export async function lookupVehicleByPlate(plateRaw: string, stateRaw: string): Promise<PlateLookupResult> {
  const plate = normalizePlate(plateRaw)
  const state = normalizeState(stateRaw)

  if (!plate || plate.length < 2) {
    return {
      plate,
      state,
      vin: null,
      vehicle_year: null,
      vehicle_make: null,
      vehicle_model: null,
      trim: null,
      factory_options: null,
      source: "mock",
      error: "Enter a valid license plate.",
    }
  }
  if (!state || state.length !== 2) {
    return {
      plate,
      state,
      vin: null,
      vehicle_year: null,
      vehicle_make: null,
      vehicle_model: null,
      trim: null,
      factory_options: null,
      source: "mock",
      error: "Select the plate state.",
    }
  }

  try {
    const external = await lookupViaExternalApi(state, plate)
    if (external) return external

    const mock = resultFromMock(state, plate)
    if (mock) return mock

    return {
      plate,
      state,
      vin: null,
      vehicle_year: null,
      vehicle_make: null,
      vehicle_model: null,
      trim: null,
      factory_options: null,
      source: "mock",
      error:
        "No registration match for this plate. Enter year/make/model manually, or try demo plates KY·ABC2020, TN·HOND18, TX·EQN19.",
    }
  } catch (e) {
    return {
      plate,
      state,
      vin: null,
      vehicle_year: null,
      vehicle_make: null,
      vehicle_model: null,
      trim: null,
      factory_options: null,
      source: "mock",
      error: e instanceof Error ? e.message : "Plate lookup failed.",
    }
  }
}
