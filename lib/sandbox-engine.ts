// Internal dev sandbox — seed mock locksmith workspace, simulate inbound calls, inspect intake logs.

import bcrypt from "bcryptjs"
import { certificationsData } from "@/lib/data/certifications"
import {
  createUser,
  ensureSandboxTestReceptionistAccount,
  getActivePhoneNumberByE164,
  getAuthUserByEmail,
  getOnboardingProfile,
  getPhoneNumbers,
  getUser,
  insertCallLog,
  insertPhoneNumber,
  listAiLeadsForUser,
  patchPhoneNumberPoolSettings,
  patchRoutingConfigIndustryTag,
  updateCallLog,
  updateNotificationPreferencesDb,
  updateOnboardingProfile,
  updateUser,
  upsertCertificationModule,
  getPhoneNumberLineById,
} from "@/lib/db"
import { saveCallIntake } from "@/lib/intake-engine"
import { isLyncrAdminUser } from "@/lib/lyncr-admin"
import { getAvailableReceptionistsForLine } from "@/lib/routing-pool"
import type { CertificationModuleData } from "@/lib/types"

/** Stable sandbox owner login — idempotent seed target. */
export const SANDBOX_OWNER_EMAIL = "sandbox-test-locksmith@lyncr.app"

/** Display name for the mock business workspace. */
export const SANDBOX_BUSINESS_NAME = "Test Locksmith Co."

/** Sandbox DID used for routing-pool tests (Neon-only — no Telnyx purchase). */
export const SANDBOX_BUSINESS_LINE_E164 = "+15557654321"

/** Dispatch SMS target for lead-alert E2E tests. */
export const SANDBOX_DISPATCH_SMS_E164 = "+15559876543"

/** Marker stored on onboarding_profiles.custom_routing_note. */
export const SANDBOX_PROFILE_MARKER = "lyncr-dev-sandbox:v1"

/** Automotive skill tag for routing pool matching. */
export const SANDBOX_INDUSTRY_TAG = "automotive"

/** Dev sandbox test receptionist portal login (provisioned by seed). */
export const SANDBOX_TEST_RECEPTIONIST_EMAIL = "test_receptionist@lyncr.app"

/** Stable UUID for the test receptionist user row in Neon. */
export const SANDBOX_TEST_RECEPTIONIST_USER_ID = "11111111-1111-4111-8111-111111111111"

/** Stable UUID for the linked receptionists row. */
export const SANDBOX_TEST_RECEPTIONIST_ROW_ID = "22222222-2222-4222-8222-222222222222"

/** Quiz entry point for quick-switch impersonation. */
export const SANDBOX_TEST_RECEPTIONIST_TRAINING_PATH = "/receptionist/training/automotive_core"

export type SandboxEnvironment = {
  user_id: string
  email: string
  business_name: string
  business_line_id: string | null
  business_line_e164: string | null
  sms_leads_enabled: boolean
  dispatch_sms_phone: string | null
  certification_code: string
  test_receptionist_user_id: string | null
  test_receptionist_email: string
}

export type SandboxIntakeLogRow = {
  id: string
  created_at: string
  caller_e164: string | null
  intent_slug: string | null
  intake_payload: Record<string, unknown>
  summary: string | null
  sms_sent: boolean
  sms_error: string | null
}

export type SeedSandboxDataResult =
  | {
      ok: true
      environment: SandboxEnvironment
      certification_id: string | null
      sample_intake_id: string | null
      warnings: string[]
      message: string
    }
  | { ok: false; error: string }

export type TriggerMockCallResult =
  | {
      ok: true
      call_sid: string
      business_name: string
      notified_receptionists: { id: string; name: string }[]
      message: string
    }
  | { ok: false; error: string }

function staticCertificationModule(): CertificationModuleData {
  const entry = certificationsData.find((c) => c.certification_code === "automotive_core")
  if (!entry) return { lessons: [], quiz: [] }
  return {
    description: entry.title,
    lessons: [],
    quiz: entry.questions.map((q) => ({
      id: q.id,
      question: q.question,
      options: q.options,
      correctAnswer: q.correct_answer,
    })),
  }
}

