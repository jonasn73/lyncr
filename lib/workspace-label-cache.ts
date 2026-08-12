/**
 * Active workspace name for header SSR — session + paint cookie.
 * Org id cookie alone cannot paint “Key Squad 502” on hard refresh.
 */

import {
  paintSeedCookieName,
  readPaintSeedCookie,
  readPaintSeedCookieValue,
  writePaintSeedCookie,
} from "@/lib/paint-seed-cookie"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"

export const WORKSPACE_LABEL_CACHE_SCOPE = "workspace-label"
export const WORKSPACE_LABEL_SESSION_KEY = persistedCacheKey(WORKSPACE_LABEL_CACHE_SCOPE, "active")
export const WORKSPACE_LABEL_COOKIE = paintSeedCookieName(WORKSPACE_LABEL_CACHE_SCOPE)

export type WorkspaceLabelCache = {
  organizationId: string | null
  name: string
}

function isValidLabel(cached: WorkspaceLabelCache | null | undefined): cached is WorkspaceLabelCache {
  return Boolean(cached && typeof cached.name === "string" && cached.name.trim().length > 0)
}

/**
 * Paint seed first (SSR HTML), then session, then document cookie.
 * Pass `paint` from useDashboardPaintSeeds().workspace during render/SSR.
 * Prefer paint over session when both exist (React #418). Session fills gaps
 * only inside useState / useSessionSeed — not every-render UI branching.
 */
export function readWorkspaceLabelCache(
  paint?: WorkspaceLabelCache | null
): WorkspaceLabelCache | null {
  if (isValidLabel(paint)) {
    return { organizationId: paint.organizationId ?? null, name: paint.name.trim() }
  }

  const fromSession = readPersistedCache<WorkspaceLabelCache>(WORKSPACE_LABEL_SESSION_KEY)
  if (isValidLabel(fromSession)) {
    return { organizationId: fromSession.organizationId ?? null, name: fromSession.name.trim() }
  }

  const fromCookie = readPaintSeedCookie<WorkspaceLabelCache>(WORKSPACE_LABEL_CACHE_SCOPE)
  if (!isValidLabel(fromCookie)) return null
  return { organizationId: fromCookie.organizationId ?? null, name: fromCookie.name.trim() }
}

/** Read workspace label paint cookie from Next.js cookies().get(name)?.value. */
export function readWorkspaceLabelFromCookieRaw(
  cookieRaw: string | null | undefined
): WorkspaceLabelCache | null {
  const parsed = readPaintSeedCookieValue<WorkspaceLabelCache>(cookieRaw)
  if (!isValidLabel(parsed)) return null
  return { organizationId: parsed.organizationId ?? null, name: parsed.name.trim() }
}

/** Persist after org list / active org is known (session + cookie). */
export function writeWorkspaceLabelCache(next: WorkspaceLabelCache): void {
  const name = next.name.trim()
  if (!name) return
  const payload: WorkspaceLabelCache = {
    organizationId: next.organizationId ?? null,
    name,
  }
  writePersistedCache(WORKSPACE_LABEL_SESSION_KEY, payload)
  writePaintSeedCookie(WORKSPACE_LABEL_CACHE_SCOPE, payload)
}
