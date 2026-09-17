// Industry / specialty tags for the managed receptionist routing pool.
//
// There is no fixed tag taxonomy: app/api/admin/network-agents/route.ts lets an admin
// tag an agent with any free-text slug, and lib/db.ts's resolveIndustryTagForLine
// matches it directly against `users.industry` — any of the 31 ids in
// business-industries.ts's SIGNUP_INDUSTRY_OPTIONS works. SKILL_LABELS below only
// covers the tags known to be in live use well enough to deserve a friendly display
// label; formatRoutingPoolSkillLabel title-cases anything else on the fly.

const SKILL_LABELS: Record<string, string> = {
  auto_detailing: "Auto Detailing",
  auto_repair: "Auto Repair",
  locksmith: "Locksmith",
  // Kept so any pre-existing agents still tagged "automotive" render with a friendly label.
  automotive: "Automotive",
  general_support: "General support",
  real_estate: "Real estate",
  medical: "Medical",
  legal: "Legal",
  home_services: "Home services",
  retail: "Retail",
  generic: "General",
}

/** Normalize a tag for storage/comparison — lowercase, underscores, trimmed. */
export function normalizeRoutingPoolSkillTag(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
}

/** Human-readable label for admin badges and UI (e.g. real_estate → Real estate). */
export function formatRoutingPoolSkillLabel(tag: string): string {
  const key = normalizeRoutingPoolSkillTag(tag)
  return SKILL_LABELS[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Parse Postgres TEXT[] or JSON array into a deduped string list. */
export function parseSkillsArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return [...new Set(value.map((v) => normalizeRoutingPoolSkillTag(String(v))).filter(Boolean))]
  }
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      const inner = trimmed.slice(1, -1).trim()
      if (!inner) return []
      return [
        ...new Set(
          inner
            .split(",")
            .map((part) => normalizeRoutingPoolSkillTag(part.replace(/^"|"$/g, "")))
            .filter(Boolean)
        ),
      ]
    }
  }
  return []
}

export type RoutingPoolMode = "sequential" | "simultaneous"

export function parseRoutingPoolMode(raw: unknown): RoutingPoolMode {
  return String(raw ?? "").toLowerCase() === "simultaneous" ? "simultaneous" : "sequential"
}

/** Map certification code (e.g. automotive_core) → routing pool tag (automotive). */
export function routingSkillTagFromCertCode(codeIdentifier: string): string {
  const normalized = normalizeRoutingPoolSkillTag(codeIdentifier)
  const withoutCore = normalized.replace(/_core$/, "")
  const base = withoutCore.split("_")[0]
  return base || normalized
}
