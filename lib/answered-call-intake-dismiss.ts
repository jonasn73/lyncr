// Cross-tab + persistent dismiss state for the owner answered-call intake sheet.

const STORAGE_PREFIX = "zing_answered_intake_dismissed_v2"
const LEGACY_SESSION_KEY = "zing_answered_customer_popup_seen_v1"
const BROADCAST_PREFIX = "zing-answered-intake"
const MAX_IDS = 200

function storageKey(ownerUserId: string): string {
  return `${STORAGE_PREFIX}:${ownerUserId}`
}

function channelName(ownerUserId: string): string {
  return `${BROADCAST_PREFIX}:${ownerUserId}`
}

function readIds(ownerUserId: string): Set<string> {
  if (typeof window === "undefined") return new Set()
  try {
    const raw = localStorage.getItem(storageKey(ownerUserId))
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    const ids = new Set(Array.isArray(parsed) ? parsed.map(String) : [])
    const legacy = sessionStorage.getItem(LEGACY_SESSION_KEY)
    if (legacy) {
      const legacyIds = JSON.parse(legacy) as unknown
      if (Array.isArray(legacyIds)) {
        for (const id of legacyIds) ids.add(String(id))
      }
      sessionStorage.removeItem(LEGACY_SESSION_KEY)
      localStorage.setItem(storageKey(ownerUserId), JSON.stringify([...ids].slice(-MAX_IDS)))
    }
    return ids
  } catch {
    return new Set()
  }
}

function writeIds(ownerUserId: string, ids: Set<string>) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(storageKey(ownerUserId), JSON.stringify([...ids].slice(-MAX_IDS)))
  } catch {
    /* quota */
  }
}

function broadcast(ownerUserId: string, callLogIds: string[]) {
  if (typeof window === "undefined" || callLogIds.length === 0) return
  try {
    const channel = new BroadcastChannel(channelName(ownerUserId))
    channel.postMessage({ type: "dismissed", callLogIds })
    channel.close()
  } catch {
    /* BroadcastChannel unavailable */
  }
}

/** Load dismissed call ids for this owner (localStorage, migrates legacy sessionStorage). */
export function loadAnsweredIntakeDismissed(ownerUserId: string): Set<string> {
  return readIds(ownerUserId)
}

/** True when this call should not reopen the intake sheet. */
export function isAnsweredIntakeDismissed(ownerUserId: string, callLogId: string | null | undefined): boolean {
  const id = String(callLogId ?? "").trim()
  if (!id) return false
  return readIds(ownerUserId).has(id)
}

/**
 * Mark one or more call ids dismissed in this browser and notify other tabs.
 * Also best-effort persists to the server when a real call_logs UUID is provided.
 */
export function markAnsweredIntakeDismissed(
  ownerUserId: string,
  callLogIds: string | string[],
  options?: { syncServer?: boolean }
): void {
  const ids = (Array.isArray(callLogIds) ? callLogIds : [callLogIds])
    .map((id) => String(id).trim())
    .filter(Boolean)
  if (ids.length === 0) return

  const seen = readIds(ownerUserId)
  for (const id of ids) seen.add(id)
  writeIds(ownerUserId, seen)
  broadcast(ownerUserId, ids)

  if (options?.syncServer === false) return
  for (const id of ids) {
    if (!isUuid(id) || id.startsWith("ring-")) continue
    void fetch(`/api/calls/${encodeURIComponent(id)}/intake-dismissed`, {
      method: "POST",
      credentials: "include",
    }).catch(() => {
      /* offline — local dismiss still applies */
    })
  }
}

/** Subscribe to dismiss events from other tabs (same owner). */
export function subscribeAnsweredIntakeDismissed(
  ownerUserId: string,
  onDismissed: (callLogIds: string[]) => void
): () => void {
  if (typeof window === "undefined") return () => {}
  try {
    const channel = new BroadcastChannel(channelName(ownerUserId))
    channel.onmessage = (event: MessageEvent<{ type?: string; callLogIds?: string[] }>) => {
      if (event.data?.type !== "dismissed") return
      const ids = Array.isArray(event.data.callLogIds) ? event.data.callLogIds.map(String) : []
      if (ids.length === 0) return
      const seen = readIds(ownerUserId)
      for (const id of ids) seen.add(id)
      writeIds(ownerUserId, seen)
      onDismissed(ids)
    }
    return () => channel.close()
  } catch {
    return () => {}
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
