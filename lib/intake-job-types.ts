// Locksmith job types for the answered-call intake sheet (maps to ai_leads.job_type).

export const INTAKE_LOCKSMITH_JOB_TYPES = [
  "Key replacement",
  "Copy",
  "Lockout",
  "Ignition",
  "Something else",
] as const

export type IntakeLocksmithJobType = (typeof INTAKE_LOCKSMITH_JOB_TYPES)[number]

/** Sub-type when the customer needs a new key cut/programmed vs a spare copy. */
export const KEY_REPLACEMENT_MODES = ["Origination", "Duplication"] as const

export type KeyReplacementMode = (typeof KEY_REPLACEMENT_MODES)[number]

export function isIntakeLocksmithJobType(value: string): value is IntakeLocksmithJobType {
  return (INTAKE_LOCKSMITH_JOB_TYPES as readonly string[]).includes(value)
}

export function isKeyReplacementMode(value: string): value is KeyReplacementMode {
  return (KEY_REPLACEMENT_MODES as readonly string[]).includes(value)
}

/** True when a service type is fully selected (Key replacement also needs origination vs duplication). */
export function isIntakeJobTypeComplete(jobType: string, keyReplacementMode: string): boolean {
  if (!isIntakeLocksmithJobType(jobType)) return false
  if (jobType === "Key replacement") return isKeyReplacementMode(keyReplacementMode)
  return true
}

/** Value stored on the job / dispatch map (e.g. "Key replacement — Origination"). */
export function formatIntakeJobTypeForDispatch(jobType: string, keyReplacementMode: string): string {
  if (jobType === "Key replacement" && isKeyReplacementMode(keyReplacementMode)) {
    return `Key replacement — ${keyReplacementMode}`
  }
  return jobType
}
