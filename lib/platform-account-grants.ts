// What the PLATFORM allows a business account to do at all.
//
// The tier above owner. Same vocabulary as staff capabilities on purpose: one word means
// one thing at every level, so "who can see the customer book?" is answered by reading the
// same key in two places instead of two different systems.
//
// Defaults are the INVERSE of staff capabilities, and deliberately so:
//
//   staff     start with nothing — the owner grants outward
//   accounts  start with everything — the platform admin restricts inward
//
// An owner who has paid for the product is not waiting on anyone to switch their own
// console on. A missing key therefore reads as GRANTED here, where a missing key reads as
// denied for staff. Both defaults fail in the safe direction for the person they describe.

import { ALL_CAPABILITIES_GRANTED, DEFAULT_RECEPTIONIST_CAPABILITIES } from "@/lib/receptionist-capabilities"
import type { ReceptionistCapabilities } from "@/lib/types"

/** Same keys as staff capabilities — the platform ceiling for one business account. */
export type PlatformAccountGrants = ReceptionistCapabilities

export const ALL_PLATFORM_GRANTS: PlatformAccountGrants = ALL_CAPABILITIES_GRANTED

/**
 * Tolerant of a missing column, a partial object, or unknown keys — and unlike staff
 * capabilities, an absent key means GRANTED. Every existing account predates this column,
 * and none of them should lose a feature because a migration has not run yet.
 */
export function parsePlatformAccountGrants(raw: unknown): PlatformAccountGrants {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const keys = Object.keys(DEFAULT_RECEPTIONIST_CAPABILITIES) as (keyof PlatformAccountGrants)[]
  return keys.reduce((grants, key) => {
    grants[key] = obj[key] !== false
    return grants
  }, {} as PlatformAccountGrants)
}

/**
 * The rule the whole permission model rests on: nobody exceeds the ceiling above them.
 *
 * effective = what the platform allows this account  AND  what this actor was granted
 *
 * An owner passes their own grants through unchanged (their staff layer is "everything").
 * A receptionist with crm_access on an account the platform has restricted still gets
 * nothing — which is what makes the platform admin the master rather than an advisory.
 */
export function intersectGrants(
  platform: PlatformAccountGrants,
  actor: ReceptionistCapabilities
): ReceptionistCapabilities {
  const keys = Object.keys(DEFAULT_RECEPTIONIST_CAPABILITIES) as (keyof ReceptionistCapabilities)[]
  return keys.reduce((effective, key) => {
    effective[key] = platform[key] === true && actor[key] === true
    return effective
  }, {} as ReceptionistCapabilities)
}
