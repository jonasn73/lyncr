/**
 * Active workspace name for header SSR — session + paint cookie.
 * Org id cookie alone cannot paint “Key Squad 502” on hard refresh.
 */

import {
  paintSeedCookieName,
  readPaintSeedCookieValue,
  writePaintSeedCookie,
} from "@/lib/paint-seed-cookie"
import { persistedCacheKey, writePersistedCache } from "@/lib/swr/persisted-cache"

const WORKSPACE_LABEL_CACHE_SCOPE = "workspace-label"
const WORKSPACE_LABEL_SESSION_KEY = persistedCacheKey(WORKSPACE_LABEL_CACHE_SCOPE, "active")
export const WORKSPACE_LABEL_COOKIE = paintSeedCookieName(WORKSPACE_LABEL_CACHE_SCOPE)

export type WorkspaceLabelCache = {
  organizationId: string | null
  name: string
}

function isValidLabel(cached: WorkspaceLabelCache | null | undefined): cached is WorkspaceLabelCache {
  return Boolean(cached && typeof cached.name === "string" && cached.name.trim().length > 0)
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