function buildEnvironmentFromParts(params: {
  userId: string
  email: string
  businessName: string
  lineId: string | null
  lineE164: string | null
  profile: Awaited<ReturnType<typeof getOnboardingProfile>>
  testReceptionistUserId: string | null
}): SandboxEnvironment {
  return {
    user_id: params.userId,
    email: params.email,
    business_name: params.businessName,
    business_line_id: params.lineId,
    business_line_e164: params.lineE164,
    sms_leads_enabled: params.profile?.sms_leads_enabled ?? false,
    dispatch_sms_phone: params.profile?.dispatch_sms_phone ?? null,
    certification_code: "automotive_core",
    test_receptionist_user_id: params.testReceptionistUserId,
    test_receptionist_email: SANDBOX_TEST_RECEPTIONIST_EMAIL,
  }
}

async function resolveTestReceptionistUserId(): Promise<string | null> {
  const auth = await getAuthUserByEmail(SANDBOX_TEST_RECEPTIONIST_EMAIL)
  return auth?.id ?? null
}

/** Provision test_receptionist@lyncr.app linked to the sandbox owner (empty skills — quiz-first). */
export async function provisionSandboxTestReceptionist(ownerUserId: string): Promise<{
  portal_user_id: string
  receptionist_id: string
  created: boolean
}> {
  const password_hash = await bcrypt.hash("SandboxDev123!", 10)
  const result = await ensureSandboxTestReceptionistAccount({
    owner_user_id: ownerUserId,
    email: SANDBOX_TEST_RECEPTIONIST_EMAIL,
    name: "Test Receptionist",
    phone: "+15552223333",
    password_hash,
  })
  return {
    portal_user_id: result.portal_user_id,
    receptionist_id: result.receptionist_id,
    created: result.created_user || result.created_receptionist,
  }
}

/** Load current sandbox workspace snapshot (null when never seeded). Never throws. */
export async function getSandboxEnvironment(): Promise<SandboxEnvironment | null> {
  try {
    const auth = await getAuthUserByEmail(SANDBOX_OWNER_EMAIL)
    if (!auth) return null

    const [profile, numbers, testReceptionistUserId] = await Promise.all([
      getOnboardingProfile(auth.id),
      getPhoneNumbers(auth.id),
      resolveTestReceptionistUserId(),
    ])

    const line = numbers.find((n) => n.status === "active") ?? null

    return buildEnvironmentFromParts({
      userId: auth.id,
      email: auth.email,
      businessName: auth.business_name,
      lineId: line?.id ?? null,
      lineE164: line?.number ?? null,
      profile,
      testReceptionistUserId,
    })
  } catch (e) {
    console.error("[sandbox-engine] getSandboxEnvironment:", e)
    return null
  }
}

/** Resolve provisioned test receptionist portal user id (null before seed). */
export async function getSandboxTestReceptionistUserId(): Promise<string | null> {
  try {
    return await resolveTestReceptionistUserId()
  } catch {
    return null
  }
}

export type ResolveSandboxTestReceptionistResult =
  | { ok: true; target_user_id: string; target_email: string }
  | { ok: false; error: string }

