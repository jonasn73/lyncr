// Server-only: persist geocoded / structured addresses on ai_leads rows.

import { setLeadCoordinates, setLeadStructuredAddress } from "@/lib/db"
import { geocodeAddress, pickAddressFromFields, structuredAddressFromCollected } from "@/lib/geocode"

/** Background geocode + persist structured address on a lead (API routes only). */
export async function persistLeadAddressFromFields(leadId: string, fields: Record<string, unknown>): Promise<void> {
  const structured = structuredAddressFromCollected(fields)
  if (structured) {
    let lat = structured.lat
    let lng = structured.lng
    if (lat == null || lng == null) {
      const coords = await geocodeAddress(structured.formatted)
      if (coords) {
        lat = coords.lat
        lng = coords.lng
      }
    }
    await setLeadStructuredAddress(leadId, { ...structured, lat, lng })
    return
  }
  const address = pickAddressFromFields(fields)
  if (!address) return
  const coords = await geocodeAddress(address)
  if (coords) await setLeadCoordinates(leadId, coords.lat, coords.lng)
}
