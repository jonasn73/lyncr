"use client"

// Browser geolocation for the answered-call intake sheet (dispatcher → job distance).

import { useEffect, useState } from "react"

export type DispatcherLocationState = {
  lat: number | null
  lng: number | null
  accuracyMeters: number | null
  status: "idle" | "requesting" | "ready" | "denied" | "unsupported"
  error: string | null
}

const EMPTY: DispatcherLocationState = {
  lat: null,
  lng: null,
  accuracyMeters: null,
  status: "idle",
  error: null,
}

/** Watch the dispatcher's GPS while the call intake sheet is open. */
export function useDispatcherLocation(enabled: boolean): DispatcherLocationState {
  const [state, setState] = useState<DispatcherLocationState>(EMPTY)

  useEffect(() => {
    if (!enabled) {
      setState(EMPTY)
      return
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState({ ...EMPTY, status: "unsupported", error: "Location not available in this browser." })
      return
    }

    setState((prev) => ({ ...prev, status: "requesting", error: null }))

    const onPosition = (pos: GeolocationPosition) => {
      setState({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracyMeters: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
        status: "ready",
        error: null,
      })
    }

    const onError = (err: GeolocationPositionError) => {
      const denied = err.code === err.PERMISSION_DENIED
      setState({
        lat: null,
        lng: null,
        accuracyMeters: null,
        status: denied ? "denied" : "unsupported",
        error: denied
          ? "Allow location access to see travel distance from you."
          : "Could not read your location.",
      })
    }

    navigator.geolocation.getCurrentPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 60_000,
      timeout: 12_000,
    })

    const watchId = navigator.geolocation.watchPosition(onPosition, () => {}, {
      enableHighAccuracy: false,
      maximumAge: 120_000,
      timeout: 20_000,
    })

    return () => navigator.geolocation.clearWatch(watchId)
  }, [enabled])

  return state
}
