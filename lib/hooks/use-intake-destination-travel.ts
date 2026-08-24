"use client"

// Distance / ETA / nearest-tech for an active intake map destination.

import { useMemo } from "react"
import { calculateTechETA } from "@/lib/dispatch-eta"
import type { FocusDispatchMapDetail } from "@/lib/dispatch-map-focus"
import { estimateTravelMinutes, travelDistanceMiles } from "@/lib/geo"
import { DEFAULT_502_SERVICE_BIAS } from "@/lib/geocode-service-bias"
import { useDispatcherLocation } from "@/lib/hooks/use-dispatcher-location"
import { useDispatchMapData } from "@/lib/hooks/use-dispatch-map-data"
import { useShopOrigin } from "@/lib/hooks/use-shop-origin"
import type {
  IntakeNearestTech,
  IntakeTravelMetrics,
} from "@/components/dashboard/intake-map-destination-banner"

export function useIntakeDestinationTravel(
  destination: FocusDispatchMapDetail | null,
  organizationId: string | null | undefined,
  options?: { enabled?: boolean }
): {
  travelMetrics: IntakeTravelMetrics | null
  nearestTech: IntakeNearestTech | null
} {
  const enabled = options?.enabled !== false
  const dispatcherLocation = useDispatcherLocation(Boolean(destination) && enabled)
  // Reuse active-dispatch feed only (no lead pins) for nearest-tech math.
  const { data: mapData } = useDispatchMapData(organizationId, {
    enabled: enabled && Boolean(destination),
    includeLeads: false,
  })
  const techs = mapData?.techs ?? []

  const shopOrigin = useShopOrigin()

  // Live GPS → saved shop address → metro centroid. Only the middle one is a real
  // measurement from the shop, so the source rides along for the banner to label.
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
    if (shopOrigin) {
      return { lat: shopOrigin.lat, lng: shopOrigin.lng, source: "shop" as const }
    }
    return {
      lat: DEFAULT_502_SERVICE_BIAS.lat,
      lng: DEFAULT_502_SERVICE_BIAS.lon,
      source: "metro" as const,
    }
  }, [dispatcherLocation.lat, dispatcherLocation.lng, dispatcherLocation.status, shopOrigin])

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
      originSource: originPoint.source,
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