/** Ensure test_receptionist@lyncr.app exists (auto-seeds sandbox when missing). */
export async function resolveSandboxTestReceptionistForSwitch(): Promise<ResolveSandboxTestReceptionistResult> {
  let target = await getAuthUserByEmail(SANDBOX_TEST_RECEPTIONIST_EMAIL)
  if (target) {
    if (isLyncrAdminUser(target)) {
      return { ok: false, error: "Test receptionist account is misconfigured as an operator login." }
    }
    return { ok: true, target_user_id: target.id, target_email: target.email }
  }

  let owner = await getAuthUserByEmail(SANDBOX_OWNER_EMAIL)
  if (!owner) {
    const seeded = await seedSandboxData()
    if (!seeded.ok) return seeded
    owner = await getAuthUserByEmail(SANDBOX_OWNER_EMAIL)
    target = await getAuthUserByEmail(SANDBOX_TEST_RECEPTIONIST_EMAIL)
    if (target) {
      return { ok: true, target_user_id: target.id, target_email: target.email }
    }
  }

  if (!owner) {
    return { ok: false, error: "Sandbox owner missing — click Seed sandbox data first." }
  }

  try {
    await provisionSandboxTestReceptionist(owner.id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not provision test receptionist"
    return { ok: false, error: msg }
  }

  target = await getAuthUserByEmail(SANDBOX_TEST_RECEPTIONIST_EMAIL)
  if (!target) {
    return {
      ok: false,
      error: "Test receptionist login could not be created. Check Neon logs and run scripts/MIGRATE-ALL.md migrations 040+.",
    }
  }
  if (isLyncrAdminUser(target)) {
    return { ok: false, error: "Test receptionist account is misconfigured as an operator login." }
  }
  return { ok: true, target_user_id: target.id, target_email: target.email }
}

export async function listSandboxIntakeLogs(limit = 25): Promise<SandboxIntakeLogRow[]> {
  try {
    const env = await getSandboxEnvironment()
    if (!env) return []

    const rows = await listAiLeadsForUser(env.user_id, limit)
    return rows.map((row) => ({
      id: row.id,
      created_at: row.created_at,
      caller_e164: row.caller_e164,
      intent_slug: row.intent_slug,
      intake_payload: row.collected,
      summary: row.summary,
      sms_sent: row.sms_sent,
      sms_error: row.sms_error,
    }))
  } catch (e) {
    console.error("[sandbox-engine] listSandboxIntakeLogs:", e)
    return []
  }
}

/**
 * Create or refresh the mock locksmith company, SMS dispatch settings, business line,
 * automotive_core certification, and a sample intake lead.
 */
export async function seedSandboxData(): Promise<SeedSandboxDataResult> {
  const warnings: string[] = []

  try {
    let owner = await getAuthUserByEmail(SANDBOX_OWNER_EMAIL)
    if (!owner) {
      const password_hash = await bcrypt.hash("SandboxDev123!", 10)
      const created = await createUser({
        email: SANDBOX_OWNER_EMAIL,
        name: "Sandbox Owner",
        phone: "+15551112222",
        business_name: SANDBOX_BUSINESS_NAME,
        industry: "locksmith",
        password_hash,
        account_role: "owner",
      })
      owner = { ...created, password_hash }
    } else {
      await updateUser(owner.id, {
        business_name: SANDBOX_BUSINESS_NAME,
        industry: "locksmith",
      })
    }

    await updateOnboardingProfile(owner.id, {
      has_active_subscription: true,
      reserved_number: SANDBOX_BUSINESS_LINE_E164,
      reserved_number_display: "(555) 765-4321",
      reserved_number_method: "buy",
      trade_category: "locksmith",
      custom_routing_note: SANDBOX_PROFILE_MARKER,
      account_status: "active",
    })

    try {
      await updateNotificationPreferencesDb({
        userId: owner.id,
        sms_leads_enabled: true,
        dispatch_sms_phone: SANDBOX_DISPATCH_SMS_E164,
        notification_phone: SANDBOX_DISPATCH_SMS_E164,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : "SMS preferences could not be saved"
      warnings.push(msg)
    }

    try {
      await patchRoutingConfigIndustryTag(owner.id, SANDBOX_INDUSTRY_TAG)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not set routing industry tag"
      warnings.push(`Routing tag skipped: ${msg}`)
    }

    try {
      const receptionist = await provisionSandboxTestReceptionist(owner.id)
      if (receptionist.created) {
        warnings.push(`Provisioned test receptionist (${SANDBOX_TEST_RECEPTIONIST_EMAIL}).`)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not provision test receptionist"
      warnings.push(`Test receptionist skipped: ${msg}`)
    }

    let line =
      (await getPhoneNumbers(owner.id)).find(
        (n) => n.number === SANDBOX_BUSINESS_LINE_E164 && n.status === "active"
      ) ?? null

    if (!line) {
      const existingGlobal = await getActivePhoneNumberByE164(SANDBOX_BUSINESS_LINE_E164)
      if (existingGlobal && existingGlobal.user_id !== owner.id) {
        return {
          ok: false,
          error: `Sandbox line ${SANDBOX_BUSINESS_LINE_E164} is already assigned to another account.`,
        }
      }
      if (existingGlobal && existingGlobal.user_id === owner.id) {
        line = existingGlobal
      } else {
        line = await insertPhoneNumber({
          user_id: owner.id,
          number: SANDBOX_BUSINESS_LINE_E164,
          friendly_name: "Sandbox Locksmith Line",
          label: "Dev Sandbox",
          type: "local",
          status: "active",
        })
      }
    }

    const poolPatched = await patchPhoneNumberPoolSettings(line.id, owner.id, {
      industry_tag: SANDBOX_INDUSTRY_TAG,
      routing_pool_mode: "simultaneous",
    })
    if (!poolPatched) {
      warnings.push("Run scripts/042-skill-routing-pool.sql in Neon to enable routing-pool tags on phone_numbers.")
    }

    const cert = await upsertCertificationModule({
      code_identifier: "automotive_core",
      name: "Automotive & Locksmithing Intake Certification",
      module_data: staticCertificationModule(),
    })
    if (!cert) {
      warnings.push("Run scripts/043-certifications-training.sql in Neon to seed automotive_core in the certifications table.")
    }

    let sampleIntakeId: string | null = null
    try {
      const intake = await saveCallIntake({
        user_id: owner.id,
        caller_e164: "+15551230001",
        intent_slug: "automotive_akl",
        collected: {
          year: "2021",
          make: "BMW",
          model: "X5",
          akl: true,
          key_type: "proximity_fobik",
          glovebox_code: "M607",
          source: "sandbox_seed",
        },
        summary: "Sandbox seed — AKL proximity key, glovebox code M607 noted.",
        vapi_call_id: `sandbox-seed-${Date.now()}`,
      })
      sampleIntakeId = intake.id
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Sample intake could not be saved"
      warnings.push(`Sample intake skipped: ${msg}`)
    }

    const profile = await getOnboardingProfile(owner.id)
    const testReceptionistUserId = await resolveTestReceptionistUserId()
    const environment = buildEnvironmentFromParts({
      userId: owner.id,
      email: owner.email,
      businessName: SANDBOX_BUSINESS_NAME,
      lineId: line.id,
      lineE164: line.number,
      profile,
      testReceptionistUserId,
    })

    const warningSuffix = warnings.length ? ` Notes: ${warnings.join(" ")}` : ""

    return {
      ok: true,
      environment,
      certification_id: cert?.id ?? null,
      sample_intake_id: sampleIntakeId,
      warnings,
      message: `Sandbox workspace ready — Test Locksmith Co. line, SMS dispatch, and sample intake seeded.${warningSuffix}`,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sandbox seed failed"
    console.error("[sandbox-engine] seedSandboxData:", e)
    return { ok: false, error: msg }
  }
}

/**
 * Simulate an inbound routing event for online receptionists on the given business line.
 * Writes in-progress call_logs so the receptionist portal HUD shows an active call.
 */
export async function triggerMockCall(businessLineId: string): Promise<TriggerMockCallResult> {
  try {
    const lineId = businessLineId.trim()
    if (!lineId) return { ok: false, error: "businessLineId is required" }

    const line = await getPhoneNumberLineById(lineId)
    if (!line) return { ok: false, error: "Active business line not found" }

    const owner = await getUser(line.user_id)
    const businessName = owner?.business_name?.trim() || SANDBOX_BUSINESS_NAME

    const match = await getAvailableReceptionistsForLine(lineId)
    if (!match || match.receptionists.length === 0) {
      return {
        ok: false,
        error:
          "No online receptionists matched this line. Open /receptionist, toggle Online, and certify automotive_core first.",
      }
    }

    const callSid = `sandbox-mock-${crypto.randomUUID()}`
    const callerNumber = "+15551234567"
    const callerName = "Sandbox Caller"
    const nowIso = new Date().toISOString()

    const notified: { id: string; name: string }[] = []

    for (const receptionist of match.receptionists) {
      const sid = match.receptionists.length === 1 ? callSid : `${callSid}-${receptionist.id.slice(0, 8)}`

      await insertCallLog({
        user_id: line.user_id,
        provider_call_sid: sid,
        from_number: callerNumber,
        to_number: line.number,
        caller_name: callerName,
        call_type: "incoming",
        status: "in-progress",
        duration_seconds: 0,
        routed_to_receptionist_id: receptionist.id,
        routed_to_name: receptionist.name,
        has_recording: false,
        recording_url: null,
        recording_duration_seconds: null,
      })

      await updateCallLog(sid, {
        status: "in-progress",
        answered_at: nowIso,
        routed_to_name: `${receptionist.name} · ${businessName}`,
      })

      notified.push({ id: receptionist.id, name: receptionist.name })
    }

    return {
      ok: true,
      call_sid: callSid,
      business_name: businessName,
      notified_receptionists: notified,
      message: `Simulated inbound call to ${notified.length} online receptionist(s) for ${businessName}.`,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Mock call failed"
    console.error("[sandbox-engine] triggerMockCall:", e)
    return { ok: false, error: msg }
  }
}
