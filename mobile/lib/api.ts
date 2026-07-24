/**
 * API base URL for the Next.js backend.
 * - Development: use your machine's IP (e.g. http://192.168.1.10:3000) or a tunnel (ngrok).
 * - Production: use your deployed Next.js URL (e.g. https://lyncr.app).
 * Cookies from the API are sent with credentials: 'include'.
 */
// Production default is the live API; override with EXPO_PUBLIC_API_URL for local/dev.
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "https://lyncr.app"

/** GET request with credentials (sends cookies). */
export async function apiGet<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json" },
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const err = new Error((data as { error?: string }).error ?? "Request failed")
    ;(err as Error & { status?: number }).status = res.status
    throw err
  }
  return res.json()
}

/** POST/PUT with JSON body and credentials. */
export async function apiMutate(
  path: string,
  options: { method?: "POST" | "PUT" | "PATCH" | "DELETE"; body?: Record<string, unknown> }
): Promise<Response> {
  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: options.body != null ? JSON.stringify(options.body) : undefined,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error ?? res.statusText)
  }
  return res
}
