// ============================================
// POST /api/tech/location  (also mounted at /api/tech/update-location)
// ============================================
// Background ping from the technician console while a tech is en route / on site:
//   1. Stores the tech's live coordinates + status.
//   2. Broadcasts the coordinates to the owner so they render live on the dispatch map.
//   3. Geofences "arrived": if the tech is within 50m of the active job's logged customer
//      coordinates, the job auto-advances to ARRIVED_ON_SITE.

import { NextRequest, NextResponse } from "next/server"
import { after } from "next/server"
import { resolveActor } from "@/lib/actor"
import {
  getActiveJobGeoForTech,
  getFieldTechnicianByPortalUserId,
  getUser,
  setJobStatusForTech,
  updateTechLocation,
} from "@/lib/db"
import { publishOwnerEvent } from "@/lib/realtime/pusher-server"
import { ARRIVAL_RADIUS_METERS, haversineMeters } from "@/lib/geo"

export const dynamic = "force-dynamic"

const ALLOWED_STATUS = new Set(["idle", "en_route", "on_site"])

export async function POST(req: NextRequest) {
  const actor = await resolveActor(req.headers.get("cookie"), { allowFieldTech: true })
  if (!actor || actor.actorRole !== "field_tech") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  // Acts as the tech, not the business — these rows are scoped to them.
  const userId = actor.actingUserId
  const user = await getUser(userId)

  const body = (await req.json().catch(() => ({}))) as {
    latitude?: number
    longitude?: number
    status?: string
  }

  const lat = Number(body.latitude)
  const lng = Number(body.longitude)
  // Reject (0,0) too — some GPS chips/emulators report it as a "successful" fix when the
  // location can't actually be determined, and it plots the tech off the coast of Africa.
  const hasCoords =
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  let status = ALLOWED_STATUS.has(String(body.status)) ? String(body.status) : "idle"

  try {
    const tech = await getFieldTechnicianByPortalUserId(userId)
    const ownerId = tech?.owner_user_id ?? null

    // Geofence auto-arrival: flip an en-route job to "arrived" when the tech reaches the address.
    let arrivedLeadId: string | null = null
    if (hasCoords && (status === "en_route" || status === "on_site")) {
      const geo = await getActiveJobGeoForTech(userId)
      if (geo && geo.job_status === "en_route") {
        const meters = haversineMeters(lat, lng, geo.customer_lat, geo.customer_lng)
        if (meters <= ARRIVAL_RADIUS_METERS) {
          const ok = await setJobStatusForTech(userId, geo.leadId, "arrived")
          if (ok) {
            arrivedLeadId = geo.leadId
            status = "on_site"
          }
        }
      }
    }

    await updateTechLocation(userId, hasCoords ? lat : null, hasCoords ? lng : null, status)

    // Broadcast live location (and any arrival) to the owner's map without blocking the response.
    if (ownerId) {
      after(async () => {
        if (hasCoords) {
          await publishOwnerEvent(ownerId, "tech-location-updated", {
            techUserId: userId,
            name: tech?.name ?? user?.name ?? "Technician",
            latitude: lat,
            longitude: lng,
            status,
            at: new Date().toISOString(),
          }).catch(() => {})
        }
        if (arrivedLeadId) {
          await publishOwnerEvent(ownerId, "job-status-updated", {
            leadId: arrivedLeadId,
            status: "arrived",
            reason: "geofence",
          }).catch(() => {})
        }
      })
    }

    return NextResponse.json({ data: { ok: true, arrived: Boolean(arrivedLeadId) } })
  } catch (e) {
    console.error("[POST /api/tech/location] failed:", e)
    return NextResponse.json({ error: "Could not update location" }, { status: 500 })
  }
}
