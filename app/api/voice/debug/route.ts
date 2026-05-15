// ============================================
// GET /api/voice/debug?number=+15025199741
// ============================================
// Comprehensive debug endpoint showing the full call routing chain:
// Telnyx TeXML app config, outbound voice profile, number voice settings,
// DB user lookup, routing config, and the exact TeXML that would be returned.

import { NextRequest, NextResponse } from "next/server"
import { VoiceResponse, getAppUrl } from "@/lib/telnyx"
import {
  getUserByPhoneNumber,
  getRoutingConfigForNumber,
  getReceptionist,
  getPhoneNumbers,
} from "@/lib/db"
import { getUserIdFromRequest } from "@/lib/auth"
import { telnyxHeaders, TEXML_ROUTER_NAMES } from "@/lib/telnyx-config"

const TELNYX_BASE = "https://api.telnyx.com/v2"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  const url = new URL(req.url)
  const number = url.searchParams.get("number") || "+15025199741"
  const appUrl = getAppUrl()

  const debug: Record<string, unknown> = { number, appUrl }

  // 1. Check TeXML app
  try {
    const listRes = await fetch(`${TELNYX_BASE}/texml_applications?page[size]=50`, {
      headers: telnyxHeaders(),
    })
    const listBody = await listRes.json()
    const apps = listBody?.data || []
    const texmlRouterApp = apps.find((a: Record<string, string>) =>
      (TEXML_ROUTER_NAMES as readonly string[]).includes(a.friendly_name)
    )
    if (texmlRouterApp) {
      debug.texml_app = {
        id: texmlRouterApp.id,
        friendly_name: texmlRouterApp.friendly_name,
        voice_url: texmlRouterApp.voice_url,
        outbound: texmlRouterApp.outbound,
        active: texmlRouterApp.active,
      }

      // Auto-fix: if outbound voice profile is missing, assign the Default one
      if (!texmlRouterApp.outbound?.outbound_voice_profile_id) {
        // Find an existing profile
        const profilesRes = await fetch(`${TELNYX_BASE}/outbound_voice_profiles?page[size]=10`, {
          headers: telnyxHeaders(),
        })
        const profilesBody = await profilesRes.json()
        const profileId = profilesBody?.data?.[0]?.id
        if (profileId) {
          const patchRes = await fetch(`${TELNYX_BASE}/texml_applications/${texmlRouterApp.id}`, {
            method: "PATCH",
            headers: telnyxHeaders(),
            body: JSON.stringify({
              outbound: { outbound_voice_profile_id: String(profileId) },
            }),
          })
          const patchBody = await patchRes.json()
          debug.outbound_fix = {
            attempted: true,
            profile_id: String(profileId),
            patch_status: patchRes.status,
            patch_ok: patchRes.ok,
            response_outbound: patchBody?.data?.outbound,
            errors: patchBody?.errors,
          }
        }
      }
    } else {
      debug.texml_app = "NOT FOUND"
    }
  } catch (e) {
    debug.texml_app_error = String(e)
  }

  // 2. Check outbound voice profiles
  try {
    const profilesRes = await fetch(`${TELNYX_BASE}/outbound_voice_profiles?page[size]=10`, {
      headers: telnyxHeaders(),
    })
    const profilesBody = await profilesRes.json()
    debug.outbound_voice_profiles = (profilesBody?.data || []).map((p: Record<string, unknown>) => ({
      id: p.id,
      name: p.name,
      enabled: p.enabled,
      whitelisted_destinations: p.whitelisted_destinations,
      traffic_type: p.traffic_type,
      concurrent_call_limit: p.concurrent_call_limit,
      daily_spend_limit: p.daily_spend_limit,
    }))
  } catch (e) {
    debug.outbound_profiles_error = String(e)
  }

  // 3. Check the phone number's Telnyx config
  try {
    const numRes = await fetch(
      `${TELNYX_BASE}/phone_numbers?filter[phone_number]=${encodeURIComponent(number)}&page[size]=1`,
      { headers: telnyxHeaders() }
    )
    const numBody = await numRes.json()
    const numRecord = numBody?.data?.[0]
    if (numRecord) {
      debug.telnyx_number = {
        id: numRecord.id,
        phone_number: numRecord.phone_number,
        status: numRecord.status,
        connection_id: numRecord.connection_id,
        connection_name: numRecord.connection_name,
      }

      // Also check voice config
      const voiceRes = await fetch(`${TELNYX_BASE}/phone_numbers/${numRecord.id}/voice`, {
        headers: telnyxHeaders(),
      })
      if (voiceRes.ok) {
        const voiceBody = await voiceRes.json()
        debug.telnyx_number_voice = voiceBody?.data
          ? {
              connection_id: voiceBody.data.connection_id,
              connection_name: voiceBody.data.connection_name,
              tech_prefix_enabled: voiceBody.data.tech_prefix_enabled,
              translated_number: voiceBody.data.translated_number,
              call_forwarding: voiceBody.data.call_forwarding,
            }
          : voiceBody
      } else {
        debug.telnyx_number_voice_error = `HTTP ${voiceRes.status}`
      }
    } else {
      debug.telnyx_number = "NOT FOUND in Telnyx"
    }
  } catch (e) {
    debug.telnyx_number_error = String(e)
  }

  // 4. DB user lookup
  try {
    const user = await getUserByPhoneNumber(number)
    debug.db_user = user ? { id: user.id, name: user.name, phone: user.phone } : "NOT FOUND"

    if (user) {
      const config = await getRoutingConfigForNumber(user.id, number)
      debug.routing_config = config
        ? {
            selected_receptionist_id: config.selected_receptionist_id,
            fallback_type: config.fallback_type,
            ring_timeout_seconds: config.ring_timeout_seconds,
            business_number: config.business_number,
          }
        : "NO CONFIG"

      if (config?.selected_receptionist_id) {
        const rec = await getReceptionist(config.selected_receptionist_id)
        debug.receptionist = rec ? { id: rec.id, name: rec.name, phone: rec.phone } : "NOT FOUND"
      }

      // Build the exact TeXML
      const texml = new VoiceResponse()
      const targetPhone = config?.selected_receptionist_id
        ? (await getReceptionist(config.selected_receptionist_id))?.phone || user.phone
        : user.phone
      const dial = texml.dial({
        callerId: number,
        timeout: config?.ring_timeout_seconds || 30,
      })
      dial.number(targetPhone)
      debug.texml_response = texml.toString()
    }
  } catch (e) {
    debug.db_error = String(e)
  }

  // 5. Logged-in user's numbers
  if (userId) {
    try {
      const nums = await getPhoneNumbers(userId)
      debug.user_numbers = nums.map((n) => ({ number: n.number, status: n.status }))
    } catch (e) {
      debug.user_numbers_error = String(e)
    }
  }

  return NextResponse.json(debug, { status: 200 })
}
