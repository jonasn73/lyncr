/** Authenticated JSON fetcher for SWR hooks. */

export async function swrJsonFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include", cache: "no-store" })
  if (!res.ok) {
    const err = new Error(`Request failed (${res.status})`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return res.json() as Promise<T>
}
