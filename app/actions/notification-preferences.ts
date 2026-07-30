"use server"

// Owner notification preferences for instant SMS lead alerts + Latest attention SMS.

import { revalidatePath } from "next/cache"
import {
  getOnboardingProfile,
  getUser,
  normalizePhoneNumberE164,
  updateNotificationPreferencesDb,
  isReasonablePstnDialString,
} from "@/lib/db"
import { resolveLeadAlertSmsRecipient } from "@/lib/lead-sms-recipient"
import { getSessionUser } from "@/lib/server-session-user"

export type UpdateNotificationPreferencesResult =
  | {
      ok: true
      sms_leads_enabled: boolean
      sms_latest_enabled: boolean
      dispatch_sms_phone: string | null
    }
  | { ok: false; error: string }

/**
 * Save SMS alert settings for the signed-in business account.
 * `companyId` is the account user id (onboarding_profiles.user_id).
 * `phone` maps to onboarding_profiles.dispatch_sms_phone.
 */
export async function updateNotificationPreferences(
  companyId: string,
  enabled: boolean,
  phone: string,
  latestEnabled = false
): Promise<UpdateNotificationPreferencesResult> {
  // Must be signed in as the same account we are editing.
  const sessionUser = await getSessionUser()
  if (!sessionUser) return { ok: false, error: "Not signed in" }

  const targetId = companyId.trim()
  if (!targetId || targetId !== sessionUser.id) {
    return { ok: false, error: "Unauthorized" }
  }

  const trimmedPhone = phone.trim()
  let dispatch_sms_phone: string | null = null

  // Optional dedicated dispatch number — blank falls back to profile phone.
  if (trimmedPhone) {
    const e164 = normalizePhoneNumberE164(trimmedPhone)
    if (!isReasonablePstnDialString(e164)) {
      return { ok: false, error: "Enter a valid US mobile number" }
    }
    dispatch_sms_phone = e164
  }

  // Either alert type requires a reachable owner phone.
  if (enabled || latestEnabled) {
    const [profile, user] = await Promise.all([
      getOnboardingProfile(sessionUser.id),
      getUser(sessionUser.id),
    ])
    const resolved = resolveLeadAlertSmsRecipient(
      {
        dispatch_sms_phone,
        notification_phone: profile?.notification_phone ?? null,
      },
      user
    )
    if (!resolved) {
      return {
        ok: false,
        error:
          "Add a dedicated dispatch number or set your primary profile phone before enabling SMS alerts",
      }
    }
  }

  try {
    const profile = await updateNotificationPreferencesDb({
      userId: sessionUser.id,
      sms_leads_enabled: enabled,
      sms_latest_enabled: latestEnabled,
      dispatch_sms_phone,
    })
    revalidatePath("/dashboard/settings")
    return {
      ok: true,
      sms_leads_enabled: profile.sms_leads_enabled,
      sms_latest_enabled: profile.sms_latest_enabled,
      dispatch_sms_phone: profile.dispatch_sms_phone,
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not save notification settings"
    return { ok: false, error: message }
  }
}
