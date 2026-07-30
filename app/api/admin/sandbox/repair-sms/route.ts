// POST /api/admin/sandbox/repair-sms — assign Telnyx messaging profile + send test alert.

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import {
  getAuthUserByEmail,
  getProviderLinkedActiveNumber,
  updateNotificationPreferencesDb,
} from "@/lib/db"
import {
  resolveSandboxDispatchSmsE164,
  SANDBOX_OWNER_EMAIL,
} from "@/lib/sandbox-engine"
import { sendTelnyxSms } from "@/lib/telnyx-sms"
import {
  ensureProviderNumbersMessagingReady,
  getOrCreateMessagingProfile,
  getTelnyx10DlcAssignmentStatus,
} from "@/lib/telnyx-messaging-config"

export async function POST(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  try {
    const owner = await getAuthUserByEmail(SANDBOX_OWNER_EMAIL)
    if (!owner) {
      return NextResponse.json({ error: "Sandbox owner missing — seed sandbox data first" }, { status: 400 })
    }

    const [profileId, smsFrom, dispatchTo] = await Promise.all([
      getOrCreateMessagingProfile(),
      getProviderLinkedActiveNumber(owner.id).then(
        async (from) => from ?? getProviderLinkedActiveNumber()
      ),
      resolveSandboxDispatchSmsE164(),
    ])

    const setupWarnings = smsFrom
      ? await ensureProviderNumbersMessagingReady([smsFrom])
      : ["No purchased Telnyx line found in Neon"]

    await updateNotificationPreferencesDb({
      userId: owner.id,
      sms_leads_enabled: true,
      sms_latest_enabled: true,
      dispatch_sms_phone: dispatchTo,
      notification_phone: dispatchTo,
    })

    const test = await sendTelnyxSms({
      toE164: dispatchTo,
      text: "Lyncr sandbox SMS test — lead alerts are configured.",
      userId: owner.id,
      fromE164: smsFrom ?? undefined,
    })

    const dlcStatus = smsFrom ? await getTelnyx10DlcAssignmentStatus(smsFrom) : null

    return NextResponse.json({
      data: {
        messaging_profile_id: profileId,
        sms_from: smsFrom,
        dispatch_to: dispatchTo,
        setup_warnings: setupWarnings,
        test_sent: test.ok,
        test_error: test.ok ? null : test.error,
        telnyx_message_id: test.ok ? test.message_id : null,
        delivery_warning: test.ok ? test.delivery_warning : null,
        ten_dlc_assigned: dlcStatus?.assigned ?? null,
        ten_dlc_detail: dlcStatus?.detail ?? null,
      },
    })
  } catch (e) {
    console.error("[lyncr-admin] sandbox repair-sms:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "SMS repair failed" },
      { status: 500 }
    )
  }
}
