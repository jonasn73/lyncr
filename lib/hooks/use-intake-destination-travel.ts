"use client"

// Distance / ETA / nearest-tech for an active intake map destination.

import { useMemo } from "react"
import { calculateTechETA } from "@/lib/dispatch-eta"
import type { FocusDispatchMapDetail } from "@/lib/dispatch-map-focus"
import { estimateTravelMinutes, travelDistanceMiles } from "@/lib/geo"
import { DEFAULT_502_SERVICE_BIAS } from "@/lib/geocode-service-bias"
import { useDispatcherLocation } from "@/lib/hooks/use-dispatcher-location"
import { useDispatchMapData } from "@/lib/hooks/use-dispatch-map-data"
import type {
  IntakeNearestTech,
  IntakeTravelMetrics,
} from "@/components/dashboard/intake-map-destination-banner"

export function useIntakeDestinationTravel(
  destination: FocusDispatchMapDetail | null,
  organizationId: string | null | undefined
): {
  travelMetrics: IntakeTravelMetrics | null
  nearestTech: IntakeNearestTech | null
} {
  const dispatcherLocation = useDispatcherLocation(Boolean(destination))
  const { data: mapData } = useDispatchMapData(organizationId)
  const techs = mapData?.techs ?? []

  const originPoint = useMemo(() => {
    if (
      dispatcherLocation.status === "ready" &&
      dispatcherLocation.lat != null &&
      dispatcherLocation.lng != null
    ) {
      return {
        lat: dispatcherLocation.lat,
        lng: dispatcherLocation.lng,
        source: "gps" as const,
      }
    }
    return {
      lat: DEFAULT_502_SERVICE_BIAS.lat,
      lng: DEFAULT_502_SERVICE_BIAS.lon,
      source: "business" as const,
    }
  }, [dispatcherLocation.lat, dispatcherLocation.lng, dispatcherLocation.status])

  const travelMetrics = useMemo(() => {
    if (!destination) return null
    const miles = travelDistanceMiles(originPoint, {
      lat: destination.lat,
      lng: destination.lng,
    })
    if (!Number.isFinite(miles) || miles < 0) return null
    return {
      miles,
      durationMins: estimateTravelMinutes(miles),
      fromGps: originPoint.source === "gps",
    }
  }, [destination, originPoint])

  const nearestTech = useMemo(() => {
    if (!destination || techs.length === 0) return null
    let best: IntakeNearestTech | null = null
    for (const tech of techs) {
      const eta = calculateTechETA(
        { lat: destination.lat, lng: destination.lng },
        { lat: tech.latitude, lng: tech.longitude }
      )
      if (!eta) continue
      if (!best || eta.straightLineMiles < best.miles) {
        best = { name: tech.name || "Technician", miles: eta.straightLineMiles }
      }
    }
    return best
  }, [destination, techs])

  return { travelMetrics, nearestTech }
}
