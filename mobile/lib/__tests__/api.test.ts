import { apiGet, apiMutate, API_URL } from "../api"

function mockFetchOnce(response: { ok: boolean; status?: number; json: () => Promise<unknown> }) {
  const fetchMock = jest.fn().mockResolvedValue(response)
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

describe("apiGet", () => {
  afterEach(() => jest.restoreAllMocks())

  it("resolves with the parsed JSON body on success", async () => {
    mockFetchOnce({ ok: true, json: () => Promise.resolve({ calls: [1, 2, 3] }) })
    const result = await apiGet<{ calls: number[] }>("/api/calls")
    expect(result).toEqual({ calls: [1, 2, 3] })
  })

  it("always sends credentials: include, so the session cookie reaches the API", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: () => Promise.resolve({}) })
    await apiGet("/api/auth/session")
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/api/auth/session`,
      expect.objectContaining({ credentials: "include", method: "GET" })
    )
  })

  it("throws with the server's error message and attaches the HTTP status", async () => {
    mockFetchOnce({ ok: false, status: 401, json: () => Promise.resolve({ error: "Not authenticated" }) })
    await expect(apiGet("/api/dashboard")).rejects.toMatchObject({
      message: "Not authenticated",
      status: 401,
    })
  })

  it("falls back to a generic message when the error body isn't valid JSON", async () => {
    mockFetchOnce({ ok: false, status: 500, json: () => Promise.reject(new Error("not json")) })
    await expect(apiGet("/api/dashboard")).rejects.toMatchObject({ message: "Request failed" })
  })
})

describe("apiMutate", () => {
  afterEach(() => jest.restoreAllMocks())

  it("defaults to POST, sends the body as JSON, and includes credentials", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: () => Promise.resolve({}) })
    await apiMutate("/api/jobs", { body: { title: "New job" } })
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/api/jobs`,
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ title: "New job" }),
      })
    )
  })

  it("honors an explicit method", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: () => Promise.resolve({}) })
    await apiMutate("/api/jobs/1", { method: "DELETE" })
    expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/api/jobs/1`, expect.objectContaining({ method: "DELETE" }))
  })

  it("throws the server's error message on a non-ok response", async () => {
    mockFetchOnce({ ok: false, status: 400, json: () => Promise.resolve({ error: "Invalid job" }) })
    await expect(apiMutate("/api/jobs", { body: {} })).rejects.toThrow("Invalid job")
  })
})
