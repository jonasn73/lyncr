// Maps a line's industry/skill tag to the receptionist intake form variant.

export type { ReceptionistBusinessType } from "@/lib/types"
import type { ReceptionistBusinessType } from "@/lib/types"

/** Resolve which live intake form a receptionist should see for a given industry tag. */
export function resolveBusinessType(industryTag: string | null | undefined): ReceptionistBusinessType {
  const tag = (industryTag ?? "").toLowerCase().replace(/[-\s]+/g, "_")
  if (!tag) return "generic"
  // Token-aware so multi-word slugs resolve correctly: "auto_detailing" -> detailing,
  // "auto_repair" -> auto_repair, instead of both collapsing to the coarse "auto" head.
  const tokens = tag.split("_")
  const has = (...keywords: string[]) => keywords.some((k) => tokens.includes(k))

  // Specific verticals first, BEFORE the broad "auto"/"automotive" -> locksmith rule.
  if (has("detailing", "detail", "carwash", "car", "wash")) return "detailing"
  if (has("repair", "mechanic", "collision", "bodyshop", "autobody")) return "auto_repair"
  // Locksmith / key work and generic "automotive" lines.
  if (has("locksmith", "automotive", "auto", "key", "keys")) return "locksmith"
  return "generic"
}
