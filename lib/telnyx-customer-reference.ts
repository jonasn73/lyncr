// Encode/decode Telnyx port order `customer_reference` for multi-tenant workspace routing.

const LEGACY_PREFIX = "zing-"
const CURRENT_PREFIX = "lyncr-"

export type ParsedLyncrCustomerReference = {
  userId: string
  organizationId: string | null
}

/** @deprecated Use ParsedLyncrCustomerReference */
export type ParsedZingCustomerReference = ParsedLyncrCustomerReference

function parsePrefixedCustomerReference(
  ref: string,
  prefix: string
): ParsedLyncrCustomerReference | null {
  const trimmed = ref.trim()
  if (!trimmed.startsWith(prefix)) return null
  const rest = trimmed.slice(prefix.length)
  const sep = rest.indexOf("--")
  if (sep >= 0) {
    const userId = rest.slice(0, sep).trim()
    const organizationId = rest.slice(sep + 2).trim()
    if (!userId) return null
    return { userId, organizationId: organizationId || null }
  }
  const userId = rest.trim()
  return userId ? { userId, organizationId: null } : null
}

/** Build Telnyx customer_reference — optionally scoped to one organization workspace. */
export function buildLyncrCustomerReference(userId: string, organizationId?: string | null): string {
  const uid = userId.trim()
  const org = organizationId?.trim()
  if (org && !org.startsWith("legacy-")) return `${CURRENT_PREFIX}${uid}--${org}`
  return `${CURRENT_PREFIX}${uid}`
}

/** @deprecated Use buildLyncrCustomerReference */
export function buildZingCustomerReference(userId: string, organizationId?: string | null): string {
  return buildLyncrCustomerReference(userId, organizationId)
}

/** Parse `lyncr-…` or legacy `zing-<userId>` / `zing-<userId>--<organizationId>`. */
export function parseLyncrCustomerReference(ref: string): ParsedLyncrCustomerReference | null {
  return (
    parsePrefixedCustomerReference(ref, CURRENT_PREFIX) ??
    parsePrefixedCustomerReference(ref, LEGACY_PREFIX)
  )
}

/** @deprecated Use parseLyncrCustomerReference */
export function parseZingCustomerReference(ref: string): ParsedLyncrCustomerReference | null {
  return parseLyncrCustomerReference(ref)
}

function isCustomerReferenceString(value: string): boolean {
  return value.startsWith(CURRENT_PREFIX) || value.startsWith(LEGACY_PREFIX)
}

/** Walk webhook JSON for a lyncr/zing customer_reference string. */
export function findLyncrCustomerReferenceInPayload(obj: unknown): string | null {
  if (obj == null) return null
  if (typeof obj === "string") return null
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findLyncrCustomerReferenceInPayload(item)
      if (found) return found
    }
    return null
  }
  if (typeof obj === "object") {
    const o = obj as Record<string, unknown>
    const cr = o.customer_reference
    if (typeof cr === "string" && isCustomerReferenceString(cr)) return cr
    for (const value of Object.values(o)) {
      const found = findLyncrCustomerReferenceInPayload(value)
      if (found) return found
    }
  }
  return null
}

/** @deprecated Use findLyncrCustomerReferenceInPayload */
export function findZingCustomerReferenceInPayload(obj: unknown): string | null {
  return findLyncrCustomerReferenceInPayload(obj)
}
