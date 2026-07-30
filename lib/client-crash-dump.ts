/** Persist the last client React crash so app/error.tsx can show a useful stack. */

export type ClientCrashDump = {
  at: number
  message: string
  stack: string | null
  componentStack: string | null
}

const KEY = "lyncr:last-client-crash"

export function writeClientCrashDump(dump: ClientCrashDump): void {
  if (typeof window === "undefined") return
  try {
    sessionStorage.setItem(KEY, JSON.stringify(dump))
  } catch {
    /* private mode / quota */
  }
}

export function readClientCrashDump(): ClientCrashDump | null {
  if (typeof window === "undefined") return null
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    return JSON.parse(raw) as ClientCrashDump
  } catch {
    return null
  }
}

export function clearClientCrashDump(): void {
  if (typeof window === "undefined") return
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
