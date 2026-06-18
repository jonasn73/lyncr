// Resolve which industry-specific intake layout to show for a workspace or live call.

import { resolveBusinessType, type ReceptionistBusinessType } from "@/lib/business-type"

export type IntakeWorkspaceProfile = ReceptionistBusinessType

/** Name-based hints when industry_tag is missing (e.g. "Key Squad 502", "Fresh Auto Detail"). */
function profileFromOrganizationName(name: string | null | undefined): IntakeWorkspaceProfile | null {
  const n = (name ?? "").toLowerCase()
  if (!n.trim()) return null
  if (/\b(key|keys|locksmith|lock\s?out|akl)\b/.test(n)) return "locksmith"
  if (/\b(detail|detailing|carwash|wash|wax|ceramic)\b/.test(n)) return "detailing"
  if (/\b(repair|mechanic|body\s?shop|collision|garage)\b/.test(n)) return "auto_repair"
  return null
}

/** Pick the dominant industry tag from workspace phone lines. */
function profileFromIndustryTags(tags: Array<string | null | undefined>): IntakeWorkspaceProfile | null {
  const counts: Partial<Record<IntakeWorkspaceProfile, number>> = {}
  for (const raw of tags) {
    const p = resolveBusinessType(raw)
    counts[p] = (counts[p] ?? 0) + 1
  }
  let best: IntakeWorkspaceProfile | null = null
  let bestN = 0
  for (const [p, n] of Object.entries(counts) as [IntakeWorkspaceProfile, number][]) {
    if (p === "generic") continue
    if (n > bestN) {
      best = p
      bestN = n
    }
  }
  return best
}

/** Owner scheduler + receptionist: locksmith vs detailing vs generic intake layout. */
export function resolveWorkspaceIntakeProfile(params: {
  organizationName?: string | null
  industryTags?: Array<string | null | undefined>
  /** Receptionist live call already resolved business type from the ringing line. */
  callBusinessType?: ReceptionistBusinessType | null
}): IntakeWorkspaceProfile {
  if (params.callBusinessType && params.callBusinessType !== "generic") {
    return params.callBusinessType
  }
  const fromTags = profileFromIndustryTags(params.industryTags ?? [])
  if (fromTags) return fromTags
  const fromName = profileFromOrganizationName(params.organizationName)
  if (fromName) return fromName
  return "generic"
}
