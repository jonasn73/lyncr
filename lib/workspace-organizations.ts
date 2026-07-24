/** localStorage key for the owner's active business workspace (organization) id. */
export const ACTIVE_ORGANIZATION_STORAGE_KEY = "lyncr_active_organization_id"

/** Cookie mirror so SSR can pick the same org as the client (avoids business-name flash). */
export const ACTIVE_ORGANIZATION_COOKIE = "lyncr_active_organization_id"

const ACTIVE_ORG_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 365

/**
 * Fix common display-name typos so webhook branding and the dashboard switcher match.
 * Example: "Key Squad 5o2" (letter o) → "Key Squad 502" (digit zero).
 */
export function normalizeWorkspaceDisplayName(raw: string): string {
  // Trim ends so create/rename APIs get a clean name.
  let name = raw.trim()
  // Replace letter-o lookalikes next to 5/2 (5o2 / 5O2) with the digit zero.
  name = name.replace(/\b5[oO]2\b/g, "502")
  return name
}

/** Parse active org id from a Cookie header / next/headers cookie value. */
export function readActiveOrganizationIdFromCookieHeader(
  cookieHeader: string | null | undefined
): string | null {
  if (!cookieHeader) return null
  const parts = cookieHeader.split(";")
  for (const part of parts) {
    const [rawKey, ...rest] = part.trim().split("=")
    if (rawKey !== ACTIVE_ORGANIZATION_COOKIE) continue
    const value = decodeURIComponent(rest.join("=").trim())
    return value || null
  }
  return null
}

function readActiveOrganizationIdFromDocumentCookie(): string | null {
  if (typeof document === "undefined") return null
  try {
    return readActiveOrganizationIdFromCookieHeader(document.cookie)
  } catch {
    return null
  }
}

function writeActiveOrganizationCookie(organizationId: string | null): void {
  if (typeof document === "undefined") return
  try {
    if (!organizationId) {
      document.cookie = `${ACTIVE_ORGANIZATION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
      return
    }
    document.cookie = `${ACTIVE_ORGANIZATION_COOKIE}=${encodeURIComponent(organizationId)}; Path=/; Max-Age=${ACTIVE_ORG_COOKIE_MAX_AGE_SEC}; SameSite=Lax`
  } catch {
    /* private mode */
  }
}

export function readActiveOrganizationId(): string | null {
  if (typeof window === "undefined") return null
  try {
    const fromStorage = localStorage.getItem(ACTIVE_ORGANIZATION_STORAGE_KEY)?.trim()
    if (fromStorage) return fromStorage
    return readActiveOrganizationIdFromDocumentCookie()
  } catch {
    return readActiveOrganizationIdFromDocumentCookie()
  }
}

/**
 * Persist active org to localStorage + cookie.
 * Cookie lets the next SSR paint the same business name as the client.
 */
export function writeActiveOrganizationId(organizationId: string | null): void {
  if (typeof window === "undefined") return
  try {
    const next = organizationId?.trim() || null
    const prev = readActiveOrganizationId()
    // Always keep the cookie in sync (even when localStorage already matches).
    writeActiveOrganizationCookie(next)
    if (prev === next) return
    if (!next) localStorage.removeItem(ACTIVE_ORGANIZATION_STORAGE_KEY)
    else localStorage.setItem(ACTIVE_ORGANIZATION_STORAGE_KEY, next)
    window.dispatchEvent(new CustomEvent("lyncr-organization-changed", { detail: { organizationId: next } }))
    notifyWorkspaceDataChanged({ organizationId: next })
  } catch {
    // ignore quota / private mode
  }
}

/** One-shot: keep localStorage and cookie aligned so SSR and client pick the same org. */
export function ensureActiveOrganizationCookie(): void {
  if (typeof window === "undefined") return
  try {
    const fromStorage = localStorage.getItem(ACTIVE_ORGANIZATION_STORAGE_KEY)?.trim() || null
    if (fromStorage) {
      writeActiveOrganizationCookie(fromStorage)
      return
    }
    const fromCookie = readActiveOrganizationIdFromDocumentCookie()
    if (fromCookie) {
      localStorage.setItem(ACTIVE_ORGANIZATION_STORAGE_KEY, fromCookie)
    }
  } catch {
    /* ignore */
  }
}

/** Tell mounted dashboard views (scheduler pool, routing stats, etc.) to re-fetch. */
export function notifyWorkspaceDataChanged(detail?: {
  organizationId?: string | null
  reason?: string
}): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent("lyncr-workspace-data-changed", { detail }))
}

/** Append ?organization_id= when a workspace is selected (for dashboard API fetches). */
export function organizationQueryString(organizationId: string | null | undefined): string {
  const id = organizationId?.trim()
  if (!id || id.startsWith("legacy-")) return ""
  return `?organization_id=${encodeURIComponent(id)}`
}
