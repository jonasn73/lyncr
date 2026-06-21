// Encode/decode Telnyx port order `customer_reference` for multi-tenant workspace routing.

/** Build Telnyx customer_reference — optionally scoped to one organization workspace. */
export function buildZingCustomerReference(userId: string, organizationId?: string | null): string {
  const uid = userId.trim()
  const org = organizationId?.trim()
  if (org && !org.startsWith("legacy-")) return `zing-${uid}--${org}`
  return `zing-${uid}`
}

export type ParsedZingCustomerReference = {
  userId: string
  organizationId: string | null
}

/** Parse `zing-<userId>` or `zing-<userId>--<organizationId>`. */
export function parseZingCustomerReference(ref: string): ParsedZingCustomerReference | null {
  const trimmed = ref.trim()
  if (!trimmed.startsWith("zing-")) return null
  const rest = trimmed.slice(5)
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

/** Walk webhook JSON for a zing customer_reference string. */
export function findZingCustomerReferenceInPayload(obj: unknown): string | null {
  if (obj == null) return null
  if (typeof obj === "string") return null
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findZingCustomerReferenceInPayload(item)
      if (found) return found
    }
    return null
  }
  if (typeof obj === "object") {
    const o = obj as Record<string, unknown>
    const cr = o.customer_reference
    if (typeof cr === "string" && cr.startsWith("zing-")) return cr
    for (const value of Object.values(o)) {
      const found = findZingCustomerReferenceInPayload(value)
      if (found) return found
    }
  }
  return null
}
