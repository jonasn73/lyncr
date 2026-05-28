"use server"

// Admin-only server actions for the internal dev sandbox board.

import { AdminAuthError, requireLyncrAdminSession } from "@/lib/admin-server-auth"
import {
  getSandboxEnvironment,
  listSandboxIntakeLogs,
  seedSandboxData,
  triggerMockCall,
  type SandboxEnvironment,
  type SandboxIntakeLogRow,
  type SeedSandboxDataResult,
  type TriggerMockCallResult,
} from "@/lib/sandbox-engine"

export type {
  SandboxEnvironment,
  SandboxIntakeLogRow,
  SeedSandboxDataResult,
  TriggerMockCallResult,
}

async function guardAdmin(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireLyncrAdminSession()
    return { ok: true }
  } catch (e) {
    if (e instanceof AdminAuthError) return { ok: false, error: e.message }
    const msg = e instanceof Error ? e.message : "Forbidden"
    return { ok: false, error: msg }
  }
}

/** Operator-only: seed Test Locksmith Co. workspace + automotive_core certification. */
export async function runSeedSandboxData(): Promise<SeedSandboxDataResult> {
  try {
    const auth = await guardAdmin()
    if (!auth.ok) return auth
    return await seedSandboxData()
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sandbox seed failed unexpectedly"
    console.error("[sandbox-engine action] runSeedSandboxData:", e)
    return { ok: false, error: msg }
  }
}

/** Operator-only: fire a simulated inbound call to online receptionists on a business line. */
export async function runTriggerMockCall(businessLineId: string): Promise<TriggerMockCallResult> {
  try {
    const auth = await guardAdmin()
    if (!auth.ok) return auth
    return await triggerMockCall(businessLineId)
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Mock call failed unexpectedly"
    console.error("[sandbox-engine action] runTriggerMockCall:", e)
    return { ok: false, error: msg }
  }
}

/** Operator-only: load sandbox workspace snapshot for the admin board. */
export async function fetchSandboxEnvironment(): Promise<SandboxEnvironment | null> {
  const auth = await guardAdmin()
  if (!auth.ok) return null
  return getSandboxEnvironment()
}

/** Operator-only: latest intake_payload rows for debugging dispatch. */
export async function fetchSandboxIntakeLogs(limit = 25): Promise<SandboxIntakeLogRow[]> {
  const auth = await guardAdmin()
  if (!auth.ok) return []
  return listSandboxIntakeLogs(limit)
}
